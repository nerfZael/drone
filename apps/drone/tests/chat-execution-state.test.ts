import { expect, test } from 'bun:test';
import { createChatReconciliationExecutor } from '../src/hub/chat-reconciliation-executor';
import { withTempDroneDataDir } from './test-helpers';

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
