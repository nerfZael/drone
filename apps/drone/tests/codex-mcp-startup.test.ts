import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import { CodexAppServerConnection } from '../src/codex-app-server';
import {
  CodexPromptRunManager,
  type CodexPromptMessage,
  type CodexPromptRun,
} from '../src/codex-prompt-run-manager';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function harness(initialMode = 'healthy') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-startup-'));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const modePath = path.join(root, 'mode');
  const logPath = path.join(root, 'requests.jsonl');
  const scriptPath = path.join(root, 'server.cjs');
  fs.writeFileSync(modePath, initialMode);
  fs.writeFileSync(
    scriptPath,
    `
const fs = require('node:fs');
const readline = require('node:readline');
const modePath = ${JSON.stringify(modePath)};
const logPath = ${JSON.stringify(logPath)};
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
let turn = 0;
let discoveryCount = 0;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  fs.appendFileSync(logPath, JSON.stringify({ ...message, pid: process.pid }) + '\\n');
  const mode = fs.readFileSync(modePath, 'utf8');
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    send({ id: message.id, result: { thread: { id: 'thread-1' } } });
  }
  if (message.method === 'mcpServerStatus/list') {
    if (mode === 'starting' && discoveryCount++ === 0) {
      return send({ id: message.id, result: { data: [{ name: 'drone-hub', runtimeStatus: 'starting', tools: {} }], nextCursor: null } });
    }
    if (mode === 'hang') return;
    if (mode === 'error') return send({ id: message.id, error: { message: 'MCP discovery failed' } });
    if (mode === 'missing') return send({ id: message.id, result: { data: [], nextCursor: null } });
    if (mode === 'paginated' && !message.params.cursor) {
      return send({ id: message.id, result: { data: [{ name: 'other', tools: {} }], nextCursor: 'page-2' } });
    }
    if (mode === 'repeated') return send({ id: message.id, result: { data: [], nextCursor: 'same' } });
    send({ id: message.id, result: { data: [{
      name: 'drone-hub', runtimeStatus: mode === 'failed' ? 'failed' : 'connected',
      tools: mode === 'empty' ? {} : { list_drones: { name: 'list_drones' } },
    }], nextCursor: null } });
  }
  if (message.method === 'turn/start') {
    const id = 'turn-' + ++turn;
    send({ id: message.id, result: { turn: { id } } });
    if (mode === 'reconnect') {
      send({ method: 'mcpServer/startupStatus/updated', params: { threadId: 'thread-1', name: 'drone-hub', status: 'starting' } });
    }
    send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id, status: 'completed' } } });
  }
});
`,
  );
  const messages = new Map<string, CodexPromptMessage>();
  const runs = new Map<string, CodexPromptRun>();
  const manager = new CodexPromptRunManager({
    loadMessage: async (id) => messages.get(id) ?? null,
    saveMessage: async (message) => {
      messages.set(message.id, message);
    },
    createRun: async (message, startedAt) => ({
      id: `run-${message.id}`,
      sessionKey: 'chat',
      state: 'running',
      messageIds: [message.id],
      responseMessageId: message.id,
      createdAt: startedAt,
      updatedAt: startedAt,
      startedAt,
      stdoutPath: '',
      stderrPath: '',
    }),
    loadRun: async (id) => runs.get(id) ?? null,
    saveRun: async (run) => {
      runs.set(run.id, run);
    },
    appendRunEvents: async (run) => run,
    appendRunStderr: async () => {},
    mutate: async (operation) => operation(),
  });
  cleanups.push(() => manager.stop());
  const launchScript = `exec '${process.execPath}' '${scriptPath}'`;
  return {
    launchScript,
    setMode: (mode: string) => fs.writeFileSync(modePath, mode),
    requests: () =>
      fs
        .readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    async send(requireDroneHubMcp = true, existingThreadId?: string) {
      const message: CodexPromptMessage = {
        id: `message-${messages.size}`,
        state: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        codexAppServer: {
          sessionKey: 'chat',
          launchScript,
          prompt: 'test',
          requireDroneHubMcp,
          existingThreadId,
        },
      };
      messages.set(message.id, message);
      await manager.enqueue(message);
      const deadline = Date.now() + 2_000;
      while (messages.get(message.id)?.state === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return messages.get(message.id)!;
    },
  };
}

describe('managed Codex MCP startup', () => {
  test.each(['missing', 'empty', 'failed', 'error', 'repeated'])(
    'fails visibly before generation when discovery is %s',
    async (mode) => {
      const h = harness(mode);
      const message = await h.send();
      expect(message.state).toBe('failed');
      expect(message.error).toContain('Drone Hub tools are unavailable');
      expect(message.error).toContain('retry the prompt');
      expect(h.requests().some((request) => request.method === 'turn/start')).toBe(false);
    },
  );

  test('checks a resumed thread once and reuses the healthy connection for later messages', async () => {
    const h = harness();
    expect((await h.send(true, 'thread-1')).state).toBe('done');
    expect((await h.send()).state).toBe('done');
    const requests = h.requests();
    expect(requests.filter((request) => request.method === 'initialize')).toHaveLength(1);
    expect(requests.filter((request) => request.method === 'thread/resume')).toHaveLength(1);
    expect(requests.filter((request) => request.method === 'mcpServerStatus/list')).toHaveLength(1);
    expect(requests.find((request) => request.method === 'mcpServerStatus/list').params).toEqual({
      threadId: 'thread-1',
      detail: 'toolsAndAuthOnly',
    });
    expect(requests.filter((request) => request.method === 'turn/start')).toHaveLength(2);
  });

  test('finds Drone Hub on a later inventory page', async () => {
    const h = harness('paginated');
    expect((await h.send()).state).toBe('done');
    expect(
      h.requests().filter((request) => request.method === 'mcpServerStatus/list'),
    ).toHaveLength(2);
  });

  test('allows in-progress startup to finish before checking the catalog', async () => {
    const h = harness('starting');
    expect((await h.send()).state).toBe('done');
    expect(
      h.requests().filter((request) => request.method === 'mcpServerStatus/list'),
    ).toHaveLength(2);
  });

  test('starts a fresh connection when retrying failed tool discovery', async () => {
    const h = harness('empty');
    expect((await h.send()).state).toBe('failed');
    h.setMode('healthy');
    expect((await h.send()).state).toBe('done');
    const initializations = h.requests().filter((request) => request.method === 'initialize');
    expect(initializations).toHaveLength(2);
    expect(initializations[0].pid).not.toBe(initializations[1].pid);
  });

  test('checks tools again after a reconnect notification', async () => {
    const h = harness('reconnect');
    expect((await h.send()).state).toBe('done');
    h.setMode('empty');
    expect((await h.send()).state).toBe('failed');
    expect(
      h.requests().filter((request) => request.method === 'mcpServerStatus/list'),
    ).toHaveLength(2);
    expect(h.requests().filter((request) => request.method === 'turn/start')).toHaveLength(1);
  });

  test('does not check tools when Drone Hub access is not required', async () => {
    const h = harness('missing');
    expect((await h.send(false)).state).toBe('done');
    expect(h.requests().some((request) => request.method === 'mcpServerStatus/list')).toBe(false);
  });

  test('bounds a stalled inventory request without breaking subsequent RPCs', async () => {
    const h = harness('hang');
    const connection = new CodexAppServerConnection({ launchScript: h.launchScript });
    cleanups.push(() => connection.stop());
    await connection.ready();
    await expect(connection.call('mcpServerStatus/list', {}, 25)).rejects.toThrow(
      'request timed out',
    );
    expect(await connection.call('thread/start', {})).toEqual({ thread: { id: 'thread-1' } });
  });
});
