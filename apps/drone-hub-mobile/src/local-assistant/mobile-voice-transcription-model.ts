export type MobileVoiceRecordingStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'transcribing';

export const MOBILE_GROQ_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';
export const MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;

export function mergeMobileDraftWithVoiceTranscript(
  draft: string,
  transcript: string,
): string {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return draft;
  const cleanDraft = draft.trimEnd();
  if (!cleanDraft) return cleanTranscript;
  return `${cleanDraft}\n${cleanTranscript}`;
}

export function mobileVoiceStatusLabel(status: MobileVoiceRecordingStatus): string {
  if (status === 'starting') return 'Starting…';
  if (status === 'recording') return 'Recording';
  if (status === 'paused') return 'Paused';
  if (status === 'transcribing') return 'Transcribing…';
  return '';
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
