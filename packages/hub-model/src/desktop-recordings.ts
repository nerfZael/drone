export type RecordingSource = 'microphone' | 'system';
export type RecordingSegment = {
  start: number;
  end: number;
  text: string;
  source: RecordingSource;
  speakerId: string;
};

export type DesktopRecording = {
  schemaVersion: 1;
  id: string;
  title: string;
  startedAt: string;
  durationSeconds: number;
  status: 'recording' | 'processing' | 'complete' | 'failed';
  keepAudio: boolean;
  liveTranscription: boolean;
  audioFiles: string[];
  segments: RecordingSegment[];
  previewSegments: RecordingSegment[];
  previewChunks: number;
  error: string | null;
  captureError?: string;
  previewError?: string;
  warnings: string[];
  providers: { microphone: string; system: string };
  updatedAt: string;
};

export type DesktopRecordingSummary = Omit<DesktopRecording, 'segments' | 'previewSegments'> & {
  relativePath: string;
  inHomeFiles: boolean;
  speakerCount: number;
};

export type DesktopRecordingStatus = {
  supported: boolean;
  busy: boolean;
  id: string | null;
  startedAt: number | null;
  microphone: string;
  system: string;
  error: string;
};
