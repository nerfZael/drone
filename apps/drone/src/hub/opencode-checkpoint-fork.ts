/* eslint-disable @typescript-eslint/no-require-imports -- Serialized helpers load Node built-ins inside the provider process, not the Hub. */

type OpenCodeMessage = {
  info: { id: string; sessionID: string; role: string; parentID?: string; [key: string]: any };
  parts: Array<Record<string, any>>;
};
type SessionRequest = (path: string, method?: string, body?: unknown) => Promise<any>;

/** Runs beside the provider, including in container drones without Hub dependencies. */
export function openCodeCheckpointForkScript(sessionId: string, messageId: string): string {
  return `(${runOpenCodeCheckpointFork.toString()})(${JSON.stringify(sessionId)}, ${JSON.stringify(messageId)}, ${forkOpenCodeCheckpoint.toString()})
    .then(id => process.stdout.write(id))
    .catch(error => { console.error(error.message); process.exitCode = 1; });`;
}

/** OpenCode's cutoff is exclusive. Verify even whole forks against the captured prefix. */
export async function forkOpenCodeCheckpoint(
  request: SessionRequest,
  sessionId: string,
  messageId: string,
): Promise<string> {
  const assert: typeof import('node:assert/strict') = require('node:assert/strict');
  const sourcePath = `/session/${encodeURIComponent(sessionId)}`;
  const messages: OpenCodeMessage[] = await request(`${sourcePath}/message`);
  const index = messages.findIndex((message) => message.info.id === messageId);
  if (index < 0 || messages[index].info.role !== 'assistant') {
    throw new Error(
      'The OpenCode assistant checkpoint is no longer available; the source was not changed.',
    );
  }
  const expected = messages.slice(0, index + 1);
  const nextId = messages[index + 1]?.info.id;
  const fork = await request(`${sourcePath}/fork`, 'POST', nextId ? { messageID: nextId } : {});
  if (!fork?.id || fork.id === sessionId)
    throw new Error('OpenCode did not create a separate fork.');
  const forkPath = `/session/${encodeURIComponent(fork.id)}`;
  try {
    const actual: OpenCodeMessage[] = await request(`${forkPath}/message`);
    assert.equal(actual.length, expected.length);
    const ids = new Map(expected.map((message, i) => [message.info.id, actual[i].info.id]));
    for (let i = 0; i < expected.length; i += 1) {
      const original = expected[i];
      const cloned = actual[i];
      assert.equal(cloned.info.sessionID, fork.id);
      assert.notEqual(cloned.info.id, original.info.id);
      assert.deepEqual(cloned.info, {
        ...original.info,
        id: cloned.info.id,
        sessionID: fork.id,
        ...(original.info.parentID ? { parentID: ids.get(original.info.parentID) } : {}),
      });
      assert.equal(cloned.parts.length, original.parts.length);
      for (let p = 0; p < original.parts.length; p += 1) {
        const part = original.parts[p];
        assert.deepEqual(cloned.parts[p], {
          ...part,
          id: cloned.parts[p].id,
          sessionID: fork.id,
          messageID: cloned.info.id,
          ...(part.type === 'compaction' && part.tail_start_id
            ? { tail_start_id: ids.get(part.tail_start_id) }
            : {}),
        });
      }
    }
    return fork.id;
  } catch {
    // Only this newly-created, unused fork is eligible for cleanup. Never touch the source.
    await request(forkPath, 'DELETE').catch(() => undefined);
    throw new Error(
      'OpenCode fork did not match the selected checkpoint. No prompt was sent; retry the side chat.',
    );
  }
}

// Keep this function self-contained: its source is executed by Node in the drone runtime.
async function runOpenCodeCheckpointFork(
  sessionId: string,
  messageId: string,
  fork: typeof forkOpenCodeCheckpoint,
): Promise<string> {
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
  const password = randomBytes(24).toString('hex');
  const server = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    env: {
      ...process.env,
      OPENCODE_SERVER_USERNAME: 'opencode',
      OPENCODE_SERVER_PASSWORD: password,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Bound diagnostics, and never echo server stdout (it would corrupt the session ID).
  let diagnostics = '';
  server.stderr!.on('data', (data: Buffer) => {
    diagnostics = (diagnostics + data).slice(-2000);
  });
  const terminate = () => {
    server.kill('SIGTERM');
  };
  process.once('SIGTERM', terminate);
  process.once('SIGINT', terminate);
  try {
    const baseUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out starting OpenCode checkpoint server.')),
        30_000,
      );
      let output = '';
      server.stdout!.on('data', (data: Buffer) => {
        output = (output + data).slice(-4000);
        const match = output.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      server.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(`OpenCode checkpoint server stopped. ${diagnostics}`));
      });
    });
    const request: SessionRequest = async (path, method = 'GET', body) => {
      const response = await fetch(
        `${baseUrl}${path}?directory=${encodeURIComponent(process.cwd())}`,
        {
          method,
          headers: {
            authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
            'content-type': 'application/json',
            'x-opencode-directory': encodeURIComponent(process.cwd()),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw new Error(`OpenCode checkpoint API failed (${response.status}).`);
      return response.json();
    };
    return await fork(request, sessionId, messageId);
  } finally {
    process.removeListener('SIGTERM', terminate);
    process.removeListener('SIGINT', terminate);
    server.kill('SIGTERM');
    // Some provider versions do not promptly terminate their HTTP server.
    const killTimer = setTimeout(() => server.kill('SIGKILL'), 2000);
    killTimer.unref();
    server.once('exit', () => clearTimeout(killTimer));
  }
}
