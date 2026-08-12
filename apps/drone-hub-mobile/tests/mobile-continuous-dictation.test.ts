import { describe, expect, test } from 'bun:test';
import {
  appendMobileContinuousDictationLine,
  mergeMobileDraftWithContinuousDictation,
  MobileContinuousDictationBuffer,
  mobileContinuousDictationText,
  resolveMobileContinuousDictationNavigationAction,
} from '../src/local-assistant/mobile-continuous-dictation';

describe('mobile continuous dictation', () => {
  test('keeps accepted thoughts ordered and ignores duplicate deliveries', () => {
    const first = appendMobileContinuousDictationLine([], {
      id: 'delivery-1',
      text: '  First thought.  ',
    });
    const duplicate = appendMobileContinuousDictationLine(first, {
      id: 'delivery-1',
      text: 'First thought again.',
    });
    const second = appendMobileContinuousDictationLine(duplicate, {
      id: 'delivery-2',
      text: 'Second thought.',
    });

    expect(mobileContinuousDictationText(second)).toBe('First thought.\nSecond thought.');
  });

  test('writes each dictated thought to a new composer line', () => {
    expect(mergeMobileDraftWithContinuousDictation('Typed text  ', 'Dictated text')).toBe(
      'Typed text\nDictated text',
    );
    expect(
      mergeMobileDraftWithContinuousDictation(
        mergeMobileDraftWithContinuousDictation('Typed text', 'First thought.'),
        'Second thought.',
      ),
    ).toBe('Typed text\nFirst thought.\nSecond thought.');
    expect(mergeMobileDraftWithContinuousDictation('Typed text  ', '   ')).toBe('Typed text  ');
  });

  test('discards and cancels dictation when navigating to another composer', () => {
    expect(
      resolveMobileContinuousDictationNavigationAction({
        previousTargetKey: 'drone-a:chat-a',
        nextTargetKey: 'drone-b:chat-b',
        dictationTargetKey: 'drone-a:chat-a',
        continuousVoiceTargetKey: 'drone-a:chat-a',
        continuousVoiceIdle: false,
      }),
    ).toEqual({ discardDictation: true, voiceAction: 'cancel' });
  });

  test('discards and cancels dictation when its composer unmounts', () => {
    expect(
      resolveMobileContinuousDictationNavigationAction({
        previousTargetKey: 'drone-a:chat-a',
        nextTargetKey: '',
        dictationTargetKey: 'drone-a:chat-a',
        continuousVoiceTargetKey: 'drone-a:chat-a',
        continuousVoiceIdle: false,
      }),
    ).toEqual({ discardDictation: true, voiceAction: 'cancel' });
  });

  test('gracefully finishes steering when navigating to another composer', () => {
    expect(
      resolveMobileContinuousDictationNavigationAction({
        previousTargetKey: 'drone-a:chat-a',
        nextTargetKey: 'drone-b:chat-b',
        dictationTargetKey: null,
        continuousVoiceTargetKey: 'drone-a:chat-a',
        continuousVoiceIdle: false,
      }),
    ).toEqual({ discardDictation: false, voiceAction: 'stop' });
  });

  test('resets delivery tracking when a fresh dictation begins', () => {
    const buffer = new MobileContinuousDictationBuffer();
    const firstGeneration = buffer.begin('drone-a:chat-a');
    buffer.append(firstGeneration, 'drone-a:chat-a', {
      id: 'delivery-1',
      text: 'Keep this while stopped.',
    });

    expect(mobileContinuousDictationText(buffer.snapshot().lines)).toBe('Keep this while stopped.');
    buffer.begin('drone-a:chat-a');
    expect(buffer.snapshot()).toEqual({ targetKey: 'drone-a:chat-a', lines: [] });
  });

  test('ignores late deliveries from a discarded or superseded session', () => {
    const buffer = new MobileContinuousDictationBuffer();
    const staleGeneration = buffer.begin('drone-a:chat-a');
    buffer.discard('drone-a:chat-a');
    const currentGeneration = buffer.begin('drone-a:chat-a');

    expect(
      buffer.append(staleGeneration, 'drone-a:chat-a', {
        id: 'stale',
        text: 'Do not restore me.',
      }),
    ).toBe(false);
    expect(
      buffer.append(currentGeneration, 'drone-a:chat-a', {
        id: 'current',
        text: 'Current session.',
      }),
    ).toBe(true);
    expect(mobileContinuousDictationText(buffer.snapshot().lines)).toBe('Current session.');
  });
});
