/** One speech-to-text recording kept by the Hub that transcribed it, or received it from a phone. */
export type SpeechClipStatus = 'transcribing' | 'transcribed' | 'failed' | 'canceled';

export type SpeechClip = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SpeechClipStatus;
  /** Where the recording was made, e.g. "chat", "dictation", "companion", "continuous". */
  surface: string;
  /** Device that recorded it; null for this Hub's own UI. */
  sourceDevice: string | null;
  /** Human label of the destination, when the recorder knew it. */
  target: string | null;
  mimeType: string;
  audioBytes: number;
  durationMs: number | null;
  text: string;
  error: string | null;
  model: string | null;
  transcribedAt: string | null;
};
