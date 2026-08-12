import type { MobileContinuousVoiceStatus } from './mobile-continuous-voice-lifecycle';

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
      text: string;
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
  voiceTargetKey: string | null;
  voiceStatus: MobileContinuousVoiceStatus;
  pendingCount: number;
  durationMillis: number;
  dictationTargetKey: string | null;
  dictationText: string;
}): MobileComposerContinuousVoiceState {
  const voiceActive = input.voiceStatus !== 'idle';
  const voiceOwned = voiceActive && input.voiceTargetKey === input.targetKey;
  const dictationOwned = input.dictationTargetKey === input.targetKey;
  const activity = {
    status: input.voiceStatus,
    pendingCount: input.pendingCount,
    durationMillis: input.durationMillis,
  };
  if (dictationOwned) {
    return {
      ...activity,
      kind: 'dictation',
      mode: 'dictation',
      owned: voiceOwned,
      elsewhere: voiceActive && !voiceOwned,
      text: input.dictationText,
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
