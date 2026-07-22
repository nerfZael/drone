export type MobileVoiceRecordingStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'transcribing';

export const MOBILE_GROQ_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';
export const MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;

export function resolveMobileVoiceRecorderEvent(input: {
  activeUri: string | null;
  eventUri: string | null;
  failed: boolean;
}): { uri: string | null; handleFailure: boolean } {
  if (!input.failed) return { uri: input.activeUri, handleFailure: false };
  if (input.eventUri && input.activeUri && input.eventUri !== input.activeUri) {
    return { uri: input.activeUri, handleFailure: false };
  }
  return { uri: input.activeUri || input.eventUri, handleFailure: true };
}

export function mobileVoiceRecordActionDisabled(input: {
  editable: boolean;
  sending: boolean;
  running: boolean;
  queueWhileRunning: boolean;
}): boolean {
  return !input.editable || input.sending || (input.running && !input.queueWhileRunning);
}

export function mergeMobileDraftWithVoiceTranscript(
  draft: string,
  transcript: string,
): string {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return draft;
  const cleanDraft = draft.trimEnd();
  if (!cleanDraft) return cleanTranscript;
  return `${cleanDraft} ${cleanTranscript}`;
}

export function formatMobileVoiceDuration(durationMillis: number): string {
  const milliseconds = Number(durationMillis);
  const totalSeconds = Number.isFinite(milliseconds)
    ? Math.max(0, Math.floor(milliseconds / 1000))
    : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function mobileVoiceStatusLabel(status: MobileVoiceRecordingStatus): string {
  if (status === 'starting') return 'Starting…';
  if (status === 'recording') return 'Recording';
  if (status === 'paused') return 'Paused';
  if (status === 'transcribing') return 'Transcribing…';
  return '';
}

export function shouldDiscardMobileVoiceWhenInactive(
  status: MobileVoiceRecordingStatus,
): boolean {
  return status === 'recording' || status === 'paused' || status === 'transcribing';
}

export function resolveMobileGroqTranscriptionResponse(input: {
  ok: boolean;
  status: number;
  statusText?: string;
  body: string;
}): string {
  let data: any = null;
  try {
    data = input.body ? JSON.parse(input.body) : null;
  } catch {
    data = null;
  }
  if (!input.ok) {
    const nestedMessage =
      data?.error && typeof data.error === 'object' ? String(data.error.message ?? '').trim() : '';
    const directMessage = typeof data?.error === 'string' ? data.error.trim() : '';
    const message =
      nestedMessage ||
      directMessage ||
      String(data?.message ?? '').trim() ||
      String(input.statusText ?? '').trim() ||
      `GROQ transcription failed (${input.status}).`;
    throw new Error(message);
  }
  const transcript = String(data?.text ?? '').trim();
  if (!transcript) throw new Error('No speech detected.');
  return transcript;
}
