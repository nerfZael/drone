import { describe, expect, test } from 'bun:test';

import { createChatReconciliationExecutor } from '../src/hub/chat-reconciliation-executor';
import {
  formatTranscriptJobFailure,
  parseCodexJobTranscript,
} from '../src/hub/builtin-transcript-sessions';
import { shouldRetryFailedPendingPrompt } from '../src/hub/pendingPromptEnqueue';
import { resolveTranscriptPromptAt } from '../src/hub/transcript-order';

const DRONE_ID = 'drone-1';
const CHAT = 'Review';
const NOW = '2026-09-30T18:55:00.000Z';

function codexJob(transcript: Record<string, unknown>) {
  return {
    id: 'prompt-1',
    kind: 'codex',
    state: 'done',
    startedAt: '2026-09-30T18:50:33.233Z',
    finishedAt: '2026-09-30T18:50:37.207Z',
    exitCode: 0,
    codexAppServer: { turnId: 'turn-1', threadId: 'thread-1' },
    transcript: { kind: 'codex', threadId: 'thread-1', model: 'gpt-6-astra', ...transcript },
  };
}

function harness(opts: { pending: any; job: any; chatId?: string }) {
  const pendingUpdates: any[] = [];
  const storedTurns: any[] = [];
  const retries: string[] = [];
  const reconcile = createChatReconciliationExecutor({
    applyChatReconciliationInStore: async (input: any) => storedTurns.push(...input.turns),
    chatHasReconcilablePendingPrompts: (entry: any) =>
      entry.pendingPrompts.some(
        (p: any) =>
          p.state === 'failed' &&
          shouldRetryFailedPendingPrompt({ error: p.error, updatedAt: p.updatedAt, nowMs: Date.parse(NOW) }),
      ),
    clearScheduledReconcileRetryByKey: () => {},
    collectDroneRuntimeDiagnostics: async () => ({}),
    compactDiagnosticError: String,
    defaultPromptEnqueueTimeoutMs: () => 180_000,
    droneChatMapKey: (d: string, c: string) => `${d}:${c}`,
    dronePromptGet: async () => ({ job: opts.job }),
    droneRuntime: () => 'container',
    enqueuePendingPromptPump: () => {},
    ensureOpenCodeSessionId: async () => null,
    formatTranscriptJobFailure,
    hubLog: () => {},
    importChatFromRegistry: async () => {},
    inferChatAgent: () => ({ kind: 'builtin', id: 'codex' }),
    interruptedPromptDeliveryError: String,
    loadRegistry: async () => ({
      drones: { [DRONE_ID]: { token: 'token', hostPort: 7777, chats: { [CHAT]: {} } } },
    }),
    makeClient: () => ({}),
    maybeStartDockerSnapshotForTranscriptTurn: async () => {},
    normalizeBuiltinAgentId: (v: unknown) => (v === 'codex' ? 'codex' : null),
    normalizeChatImageAttachmentRefs: () => [],
    normalizeChatModel: (v: unknown) => (typeof v === 'string' && v ? v : null),
    normalizeChatName: (v: string) => v,
    normalizeChatReasoning: (v: unknown) => (typeof v === 'string' && v ? v : null),
    normalizeDroneIdentity: (v: string) => v,
    nowIso: () => NOW,
    parseBlipJobTranscript: () => ({}),
    parseCodexJobTranscript,
    parsePiJobTranscript: () => ({}),
    parseStructuredAgentJobTranscript: () => ({}),
    projectCanonicalChatToRegistry: async () => {},
    pruneCompletedPendingPrompts: (list: any[]) => list,
    readChatMetadataFromStore: () => ({ available: true, chat: { id: opts.chatId ?? 'chat-1' } }),
    readChatRowsFromStore: () => ({ available: true, pending: [opts.pending], pendingTurns: [] }),
    recoverStalePromptJobSession: async () => ({}),
    resolveCanonicalDroneOrPendingForReadRef: async () => null,
    resolveCodexTurnRuntime: async ({ pendingModel }: any) => ({ model: pendingModel ?? 'gpt-6-astra' }),
    resolvePendingCodexApprovalsForNeverAsk: async () => {},
    resolveHostPort: async () => 7777,
    resolveTranscriptPromptAt,
    sameAgentPlan: () => true,
    schedulePendingPromptPumpRetry: () => {},
    scheduleReconcileRetry: (d: string, c: string) => retries.push(`${d}:${c}`),
    shouldRetryFailedPendingPrompt: (input: any) =>
      shouldRetryFailedPendingPrompt({ ...input, nowMs: Date.parse(NOW) }),
    stalePendingPromptState: () => null,
    updatePendingPrompt: async (input: any) => pendingUpdates.push(input),
    STOPPED_BY_USER_ERROR: 'stopped',
  });
  return {
    run: () => reconcile.reconcileChatFromDaemon({ droneId: DRONE_ID, chatName: CHAT }),
    pendingUpdates,
    storedTurns,
    retries,
  };
}

const sentPending = {
  id: 'prompt-1',
  at: '2026-09-30T18:50:30.264Z',
  state: 'sent',
  prompt: '<dronehub_event_notification version="1"></dronehub_event_notification>',
  fileChanges: { version: 1, capturedAt: NOW, counts: {}, workspaces: [] },
};

describe('codex reconciliation', () => {
  test('records a completed turn without a final answer as a silent completion', async () => {
    const h = harness({
      pending: sentPending,
      job: codexJob({ message: null, terminalEvent: 'turn.completed', terminalStatus: 'completed' }),
    });

    await h.run();

    expect(h.storedTurns).toHaveLength(1);
    expect(h.storedTurns[0]).toMatchObject({
      id: 'prompt-1',
      ok: true,
      output: '',
      silentCompletion: true,
      codexTurnId: 'turn-1',
    });
    expect(h.pendingUpdates.map((u) => u.patch.state)).toEqual(['sent']);
  });

  test('keeps a truncated transcript without a message as a recoverable failure', async () => {
    const h = harness({
      pending: sentPending,
      job: codexJob({ message: null, terminalStatus: 'completed', stdoutTruncated: true }),
    });

    await h.run();

    expect(h.storedTurns).toHaveLength(0);
    expect(h.pendingUpdates[0].patch).toMatchObject({
      state: 'failed',
      error: 'codex finished but no message was parsed (exit 0)',
    });
  });

  test('re-failing the same way leaves the failure timestamp alone', async () => {
    const failedAt = '2026-09-30T18:50:41.000Z';
    const h = harness({
      pending: {
        ...sentPending,
        state: 'failed',
        error: 'codex finished but no message was parsed (exit 0)',
        updatedAt: failedAt,
      },
      job: codexJob({ message: null }),
    });

    await h.run();

    expect(h.pendingUpdates).toEqual([]);
    expect(h.storedTurns).toEqual([]);
  });

  test('fails a prompt whose daemon job belongs to another chat instead of adopting it', async () => {
    const chatId = '431477b1-9fb4-4f42-8c2f-5231e8b2e527';
    const otherChatId = 'd6c00def-ec99-4b7f-9233-5c0188615d25';
    const job = codexJob({ message: 'other chat reply', terminalStatus: 'completed' });
    const h = harness({
      chatId,
      pending: sentPending,
      job: { ...job, codexAppServer: { ...job.codexAppServer, sessionKey: `codex-chat:${DRONE_ID}:${otherChatId}` } },
    });

    await h.run();

    expect(h.storedTurns).toEqual([]);
    expect(h.pendingUpdates[0].patch).toMatchObject({ state: 'failed' });
    expect(h.pendingUpdates[0].patch.error).toContain('already used by another chat');
  });

  test('adopts a daemon job that belongs to this chat', async () => {
    const chatId = '431477b1-9fb4-4f42-8c2f-5231e8b2e527';
    const job = codexJob({ message: 'reply', terminalStatus: 'completed' });
    const h = harness({
      chatId,
      pending: sentPending,
      job: { ...job, codexAppServer: { ...job.codexAppServer, sessionKey: `codex-chat:${DRONE_ID}:${chatId}` } },
    });

    await h.run();

    expect(h.storedTurns).toHaveLength(1);
  });
});
