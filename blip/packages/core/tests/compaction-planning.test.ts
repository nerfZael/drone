import { describe, expect, test } from 'bun:test';
import { fauxAssistantMessage, fauxToolCall } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { prepareCompaction } from '../src/prepareCompaction';
import { modelMessagesFromTranscript } from '../src/model-context';
import { compactionBudget, resolveCompactionSettings } from '../src/compaction-settings';
import type { BlipSessionState, TranscriptEntry } from '../src/types';

const session = { readFiles: [], changedFiles: [] } as unknown as BlipSessionState;
const settings = { auto: true, reserveTokens: 200, keepRecentTokens: 100, keepRecentTurns: 2 };
const user = (content: string): AgentMessage => ({ role: 'user', content, timestamp: 0 });
const result = (id: string, text: string): AgentMessage => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: 'read',
  content: [{ type: 'text', text }],
  details: {},
  isError: false,
  timestamp: 0,
});
const entry = (id: string, message: AgentMessage): TranscriptEntry => ({
  type: 'message',
  id,
  timestamp: new Date(0).toISOString(),
  message,
});
const calls = (...ids: string[]) =>
  fauxAssistantMessage(
    ids.map((id) => fauxToolCall('read', {}, { id })),
    { stopReason: 'toolUse' },
  );

function checkpoint(plan: NonNullable<ReturnType<typeof prepareCompaction>>): TranscriptEntry {
  return {
    type: 'compaction',
    id: 'checkpoint',
    createdAt: new Date(0).toISOString(),
    trigger: 'auto',
    summary: 'Saved work',
    tokensBefore: 1000,
    details: plan.details,
    firstKeptEntryId: plan.firstKeptEntryId,
    retainedUserEntryId: plan.retainedUserEntryId,
  };
}

describe('compaction boundary and budgets', () => {
  test('keeps recent complete batches inside a long turn and pins the user', () => {
    const entries = [
      entry('user', user('Keep working; do not commit')),
      entry('old-call', calls('old')),
      entry('old-result', result('old', 'x'.repeat(8_000))),
      entry('new-call', calls('a', 'b')),
      entry('a', result('a', 'small')),
      entry('b', result('b', 'small')),
    ];
    const plan = prepareCompaction({ session, entries, settings })!;
    expect(plan.firstKeptEntryId).toBe('new-call');
    expect(plan.retainedUserEntryId).toBe('user');
    const messages = modelMessagesFromTranscript([...entries, checkpoint(plan)]);
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'user',
      'assistant',
      'toolResult',
      'toolResult',
    ]);
    expect(messages[1]).toEqual(entries[0].type === 'message' ? entries[0].message : undefined);
  });

  test('never cuts between parallel calls and results, including an unfinished batch', () => {
    const entries = [
      entry('user', user('task')),
      entry('calls', calls('a', 'b')),
      entry('a', result('a', 'x'.repeat(8_000))),
    ];
    const plan = prepareCompaction({ session, entries, settings });
    // No boundary after the incomplete batch is safe, even with a zero tail budget.
    expect(plan).toBeUndefined();
    entries.push(entry('b', result('b', 'done')));
    const completed = prepareCompaction({ session, entries, settings })!;
    expect(completed.firstKeptEntryId).toBeUndefined();
    expect(completed.retainedUserEntryId).toBe('user');
  });

  test('retains the original user through repeated within-turn compaction', () => {
    const entries = [
      entry('user', user('Do not deploy')),
      entry('call', calls('old')),
      entry('result', result('old', 'x'.repeat(8_000))),
    ];
    const first = prepareCompaction({ session, entries, settings })!;
    entries.push(
      checkpoint(first),
      entry('call2', calls('new')),
      entry('result2', result('new', 'x'.repeat(8_000))),
    );
    const second = prepareCompaction({ session, entries, settings })!;
    expect(second.previousSummary).toBe('Saved work');
    expect(second.retainedUserEntryId).toBe('user');
    const messages = modelMessagesFromTranscript([
      ...entries,
      { ...checkpoint(second), id: 'checkpoint2' },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual(user('Do not deploy'));
  });

  test('a damaged previous boundary cannot hide raw history from the next plan', () => {
    const entries = [
      entry('user', user('task')),
      entry('answer', fauxAssistantMessage('x'.repeat(8_000))),
    ];
    entries.push({
      type: 'compaction',
      id: 'bad',
      createdAt: new Date(0).toISOString(),
      trigger: 'auto',
      summary: 'incomplete',
      tokensBefore: 1,
      details: { readFiles: [], modifiedFiles: [] },
      firstKeptEntryId: 'missing',
    });
    const plan = prepareCompaction({ session, entries, settings })!;
    expect(plan.entriesToSummarize.map((item) => item.id)).toContain('answer');
    expect(plan.previousSummary).toBeUndefined();
  });

  test('summary size is independent of the reserve; output and fractional limits both apply', () => {
    const model = { contextWindow: 400_000, maxTokens: 32_000, reasoning: false } as any;
    const resolved = resolveCompactionSettings();
    expect(compactionBudget(model, resolved)).toMatchObject({
      summaryTokens: 4096,
      hardLimit: 356_000,
      targetLimit: 240_000,
    });
    expect(compactionBudget(model, { ...resolved, reserveTokens: 100_000 })).toMatchObject({
      summaryTokens: 4096,
      hardLimit: 300_000,
    });
    expect(compactionBudget({ ...model, contextWindow: 1_000_000 }, resolved).hardLimit).toBe(
      900_000,
    );
  });

  test('a pin pointing to an assistant cannot hide older evidence from the next summary', () => {
    const entries = [
      entry('old-user', user('Preserve this original constraint')),
      entry('bad-pin', fauxAssistantMessage('x'.repeat(8_000))),
      entry('keep', user('Continue')),
      {
        type: 'compaction' as const,
        id: 'bad-checkpoint',
        createdAt: new Date(0).toISOString(),
        trigger: 'auto' as const,
        summary: 'Incomplete summary',
        tokensBefore: 2000,
        details: { readFiles: [], modifiedFiles: [] },
        firstKeptEntryId: 'keep',
        retainedUserEntryId: 'bad-pin',
      },
    ];
    const plan = prepareCompaction({ session, entries, settings })!;
    expect(plan.previousSummary).toBeUndefined();
    expect(plan.entriesToSummarize.map((item) => item.id)).toContain('old-user');
  });

  test('rejects invalid settings instead of silently producing unsafe budgets', () => {
    expect(() => resolveCompactionSettings({ ...settings, summaryMaxTokens: 0 })).toThrow();
    expect(() => resolveCompactionSettings({ ...settings, targetThreshold: 0.95 })).toThrow();
    expect(() => resolveCompactionSettings({ ...settings, reserveTokens: NaN })).toThrow();
  });
});
