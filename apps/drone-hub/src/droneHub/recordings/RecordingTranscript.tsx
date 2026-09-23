import React from 'react';
import type { DesktopRecording } from '@drone/hub-model';

export function RecordingTranscript({ recording, status }: { recording: DesktopRecording | null; status: DesktopRecording['status'] }) {
  if (!recording) return <p role="status">Loading transcript…</p>;
  const savedPreview = status === 'failed' && recording.segments.length === 0 && recording.previewSegments.length > 0;
  const preview = status === 'recording' || savedPreview;
  const segments = preview ? recording.previewSegments : recording.segments;
  return <div className="max-h-[45vh] space-y-3 overflow-y-auto text-sm">
    {recording.error || recording.captureError || recording.previewError ? <p role="alert" className="text-[var(--red)]">{recording.error || recording.captureError || recording.previewError}</p> : null}
    {recording.warnings.map(warning => <p key={warning} className="text-xs text-[var(--yellow)]">{warning}</p>)}
    {savedPreview ? <p className="text-xs text-[var(--muted)]">Saved live preview from before processing failed. This text is provisional; retry processing for the final transcript and speaker labels.</p> : null}
    {status === 'recording' ? <p className="text-xs text-[var(--muted)]">{recording.liveTranscription ? 'Live preview updates about every 30 seconds. Speaker labels appear after stop.' : 'Live preview is off. The transcript will be created after stop.'}</p> : null}
    {status === 'processing' ? <p role="status" className="text-[var(--muted)]">Processing saved audio and assigning speaker numbers. You can close this window.</p> : null}
    {segments.length === 0 && status === 'complete' ? <p>No speech was detected.</p> : null}
    {segments.map((segment, index) => <p key={`${segment.source}-${index}`}>
      <span className="mr-2 font-mono text-xs text-[var(--muted)]">{Math.floor(segment.start / 60)}:{String(Math.floor(segment.start % 60)).padStart(2, '0')}</span>
      <strong>{segment.speakerId === 'you' ? 'You' : segment.speakerId === 'system' ? 'Desktop' : `Speaker ${segment.speakerId.replace('speaker-', '')}`}: </strong>{segment.text}
    </p>)}
  </div>;
}
