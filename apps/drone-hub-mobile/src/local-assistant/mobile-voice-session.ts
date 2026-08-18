import type { CompanionStatus } from '@drone/assistant-chat';
import type { MobileContinuousVoiceMode } from './mobile-continuous-dictation';
import type { MobileContinuousVoiceStatus } from './mobile-continuous-voice-lifecycle';
import type { MobileVoiceRecordingStatus } from './mobile-voice-transcription-model';

export type MobileRecordedVoiceSessionOwner = 'single-shot' | 'companion';

export type MobileVoiceSession = { microphoneAvailable: boolean } & (
  | {
      kind: 'idle';
      status: 'idle';
    }
  | {
      kind: 'single-shot' | 'companion';
      status: Exclude<MobileVoiceRecordingStatus, 'idle'>;
      durationMillis: number;
    }
  | {
      kind: 'continuous';
      mode: MobileContinuousVoiceMode;
      status: MobileContinuousVoiceStatus;
      targetKey: string | null;
      pendingCount: number;
      durationMillis: number;
    }
);

export function resolveMobileVoiceSession(input: {
  recordingOwner: MobileRecordedVoiceSessionOwner | null;
  recordingStatus: MobileVoiceRecordingStatus;
  recordingDurationMillis: number;
  continuousStatus: MobileContinuousVoiceStatus;
  continuousTargetKey: string | null;
  continuousDictationTargetKey: string | null;
  continuousPendingCount: number;
  continuousDurationMillis: number;
  microphoneAvailable: boolean;
}): MobileVoiceSession {
  if (input.recordingOwner && input.recordingStatus !== 'idle') {
    return {
      kind: input.recordingOwner,
      status: input.recordingStatus,
      durationMillis: input.recordingDurationMillis,
      microphoneAvailable: input.microphoneAvailable,
    };
  }

  const continuousActive = input.continuousStatus !== 'idle';
  const targetKey = input.continuousDictationTargetKey || input.continuousTargetKey;
  if (continuousActive || targetKey) {
    return {
      kind: 'continuous',
      mode: input.continuousDictationTargetKey ? 'dictation' : 'steering',
      status: input.continuousStatus,
      targetKey,
      pendingCount: input.continuousPendingCount,
      durationMillis: input.continuousDurationMillis,
      microphoneAvailable: input.microphoneAvailable,
    };
  }

  return {
    kind: 'idle',
    status: 'idle',
    microphoneAvailable: input.microphoneAvailable,
  };
}

export function resolveMobileCompanionVoiceStatus(
  companionStatus: CompanionStatus,
  session: MobileVoiceSession,
): CompanionStatus {
  if (session.kind !== 'companion') return companionStatus;
  if (session.status === 'paused') return 'recording';
  if (session.status === 'stopped') return 'transcribing';
  return session.status;
}
