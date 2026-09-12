import { describe, expect, test } from 'bun:test';
import type { AgentMessage, StreamFn } from '@mariozechner/pi-agent-core';
import {
  AssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  estimateContextTokens,
  type AssistantMessage,
  type Context,
  type Model,
} from '@mariozechner/pi-ai';
import { createCompaction, type CompactionPlan } from '../src/compaction';
import { DEFAULT_COMPACTION_SETTINGS } from '../src/compaction-settings';
import { deterministicSummary, summaryInputBatches } from '../src/helpers/compaction-summary-input';
import { modelSummary } from '../src/helpers/compaction-summary';
import type { BlipSessionState, TranscriptEntry } from '../src/types';
import { summaryText } from './helpers/compaction-fixtures';

const model: Model<any> = {
  id: 'summary-test', name: 'Summary test', api: 'faux', provider: 'faux',
  baseUrl: '', reasoning: false, input: ['text'], contextWindow: 128_000, maxTokens: 8_192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const session: BlipSessionState = {
  id: 'summary-session', workspaceRoot: '/workspace', modelProvider: 'faux', modelId: model.id,
  permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write', loadedSkills: [],
  transcriptPath: '/workspace/transcript.jsonl', readFiles: [], changedFiles: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

describe('Compaction summary reliability and coverage', () => {
  test('preserves user instructions chronologically and previews large errors with recovery and failure status', () => {
    const originalUser = 'Keep offline. ' + '中😀\\"\n'.repeat(30_000) + ' No publishing.';
    const originalTool = 'output '.repeat(30_000) + 'ERROR sentinel: permission denied';
    const entries = [
      entry('old', user(originalUser)),
      entry('call', fauxAssistantMessage(fauxToolCall('exec', { command: 'check' }, { id: 'call_check' }), { stopReason: 'toolUse' })),
      entry('error', { role: 'toolResult', toolName: 'exec', toolCallId: 'call_check', isError: true,
        content: [{ type: 'text', text: originalTool }], timestamp: 1 }),
      entry('new', user('Correction: only inspect src/config.ts.')),
    ];
    const batches = [...summaryInputBatches(plan(entries))];
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.length <= 120_000)).toBe(true);
    const records = reconstruct(batches);
    expect(records.map((record) => record.id)).toEqual(['old', 'call', 'error', 'new']);
    expect(records[0].content).toBe(originalUser);
    expect(records[1].content[0]).toEqual({ type: 'toolCall', id: 'call_check', name: 'exec', arguments: { command: 'check' } });
    expect(records[2]).toMatchObject({ isError: true, toolCallId: 'call_check' });
    expect(records[2].toolReportedFailure).toBe(true);
    expect(records[2].content[0].text.length).toBeLessThan(24_600);
    expect(records[2].content[0].text).toContain('ERROR sentinel: permission denied');
    expect(records[2].content[0].text).toContain('call_id="call_check"');
    expect((entries[2].message.content as any)[0].text).toBe(originalTool);
    expect(records[3].content).toBe('Correction: only inspect src/config.ts.');
  });

  test('summarizes a large parallel tool batch in one bounded call, retaining raw data and opt-out', async () => {
    const ids = ['mcp', 'browser', 'file', 'shell'];
    const entries = [
      entry('user', user('Keep the exact user instruction.')),
      entry('calls', fauxAssistantMessage(ids.map((id) => fauxToolCall(id, {}, { id })), { stopReason: 'toolUse' })),
      ...ids.map((id) => entry(id, { role: 'toolResult', toolName: id, toolCallId: id, isError: false,
        content: [{ type: 'text', text: 'HEAD ' + 'x'.repeat(1_000_000) + ' TAIL' }], timestamp: 1 })),
    ];
    const inputPlan = plan(entries);
    const original = JSON.stringify(entries);
    const batches = [...summaryInputBatches(inputPlan)];
    expect(batches).toHaveLength(1);
    expect(batches[0].length).toBeLessThan(52_000);
    expect(reconstruct(batches)[0].content).toBe('Keep the exact user instruction.');
    let calls = 0;
    await modelSummary({ model, plan: inputPlan, streamFn: stream((context) => {
      calls++;
      expect(String(context.messages[0].content)).toContain('read_tool_output');
      expect(context.systemPrompt).toContain('Never infer success');
      return fauxAssistantMessage(summaryText('Continue using saved output'));
    }) });
    expect(calls).toBe(1);
    expect(deterministicSummary(inputPlan).length).toBeLessThan(52_000);
    expect(JSON.stringify(entries)).toBe(original);
    expect([...summaryInputBatches({ ...inputPlan, pruneToolOutputs: false })].length).toBeGreaterThan(30);
  });

  test('carries checkpoints through every batch and accounts for every model response', async () => {
    const inputPlan = plan([entry('long', user('history '.repeat(800)))]);
    inputPlan.settings.maxSummaryInputChars = 1_000;
    inputPlan.settings.maxSummaryMessageChars = 500;
    inputPlan.previousSummary = summaryText('Original unfinished objective');
    const seen: Context[] = [];
    const usage: AssistantMessage[] = [];
    const phases: string[] = [];
    const batches = [...summaryInputBatches(inputPlan)];
    const result = await modelSummary({ model, plan: inputPlan,
      streamFn: stream((context) => {
        seen.push(context);
        return fauxAssistantMessage(summaryText(`Checkpoint ${seen.length}`));
      }),
      onUsage: async (response) => { usage.push(response); },
      onModelCall: (phase) => phases.push(phase),
    });
    expect(seen).toHaveLength(batches.length);
    expect(usage).toHaveLength(batches.length);
    expect(phases).toEqual(batches.flatMap(() => ['started', 'finished']));
    for (const [index, context] of seen.entries()) {
      const prompt = String(context.messages[0].content);
      expect(prompt).toContain(JSON.stringify(index === 0 ? inputPlan.previousSummary : summaryText(`Checkpoint ${index}`)));
      expect(prompt).toContain(batches[index]);
    }
    expect(result).toBe(summaryText(`Checkpoint ${batches.length}`));
    expect(seen[0].systemPrompt).toContain('A skipped question is not approval');
    expect(seen[0].systemPrompt).toContain('Separate verified completion from attempted or planned work');
    expect(seen[0].systemPrompt).toContain('latest user instruction takes precedence');
  });

  test('honors small explicit input caps and rejects unusable limits without dropping text or looping', () => {
    const inputPlan = plan([entry('small', user('😀'.repeat(200)))]);
    inputPlan.settings.maxSummaryInputChars = 500;
    inputPlan.settings.maxSummaryMessageChars = 100;
    const batches = [...summaryInputBatches(inputPlan)];
    expect(batches.every((batch) => batch.length <= 500)).toBe(true);
    expect(reconstruct(batches)[0].content).toBe('😀'.repeat(200));
    expect(() => [...summaryInputBatches(inputPlan, () => 129)]).toThrow('leave no room');
    inputPlan.settings.maxSummaryMessageChars = 1;
    expect(() => [...summaryInputBatches(inputPlan)]).toThrow('complete Unicode character');
  });

  test.each([
    ['provider error', fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'unavailable' })],
    ['output limit', fauxAssistantMessage(summaryText('TRUNCATED CANDIDATE'), { stopReason: 'length' })],
    ['empty text', fauxAssistantMessage('')],
    ['thinking only', fauxAssistantMessage({ type: 'thinking', thinking: 'SECRET_THINKING_SENTINEL' })],
    ['tool use', fauxAssistantMessage(fauxToolCall('exec', {}), { stopReason: 'toolUse' })],
    ['missing sections', fauxAssistantMessage('## Goal\nINVALID CANDIDATE')],
    ['empty section', fauxAssistantMessage(summaryText('INVALID CANDIDATE').replace('## Next Steps\n- Not established.', '## Next Steps'))],
  ] as const)('preserves original evidence on %s', async (_name, response) => {
    const entries = historyWithCheckpoint();
    const before = JSON.stringify(entries);
    const result = await createCompaction({ session, entries, trigger: 'manual', model,
      settings: settings(), streamFn: stream(() => response) });
    expect(result?.fallbackUsed).toBe(true);
    expect(result?.fallbackReason).toBeTruthy();
    expect(result?.summary).toContain('PRIOR CONSTRAINT: never publish');
    expect(result?.summary).toContain('NEW CONSTRAINT: keep the public API');
    expect(result?.summary).toContain('FAILED: missing credentials');
    expect(result?.summary).not.toContain('INVALID CANDIDATE');
    expect(result?.summary).not.toContain('TRUNCATED CANDIDATE');
    expect(result?.summary).not.toContain('SECRET_THINKING_SENTINEL');
    expect(result?.summary).not.toContain('(none recorded)');
    expect(JSON.stringify(entries)).toBe(before);
  });

  test('a later batch failure falls back from the original evidence, never a partial checkpoint', async () => {
    const entries = historyWithCheckpoint('NEW CONSTRAINT: keep the public API. ' + 'history '.repeat(1_000));
    let calls = 0;
    const result = await createCompaction({ session, entries, trigger: 'manual', model,
      settings: { ...settings(), maxSummaryInputChars: 1_000 },
      streamFn: stream(() => ++calls === 1
        ? fauxAssistantMessage(summaryText('PARTIAL CANDIDATE'))
        : fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'second batch failed' })),
    });
    expect(calls).toBe(2);
    expect(result?.fallbackUsed).toBe(true);
    expect(result?.summary).toContain('PRIOR CONSTRAINT: never publish');
    expect(result?.summary).toContain('FAILED: missing credentials');
    expect(result?.summary).toContain('history '.repeat(1_000));
    expect(result?.summary).not.toContain('PARTIAL CANDIDATE');
  });

  test('fits each batch around the carried checkpoint and output allowance in a small model window', async () => {
    const smallModel = { ...model, contextWindow: 4_000, maxTokens: 500 };
    const source = 'Beginning constraint. ' + 'long transcript '.repeat(4_000) + ' Final error.';
    const inputPlan = plan([entry('long', user(source))]);
    inputPlan.previousSummary = summaryText('Unfinished original goal');
    const batches: string[] = [];
    await modelSummary({ model: smallModel, plan: inputPlan,
      streamFn: (_model, context, options) => {
        expect(estimateContextTokens(smallModel, context).inputTokens + (options?.maxTokens ?? 0)).toBeLessThan(smallModel.contextWindow);
        const prompt = String(context.messages[0].content);
        batches.push(prompt.slice(prompt.indexOf('\nMessage ') + 1));
        const result = new AssistantMessageEventStream();
        result.end(fauxAssistantMessage(summaryText('Checkpoint ' + 'carried fact '.repeat(60))));
        return result;
      },
    });
    expect(batches.length).toBeGreaterThan(2);
    expect(reconstruct(batches)[0].content).toBe(source);
  });

  test('an oversized previous summary is preserved rather than silently truncated to fit', async () => {
    const inputPlan = plan([entry('new', user('New requirement.'))]);
    inputPlan.previousSummary = 'CRITICAL PRIOR FACT '.repeat(10_000);
    let calls = 0;
    await expect(modelSummary({ model: { ...model, contextWindow: 4_000, maxTokens: 500 }, plan: inputPlan,
      streamFn: stream(() => { calls++; return fauxAssistantMessage(summaryText('Unused')); }),
    })).rejects.toThrow('leave no room');
    expect(calls).toBe(0);
    expect(deterministicSummary(inputPlan)).toContain(inputPlan.previousSummary);
  });

  test('no-model and repeated fallbacks preserve the previous summary verbatim', async () => {
    const entries = historyWithCheckpoint();
    const first = await createCompaction({ session, entries, trigger: 'manual', settings: settings() });
    expect(first?.fallbackUsed).toBe(true);
    entries.push(first!, entry('later', user('Additional request.')));
    const second = await createCompaction({ session, entries, trigger: 'manual', settings: settings() });
    expect(second?.summary).toContain(first!.summary);
    expect(second?.summary).toContain('PRIOR CONSTRAINT: never publish');
  });

  test('preserves tool identifiers and failed assistant outcomes; marks unavailable image content', () => {
    const inputPlan = plan([
      entry('image', { role: 'user', timestamp: 1, content: [{ type: 'image', mimeType: 'image/png', data: 'PRIVATE_BASE64' }] }),
      entry('failed', fauxAssistantMessage('Attempted operation.', { stopReason: 'error', errorMessage: 'connection closed' })),
    ]);
    const fallback = deterministicSummary(inputPlan);
    expect(fallback).toContain('visual contents unavailable');
    expect(fallback).not.toContain('PRIVATE_BASE64');
    expect(fallback).toContain('"stopReason":"error"');
    expect(fallback).toContain('connection closed');
  });

  test('cancellation before or during generation produces no fallback checkpoint', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await expect(createCompaction({ session, entries: historyWithCheckpoint(), trigger: 'manual', model,
      settings: settings(), signal: controller.signal,
      streamFn: stream(() => { called = true; return fauxAssistantMessage(summaryText('Ignored')); }),
    })).rejects.toThrow();
    expect(called).toBe(false);
    await expect(createCompaction({ session, entries: historyWithCheckpoint(), trigger: 'manual', model,
      settings: settings(), streamFn: stream(() => fauxAssistantMessage('', { stopReason: 'aborted' })),
    })).rejects.toMatchObject({ name: 'AbortError' });
    const during = new AbortController();
    await expect(createCompaction({ session, entries: historyWithCheckpoint(), trigger: 'manual', model,
      settings: settings(), signal: during.signal,
      streamFn: stream(() => { during.abort(); return fauxAssistantMessage(summaryText('Ignored')); }),
    })).rejects.toThrow();
  });
});

function entry(id: string, message: AgentMessage): Extract<TranscriptEntry, { type: 'message' }> {
  return { type: 'message', id, timestamp: '2026-01-01T00:00:00Z', message };
}

function user(content: string): AgentMessage {
  return { role: 'user', content, timestamp: 1 };
}

function settings() {
  return { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 1, keepRecentTurns: 1 };
}

function plan(entries: CompactionPlan['entriesToSummarize']): CompactionPlan {
  return { entriesToSummarize: entries, entriesToKeep: [], tokensBefore: 0,
    tokensAfterEstimate: 0, details: { readFiles: [], modifiedFiles: [] }, settings: settings() };
}

function historyWithCheckpoint(content = 'NEW CONSTRAINT: keep the public API'): TranscriptEntry[] {
  return [
    entry('old', user(content)),
    entry('response', fauxAssistantMessage('FAILED: missing credentials')),
    entry('recent', user('Continue investigating.')),
    { type: 'compaction', id: 'previous', createdAt: session.createdAt, trigger: 'manual', tokensBefore: 1,
      firstKeptEntryId: 'old', summary: 'PRIOR CONSTRAINT: never publish', details: { readFiles: [], modifiedFiles: [] } },
  ];
}

function stream(response: (context: Context) => AssistantMessage): StreamFn {
  return (_model, context) => {
    const result = new AssistantMessageEventStream();
    result.end(response(context));
    return result;
  };
}

function reconstruct(batches: string[]): any[] {
  const records = new Map<number, string>();
  for (const batch of batches) {
    const fragments = [...batch.matchAll(/Message (\d+), characters (\d+)-(\d+)\/(\d+):\n([^\n]*)\n\n/g)];
    expect(fragments.map((fragment) => fragment[0]).join('')).toBe(batch);
    for (const fragment of fragments) {
      const index = Number(fragment[1]);
      const previous = records.get(index) ?? '';
      expect(Number(fragment[2])).toBe(previous.length + 1);
      expect(fragment[5].length).toBe(Number(fragment[3]) - Number(fragment[2]) + 1);
      records.set(index, previous + fragment[5]);
    }
  }
  return [...records.values()].map((record) => JSON.parse(record));
}

test('reports summary stream activity before the final response without forwarding content', async () => {
  const result = new AssistantMessageEventStream();
  const response = fauxAssistantMessage(summaryText('Private continuation facts'));
  const phases: string[] = [];
  let firstActivity!: () => void;
  const activity = new Promise<void>((resolve) => { firstActivity = resolve; });
  let settled = false;
  const summary = modelSummary({
    model, plan: plan([entry('one', user('Private transcript'))]),
    streamFn: () => { result.push({ type: 'start', partial: response }); return result; },
    onModelCall: (phase) => { phases.push(phase); },
    onModelActivity: (...args) => { expect(args).toEqual([]); firstActivity(); },
  }).finally(() => { settled = true; });
  await activity;
  expect(settled).toBe(false);
  expect(phases).toEqual(['started']);
  result.push({ type: 'done', reason: 'stop', message: response });
  expect(await summary).toContain('Private continuation facts');
  expect(phases).toEqual(['started', 'finished']);
});
