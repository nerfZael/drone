import { describe, expect, test } from 'bun:test';

import { nextActionsAnchorFromTranscript, nextActionsTurnsFromMessages } from '../src/droneHub/chat/next-actions';
import type { TranscriptItem } from '../src/droneHub/types';

function turn(index: number, patch: Partial<TranscriptItem> = {}): TranscriptItem {
  return {
    turn: index,
    at: `2026-10-02T00:00:0${index}Z`,
    id: `t${index}`,
    prompt: `prompt ${index}`,
    output: `reply ${index}`,
    ok: true,
    session: 's',
    logPath: '',
    ...patch,
  } as TranscriptItem;
}

describe('nextActionsAnchorFromTranscript', () => {
  test('anchors to the latest finished reply with recent turns as context', () => {
    const anchor = nextActionsAnchorFromTranscript(Array.from({ length: 9 }, (_, index) => turn(index)));
    expect(anchor?.turnId).toBe('t8');
    expect(anchor?.turns).toHaveLength(6);
    expect(anchor?.turns.at(-1)).toEqual({ prompt: 'prompt 8', response: 'reply 8' });
  });

  test('falls back to turn number and time when the turn has no id', () => {
    expect(nextActionsAnchorFromTranscript([turn(1, { id: undefined })])?.turnId).toBe('1:2026-10-02T00:00:01Z');
  });

  test('offers nothing after failed, silent, user-only, or empty replies', () => {
    expect(nextActionsAnchorFromTranscript(null)).toBeNull();
    expect(nextActionsAnchorFromTranscript([turn(1, { ok: false, error: 'boom' })])).toBeNull();
    expect(nextActionsAnchorFromTranscript([turn(1, { silentCompletion: true })])).toBeNull();
    expect(nextActionsAnchorFromTranscript([turn(1, { userOnly: true })])).toBeNull();
    expect(nextActionsAnchorFromTranscript([turn(1, { output: '  ' })])).toBeNull();
  });

  test('earlier failed turns keep their prompt but not their error', () => {
    const anchor = nextActionsAnchorFromTranscript([turn(1, { ok: false, output: '', error: 'boom' }), turn(2)]);
    expect(anchor?.turns[0]).toEqual({ prompt: 'prompt 1', response: '' });
  });
});

describe('nextActionsTurnsFromMessages', () => {
  test('pairs each user message with the last assistant text after it', () => {
    expect(nextActionsTurnsFromMessages([
      { role: 'user', text: 'fix it' },
      { role: 'assistant', text: 'Looking…' },
      { role: 'toolResult', text: 'ignored' },
      { role: 'assistant', text: '' },
      { role: 'assistant', text: 'Fixed.' },
      { role: 'user', text: 'thanks' },
    ])).toEqual([
      { prompt: 'fix it', response: 'Fixed.' },
      { prompt: 'thanks', response: '' },
    ]);
  });
});
