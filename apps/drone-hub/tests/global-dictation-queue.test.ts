import { describe, expect, test } from 'bun:test';
import {
  appendGlobalDictationTranscript,
  drainReadyTranscriptionResults,
  type OrderedTranscriptionResult,
} from '../src/droneHub/dictation/global-dictation-queue';

describe('global dictation transcription ordering', () => {
  test('waits for earlier clips even when a later clip finishes first', () => {
    const queue: OrderedTranscriptionResult[] = [
      { status: 'pending', text: '' },
      { status: 'ready', text: 'second' },
    ];
    expect(drainReadyTranscriptionResults(queue)).toEqual([]);
    expect(queue).toHaveLength(2);

    queue[0] = { status: 'ready', text: 'first' };
    expect(drainReadyTranscriptionResults(queue)).toEqual(['first', 'second']);
    expect(queue).toEqual([]);
  });

  test('keeps later results behind a failed clip until it is handled', () => {
    const queue: OrderedTranscriptionResult[] = [
      { status: 'failed', text: '' },
      { status: 'ready', text: 'later' },
    ];
    expect(drainReadyTranscriptionResults(queue)).toEqual([]);
    queue.shift();
    expect(drainReadyTranscriptionResults(queue)).toEqual(['later']);
  });

  test('appends each transcript on a new line without replacing edits', () => {
    expect(appendGlobalDictationTranscript('edited text', 'new thought')).toBe(
      'edited text\nnew thought',
    );
    expect(appendGlobalDictationTranscript('edited text\n', 'new thought')).toBe(
      'edited text\nnew thought',
    );
  });
});
