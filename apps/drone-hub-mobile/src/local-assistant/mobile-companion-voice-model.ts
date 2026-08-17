import type { CompanionStatus } from '@drone/assistant-chat';
import type { MobileMicrophoneOwner } from './mobile-microphone-coordinator';
import type { MobileVoiceRecordingStatus } from './mobile-voice-transcription-model';

export function mobileCompanionOwnsMicrophone(
  microphoneOwner: MobileMicrophoneOwner | null,
): boolean {
  return microphoneOwner === 'companion';
}

export function resolveMobileCompanionVoiceStatus(input: {
  companionStatus: CompanionStatus;
  companionVoiceSessionActive?: boolean;
  microphoneOwner: MobileMicrophoneOwner | null;
  voiceStatus: MobileVoiceRecordingStatus;
}): CompanionStatus {
  const companionVoiceActive =
    input.companionVoiceSessionActive || mobileCompanionOwnsMicrophone(input.microphoneOwner);
  if (!companionVoiceActive || input.voiceStatus === 'idle') {
    return input.companionStatus;
  }
  if (input.voiceStatus === 'paused') return 'recording';
  if (input.voiceStatus === 'stopped') return 'transcribing';
  return input.voiceStatus;
}
