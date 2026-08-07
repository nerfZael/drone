export type MobileContinuousVoiceStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'speech'
  | 'thought-pause'
  | 'recovering'
  | 'paused'
  | 'stopping'
  | 'error';

export type MobileContinuousVoiceNativeReason =
  | 'started'
  | 'stopped'
  | 'interrupted'
  | 'system-control'
  | undefined;

export type MobileContinuousVoiceNativeAction =
  | 'ignore'
  | 'finish'
  | 'checkpoint-and-recover'
  | 'resume';

export function resolveMobileContinuousVoiceNativeAction(
  status: MobileContinuousVoiceStatus,
  reason: MobileContinuousVoiceNativeReason,
): MobileContinuousVoiceNativeAction {
  if (reason === 'system-control') {
    return status === 'idle' || status === 'stopping' || status === 'error' ? 'ignore' : 'finish';
  }
  if (reason === 'interrupted') {
    return status === 'listening' || status === 'speech' || status === 'thought-pause'
      ? 'checkpoint-and-recover'
      : 'ignore';
  }
  if (reason === 'started' && status === 'recovering') return 'resume';
  return 'ignore';
}
