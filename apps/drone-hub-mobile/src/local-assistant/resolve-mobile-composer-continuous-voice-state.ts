import type { MobileContinuousVoiceStatus } from './mobile-continuous-voice-lifecycle';
import type { MobileVoiceSession } from './mobile-voice-session';

type MobileComposerContinuousVoiceStateBase = {
  status: MobileContinuousVoiceStatus;
  pendingCount: number;
  durationMillis: number;
};

export type MobileComposerContinuousVoiceState =
  | (MobileComposerContinuousVoiceStateBase & {
      kind: 'idle';
      mode: 'steering';
      owned: false;
      elsewhere: false;
    })
  | (MobileComposerContinuousVoiceStateBase & {
      kind: 'dictation';
      mode: 'dictation';
      owned: boolean;
      elsewhere: boolean;
    })
  | (MobileComposerContinuousVoiceStateBase & {
      kind: 'steering';
      mode: 'steering';
      owned: true;
      elsewhere: false;
    })
  | (MobileComposerContinuousVoiceStateBase & {
      kind: 'elsewhere';
      mode: 'steering';
      owned: false;
      elsewhere: true;
    });

export function resolveMobileComposerContinuousVoiceState(input: {
  targetKey: string;
  session: MobileVoiceSession;
}): MobileComposerContinuousVoiceState {
  const continuousSession = input.session.kind === 'continuous' ? input.session : null;
  const voiceActive = Boolean(continuousSession && continuousSession.status !== 'idle');
  const voiceOwned = Boolean(voiceActive && continuousSession?.targetKey === input.targetKey);
  const dictationOwned = Boolean(
    continuousSession?.mode === 'dictation' && continuousSession.targetKey === input.targetKey,
  );
  const activity = {
    status: continuousSession?.status ?? ('idle' as const),
    pendingCount: continuousSession?.pendingCount ?? 0,
    durationMillis: continuousSession?.durationMillis ?? 0,
  };
  if (dictationOwned) {
    return {
      ...activity,
      kind: 'dictation',
      mode: 'dictation',
      owned: voiceOwned,
      elsewhere: voiceActive && !voiceOwned,
    };
  }
  if (voiceOwned) {
    return { ...activity, kind: 'steering', mode: 'steering', owned: true, elsewhere: false };
  }
  if (voiceActive) {
    return { ...activity, kind: 'elsewhere', mode: 'steering', owned: false, elsewhere: true };
  }
  return { ...activity, kind: 'idle', mode: 'steering', owned: false, elsewhere: false };
}
