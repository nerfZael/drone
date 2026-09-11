import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssistantMessageEventStream, fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';
import { createBlipSession, type BlipRuntimeEvent } from '../src/index';
import { SessionStore } from '../src/node';
import { summaryText } from './helpers/compaction-fixtures';

test('repeated checkpoints preserve supplied continuation facts and emit separate durable measurements', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'blip-compaction-observability-'));
  const faux = registerFauxProvider({ api: 'faux-compaction-observability', provider: 'faux-compaction-observability', tokensPerSecond: 0 });
  const repository = new SessionStore(workspace);
  const events: BlipRuntimeEvent[] = [];
  const objective = 'Fix /repo/app.ts; do not deploy; unit tests remain pending.';
  const summary = summaryText(objective);
  // Canned summaries isolate context plumbing from model quality. The summary
  // callbacks also verify the prior checkpoint reaches the next compaction.
  faux.setResponses([
    fauxAssistantMessage('Investigation evidence. '.repeat(500)),
    (context) => {
      expect(JSON.stringify(context.messages)).toContain(objective);
      return fauxAssistantMessage(summary);
    },
    (context) => {
      expect(JSON.stringify(context.messages)).toContain(objective);
      expect(JSON.stringify(context.messages.at(-1))).toContain('Continue with unit tests only.');
      return fauxAssistantMessage('Additional test evidence. '.repeat(500));
    },
    (context) => {
      expect(JSON.stringify(context.messages)).toContain(objective);
      expect(JSON.stringify(context.messages)).toContain('Continue with unit tests only.');
      return fauxAssistantMessage(summary);
    },
    (context) => {
      expect(JSON.stringify(context.messages)).toContain(objective);
      return fauxAssistantMessage('Ready to run the remaining unit tests.');
    },
  ]);
  const options = {
    workspaceRoot: workspace, model: { ...faux.getModel(), contextWindow: 32_000, maxTokens: 2048 },
    permissionMode: 'workspace-write' as const, toolProfile: 'no-shell-workspace-write' as const,
    sessionRepository: repository, promptProvider: () => 'Help with the requested task.',
    compactionSettings: { auto: false, reserveTokens: 2048, summaryMaxTokens: 1024, keepRecentTokens: 0, keepRecentTurns: 0 },
    eventSink: (event: BlipRuntimeEvent) => { events.push(event); },
  };
  let session = await createBlipSession(options);
  try {
    await session.prompt(objective);
    await session.compact();
    await session.prompt('Continue with unit tests only.');
    await session.compact();
    const completions = events.filter((event) => event.type === 'compaction_completed');
    expect(completions).toHaveLength(2);
    for (const event of completions) {
      expect(event.fallbackUsed).toBe(false);
      expect(event.tokensAfter).toBeLessThan(event.tokensBefore);
      expect(event.metrics).toMatchObject({ modelCallCount: 1, modelResponseCount: 1, incompleteModelResponseCount: 0 });
      expect(event.metrics!.durationMs).toBeGreaterThanOrEqual(event.metrics!.modelDurationMs);
    }
    const sessionId = session.state.id;
    session.close();
    session = await createBlipSession({ ...options, sessionId });
    await session.prompt('Resume the remaining checks.');
    const stored = (await repository.readTranscript(session.state))
      .flatMap((entry) => entry.type === 'runtime_event' ? [entry.event] : []);
    expect(stored.filter((event) => event.type === 'compaction_completed')).toEqual(completions);
    expect(faux.state.callCount).toBe(5);
  } finally {
    session.close(); faux.unregister();
    await rm(workspace, { recursive: true, force: true });
  }
});


test('cancelling a real summary call emits one measured terminal event without a checkpoint', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'blip-compaction-cancel-metrics-'));
  const faux = registerFauxProvider({ api: 'faux-compaction-cancel-metrics', provider: 'faux-compaction-cancel-metrics', tokensPerSecond: 0 });
  const repository = new SessionStore(workspace);
  const events: BlipRuntimeEvent[] = [];
  let started!: () => void;
  const summaryStarted = new Promise<void>((resolve) => { started = resolve; });
  const session = await createBlipSession({
    workspaceRoot: workspace, model: { ...faux.getModel(), contextWindow: 32_000, maxTokens: 2048 },
    permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write', sessionRepository: repository,
    promptProvider: () => 'Help with the task.',
    compactionSettings: { auto: false, reserveTokens: 2048, summaryMaxTokens: 1024, keepRecentTokens: 0, keepRecentTurns: 0 },
    eventSink: (event) => { events.push(event); },
    streamFn: (_model, _context, options) => {
      const stream = new AssistantMessageEventStream();
      if (!_context.systemPrompt?.includes('compaction')) {
        stream.push({ type: 'done', reason: 'stop', message: fauxAssistantMessage('Detailed evidence. '.repeat(500)) });
        return stream;
      }
      const abort = () => stream.push({ type: 'error', reason: 'aborted', error: fauxAssistantMessage('', { stopReason: 'aborted' }) });
      if (options?.signal?.aborted) abort();
      else options?.signal?.addEventListener('abort', abort, { once: true });
      started();
      return stream;
    },
  });
  try {
    await session.prompt('Investigate the issue.');
    const compacting = session.compact();
    const outcome = compacting.then(() => undefined, (error: unknown) => error);
    await Promise.race([summaryStarted, outcome.then(() => {
      throw new Error('Compaction ended before requesting a summary');
    })]);
    session.abort();
    expect(await outcome).toMatchObject({ name: 'AbortError', message: 'Compaction was aborted' });
    expect(events.filter((event) => event.type === 'compaction_failed')).toEqual([
      expect.objectContaining({ type: 'compaction_failed', reason: 'cancelled', metrics: expect.objectContaining({
        modelCallCount: 1, modelResponseCount: 1, incompleteModelResponseCount: 1,
      }) }),
    ]);
    expect(events.some((event) => event.type === 'compaction_completed')).toBe(false);
    expect((await repository.readTranscript(session.state)).some((entry) => entry.type === 'compaction')).toBe(false);
  } finally {
    session.close(); faux.unregister();
    await rm(workspace, { recursive: true, force: true });
  }
});
