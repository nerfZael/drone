import { expect, test, spyOn } from 'bun:test';
import path from 'node:path';
import { UsageStore, getUsageStore } from '../src/hub/usage/UsageStore';
import { UsageJournal, getUsageJournal } from '../src/hub/usage/UsageJournal';
import { UsageRecoveryService } from '../src/hub/usage/UsageRecoveryService';
import { trackHubGeneration } from '../src/hub/usage/trackHubGeneration';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { withTempDroneDataDir } from './test-helpers';
import { recordExternalUsage } from '../src/hub/usage/recordExternalUsage';

const observation = { id: 'request', input: 10, output: 5, cacheRead: 4, cacheWrite: 1, reasoning: 2,
  model: 'test', provider: 'test', scope: 'request' as const, complete: true, raw: {} };
const future = () => new Date(Date.now() + 1000).toISOString();

test('steered Codex prompts share one usage execution despite different message start times', () => {
  const store = new UsageStore(':memory:');
  const journal = new UsageJournal(':memory:');
  try {
    const input = { droneId: 'drone', chatId: 'chat', chatName: 'default' };
    const job = { id: 'first', kind: 'codex', state: 'running', startedAt: store.trackingSince,
      codexAppServer: { runId: 'shared-run' }, transcript: { usage: [observation] } };
    recordExternalUsage({ ...input, job }, journal, store);
    recordExternalUsage({ ...input, job: { ...job, id: 'steered', startedAt: future(), state: 'done' } }, journal, store);
    expect(store.analytics().totals.executions).toBe(1);
    expect(store.analytics().totals.total).toBe(20);
    expect(store.analytics().totals.running).toBe(0);
    // A late snapshot from the first prompt cannot reopen or duplicate the shared run.
    recordExternalUsage({ ...input, job }, journal, store);
    expect(store.analytics().totals.total).toBe(20);
    expect(store.analytics().totals.running).toBe(0);
    // Daemon projections retain per-message dates and state; the shared run is authoritative.
    const run = { state: 'done', startedAt: store.trackingSince, updatedAt: future() };
    recordExternalUsage({ ...input, job: { ...job, codexAppServer: { runId: 'shared-run', run } } }, journal, store);
    expect(journal.due(Number.MAX_SAFE_INTEGER)).toHaveLength(0);
  } finally { journal.close(); store.close(); }
});

test('restart distinguishes interrupted native work from external work awaiting reconnection', () => {
  const store = new UsageStore(':memory:');
  const journal = new UsageJournal(':memory:');
  try {
    const native = { id: 'native:turn', agent: 'native', startedAt: store.trackingSince, status: 'running' };
    store.record(native, [observation], false);
    store.record({ ...native, id: 'external:turn', agent: 'codex' }, [observation]);
    store.record({ ...native, id: 'suspended', status: 'suspended' }, [observation]);
    store.record({ ...native, id: 'done', status: 'completed' }, [observation]);
    journal.append({ execution: { ...native, id: 'late-native' }, observations: [observation], replace: false });
    store.beginRecovery(future());
    journal.drain(store);
    let totals = store.analytics().totals;
    expect(totals.running).toBe(0);
    expect(totals.interrupted).toBe(2);
    expect(totals.recovering).toBe(1);
    expect(totals.total).toBe(100);
    // Replay the old start after the final event: do not reopen or downgrade completed work.
    store.record({ ...native, id: 'done' }, [], false);
    expect(store.analytics().totals.interrupted).toBe(2);
    store.record({ ...native, status: 'completed' }, [observation], false);
    store.record({ ...native, id: 'external:turn', agent: 'codex' }, [observation]);
    totals = store.analytics().totals;
    expect(totals.interrupted).toBe(1);
    expect(totals.running).toBe(1);
    expect(totals.recovering).toBe(0);
    expect(totals.total).toBe(100);
  } finally { journal.close(); store.close(); }
});

test('a real killed writer leaves recoverable usage without replaying the model request', async () => {
  await withTempDroneDataDir('usage-kill-', async (directory) => {
    const ledgerFile = path.join(directory, 'isolated-ledger.sqlite');
    const journalFile = path.join(directory, 'isolated-journal.sqlite');
    const storePath = path.resolve('apps/drone/src/hub/usage/UsageStore.ts');
    const journalPath = path.resolve('apps/drone/src/hub/usage/UsageJournal.ts');
    const script = `import {UsageStore} from ${JSON.stringify(storePath)};
      import {UsageJournal} from ${JSON.stringify(journalPath)};
      const store = new UsageStore(${JSON.stringify(ledgerFile)});
      new UsageJournal(${JSON.stringify(journalFile)}).append({execution:{id:'killed',agent:'native',startedAt:store.trackingSince,status:'running'},
        observations:[${JSON.stringify(observation)}],replace:false});
      process.stdout.write('durable'); setInterval(() => {},1000);`;
    const child = Bun.spawn([process.execPath, '-e', script], { env: { ...process.env }, stdout: 'pipe', stderr: 'pipe' });
    try {
      const reader = child.stdout.getReader();
      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toBe('durable');
      reader.releaseLock();
      child.kill('SIGKILL');
      await child.exited;
      const store = new UsageStore(ledgerFile);
      store.beginRecovery(future());
      const journal = new UsageJournal(journalFile);
      try {
        expect(journal.pendingDeliveries()).toBe(1);
        journal.drain(store);
        journal.drain(store);
        expect(store.analytics().totals.total).toBe(20);
        expect(store.analytics().totals.interrupted).toBe(1);
        expect(journal.pendingDeliveries()).toBe(0);
      } finally { journal.close(); store.close(); }
    } finally { child.kill(); await child.exited; }
  });
});

test('helper results survive ledger failure and the model is only called once', async () => {
  await withTempDroneDataDir('usage-helper-recovery-', async () => {
    const store = getUsageStore();
    const write = store.record.bind(store);
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    store.record = () => { throw new Error('ledger temporarily locked'); };
    try {
      const result = await trackHubGeneration('test', 'test', async () => {
        calls++;
        return { text: 'done', usage: { input: 10, output: 5, cacheRead: 4, cacheWrite: 1 } };
      }, true);
      expect(result.text).toBe('done');
      expect(calls).toBe(1);
      expect(getUsageJournal().pendingDeliveries()).toBe(2);
      store.record = write;
      store.beginRecovery(future());
      getUsageJournal().drain(store);
      expect(store.analytics().totals.total).toBe(20);
      expect(store.analytics().totals.running).toBe(0);
      expect(store.analytics().totals.interrupted).toBe(0);
    } finally { store.record = write; warning.mockRestore(); }
  });
});

test('Companion usage survives deletion of its in-memory transcript while the ledger is unavailable', async () => {
  await withTempDroneDataDir('usage-companion-recovery-', async () => {
    const repository = new HubSessionRepository({ inMemory: true, trackUsage: true });
    const store = getUsageStore();
    const write = store.record.bind(store);
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const session = await repository.create({ workspaceRoot: '.', provider: 'test', model: 'test',
        permissionMode: 'read-only', toolProfile: 'read-only' });
      await repository.bindThread('companion:run', session.id);
      store.record = () => { throw new Error('ledger temporarily locked'); };
      await repository.appendRuntimeEvent(session, { version: 1, eventId: 'companion-usage', sessionId: session.id,
        turnId: 'turn', timestamp: store.trackingSince, type: 'usage_observed', model: 'test', provider: 'test',
        purpose: 'chat', complete: true, usage: { input: 10, output: 5, cacheRead: 4, cacheWrite: 1, totalTokens: 20 } });
      await repository.delete(session.id);
      expect(getUsageJournal().pendingDeliveries()).toBe(1);
      store.record = write;
      store.beginRecovery(future());
      getUsageJournal().drain(store);
      expect(store.analytics().totals.total).toBe(20);
      expect(store.analytics().totals.interrupted).toBe(1);
      expect(store.analytics({ groupBy: 'purpose' }).groups[0].key).toBe('companion');
    } finally { store.record = write; repository.close(); warning.mockRestore(); }
  });
});

test('external watches survive restart and collect final usage without a chat row', async () => {
  await withTempDroneDataDir('external-usage-recovery-', async (directory) => {
    const file = path.join(directory, 'watch.sqlite');
    let journal = new UsageJournal(file);
    const store = getUsageStore();
    const watch = { droneId: 'drone', promptId: 'job', chatId: 'deleted-chat', chatName: 'Deleted chat' };
    journal.watch(watch);
    journal.close(); journal = new UsageJournal(file);
    const service = new UsageRecoveryService({ journal: () => journal, store: () => store, lookup: async (saved) => {
      expect(saved.chatId).toBe('deleted-chat');
      return { id: 'job', kind: 'cursor', state: 'done', startedAt: store.trackingSince,
        transcript: { usage: [observation] } };
    } });
    try {
      store.beginRecovery(future());
      await service.recoverOnce(new AbortController().signal);
      expect(store.analytics({ chatId: 'deleted-chat' }).totals.total).toBe(20);
      expect(journal.due(Number.MAX_SAFE_INTEGER)).toHaveLength(0);
      await service.recoverOnce(new AbortController().signal);
      expect(store.analytics().totals.total).toBe(20);
    } finally { journal.close(); }
  });
});

test('unreachable external jobs keep their watch and last counts without becoming failed', async () => {
  const store = new UsageStore(':memory:');
  const journal = new UsageJournal(':memory:');
  const watch = { droneId: 'drone', promptId: 'job', chatId: 'chat', chatName: 'chat' };
  store.record({ id: 'external', agent: 'codex', startedAt: store.trackingSince, status: 'running' }, [observation]);
  store.beginRecovery(future());
  journal.watch(watch);
  const service = new UsageRecoveryService({ journal: () => journal, store: () => store,
    lookup: async () => { throw new Error('daemon offline'); } });
  try {
    await service.recoverOnce(new AbortController().signal);
    expect(journal.due()).toHaveLength(0);
    expect(journal.due(Number.MAX_SAFE_INTEGER)[0].attempts).toBe(1);
    expect(store.analytics().totals.recovering).toBe(1);
    expect(store.analytics().totals.total).toBe(20);
  } finally { journal.close(); store.close(); }
});

test('replaying a pre-crash external running snapshot does not claim the daemon is still running', () => {
  const store = new UsageStore(':memory:');
  const journal = new UsageJournal(':memory:');
  try {
    const execution = { id: 'external', agent: 'codex', startedAt: store.trackingSince, status: 'running' };
    journal.append({ execution, observations: [observation], replace: true });
    store.beginRecovery(future());
    journal.drain(store);
    expect(store.analytics().totals.running).toBe(0);
    expect(store.analytics().totals.recovering).toBe(1);
    store.record({ ...execution, observedAt: new Date(Date.now() + 2000).toISOString() }, [observation]);
    expect(store.analytics().totals.running).toBe(1);
    expect(store.analytics().totals.total).toBe(20);
  } finally { journal.close(); store.close(); }
});

test('a final external snapshot is durable before its watch is acknowledged', async () => {
  await withTempDroneDataDir('usage-final-handoff-', async (directory) => {
    const file = path.join(directory, 'delivery.sqlite');
    let journal = new UsageJournal(file);
    const store = getUsageStore();
    const write = store.record.bind(store);
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    journal.watch({ droneId: 'drone', promptId: 'job', chatId: 'chat', chatName: 'chat' });
    const service = new UsageRecoveryService({ journal: () => journal, store: () => store, lookup: async () => ({
      id: 'job', kind: 'codex', state: 'done', startedAt: store.trackingSince, transcript: { usage: [observation] },
    }) });
    try {
      store.record = () => { throw new Error('ledger unavailable'); };
      await service.recoverOnce(new AbortController().signal);
      expect(journal.due(Number.MAX_SAFE_INTEGER)).toHaveLength(0);
      expect(journal.pendingDeliveries()).toBe(1);
      journal.close(); journal = new UsageJournal(file);
      store.record = (execution, observations, replace) => {
        write(execution, observations, replace);
        throw new Error('crash after ledger commit, before delivery acknowledgement');
      };
      expect(() => journal.drain(store)).toThrow();
      expect(journal.pendingDeliveries()).toBe(1);
      store.record = write;
      journal.drain(store);
      expect(store.analytics().totals.total).toBe(20);
      expect(journal.pendingDeliveries()).toBe(0);
    } finally { store.record = write; journal.close(); warning.mockRestore(); }
  });
});

test('shutdown aborts recovery lookups and retains their watches', async () => {
  const store = new UsageStore(':memory:');
  const journal = new UsageJournal(':memory:');
  journal.watch({ droneId: 'drone', promptId: 'job', chatId: 'chat', chatName: 'chat' });
  const started = Promise.withResolvers<void>();
  const service = new UsageRecoveryService({ journal: () => journal, store: () => store,
    lookup: async (_watch, signal) => {
      started.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    } });
  try {
    service.start();
    await started.promise;
    await service.stop();
    expect(journal.due(Number.MAX_SAFE_INTEGER)).toHaveLength(1);
    expect(journal.due()[0].attempts).toBe(0);
  } finally { await service.stop(); journal.close(); store.close(); }
});

test('a late provisional failure cannot replace newer completed usage', () => {
  const store = new UsageStore(':memory:');
  try {
    const execution = { id: 'external', agent: 'codex', startedAt: store.trackingSince, status: 'done', snapshotAt: future() };
    store.record(execution, [observation]);
    store.record({ ...execution, status: 'failed', snapshotAt: store.trackingSince }, []);
    expect(store.analytics().totals.total).toBe(20);
    expect(store.analytics().totals.missing).toBe(0);
  } finally { store.close(); }
});
