import React from 'react';
import {
  browserMicrophoneCoordinator,
  browserMicrophoneOwnerLabel,
  type BrowserMicrophoneLease,
} from '../chat/browser-microphone-coordinator';
import { concatArrayBuffers, floatToPcm16, pcm16ToWav } from '../chat/use-chat-voice-recorder';

const SAMPLE_RATE_HZ = 16_000;
const CHANNELS = 1;
const BYTES_PER_SECOND = SAMPLE_RATE_HZ * CHANNELS * 2;

export type DictationAudioRecorderStatus = 'idle' | 'starting' | 'recording' | 'paused';

export type DictationAudioClip = {
  wav: ArrayBuffer;
  durationMillis: number;
};

type Capture = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  output: GainNode;
  chunks: ArrayBuffer[];
  totalBytes: number;
};

export function useDictationAudioRecorder(onError: (message: string) => void) {
  const [status, setStatus] = React.useState<DictationAudioRecorderStatus>('idle');
  const [durationMillis, setDurationMillis] = React.useState(0);
  const statusRef = React.useRef<DictationAudioRecorderStatus>('idle');
  const captureRef = React.useRef<Capture | null>(null);
  const leaseRef = React.useRef<BrowserMicrophoneLease | null>(null);
  const attemptRef = React.useRef(0);
  const mountedRef = React.useRef(false);
  const lastDurationUpdateAtRef = React.useRef(0);

  const setStatusValue = React.useCallback((next: DictationAudioRecorderStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const releaseMicrophone = React.useCallback((lease = leaseRef.current) => {
    lease?.release();
    if (leaseRef.current === lease) leaseRef.current = null;
  }, []);

  const closeCapture = React.useCallback((capture: Capture | null) => {
    if (!capture) return;
    capture.processor.onaudioprocess = null;
    for (const node of [capture.processor, capture.source, capture.output]) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close().catch(() => undefined);
  }, []);

  const cancel = React.useCallback(async () => {
    attemptRef.current += 1;
    const capture = captureRef.current;
    captureRef.current = null;
    closeCapture(capture);
    releaseMicrophone();
    setDurationMillis(0);
    setStatusValue('idle');
  }, [closeCapture, releaseMicrophone, setStatusValue]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attemptRef.current += 1;
      closeCapture(captureRef.current);
      captureRef.current = null;
      releaseMicrophone();
    };
  }, [closeCapture, releaseMicrophone]);

  const start = React.useCallback(async (): Promise<boolean> => {
    if (statusRef.current !== 'idle') return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      onError('Microphone recording is not available here.');
      return false;
    }
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      onError('Microphone recording is not available here.');
      return false;
    }

    const lease = browserMicrophoneCoordinator.acquire('global-dictation');
    if (!lease) {
      const owner = browserMicrophoneCoordinator.getSnapshot();
      onError(
        owner
          ? `${browserMicrophoneOwnerLabel(owner)} is already using the microphone.`
          : 'The microphone is still finishing another recording.',
      );
      return false;
    }
    leaseRef.current = lease;
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    lastDurationUpdateAtRef.current = 0;
    setDurationMillis(0);
    setStatusValue('starting');
    onError('');

    let pendingStream: MediaStream | null = null;
    let pendingContext: AudioContext | null = null;
    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: SAMPLE_RATE_HZ,
        },
      });
      pendingContext = new AudioContextCtor({ sampleRate: SAMPLE_RATE_HZ });
      if (pendingContext.state === 'suspended') {
        await pendingContext.resume().catch(() => undefined);
      }
      if (attemptRef.current !== attempt) {
        pendingStream.getTracks().forEach((track) => track.stop());
        void pendingContext.close().catch(() => undefined);
        releaseMicrophone(lease);
        return false;
      }

      const source = pendingContext.createMediaStreamSource(pendingStream);
      const processor = pendingContext.createScriptProcessor(4096, CHANNELS, CHANNELS);
      const output = pendingContext.createGain();
      output.gain.value = 0;
      const capture: Capture = {
        stream: pendingStream,
        context: pendingContext,
        source,
        processor,
        output,
        chunks: [],
        totalBytes: 0,
      };
      processor.onaudioprocess = (event) => {
        if (statusRef.current === 'paused') return;
        const frame = floatToPcm16(
          event.inputBuffer.getChannelData(0),
          event.inputBuffer.sampleRate,
        );
        capture.chunks.push(frame.slice(0));
        capture.totalBytes += frame.byteLength;
        const now = Date.now();
        if (mountedRef.current && now - lastDurationUpdateAtRef.current >= 200) {
          lastDurationUpdateAtRef.current = now;
          setDurationMillis((capture.totalBytes / BYTES_PER_SECOND) * 1000);
        }
      };
      source.connect(processor);
      processor.connect(output);
      output.connect(pendingContext.destination);
      captureRef.current = capture;
      pendingStream = null;
      pendingContext = null;
      setStatusValue('recording');
      return true;
    } catch (error: unknown) {
      pendingStream?.getTracks().forEach((track) => track.stop());
      if (pendingContext) void pendingContext.close().catch(() => undefined);
      releaseMicrophone(lease);
      if (attemptRef.current === attempt) {
        setStatusValue('idle');
        onError(recordingStartError(error));
      }
      return false;
    }
  }, [onError, releaseMicrophone, setStatusValue]);

  const finish = React.useCallback(async (): Promise<DictationAudioClip | null> => {
    if (statusRef.current === 'starting') {
      await cancel();
      return null;
    }
    if (statusRef.current !== 'recording' && statusRef.current !== 'paused') return null;
    const capture = captureRef.current;
    attemptRef.current += 1;
    captureRef.current = null;
    releaseMicrophone();
    setStatusValue('idle');
    if (!capture) {
      setDurationMillis(0);
      return null;
    }
    const nextDuration = (capture.totalBytes / BYTES_PER_SECOND) * 1000;
    setDurationMillis(nextDuration);
    closeCapture(capture);
    if (capture.totalBytes <= 0) return null;
    const pcm = concatArrayBuffers(capture.chunks, capture.totalBytes);
    return {
      wav: pcm16ToWav(pcm, SAMPLE_RATE_HZ, CHANNELS),
      durationMillis: nextDuration,
    };
  }, [cancel, closeCapture, releaseMicrophone, setStatusValue]);

  const togglePause = React.useCallback((): boolean => {
    if (statusRef.current === 'recording') {
      setStatusValue('paused');
      return true;
    }
    if (statusRef.current === 'paused') {
      setStatusValue('recording');
      return true;
    }
    return false;
  }, [setStatusValue]);

  const getStatus = React.useCallback(() => statusRef.current, []);

  return {
    status,
    durationMillis,
    getStatus,
    start,
    finish,
    cancel,
    togglePause,
  };
}

function recordingStartError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/permission|denied|notallowed/i.test(message)) return 'Microphone permission was denied.';
  return message.trim() ? `Recording could not start: ${message}` : 'Recording could not start.';
}
