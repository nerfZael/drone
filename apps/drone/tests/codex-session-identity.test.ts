import { expect, test } from 'bun:test';
import { CodexPromptRunManager, type CodexPromptMessage, type CodexPromptRun } from '../src/codex-prompt-run-manager';
import { codexChatSessionKey, codexSessionIdentity } from '../src/codex-session-identity';

const chatId = '1b8ccc28-1440-4010-b5fe-8a538c429b73';
const oldKey = `side-a38d529d:${chatId}`;
const renamedKey = `B:${chatId}`;
const stableKey = codexChatSessionKey('drone-1', chatId);

function harness() {
  const messages = new Map<string, CodexPromptMessage>();
  const runs = new Map<string, CodexPromptRun>();
  const calls: { connection: number; method: string; params: any }[] = [];
  const writers = new Map<string, number>();
  const connections: any[] = [];
  let nextThread = 0;
  let nextTurn = 0;
  const manager = new CodexPromptRunManager<CodexPromptMessage>({
    loadMessage: async (id) => messages.get(id) ?? null,
    saveMessage: async (message) => { messages.set(message.id, message); },
    createRun: async (message, startedAt) => ({
      id: `run-${message.id}`, sessionKey: message.codexAppServer.sessionKey,
      state: 'running', messageIds: [message.id], responseMessageId: message.id,
      createdAt: startedAt, updatedAt: startedAt, startedAt, stdoutPath: '', stderrPath: '',
    }),
    loadRun: async (id) => runs.get(id) ?? null,
    saveRun: async (run) => { runs.set(run.id, run); },
    appendRunEvents: async (run) => run,
    appendRunStderr: async () => {},
    mutate: async (operation) => operation(),
  });
  (manager as any).createConnection = () => {
    const index = connections.length;
    const connection = {
      running: true,
      closeGate: undefined as Promise<void> | undefined,
      async close() {
        await connection.closeGate;
        connection.running = false;
        for (const [thread, owner] of writers) if (owner === index) writers.delete(thread);
      },
      stop() { void connection.close(); },
      async call(method: string, params: any) {
        calls.push({ connection: index, method, params });
        if (method === 'config/read') return { config: { model_provider: 'openai', model: 'test' } };
        if (['thread/start', 'thread/resume', 'thread/fork'].includes(method)) {
          const id = method === 'thread/resume' ? params.threadId : `thread-${++nextThread}`;
          if (writers.has(id) && writers.get(id) !== index) throw new Error(`thread ${id} already has an active writer`);
          writers.set(id, index);
          return { thread: { id } };
        }
        if (method === 'turn/start') return { turn: { id: `turn-${++nextTurn}` } };
        return {};
      },
    };
    connections.push(connection);
    return connection;
  };
  function message(key: string, thread?: string, forkThreadId?: string) {
    const value: CodexPromptMessage = {
      id: `message-${messages.size}`, state: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      codexAppServer: { sessionKey: key, launchScript: 'unused', prompt: 'test', existingThreadId: thread, forkThreadId },
    };
    messages.set(value.id, value);
    return value;
  }
  const session = (value: CodexPromptMessage) => (manager as any).findSession(value.codexAppServer);
  async function complete(value: CodexPromptMessage) {
    const owner = session(value);
    await (manager as any).handleNotification(owner, {
      method: 'turn/completed', params: { threadId: owner.threadId, turn: { id: owner.activeTurnId, status: 'completed' } },
    });
  }
  return { manager, messages, calls, connections, writers, message, session, complete };
}

test('legacy names and permanent keys resolve to the same chat, without collapsing different chats', () => {
  expect(codexSessionIdentity(oldKey)).toBe(codexSessionIdentity(renamedKey));
  expect(codexSessionIdentity(oldKey)).toBe(codexSessionIdentity(stableKey));
  expect(codexSessionIdentity('B:2b8ccc28-1440-4010-b5fe-8a538c429b73')).not.toBe(codexSessionIdentity(oldKey));
  expect(codexSessionIdentity('custom-key')).toBe('custom-key');
  expect(() => codexChatSessionKey('drone', '')).toThrow('stable drone and chat ID');
});

test('idle renamed chats and new hub keys reuse the original writer and history', async () => {
  const h = harness();
  const first = h.message(oldKey, 'saved-thread');
  await h.manager.enqueue(first);
  await h.complete(first);
  for (const key of [renamedKey, stableKey, oldKey]) {
    const next = h.message(key, 'saved-thread');
    await h.manager.enqueue(next);
    await h.complete(next);
    expect(h.messages.get(next.id)?.state).toBe('done');
  }
  expect(h.connections).toHaveLength(1);
  expect(h.calls.filter((call) => call.method === 'thread/resume')).toHaveLength(1);
  expect(h.calls.filter((call) => call.method === 'turn/start').every((call) => call.params.threadId === 'saved-thread')).toBe(true);
});

test('renaming during a turn preserves queues, ownership, cancellation and approvals', async () => {
  const h = harness();
  const first = h.message(oldKey);
  await h.manager.enqueue(first);
  const queued = h.message(stableKey);
  expect(await h.manager.enqueue(queued)).toEqual({ disposition: 'queued' });
  expect(h.manager.ownsMessage(queued)).toBe(true);
  expect((await h.manager.cancel(queued)).state).toBe('canceled');
  const renamed = { ...h.messages.get(first.id)!, codexAppServer: { ...h.messages.get(first.id)!.codexAppServer, sessionKey: renamedKey } };
  expect(h.manager.ownsMessage(renamed)).toBe(true);
  let resolved = false;
  const session = h.session(first);
  session.pendingApprovalCallbacks.set('approval', {
    approval: { id: 'approval', itemId: 'item', method: 'item/commandExecution/requestApproval', availableDecisions: ['accept'] },
    requestId: 1, resolve: () => { resolved = true; },
  });
  await h.manager.resolveApproval(renamed, 'approval', 'accept');
  expect(resolved).toBe(true);
  await h.manager.cancel(renamed);
  expect(h.calls.filter((call) => call.method === 'turn/interrupt')).toHaveLength(1);
  expect(h.connections).toHaveLength(1);
});

test('different legacy keys for the same thread reuse its owner, but a fork gets its own session', async () => {
  const h = harness();
  const first = h.message('legacy-owner', 'saved-thread');
  await h.manager.enqueue(first);
  const next = h.message('different-key', 'saved-thread');
  expect(await h.manager.enqueue(next)).toEqual({ disposition: 'queued' });
  expect(h.manager.ownsMessage(next)).toBe(true);
  await h.manager.cancel(next);
  const fork = h.message('fork-key', 'saved-thread', 'saved-thread');
  await h.manager.enqueue(fork);
  expect(h.connections).toHaveLength(2);
  expect(h.session(fork).threadId).not.toBe('saved-thread');
});

test('an enqueue during idle cleanup waits for writer release before resuming', async () => {
  const h = harness();
  const first = h.message(oldKey, 'saved-thread');
  await h.manager.enqueue(first);
  await h.complete(first);
  let release!: () => void;
  h.connections[0].closeGate = new Promise<void>((resolve) => { release = resolve; });
  const sweep = h.manager.sweepIdle(0);
  const next = h.message(stableKey, 'saved-thread');
  const enqueue = h.manager.enqueue(next);
  await Promise.resolve();
  expect(h.connections).toHaveLength(1);
  release();
  await Promise.all([sweep, enqueue]);
  expect(h.connections).toHaveLength(2);
  expect(h.messages.get(next.id)?.state).toBe('running');
  expect(h.session(next).threadId).toBe('saved-thread');
});

test('idle cleanup rechecks a turn that was queued before the sweep', async () => {
  const h = harness();
  const first = h.message(oldKey, 'saved-thread');
  await h.manager.enqueue(first);
  await h.complete(first);
  const next = h.message(renamedKey, 'saved-thread');
  const enqueue = h.manager.enqueue(next);
  await Promise.all([enqueue, h.manager.sweepIdle(0)]);
  expect(h.connections[0].running).toBe(true);
  expect(h.manager.ownsMessage(next)).toBe(true);
});

test('an external writer is left alone and recovery resumes the saved history after it releases ownership', async () => {
  const h = harness();
  h.writers.set('saved-thread', -1);
  const blocked = h.message(stableKey, 'saved-thread');
  await h.manager.enqueue(blocked);
  expect(h.messages.get(blocked.id)?.state).toBe('failed');
  expect(h.messages.get(blocked.id)?.error).toContain('already has an active writer');
  expect(h.writers.get('saved-thread')).toBe(-1);
  expect(h.calls.some((call) => ['thread/start', 'thread/fork', 'turn/start'].includes(call.method))).toBe(false);
  h.writers.delete('saved-thread');
  const recovered = h.message(renamedKey, 'saved-thread');
  await h.manager.enqueue(recovered);
  expect(h.messages.get(recovered.id)?.state).toBe('running');
  expect(h.session(recovered).threadId).toBe('saved-thread');
});
