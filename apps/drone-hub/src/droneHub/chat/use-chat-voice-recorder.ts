import { normalizeGroqTranscriptionPrompt } from '@drone/assistant-chat';
import React from 'react';
import {
  browserMicrophoneCoordinator,
  browserMicrophoneOwnerLabel,
  type BrowserMicrophoneLease,
  type BrowserMicrophoneOwner,
} from './browser-microphone-coordinator';

const CHAT_VOICE_SAMPLE_RATE_HZ = 16_000;
const CHAT_VOICE_CHANNELS = 1;

export type ChatVoiceRecordingStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'transcribing';

export function formatChatVoiceDuration(durationMillis: number): string {
  const totalSeconds = Number.isFinite(durationMillis)
    ? Math.max(0, Math.floor(durationMillis / 1000))
    : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

type ChatVoiceCapture = {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
  startedAt: number;
  pausedAt: number | null;
  pausedMillis: number;
  durationTimer: number;
};

type TranscriptionResponse = {
  ok?: boolean;
  text?: unknown;
  error?: unknown;
};

export function mergeDraftWithVoiceTranscript(draft: string, transcript: string): string {
  const cleanDraft = draft.trimEnd();
  return insertVoiceTranscriptAtSelection(cleanDraft, transcript, cleanDraft.length).value;
}

export type VoiceTranscriptInsertion = {
  value: string;
  caret: number;
};

export function insertVoiceTranscriptAtSelection(
  draft: string,
  transcript: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): VoiceTranscriptInsertion {
  const cleanTranscript = transcript.trim();
  const start = Math.min(Math.max(0, selectionStart), draft.length);
  const end = Math.min(Math.max(start, selectionEnd), draft.length);
  if (!cleanTranscript) return { value: draft, caret: start };

  const before = draft.slice(0, start);
  const after = draft.slice(end);
  const prefix = before && !/\n$/.test(before) ? '\n' : '';
  const suffix = after && !/^\s/.test(after) ? ' ' : '';
  const inserted = `${prefix}${cleanTranscript}`;

  return {
    value: `${before}${inserted}${suffix}${after}`,
    caret: start + inserted.length,
  };
}

export function concatArrayBuffers(chunks: ArrayBuffer[], totalBytes: number): ArrayBuffer {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

export function pcm16ToWav(pcm: ArrayBuffer, sampleRate = CHAT_VOICE_SAMPLE_RATE_HZ, channels = CHAT_VOICE_CHANNELS): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm));
  return buffer;
}

export function floatToPcm16(input: Float32Array, sourceSampleRate = CHAT_VOICE_SAMPLE_RATE_HZ): ArrayBuffer {
  const samples = resampleFloat32(input, sourceSampleRate, CHAT_VOICE_SAMPLE_RATE_HZ);
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

export async function transcribeChatVoiceWav(
  wav: ArrayBuffer,
  options: {
    quality?: 'fast' | 'accurate';
    language?: string | null;
    prompt?: string | null;
    telemetryId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  return await transcribeChatVoiceAudio(wav, 'audio/wav', options);
}

export async function transcribeChatVoiceAudio(
  audio: ArrayBuffer,
  mimeType: string,
  options: {
    quality?: 'fast' | 'accurate';
    language?: string | null;
    prompt?: string | null;
    telemetryId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const prompt = normalizeGroqTranscriptionPrompt(options.prompt);
  const promptBytes = prompt ? new TextEncoder().encode(prompt) : null;
  let promptBase64 = '';
  if (promptBytes) {
    let binary = '';
    for (const byte of promptBytes) binary += String.fromCharCode(byte);
    promptBase64 = window.btoa(binary);
  }
  const response = await fetch('/api/audio/transcriptions', {
    method: 'POST',
    headers: {
      'content-type': mimeType || 'audio/webm',
      ...(options.quality ? { 'x-drone-transcription-quality': options.quality } : {}),
      ...(options.language ? { 'x-drone-transcription-language': options.language } : {}),
      ...(promptBase64 ? { 'x-drone-transcription-prompt-base64': promptBase64 } : {}),
      ...(options.telemetryId
        ? { 'x-drone-companion-message-id': options.telemetryId.slice(0, 128) }
        : {}),
    },
    body: audio,
    signal: options.signal,
  });
  const raw = await response.text();
  let data: TranscriptionResponse | null = null;
  try {
    data = raw ? (JSON.parse(raw) as TranscriptionResponse) : null;
  } catch {
    data = null;
  }
  if (!response.ok || data?.ok === false) {
    const message = typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : response.statusText || 'Voice transcription failed.';
    throw new Error(message);
  }
  return String(data?.text ?? '').trim();
}

export function useChatVoiceRecorder({
  onError,
  microphoneOwner = 'voice-message',
}: {
  onError: (message: string) => void;
  microphoneOwner?: BrowserMicrophoneOwner;
}) {
  const [status, setStatus] = React.useState<ChatVoiceRecordingStatus>('idle');
  const [durationMillis, setDurationMillis] = React.useState(0);
  const statusRef = React.useRef<ChatVoiceRecordingStatus>('idle');
  const captureRef = React.useRef<ChatVoiceCapture | null>(null);
  const startIdRef = React.useRef(0);
  const stopPromiseRef = React.useRef<Promise<string> | null>(null);
  const mountedRef = React.useRef(false);
  const microphoneLeaseRef = React.useRef<BrowserMicrophoneLease | null>(null);
  const transcriptionAbortRef = React.useRef<AbortController | null>(null);

  const releaseMicrophone = React.useCallback((lease = microphoneLeaseRef.current) => {
    lease?.release();
    if (microphoneLeaseRef.current === lease) microphoneLeaseRef.current = null;
  }, []);

  const setStatusValue = React.useCallback((next: ChatVoiceRecordingStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const stopCapture = React.useCallback((capture: ChatVoiceCapture | null) => {
    if (!capture) return;
    window.clearInterval(capture.durationTimer);
    try {
      if (capture.recorder.state !== 'inactive') capture.recorder.stop();
    } catch {
      // The recorder may already be stopping.
    }
    capture.stream.getTracks().forEach((track) => track.stop());
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startIdRef.current += 1;
      stopCapture(captureRef.current);
      captureRef.current = null;
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      releaseMicrophone();
    };
  }, [releaseMicrophone, stopCapture]);

  const discardRecording = React.useCallback(async () => {
    startIdRef.current += 1;
    stopPromiseRef.current = null;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    stopCapture(captureRef.current);
    captureRef.current = null;
    releaseMicrophone();
    setDurationMillis(0);
    setStatusValue('idle');
  }, [releaseMicrophone, setStatusValue, stopCapture]);

  const startRecording = React.useCallback(async () => {
    if (statusRef.current !== 'idle') return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      onError('Browser microphone recording is not available here.');
      return false;
    }
    if (typeof window.MediaRecorder === 'undefined') {
      onError('Browser microphone recording is not available here.');
      return false;
    }
    const microphoneLease = browserMicrophoneCoordinator.acquire(microphoneOwner);
    if (!microphoneLease) {
      const owner = browserMicrophoneCoordinator.getSnapshot();
      onError(
        owner
          ? `${browserMicrophoneOwnerLabel(owner)} is already using the microphone.`
          : 'The microphone is still finishing another recording.',
      );
      return false;
    }
    microphoneLeaseRef.current = microphoneLease;

    const startId = startIdRef.current + 1;
    startIdRef.current = startId;
    setDurationMillis(0);
    setStatusValue('starting');
    onError('');
    let pendingStream: MediaStream | null = null;
    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const stream = pendingStream;
      const preferredMimeType = preferredRecordingMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      const capture: ChatVoiceCapture = {
        stream,
        recorder,
        chunks: [],
        mimeType: recorder.mimeType || preferredMimeType || 'audio/webm',
        startedAt: Date.now(),
        pausedAt: null,
        pausedMillis: 0,
        durationTimer: 0,
      };
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) capture.chunks.push(event.data);
      });
      recorder.addEventListener('error', () => {
        if (captureRef.current !== capture) return;
        captureRef.current = null;
        stopCapture(capture);
        releaseMicrophone(microphoneLease);
        setStatusValue('idle');
        onError('The microphone stopped unexpectedly. Start voice input again.');
      });
      if (startIdRef.current !== startId) {
        stopCapture(capture);
        releaseMicrophone(microphoneLease);
        return false;
      }
      recorder.start(250);
      capture.durationTimer = window.setInterval(() => {
        if (!mountedRef.current) return;
        setDurationMillis(recordingDurationMillis(capture));
      }, 200);
      captureRef.current = capture;
      pendingStream = null;
      setStatusValue('recording');
      return true;
    } catch (err: any) {
      if (pendingStream) pendingStream.getTracks().forEach((track) => track.stop());
      releaseMicrophone(microphoneLease);
      if (startIdRef.current === startId) {
        setStatusValue('idle');
        onError(voiceStartFailureMessage(err));
      }
      return false;
    }
  }, [microphoneOwner, onError, releaseMicrophone, setStatusValue, stopCapture]);

  const toggleRecordingPause = React.useCallback(() => {
    const capture = captureRef.current;
    if (!capture) return;
    if (statusRef.current === 'recording') {
      try {
        capture.recorder.pause();
        capture.pausedAt = Date.now();
      } catch {
        return;
      }
      setStatusValue('paused');
      return;
    }
    if (statusRef.current === 'paused') {
      try {
        capture.recorder.resume();
        if (capture.pausedAt !== null) capture.pausedMillis += Date.now() - capture.pausedAt;
        capture.pausedAt = null;
      } catch {
        return;
      }
      setStatusValue('recording');
    }
  }, [setStatusValue]);

  const transcribeRecording = React.useCallback(
    async (options?: { telemetryId?: string }): Promise<string> => {
      const capture = captureRef.current;
      const transcriptionId = startIdRef.current + 1;
      startIdRef.current = transcriptionId;
      if (!capture) {
        setStatusValue('idle');
        return '';
      }

      captureRef.current = null;
      setDurationMillis(recordingDurationMillis(capture));
      window.clearInterval(capture.durationTimer);
      setStatusValue('transcribing');
      onError('');
      const transcriptionAbort = new AbortController();
      transcriptionAbortRef.current = transcriptionAbort;
      try {
        let audio: ArrayBuffer;
        try {
          audio = await finishMediaRecording(capture);
        } finally {
          capture.stream.getTracks().forEach((track) => track.stop());
          releaseMicrophone();
        }
        if (audio.byteLength <= 0) return '';
        return await transcribeChatVoiceAudio(audio, capture.mimeType, {
          signal: transcriptionAbort.signal,
          telemetryId: options?.telemetryId,
        });
      } catch (err: any) {
        if (startIdRef.current === transcriptionId) {
          onError(err?.message ?? String(err));
        }
        return '';
      } finally {
        if (transcriptionAbortRef.current === transcriptionAbort) {
          transcriptionAbortRef.current = null;
        }
        if (startIdRef.current === transcriptionId) setStatusValue('idle');
      }
    },
    [onError, releaseMicrophone, setStatusValue],
  );

  const stopRecordingForTranscript = React.useCallback(
    async (options?: { telemetryId?: string }): Promise<string> => {
      if (stopPromiseRef.current) return stopPromiseRef.current;
      const promise = transcribeRecording(options);
      stopPromiseRef.current = promise;
      try {
        return await promise;
      } finally {
        stopPromiseRef.current = null;
      }
    },
    [transcribeRecording],
  );

  return {
    status,
    durationMillis,
    startRecording,
    toggleRecordingPause,
    discardRecording,
    stopRecordingForTranscript,
  };
}

function preferredRecordingMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
}

function recordingDurationMillis(capture: ChatVoiceCapture, now = Date.now()): number {
  const currentPauseMillis = capture.pausedAt === null ? 0 : Math.max(0, now - capture.pausedAt);
  return Math.max(0, now - capture.startedAt - capture.pausedMillis - currentPauseMillis);
}

async function finishMediaRecording(capture: ChatVoiceCapture): Promise<ArrayBuffer> {
  if (capture.recorder.state !== 'inactive') {
    await new Promise<void>((resolve, reject) => {
      const onStop = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('The microphone stopped before the recording could be saved.'));
      };
      const cleanup = () => {
        capture.recorder.removeEventListener('stop', onStop);
        capture.recorder.removeEventListener('error', onError);
      };
      capture.recorder.addEventListener('stop', onStop, { once: true });
      capture.recorder.addEventListener('error', onError, { once: true });
      try {
        capture.recorder.stop();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
  return await new Blob(capture.chunks, { type: capture.mimeType }).arrayBuffer();
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function resampleFloat32(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (
    !Number.isFinite(sourceSampleRate) ||
    sourceSampleRate <= 0 ||
    Math.abs(sourceSampleRate - targetSampleRate) < 1
  ) {
    return input;
  }
  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const sourceIndex = Math.floor(sourcePosition);
    const nextIndex = Math.min(input.length - 1, sourceIndex + 1);
    const fraction = sourcePosition - sourceIndex;
    output[index] = (input[sourceIndex] ?? 0) * (1 - fraction) + (input[nextIndex] ?? 0) * fraction;
  }
  return output;
}

function voiceStartFailureMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (/permission|denied|notallowed/i.test(message)) return 'Microphone permission was denied.';
  if (!message.trim()) return 'Voice recording could not start.';
  return `Voice recording could not start: ${message}`;
}
