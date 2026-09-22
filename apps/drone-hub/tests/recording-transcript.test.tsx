import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DesktopRecording } from '@drone/hub-model';
import { RecordingTranscript } from '../src/droneHub/recordings/RecordingTranscript';

const recording: DesktopRecording = {
  schemaVersion: 1, id: 'test', title: 'Test', startedAt: '', updatedAt: '', durationSeconds: 10,
  status: 'recording', keepAudio: false, liveTranscription: true, audioFiles: [], segments: [],
  previewChunks: 1, error: null, warnings: [], providers: { microphone: 'groq', system: 'openai' },
  previewSegments: [{ start: 1, end: 3, text: 'hello', source: 'microphone', speakerId: 'you' }, { start: 2, end: 4, text: 'hi', source: 'system', speakerId: 'system' }],
};

test('preview distinguishes sources without promising final speaker labels', () => {
  const markup = renderToStaticMarkup(<RecordingTranscript recording={recording} status="recording" />);
  expect(markup).toContain('You:');
  expect(markup).toContain('Desktop:');
  expect(markup).toContain('Speaker labels appear after stop');
  expect(markup).not.toContain('Speaker 1:');
});

test('final transcript renders anonymous speakers and treats spoken markup as text', () => {
  const markup = renderToStaticMarkup(<RecordingTranscript status="complete" recording={{ ...recording,
    segments: [{ start: 2, end: 4, text: '<script>do something</script>', source: 'system', speakerId: 'speaker-2' }],
  }} />);
  expect(markup).toContain('Speaker 2:');
  expect(markup).toContain('&lt;script&gt;');
  expect(markup).not.toContain('<script>');
  expect(markup).not.toContain('hello');
});

test('shows processing, failures and silent completion without inventing speech', () => {
  expect(renderToStaticMarkup(<RecordingTranscript recording={recording} status="processing" />)).toContain('You can close this window');
  expect(renderToStaticMarkup(<RecordingTranscript recording={{ ...recording, error: 'Provider unavailable' }} status="failed" />)).toContain('Provider unavailable');
  expect(renderToStaticMarkup(<RecordingTranscript recording={recording} status="complete" />)).toContain('No speech was detected');
});
