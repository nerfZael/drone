import { describe, expect, test } from 'bun:test';
import { resolveMobileComposerContinuousVoiceState } from '../src/local-assistant/resolve-mobile-composer-continuous-voice-state';

describe('mobile composer continuous voice', () => {
  const activeDictation = {
    targetKey: 'drone-a:chat-a',
    session: {
      kind: 'continuous' as const,
      mode: 'dictation' as const,
      targetKey: 'drone-a:chat-a',
      status: 'listening' as const,
      pendingCount: 1,
      durationMillis: 500,
      microphoneAvailable: false,
    },
  };

  test('describes dictation owned by the current composer', () => {
    expect(resolveMobileComposerContinuousVoiceState(activeDictation)).toMatchObject({
      kind: 'dictation',
      mode: 'dictation',
      owned: true,
      elsewhere: false,
    });
  });

  test('describes steering owned by the current composer', () => {
    expect(
      resolveMobileComposerContinuousVoiceState({
        ...activeDictation,
        session: { ...activeDictation.session, mode: 'steering' },
      }),
    ).toMatchObject({ kind: 'steering', mode: 'steering', owned: true });
  });

  test('distinguishes a voice session owned by another composer', () => {
    expect(
      resolveMobileComposerContinuousVoiceState({
        ...activeDictation,
        session: {
          ...activeDictation.session,
          mode: 'steering',
          targetKey: 'drone-b:chat-b',
        },
      }),
    ).toMatchObject({ kind: 'elsewhere', owned: false, elsewhere: true });
  });

  test('keeps stopped dictation distinct from a completely idle composer', () => {
    const stopped = {
      ...activeDictation,
      session: {
        ...activeDictation.session,
        status: 'idle' as const,
        pendingCount: 0,
        durationMillis: 0,
        microphoneAvailable: true,
      },
    };
    expect(resolveMobileComposerContinuousVoiceState(stopped)).toMatchObject({
      kind: 'dictation',
      mode: 'dictation',
      owned: false,
      elsewhere: false,
    });
    expect(
      resolveMobileComposerContinuousVoiceState({
        targetKey: stopped.targetKey,
        session: { kind: 'idle', status: 'idle', microphoneAvailable: true },
      }),
    ).toMatchObject({ kind: 'idle', owned: false, elsewhere: false });
  });
});
