import {
  ContinuousVoiceSession,
  pcm16ToWaveBytes,
  type ContinuousVoiceNoiseHandling,
  type ContinuousVoiceSessionStatus,
} from '@drone/assistant-chat';
import React from 'react';
import {
  browserMicrophoneCoordinator,
  browserMicrophoneOwnerLabel,
  type BrowserMicrophoneLease,
} from './browser-microphone-coordinator';
import { floatToPcm16, transcribeChatVoiceWav } from './use-chat-voice-recorder';
import { normalizeVoiceInputSilenceMillis } from './voice-input-silence';

export type ContinuousChatVoiceStatus = ContinuousVoiceSessionStatus;

type VoiceInputSettings = {
  silenceMillis: number;
  noiseHandling: ContinuousVoiceNoiseHandling;
  language: string | null;
  quality: 'fast' | 'accurate';
  confirmationFeedback: boolean;
};

type Capture = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  output: GainNode;
  onTrackEnded: () => void;
};

const DEFAULT_SETTINGS: VoiceInputSettings = {
  silenceMillis: 2_500,
  noiseHandling: 'auto',
  language: null,
  quality: 'fast',
  confirmationFeedback: false,
};

async function loadVoiceInputSettings(): Promise<VoiceInputSettings> {
  const response = await fetch('/api/settings/voice-input');
  if (!response.ok) return DEFAULT_SETTINGS;
  const data = (await response.json()) as { voiceInput?: Partial<VoiceInputSettings> };
  return {
    silenceMillis: normalizeVoiceInputSilenceMillis(
      data.voiceInput?.silenceMillis,
      DEFAULT_SETTINGS.silenceMillis,
    ),
    noiseHandling:
      data.voiceInput?.noiseHandling === 'quiet' || data.voiceInput?.noiseHandling === 'noisy'
        ? data.voiceInput.noiseHandling
        : 'auto',
    language: String(data.voiceInput?.language ?? '').trim() || null,
    quality: data.voiceInput?.quality === 'accurate' ? 'accurate' : 'fast',
    confirmationFeedback: data.voiceInput?.confirmationFeedback === true,
  };
}

function closeCapture(capture: Capture | null): void {
  if (!capture) return;
  capture.processor.onaudioprocess = null;
  for (const track of capture.stream.getTracks()) {
    track.removeEventListener('ended', capture.onTrackEnded);
  }
  for (const node of [capture.processor, capture.source, capture.output]) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  capture.stream.getTracks().forEach((track) => track.stop());
  void capture.context.close().catch(() => undefined);
}

function playConfirmation(): void {
  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.035, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.08);
  oscillator.onended = () => void context.close().catch(() => undefined);
}

export function continuousVoiceStatusLabel(
  status: ContinuousChatVoiceStatus,
  pendingCount: number,
): string {
  if (status === 'starting') return 'Starting continuous voice…';
  if (status === 'speech') return 'Listening — speech detected';
  if (status === 'thought-pause') return 'Listening — waiting for end of thought';
  if (status === 'recovering') return 'Continuous voice reconnecting…';
  if (status === 'paused') {
    return `Continuous voice paused${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  }
  if (status === 'stopping') {
    return `Finishing continuous voice${pendingCount ? ` · ${pendingCount} pending` : ''}…`;
  }
  if (status === 'error') return 'Continuous voice needs attention';
  if (status === 'listening') {
    return `Continuous voice listening${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  }
  return '';
}

export function useContinuousChatVoice({
  resetKey,
  onTranscript,
  onError,
  routeKey,
  shouldCapture,
  microphoneOwner = 'continuous-steering',
}: {
  resetKey: string;
  onTranscript: (text: string, deliveryId: string, route: string | null) => Promise<boolean>;
  onError: (message: string) => void;
  routeKey?: () => string | null;
  shouldCapture?: () => boolean;
  microphoneOwner?: 'continuous-steering' | 'continuous-dictation';
}) {
  const [status, setStatus] = React.useState<ContinuousChatVoiceStatus>('idle');
  const [pendingCount, setPendingCount] = React.useState(0);
  const [durationMillis, setDurationMillis] = React.useState(0);
  const mountedRef = React.useRef(false);
  const startAttemptRef = React.useRef(0);
  const captureRef = React.useRef<Capture | null>(null);
  const microphoneLeaseRef = React.useRef<BrowserMicrophoneLease | null>(null);
  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;
  const routeKeyRef = React.useRef(routeKey);
  routeKeyRef.current = routeKey;
  const shouldCaptureRef = React.useRef(shouldCapture);
  shouldCaptureRef.current = shouldCapture;
  const sessionRef = React.useRef<ContinuousVoiceSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new ContinuousVoiceSession({
      onChange: (snapshot) => {
        if (!mountedRef.current) return;
        setStatus(snapshot.status);
        setPendingCount(snapshot.pendingCount);
        setDurationMillis(snapshot.durationMillis);
      },
      onError: (message) => onErrorRef.current(message),
    });
  }
  const session = sessionRef.current;

  const releaseMicrophone = React.useCallback((lease = microphoneLeaseRef.current) => {
    lease?.release();
    if (microphoneLeaseRef.current === lease) microphoneLeaseRef.current = null;
  }, []);

  const cancel = React.useCallback(async () => {
    startAttemptRef.current += 1;
    closeCapture(captureRef.current);
    captureRef.current = null;
    releaseMicrophone();
    session.cancel();
  }, [releaseMicrophone, session]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startAttemptRef.current += 1;
      closeCapture(captureRef.current);
      captureRef.current = null;
      releaseMicrophone();
      session.cancel();
    };
  }, [releaseMicrophone, session]);

  const start = React.useCallback(async () => {
    if (session.status !== 'idle') return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      onError('Browser microphone recording is not available here.');
      return false;
    }
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
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
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    const attempt = startAttemptRef.current + 1;
    startAttemptRef.current = attempt;
    if (!session.begin()) {
      releaseMicrophone(microphoneLease);
      return false;
    }
    onError('');
    try {
      const settings = await loadVoiceInputSettings().catch(() => DEFAULT_SETTINGS);
      if (startAttemptRef.current !== attempt) {
        releaseMicrophone(microphoneLease);
        return false;
      }
      session.configure({
        sessionId: `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        endpointConfig: {
          silenceMillis: settings.silenceMillis,
          noiseHandling: settings.noiseHandling,
        },
        transcribe: async ({ segment, context: transcriptContext, signal }) => {
          const wave = pcm16ToWaveBytes(segment.pcm);
          return await transcribeChatVoiceWav(wave.buffer as ArrayBuffer, {
            quality: settings.quality,
            language: settings.language,
            prompt: transcriptContext,
            signal,
          });
        },
        route: () => routeKeyRef.current?.() ?? null,
        deliver: onTranscript,
        ...(settings.confirmationFeedback ? { confirm: playConfirmation } : {}),
      });
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16_000,
        },
      });
      if (startAttemptRef.current !== attempt) {
        stream.getTracks().forEach((track) => track.stop());
        releaseMicrophone(microphoneLease);
        return false;
      }
      context = new AudioContextCtor({ sampleRate: 16_000 });
      if (context.state === 'suspended') await context.resume().catch(() => undefined);
      if (startAttemptRef.current !== attempt) {
        stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => undefined);
        releaseMicrophone(microphoneLease);
        return false;
      }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(2048, 1, 1);
      const output = context.createGain();
      output.gain.value = 0;
      const capture: Capture = {
        stream,
        context,
        source,
        processor,
        output,
        onTrackEnded: () => {
          if (captureRef.current !== capture) return;
          startAttemptRef.current += 1;
          captureRef.current = null;
          closeCapture(capture);
          releaseMicrophone();
          session.cancel();
          onErrorRef.current('The microphone stopped unexpectedly. Start voice input again.');
        },
      };
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', capture.onTrackEnded);
      }
      processor.onaudioprocess = (event) => {
        if (shouldCaptureRef.current && !shouldCaptureRef.current()) return;
        const raw = floatToPcm16(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate);
        session.push(new Int16Array(raw));
      };
      captureRef.current = capture;
      source.connect(processor);
      processor.connect(output);
      output.connect(context.destination);
      session.listen();
      return true;
    } catch (error: any) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context) void context.close().catch(() => undefined);
      releaseMicrophone(microphoneLease);
      if (startAttemptRef.current === attempt) {
        session.cancel();
        onError(error?.message ?? String(error));
      }
      return false;
    }
  }, [microphoneOwner, onError, onTranscript, releaseMicrophone, session]);

  const togglePause = React.useCallback(async () => {
    if (session.status === 'paused' || session.status === 'error') {
      onError('');
      await session.resume();
      return;
    }
    session.pause();
  }, [onError, session]);

  const stop = React.useCallback(async () => {
    if (session.status === 'idle') return;
    if (session.status === 'starting') {
      await cancel();
      return;
    }
    closeCapture(captureRef.current);
    captureRef.current = null;
    releaseMicrophone();
    await session.finish();
  }, [cancel, releaseMicrophone, session]);

  const discardPending = React.useCallback(() => {
    session.discardPending();
  }, [session]);

  const getStatus = React.useCallback(() => session.status, [session]);

  const previousResetKeyRef = React.useRef(resetKey);
  React.useEffect(() => {
    const previous = previousResetKeyRef.current;
    previousResetKeyRef.current = resetKey;
    if (previous !== resetKey && session.status !== 'idle') void stop();
  }, [resetKey, session, stop]);

  return {
    status,
    pendingCount,
    durationMillis,
    getStatus,
    start,
    stop,
    cancel,
    togglePause,
    discardPending,
  };
}
