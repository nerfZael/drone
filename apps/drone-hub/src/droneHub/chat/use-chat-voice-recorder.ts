import React from 'react';

const CHAT_VOICE_SAMPLE_RATE_HZ = 16_000;
const CHAT_VOICE_CHANNELS = 1;

export type ChatVoiceRecordingStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'transcribing';

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
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return draft;
  const cleanDraft = draft.trimEnd();
  if (!cleanDraft) return cleanTranscript;
  return `${cleanDraft}\n${cleanTranscript}`;
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

export async function transcribeChatVoiceWav(wav: ArrayBuffer): Promise<string> {
  const response = await fetch('/api/audio/transcriptions', {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: wav,
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
  const statusRef = React.useRef<ChatVoiceRecordingStatus>('idle');
  const captureRef = React.useRef<ChatVoiceCapture | null>(null);
  const startIdRef = React.useRef(0);
  const stopPromiseRef = React.useRef<Promise<string> | null>(null);
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
    setStatusValue('idle');
  }, [setStatusValue, stopCapture]);

  const startRecording = React.useCallback(async () => {
    if (statusRef.current !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      onError('Browser microphone recording is not available here.');
      return;
    }
    const AudioContextCtor =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      onError('Browser microphone recording is not available here.');
      return;
    }

    const startId = startIdRef.current + 1;
    startIdRef.current = startId;
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
      };
      if (startIdRef.current !== startId) {
        stopCapture(capture);
        return;
      }
      source.connect(processor);
      processor.connect(output);
      output.connect(context.destination);
      captureRef.current = capture;
      pendingStream = null;
      pendingContext = null;
      setStatusValue('recording');
    } catch (err: any) {
      if (pendingStream) pendingStream.getTracks().forEach((track) => track.stop());
      if (pendingContext) void pendingContext.close().catch(() => undefined);
      stopCapture(captureRef.current);
      captureRef.current = null;
      if (startIdRef.current === startId) {
        setStatusValue('idle');
        onError(voiceStartFailureMessage(err));
      }
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
