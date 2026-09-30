import { expect, test } from 'bun:test';
import { createChatReconciliationExecutor } from '../src/hub/chat-reconciliation-executor';
import { withTempDroneDataDir } from './test-helpers';

test('reconciliation preserves shared execution on live messages and both completed transcript records', async () => {
  await withTempDroneDataDir('shared-execution-', async () => {
    const run = { id: 'original', startedAt: '2026-09-28T18:45:12Z', responseMessageId: 'answer' };
    const finishedAt = '2026-09-28T18:54:39Z';
    const chat: any = { id: 'chat', pendingPrompts: [
      { id: 'original', at: '2026-09-28T18:45:11Z', prompt: 'Start work', state: 'sent' },
      { id: 'answer', at: '2026-09-28T18:47:36Z', prompt: 'My answer', state: 'sent', deliveryMode: 'asap' },
    ], turns: [] };
    let state = 'running';
    const patches: any[] = [];
    const written: any[] = [];
    const noop = () => {};
    const executor = createChatReconciliationExecutor({
      loadRegistry: async () => ({ drones: { drone: { id: 'drone', hostPort: 1, token: 'test', chats: { Plan: chat } } } }),
      importChatFromRegistry: noop, readChatMetadataFromStore: () => ({ available: false }),
      normalizeDroneIdentity: String, normalizeChatName: String,
      droneRuntime: () => 'host', inferChatAgent: () => ({ kind: 'builtin', id: 'codex' }),
      makeClient: () => ({}), dronePromptGet: async (_client: any, id: string) => ({ job: {
        id, kind: 'codex', state, finishedAt,
        startedAt: id === 'original' ? run.startedAt : '2026-09-28T18:47:37Z',
        codexAppServer: { run, turnId: 'provider-turn' },
      } }),
      normalizeChatImageAttachmentRefs: () => [], normalizeChatModel: () => undefined,
      normalizeBuiltinAgentId: String, parseCodexJobTranscript: () => ({ message: 'Done' }),
      resolveCodexTurnRuntime: async () => ({}), sameAgentPlan: () => true,
      resolveTranscriptPromptAt: ({ pendingAt }: any) => pendingAt,
      nowIso: () => finishedAt, hubLog: noop,
      pruneCompletedPendingPrompts: (pending: any) => pending,
      updatePendingPrompt: async ({ id, patch }: any) => patches.push({ id, ...patch }),
      applyChatReconciliationInStore: async ({ turns }: any) => written.push(...turns),
      projectCanonicalChatToRegistry: noop, maybeStartDockerSnapshotForTranscriptTurn: noop,
      enqueuePendingPromptPump: noop, chatHasReconcilablePendingPrompts: () => true,
      scheduleReconcileRetry: noop,
    } as any);
    await executor.reconcileChatFromDaemon({ droneId: 'drone', chatName: 'Plan' });
    expect(patches).toHaveLength(2);
    for (const patch of patches) expect(patch).toMatchObject({ runId: run.id, runStartedAt: run.startedAt });
    state = 'done';
    await executor.reconcileChatFromDaemon({ droneId: 'drone', chatName: 'Plan' });
    expect(written).toHaveLength(2);
    for (const turn of written) expect(turn).toMatchObject({
      runId: run.id, runStartedAt: run.startedAt, codexTurnId: 'provider-turn', completedAt: finishedAt,
    });
    expect(written[0]).toMatchObject({ id: 'original', userOnly: true, output: '' });
    expect(written[1]).toMatchObject({ id: 'answer', output: 'Done', deliveryMode: 'asap' });
  });
});

test('reconciliation distinguishes a delivered queue item from its later running execution', async () => {
  await withTempDroneDataDir('execution-state-', async () => {
    const chat = { id: 'chat', pendingPrompts: [{ id: 'prompt', at: '2026-09-25T00:00:00Z', prompt: 'work', state: 'sent' }], turns: [] };
    let job: any = { id: 'prompt', kind: 'claude', state: 'queued' };
    const patches: any[] = [];
    const noop = () => {};
    const executor = createChatReconciliationExecutor({
      loadRegistry: async () => ({ drones: { drone: { id: 'drone', hostPort: 1, token: 'test', chats: { Graphics: chat } } } }),
      importChatFromRegistry: noop,
      readChatMetadataFromStore: () => ({ available: false }),
      normalizeDroneIdentity: String, normalizeChatName: String,
      droneRuntime: () => 'host', inferChatAgent: () => ({ kind: 'builtin', id: 'claude' }),
      makeClient: () => ({}), dronePromptGet: async () => ({ job }),
      normalizeChatImageAttachmentRefs: () => [], normalizeChatModel: () => undefined,
      normalizeBuiltinAgentId: String,
      parseStructuredAgentJobTranscript: () => ({}), sameAgentPlan: () => true,
      nowIso: () => '2026-09-25T00:10:00Z', hubLog: noop,
      pruneCompletedPendingPrompts: (pending: any) => pending,
      updatePendingPrompt: async ({ patch }: any) => patches.push(patch),
      enqueuePendingPromptPump: noop, chatHasReconcilablePendingPrompts: () => true,
      scheduleReconcileRetry: noop,
    } as any);
    await executor.reconcileChatFromDaemon({ droneId: 'drone', chatName: 'Graphics' });
    expect(patches.at(-1)).toMatchObject({ state: 'sent', executionState: 'queued' });
    expect(patches.at(-1).startedAt).toBeUndefined();
    job = { ...job, state: 'running', startedAt: '2026-09-25T00:10:00Z' };
    await executor.reconcileChatFromDaemon({ droneId: 'drone', chatName: 'Graphics' });
    expect(patches.at(-1)).toMatchObject({ state: 'sent', executionState: 'running', startedAt: job.startedAt });
  });
});
