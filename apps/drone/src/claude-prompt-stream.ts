import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export type ClaudePromptStream = {
  sessionKey: string;
  compatibilityKey: string;
  prompt: string;
  runId?: string;
  outputOwner?: boolean;
};

export type ClaudeStreamState = {
  messageIds: string[];
  responseMessageId: string;
};

export function claudeStreamPaths(stdoutPath: string) {
  const hash = crypto.createHash('sha256').update(stdoutPath).digest('hex').slice(0, 32);
  return {
    socketPath: path.join(os.tmpdir(), `drone-claude-${hash}.sock`),
    statePath: `${stdoutPath}.claude-stream.json`,
  };
}

export async function readClaudeStreamState(stdoutPath: string): Promise<ClaudeStreamState | null> {
  try {
    return JSON.parse(await fs.readFile(claudeStreamPaths(stdoutPath).statePath, 'utf8'));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** A durable receipt also resolves a lost HTTP reply, including after daemon restart. */
export async function steerClaudeStream(
  stdoutPath: string,
  id: string,
  prompt: string,
): Promise<boolean> {
  if ((await readClaudeStreamState(stdoutPath))?.messageIds.includes(id)) return true;
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const request = http.request(
        {
          socketPath: claudeStreamPaths(stdoutPath).socketPath,
          path: '/',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            if (response.statusCode === 200) resolve(true);
            else if (response.statusCode === 409) resolve(false);
            else reject(new Error(`Claude stream delivery failed: ${response.statusCode}`));
          });
        },
      );
      request.on('error', reject);
      request.setTimeout(3_000, () =>
        request.destroy(new Error('Claude stream delivery timed out')),
      );
      request.end(JSON.stringify({ id, prompt }));
    });
  } catch (error: any) {
    if ((await readClaudeStreamState(stdoutPath))?.messageIds.includes(id)) return true;
    if (
      error?.code === 'ENOENT' ||
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'FailedToOpenSocket'
    )
      return false;
    // An ambiguous delivery must be retried with the same id, never relaunched.
    throw error;
  }
}

type RunnerConfig = {
  cmd: string;
  args: string[];
  id: string;
  prompt: string;
  socketPath: string;
  statePath: string;
};

// Self-contained because this runs under the durable tmux wrapper, independently
// of the daemon. Keep all dependencies inside the function for serialization.
function runClaudeStream(config: RunnerConfig) {
  const fs = require('node:fs') as typeof import('node:fs');
  const http = require('node:http') as typeof import('node:http');
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const readline = require('node:readline') as typeof import('node:readline');
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const child = spawn(config.cmd, config.args, {
    env: { ...process.env, DRONE_CLAUDE_STREAM: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const accepted = new Set<string>();
  const unacknowledged = new Set<string>();
  let accepting = true;
  let failed = false;
  let sawResult = false;
  const stopAccepting = () => {
    accepting = false;
    server.close();
    child.stdin.end();
  };
  const fail = (error: Error) => {
    failed = true;
    console.error(error.message);
    stopAccepting();
    child.kill('SIGTERM');
  };
  const deliver = (id: string, prompt: string): boolean => {
    if (accepted.has(id)) return true;
    if (!accepting) return false;
    const uuid = crypto.randomUUID();
    accepted.add(id);
    unacknowledged.add(uuid);
    // Persist acceptance before writing stdin. Once accepted, a broken pipe is
    // a failed run, never permission to replay a potentially executed action.
    fs.writeFileSync(
      `${config.statePath}.tmp`,
      JSON.stringify({
        messageIds: [...accepted],
        responseMessageId: id,
      }),
      { mode: 0o600 },
    );
    fs.renameSync(`${config.statePath}.tmp`, config.statePath);
    child.stdin.write(
      JSON.stringify({
        type: 'user',
        uuid,
        session_id: '',
        parent_tool_use_id: null,
        message: { role: 'user', content: prompt },
      }) + '\n',
    );
    return true;
  };
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) request.destroy();
    });
    request.on('end', () => {
      try {
        const input = JSON.parse(body);
        if (
          typeof input.id !== 'string' ||
          !input.id ||
          typeof input.prompt !== 'string' ||
          !input.prompt.trim()
        ) {
          response.writeHead(400).end();
          return;
        }
        response.writeHead(deliver(input.id, input.prompt) ? 200 : 409).end();
      } catch (error: any) {
        response.writeHead(500).end();
        fail(error);
      }
    });
  });
  server.on('error', fail);
  process.once('SIGTERM', () => fail(new Error('Claude stream canceled')));
  process.once('SIGINT', () => fail(new Error('Claude stream canceled')));
  process.once('SIGHUP', () => fail(new Error('Claude stream canceled')));
  child.stdin.on('error', fail);
  child.on('error', fail);
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line: string) => {
    process.stdout.write(line + '\n');
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.parent_tool_use_id) return;
    if (event.type === 'user' && event.uuid) unacknowledged.delete(event.uuid);
    if (event.type === 'result') {
      sawResult = true;
      if (event.is_error || event.subtype !== 'success') failed = true;
      // A result can precede consumption of a follow-up. Only close after the
      // result covering all replayed user inputs; messages may be coalesced.
      if (unacknowledged.size === 0) stopAccepting();
    }
  });
  child.on('close', (code) => {
    accepting = false;
    server.close();
    try {
      fs.unlinkSync(config.socketPath);
    } catch {
      /* already removed */
    }
    process.exitCode = failed || !sawResult || unacknowledged.size > 0 ? 1 : (code ?? 1);
  });
  server.listen(config.socketPath, () => {
    fs.chmodSync(config.socketPath, 0o600);
    try {
      deliver(config.id, config.prompt);
    } catch (error: any) {
      fail(error);
    }
  });
}

export function claudeStreamRunnerScript(config: RunnerConfig): string {
  return `(${runClaudeStream.toString()})(${JSON.stringify(config)});`;
}
