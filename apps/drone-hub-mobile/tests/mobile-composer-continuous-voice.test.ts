import { describe, expect, test } from 'bun:test';
import { resolveMobileComposerContinuousVoiceState } from '../src/local-assistant/resolve-mobile-composer-continuous-voice-state';

describe('mobile composer continuous voice', () => {
  const activeDictation = {
    targetKey: 'drone-a:chat-a',
    voiceTargetKey: 'drone-a:chat-a',
    voiceStatus: 'listening' as const,
    pendingCount: 1,
    durationMillis: 500,
    dictationTargetKey: 'drone-a:chat-a',
    dictationText: 'Current dictation.',
  };

  test('describes dictation owned by the current composer', () => {
    expect(resolveMobileComposerContinuousVoiceState(activeDictation)).toMatchObject({
      kind: 'dictation',
      mode: 'dictation',
      owned: true,
      elsewhere: false,
      text: 'Current dictation.',
    });
  });

  test('describes steering owned by the current composer', () => {
    expect(
      resolveMobileComposerContinuousVoiceState({
        ...activeDictation,
        dictationTargetKey: null,
        dictationText: '',
      }),
    ).toMatchObject({ kind: 'steering', mode: 'steering', owned: true });
  });

  test('distinguishes a voice session owned by another composer', () => {
    expect(
      resolveMobileComposerContinuousVoiceState({
        ...activeDictation,
        voiceTargetKey: 'drone-b:chat-b',
        dictationTargetKey: null,
        dictationText: '',
      }),
    ).toMatchObject({ kind: 'elsewhere', owned: false, elsewhere: true });
  });

  test('keeps stopped dictation distinct from a completely idle composer', () => {
    const stopped = {
      ...activeDictation,
      voiceTargetKey: null,
      voiceStatus: 'idle' as const,
      pendingCount: 0,
      durationMillis: 0,
    };
    expect(resolveMobileComposerContinuousVoiceState(stopped)).toMatchObject({
      kind: 'dictation',
      mode: 'dictation',
      owned: false,
      elsewhere: false,
      text: 'Current dictation.',
    });
    expect(
      resolveMobileComposerContinuousVoiceState({
        ...stopped,
        dictationTargetKey: null,
        dictationText: '',
      }),
    ).toMatchObject({ kind: 'idle', owned: false, elsewhere: false });
  });
});
