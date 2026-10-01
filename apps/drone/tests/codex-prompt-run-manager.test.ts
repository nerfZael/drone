import { expect, test } from 'bun:test';

import {
  CodexPromptRunManager,
  type CodexPromptRun,
} from '../src/codex-prompt-run-manager';

test('forks Codex at an inclusive saved turn, and verifies the fork before accepting it', async () => {
  const calls: any[] = [];
  const session: any = { threadId: null, threadReady: false, connection: { call: async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === 'config/read') return { config: { model_provider: 'openai', model: 'default-model' } };
    return method === 'thread/fork' ? { modelProvider: 'openai', thread: { id: 'new-thread' } } : { thread: { turns: [{ id: 'turn-1', status: 'completed' }] } };
  } } };
  const manager = new CodexPromptRunManager<any>({} as any);
  expect(await (manager as any).ensureThread(session, { forkThreadId: 'source', forkLastTurnId: 'turn-1' })).toBe('new-thread');
  expect(calls).toEqual([
    { method: 'config/read', params: { includeLayers: false } },
    { method: 'thread/fork', params: { threadId: 'source', lastTurnId: 'turn-1', modelProvider: 'openai', model: 'default-model' } },
    { method: 'thread/read', params: { threadId: 'new-thread', includeTurns: true } },
  ]);
});

test('resolves an older saved Hub message by clientId, not the latest running turn', async () => {
  const calls: any[] = [];
  const session: any = { threadId: null, threadReady: false, connection: { call: async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === 'config/read') return { config: { model_provider: 'openai', model: 'default-model' } };
    if (method === 'thread/fork') return { modelProvider: 'openai', thread: { id: 'new-thread' } };
    return { thread: { turns: params.threadId === 'source'
      ? [{ id: 'turn-1', status: 'completed', items: [{ type: 'userMessage', clientId: 'hub-prompt' }] }, { id: 'turn-2', status: 'inProgress', items: [] }]
      : [{ id: 'turn-1', status: 'completed' }] } };
  } } };
  const manager = new CodexPromptRunManager<any>({} as any);
  await (manager as any).ensureThread(session, { forkThreadId: 'source', forkLastMessageId: 'hub-prompt' });
  expect(calls[2]).toEqual({ method: 'thread/fork', params: { threadId: 'source', lastTurnId: 'turn-1', modelProvider: 'openai', model: 'default-model' } });
});

test('rejects an old server that ignores the boundary without using the resulting live fork', async () => {
  const calls: string[] = [];
  const session: any = { threadId: null, threadReady: false, connection: { call: async (method: string) => {
    calls.push(method);
    if (method === 'config/read') return { config: { model_provider: 'openai', model: 'default-model' } };
    return method === 'thread/fork' ? { modelProvider: 'openai', thread: { id: 'wrong-fork' } } : { thread: { turns: [{ id: 'later-turn', status: 'inProgress' }] } };
  } } };
  const manager = new CodexPromptRunManager<any>({} as any);
  await expect((manager as any).ensureThread(session, { forkThreadId: 'source', forkLastTurnId: 'turn-1' })).rejects.toThrow('did not preserve');
  expect(session.threadId).toBeNull();
  expect(session.threadReady).toBe(false);
  expect(calls).toEqual(['config/read', 'thread/fork', 'thread/read', 'thread/archive']);
});

test('restart recovery preserves a canceled outcome from the durable transcript', async () => {
  const message: any = {
    id: 'message-1',
    state: 'running',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    codexAppServer: { runId: 'run-1', sessionKey: 'session-1' },
  };
  const run: CodexPromptRun = {
    id: 'run-1',
    sessionKey: 'session-1',
    state: 'running',
    messageIds: [message.id],
    responseMessageId: message.id,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    stdoutPath: '/tmp/run-1.stdout',
    stderrPath: '/tmp/run-1.stderr',
    transcript: {
      kind: 'codex',
      message: null,
      threadId: 'thread-1',
      terminalEvent: 'turn.completed',
      terminalStatus: 'canceled',
    },
  };
  let savedRun: CodexPromptRun | null = null;
  let savedMessage: any = null;
  const manager = new CodexPromptRunManager<any>({
    loadMessage: async () => message,
    saveMessage: async (next) => {
      savedMessage = next;
    },
    createRun: async () => run,
    loadRun: async () => run,
    saveRun: async (next) => {
      savedRun = next;
    },
    appendRunEvents: async (current) => current,
    appendRunStderr: async () => {},
    mutate: async (operation) => await operation(),
    now: () => '2026-09-03T00:01:00.000Z',
  });

  await manager.failInterrupted(message, 'daemon restarted');

  expect(savedRun).toMatchObject({ state: 'canceled', pendingApprovals: [] });
  expect(savedMessage).toMatchObject({ state: 'canceled', exitCode: 1 });
});

test('refuses to attach a chat to another chat\'s live Codex thread', async () => {
  const manager = new CodexPromptRunManager<any>({
    loadMessage: async () => null,
    saveMessage: async () => {},
    createRun: async () => { throw new Error('must not start a run'); },
    loadRun: async () => null,
    saveRun: async () => {},
    appendRunEvents: async (current) => current,
    appendRunStderr: async () => {},
    mutate: async (operation) => await operation(),
  });
  const hudKey = 'chat:d6c00def-ec99-4b7f-9233-5c0188615d25';
  (manager as any).sessions.set(hudKey, { key: hudKey, threadId: 'hud-thread' });

  await expect(manager.enqueue({
    id: 'units-message',
    state: 'queued',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    codexAppServer: {
      sessionKey: 'codex-chat:drone-1:431477b1-9fb4-4f42-8c2f-5231e8b2e527',
      existingThreadId: 'hud-thread',
      launchScript: 'exit 1',
      prompt: 'hello',
    },
  })).rejects.toThrow('in use by another chat');
  expect((manager as any).sessions.size).toBe(1);
});
