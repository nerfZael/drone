import React from 'react';

const CHAT_VOICE_SAMPLE_RATE_HZ = 16_000;
const CHAT_VOICE_CHANNELS = 1;
const CHAT_VOICE_BYTES_PER_SECOND = CHAT_VOICE_SAMPLE_RATE_HZ * CHAT_VOICE_CHANNELS * 2;

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
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  output: GainNode;
  chunks: ArrayBuffer[];
  totalBytes: number;
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
  const prefix = before && !/\s$/.test(before) ? ' ' : '';
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
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const promptBytes = options.prompt ? new TextEncoder().encode(options.prompt.slice(-1_200)) : null;
  let promptBase64 = '';
  if (promptBytes) {
    let binary = '';
    for (const byte of promptBytes) binary += String.fromCharCode(byte);
    promptBase64 = window.btoa(binary);
  }
  const response = await fetch('/api/audio/transcriptions', {
    method: 'POST',
    headers: {
      'content-type': 'audio/wav',
      ...(options.quality ? { 'x-drone-transcription-quality': options.quality } : {}),
      ...(options.language ? { 'x-drone-transcription-language': options.language } : {}),
      ...(promptBase64 ? { 'x-drone-transcription-prompt-base64': promptBase64 } : {}),
    },
    body: wav,
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

export function useChatVoiceRecorder({ onError }: { onError: (message: string) => void }) {
  const [status, setStatus] = React.useState<ChatVoiceRecordingStatus>('idle');
  const [durationMillis, setDurationMillis] = React.useState(0);
  const statusRef = React.useRef<ChatVoiceRecordingStatus>('idle');
  const captureRef = React.useRef<ChatVoiceCapture | null>(null);
  const startIdRef = React.useRef(0);
  const stopPromiseRef = React.useRef<Promise<string> | null>(null);
  const lastDurationUpdateAtRef = React.useRef(0);
  const mountedRef = React.useRef(false);

  const setStatusValue = React.useCallback((next: ChatVoiceRecordingStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const stopCapture = React.useCallback((capture: ChatVoiceCapture | null) => {
    if (!capture) return;
    try {
      capture.processor.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      capture.source.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      capture.output.disconnect();
    } catch {
      // Already disconnected.
    }
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close().catch(() => undefined);
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startIdRef.current += 1;
      stopCapture(captureRef.current);
      captureRef.current = null;
    };
  }, [stopCapture]);

  const discardRecording = React.useCallback(async () => {
    startIdRef.current += 1;
    stopPromiseRef.current = null;
    stopCapture(captureRef.current);
    captureRef.current = null;
    setDurationMillis(0);
    setStatusValue('idle');
  }, [setStatusValue, stopCapture]);

  const startRecording = React.useCallback(async () => {
    if (statusRef.current !== 'idle') return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      onError('Browser microphone recording is not available here.');
      return false;
    }
    const AudioContextCtor =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      onError('Browser microphone recording is not available here.');
      return false;
    }

    const startId = startIdRef.current + 1;
    startIdRef.current = startId;
    lastDurationUpdateAtRef.current = 0;
    setDurationMillis(0);
    setStatusValue('starting');
    onError('');
    let pendingStream: MediaStream | null = null;
    let pendingContext: AudioContext | null = null;
    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pendingContext = new AudioContextCtor({ sampleRate: CHAT_VOICE_SAMPLE_RATE_HZ });
      const stream = pendingStream;
      const context = pendingContext;
      if (context.state === 'suspended') {
        await context.resume().catch(() => undefined);
      }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, CHAT_VOICE_CHANNELS, CHAT_VOICE_CHANNELS);
      const output = context.createGain();
      output.gain.value = 0;
      const capture: ChatVoiceCapture = {
        stream,
        context,
        source,
        processor,
        output,
        chunks: [],
        totalBytes: 0,
      };
      processor.onaudioprocess = (event) => {
        if (statusRef.current === 'paused') return;
        const frame = floatToPcm16(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate);
        capture.chunks.push(frame.slice(0));
        capture.totalBytes += frame.byteLength;
        const now = Date.now();
        if (mountedRef.current && now - lastDurationUpdateAtRef.current >= 200) {
          lastDurationUpdateAtRef.current = now;
          setDurationMillis((capture.totalBytes / CHAT_VOICE_BYTES_PER_SECOND) * 1000);
        }
      };
      if (startIdRef.current !== startId) {
        stopCapture(capture);
        return false;
      }
      source.connect(processor);
      processor.connect(output);
      output.connect(context.destination);
      captureRef.current = capture;
      pendingStream = null;
      pendingContext = null;
      setStatusValue('recording');
      return true;
    } catch (err: any) {
      if (pendingStream) pendingStream.getTracks().forEach((track) => track.stop());
      if (pendingContext) void pendingContext.close().catch(() => undefined);
      stopCapture(captureRef.current);
      captureRef.current = null;
      if (startIdRef.current === startId) {
        setStatusValue('idle');
        onError(voiceStartFailureMessage(err));
      }
      return false;
    }
  }, [onError, setStatusValue, stopCapture]);

  const toggleRecordingPause = React.useCallback(() => {
    if (statusRef.current === 'recording') {
      setStatusValue('paused');
      return;
    }
    if (statusRef.current === 'paused') {
      setStatusValue('recording');
    }
  }, [setStatusValue]);

  const transcribeRecording = React.useCallback(async (): Promise<string> => {
    const capture = captureRef.current;
    startIdRef.current += 1;
    if (!capture) {
      setStatusValue('idle');
      return '';
    }

    captureRef.current = null;
    setDurationMillis((capture.totalBytes / CHAT_VOICE_BYTES_PER_SECOND) * 1000);
    stopCapture(capture);
    setStatusValue('transcribing');
    onError('');
    try {
      if (capture.totalBytes <= 0) return '';
      const pcm = concatArrayBuffers(capture.chunks, capture.totalBytes);
      const wav = pcm16ToWav(pcm, CHAT_VOICE_SAMPLE_RATE_HZ, CHAT_VOICE_CHANNELS);
      return await transcribeChatVoiceWav(wav);
    } catch (err: any) {
      onError(err?.message ?? String(err));
      return '';
    } finally {
      setStatusValue('idle');
    }
  }, [onError, setStatusValue, stopCapture]);

  const stopRecordingForTranscript = React.useCallback(async (): Promise<string> => {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    const promise = transcribeRecording();
    stopPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      stopPromiseRef.current = null;
    }
  }, [transcribeRecording]);

  return {
    status,
    durationMillis,
    startRecording,
    toggleRecordingPause,
    discardRecording,
    stopRecordingForTranscript,
  };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function resampleFloat32(input: Float32Array, sourceSampleRate: number, targetSampleRate: number): Float32Array {
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0 || Math.abs(sourceSampleRate - targetSampleRate) < 1) {
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
