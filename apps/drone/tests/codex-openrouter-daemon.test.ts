import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { codexPromptEnqueue } from '../src/host/api';

test('daemon routes a Codex conversation to OpenRouter and back without persisting the API key in jobs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-router-daemon-'));
  const port = await allocatePort();
  const dataDir = path.join(root, 'data');
  const records = path.join(root, 'requests.jsonl');
  const fake = path.join(root, 'app-server.cjs');
  await fs.writeFile(fake, `
const fs = require('node:fs');
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(records)}, JSON.stringify({ ...message,
    hasCredential: process.env.DRONE_CODEX_OPENROUTER_API_KEY === 'test-router-secret',
  }) + '\\n');
  const params = message.params || {};
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  if (message.method === 'config/read') send({ id: message.id, result: { config: { model_provider: 'openai', model: 'default-model' } } });
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    send({ id: message.id, result: { modelProvider: params.modelProvider || 'openai', thread: { id: params.threadId || 'saved-thread' } } });
  }
  if (message.method === 'turn/start') {
    const turnId = 'turn-' + params.clientUserMessageId;
    send({ id: message.id, result: { turn: { id: turnId } } });
    send({ method: 'item/completed', params: { threadId: 'saved-thread', turnId, item: { id: turnId + '-answer', type: 'agentMessage', text: 'Done' } } });
    send({ method: 'turn/completed', params: { threadId: 'saved-thread', turn: { id: turnId, status: 'completed' } } });
  }
});
`);
  const daemon = Bun.spawn([process.execPath, path.resolve(__dirname, '../src/daemon.ts'),
    '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--token', 'test-token'],
    { stdout: 'ignore', stderr: 'pipe', env: { ...process.env, DRONE_DATA_DIR: root } });
  const client = { baseUrl: `http://127.0.0.1:${port}`, token: 'test-token' };
  const headers = { authorization: `Bearer ${client.token}` };
  try {
    await eventually(async () => (await fetch(`${client.baseUrl}/v1/health`, { headers })).ok);
    for (const [index, model] of ['default-model', 'openrouter:vendor/model', 'default-model'].entries()) {
      const id = `message-${index}`;
      const result = await codexPromptEnqueue(client, {
        id, sessionKey: 'same-chat', model, prompt: 'Continue',
        launchScript: `exec ${quote(process.execPath)} ${quote(fake)}`,
        ...(index === 1 ? { openrouterApiKey: 'test-router-secret' } : {}),
      });
      expect(result.ok).toBe(true);
      await eventually(async () => {
        const response = await fetch(`${client.baseUrl}/v1/prompts/${id}`, { headers });
        const data: any = await response.json();
        const job = data.job ?? data;
        if (job.state === 'failed') throw new Error(job.error || 'prompt failed');
        return job.state === 'done';
      });
      const job = await fs.readFile(path.join(dataDir, 'prompts', 'jobs', `${id}.json`), 'utf8');
      expect(job).not.toContain('test-router-secret');
      expect(JSON.parse(job).codexAppServer.threadId).toBe('saved-thread');
    }
    const requests = (await fs.readFile(records, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(requests.filter((item) => item.method === 'thread/start')).toHaveLength(1);
    expect(requests.filter((item) => item.method === 'thread/resume').map((item) => item.params)).toMatchObject([
      { threadId: 'saved-thread', modelProvider: 'drone_hub_openrouter', model: 'vendor/model' },
      { threadId: 'saved-thread', modelProvider: 'openai', model: 'default-model' },
    ]);
    const turns = requests.filter((item) => item.method === 'turn/start');
    expect(turns.map((item) => item.params.model)).toEqual(['default-model', 'vendor/model', 'default-model']);
    expect(turns.map((item) => item.hasCredential)).toEqual([false, true, false]);
  } finally {
    daemon.kill('SIGTERM');
    await daemon.exited;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 25_000);

async function allocatePort(): Promise<number> {
  const server = net.createServer();
  return await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function eventually(check: () => Promise<boolean>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await Bun.sleep(50);
  }
  throw lastError ?? new Error('Timed out waiting for daemon');
}

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
