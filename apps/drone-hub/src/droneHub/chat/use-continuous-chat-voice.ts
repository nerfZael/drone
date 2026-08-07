import {
  ContinuousVoiceSegmenter,
  pcm16ToWaveBytes,
  type ContinuousVoiceActivity,
  type ContinuousVoiceNoiseHandling,
  type ContinuousVoiceSegment,
} from '@drone/assistant-chat';
import React from 'react';
import { floatToPcm16, transcribeChatVoiceWav } from './use-chat-voice-recorder';

export type ContinuousChatVoiceStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'speech'
  | 'thought-pause'
  | 'paused'
  | 'stopping'
  | 'error';

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
};

const DEFAULT_SETTINGS: VoiceInputSettings = {
  silenceMillis: 2_500,
  noiseHandling: 'auto',
  language: null,
  quality: 'fast',
  confirmationFeedback: false,
};
const MAX_PENDING_SEGMENTS = 8;
const MAX_RETAINED_SEGMENTS = MAX_PENDING_SEGMENTS + 1;

function statusForActivity(activity: ContinuousVoiceActivity): ContinuousChatVoiceStatus {
  return activity === 'silence' ? 'listening' : activity;
}

async function loadVoiceInputSettings(): Promise<VoiceInputSettings> {
  const response = await fetch('/api/settings/voice-input');
  if (!response.ok) return DEFAULT_SETTINGS;
  const data = (await response.json()) as { voiceInput?: Partial<VoiceInputSettings> };
  return {
    silenceMillis:
      Number.isFinite(data.voiceInput?.silenceMillis) && Number(data.voiceInput?.silenceMillis) >= 1_000
        ? Number(data.voiceInput?.silenceMillis)
        : DEFAULT_SETTINGS.silenceMillis,
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
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

export function continuousVoiceStatusLabel(status: ContinuousChatVoiceStatus, pendingCount: number): string {
  if (status === 'starting') return 'Starting continuous voice…';
  if (status === 'speech') return 'Listening — speech detected';
  if (status === 'thought-pause') return 'Listening — waiting for end of thought';
  if (status === 'paused') return `Continuous voice paused${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  if (status === 'stopping') return `Finishing continuous voice${pendingCount ? ` · ${pendingCount} pending` : ''}…`;
  if (status === 'error') return 'Continuous voice needs attention';
  if (status === 'listening') return `Continuous voice listening${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  return '';
}

export function useContinuousChatVoice({
  resetKey,
  onTranscript,
  onError,
}: {
  resetKey: string;
  onTranscript: (text: string, deliveryId: string) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = React.useState<ContinuousChatVoiceStatus>('idle');
  const [pendingCount, setPendingCount] = React.useState(0);
  const [durationMillis, setDurationMillis] = React.useState(0);
  const mountedRef = React.useRef(false);
  const generationRef = React.useRef(0);
  const statusRef = React.useRef(status);
  const captureRef = React.useRef<Capture | null>(null);
  const segmenterRef = React.useRef<ContinuousVoiceSegmenter | null>(null);
  const queueRef = React.useRef<ContinuousVoiceSegment[]>([]);
  const drainRef = React.useRef<Promise<void> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const settingsRef = React.useRef(DEFAULT_SETTINGS);
  const sessionIdRef = React.useRef('');
  const transcriptContextRef = React.useRef('');
  const sampleCountRef = React.useRef(0);
  const pausedRef = React.useRef(false);
  const finishingRef = React.useRef(false);
  const onTranscriptRef = React.useRef(onTranscript);

  const setStatusValue = React.useCallback((next: ContinuousChatVoiceStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const drainQueue = React.useCallback((): Promise<void> => {
    if (drainRef.current) return drainRef.current;
    const generation = generationRef.current;
    const work = (async () => {
      while (generationRef.current === generation && queueRef.current.length > 0) {
        const segment = queueRef.current[0]!;
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const wave = pcm16ToWaveBytes(segment.pcm);
          const transcript = await transcribeChatVoiceWav(wave.buffer as ArrayBuffer, {
            quality: settingsRef.current.quality,
            language: settingsRef.current.language,
            prompt: transcriptContextRef.current,
            signal: controller.signal,
          });
          if (generationRef.current !== generation) return;
          const cleanTranscript = transcript.trim();
          if (cleanTranscript) {
            const deliveryId = `${sessionIdRef.current}.${segment.sequence}`;
            const accepted = await onTranscriptRef.current(cleanTranscript, deliveryId);
            if (!accepted) throw new Error('The chat did not accept the voice steering message.');
            transcriptContextRef.current = `${transcriptContextRef.current} ${cleanTranscript}`.trim().slice(-1_200);
            if (settingsRef.current.confirmationFeedback) playConfirmation();
          }
          queueRef.current.shift();
          if (mountedRef.current) setPendingCount(queueRef.current.length);
        } catch (error: any) {
          if (controller.signal.aborted || generationRef.current !== generation) return;
          pausedRef.current = true;
          setStatusValue('error');
          onError(error?.message ?? String(error));
          return;
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      }
    })().finally(() => {
      if (drainRef.current === work) drainRef.current = null;
    });
    drainRef.current = work;
    return work;
  }, [onError, setStatusValue]);

  const enqueue = React.useCallback(
    (segments: ContinuousVoiceSegment[]) => {
      if (!segments.length) return;
      const available = Math.max(0, MAX_RETAINED_SEGMENTS - queueRef.current.length);
      const retained = segments.slice(0, available);
      queueRef.current.push(...retained);
      if (mountedRef.current) setPendingCount(queueRef.current.length);
      if (retained.length < segments.length) {
        pausedRef.current = true;
        setStatusValue('error');
        onError('Continuous voice stopped accepting audio because its retained backlog is full.');
        return;
      }
      if (queueRef.current.length > MAX_PENDING_SEGMENTS) {
        pausedRef.current = true;
        setStatusValue('error');
        onError('Continuous voice paused because the transcription backlog is full.');
        void drainQueue();
        return;
      }
      void drainQueue();
    },
    [drainQueue, onError, setStatusValue],
  );

  const cancel = React.useCallback(async () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    closeCapture(captureRef.current);
    captureRef.current = null;
    segmenterRef.current?.discard();
    segmenterRef.current = null;
    queueRef.current = [];
    drainRef.current = null;
    pausedRef.current = false;
    finishingRef.current = false;
    sampleCountRef.current = 0;
    if (mountedRef.current) {
      setPendingCount(0);
      setDurationMillis(0);
    }
    setStatusValue('idle');
  }, [setStatusValue]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      abortRef.current?.abort();
      closeCapture(captureRef.current);
      captureRef.current = null;
    };
  }, []);

  const start = React.useCallback(async () => {
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
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setStatusValue('starting');
    onError('');
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      const settings = await loadVoiceInputSettings().catch(() => DEFAULT_SETTINGS);
      if (generationRef.current !== generation) return false;
      settingsRef.current = settings;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16_000,
        },
      });
      if (generationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      context = new AudioContextCtor({ sampleRate: 16_000 });
      if (context.state === 'suspended') await context.resume().catch(() => undefined);
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(2048, 1, 1);
      const output = context.createGain();
      output.gain.value = 0;
      const capture: Capture = { stream, context, source, processor, output };
      const segmenter = new ContinuousVoiceSegmenter({
        silenceMillis: settings.silenceMillis,
        noiseHandling: settings.noiseHandling,
      });
      processor.onaudioprocess = (event) => {
        if (generationRef.current !== generation || pausedRef.current) return;
        const raw = floatToPcm16(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate);
        const samples = new Int16Array(raw);
        sampleCountRef.current += samples.length;
        const result = segmenter.push(samples);
        if (statusRef.current !== 'stopping') setStatusValue(statusForActivity(result.activity));
        if (result.segments.length) enqueue(result.segments);
        if (mountedRef.current && sampleCountRef.current % 8_000 < samples.length) {
          setDurationMillis(Math.round((sampleCountRef.current / 16_000) * 1_000));
        }
      };
      if (generationRef.current !== generation) {
        closeCapture(capture);
        return false;
      }
      captureRef.current = capture;
      segmenterRef.current = segmenter;
      sessionIdRef.current = `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      onTranscriptRef.current = onTranscript;
      transcriptContextRef.current = '';
      finishingRef.current = false;
      source.connect(processor);
      processor.connect(output);
      output.connect(context.destination);
      setStatusValue('listening');
      return true;
    } catch (error: any) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context) void context.close().catch(() => undefined);
      if (generationRef.current === generation) {
        setStatusValue('idle');
        onError(error?.message ?? String(error));
      }
      return false;
    }
  }, [enqueue, onError, onTranscript, setStatusValue]);

  const togglePause = React.useCallback(async () => {
    if (statusRef.current === 'error' && finishingRef.current) {
      pausedRef.current = false;
      setStatusValue('stopping');
      onError('');
      await drainQueue();
      if (statusRef.current === 'error') return;
      finishingRef.current = false;
      sampleCountRef.current = 0;
      if (mountedRef.current) setDurationMillis(0);
      setStatusValue('idle');
      return;
    }
    if (statusRef.current === 'paused' || statusRef.current === 'error') {
      pausedRef.current = false;
      setStatusValue('listening');
      onError('');
      if (queueRef.current.length) void drainQueue();
      return;
    }
    if (statusRef.current === 'idle' || statusRef.current === 'starting') return;
    pausedRef.current = true;
    setStatusValue('paused');
  }, [drainQueue, onError, setStatusValue]);

  const stop = React.useCallback(async () => {
    if (statusRef.current === 'idle') return;
    if (statusRef.current === 'starting') {
      generationRef.current += 1;
      abortRef.current?.abort();
      closeCapture(captureRef.current);
      captureRef.current = null;
      segmenterRef.current?.discard();
      segmenterRef.current = null;
      pausedRef.current = false;
      finishingRef.current = false;
      setStatusValue('idle');
      return;
    }
    pausedRef.current = true;
    finishingRef.current = true;
    setStatusValue('stopping');
    closeCapture(captureRef.current);
    captureRef.current = null;
    const finalSegment = segmenterRef.current?.flush() ?? null;
    segmenterRef.current = null;
    if (finalSegment) enqueue([finalSegment]);
    await drainQueue();
    if (statusRef.current === 'error') return;
    finishingRef.current = false;
    pausedRef.current = false;
    sampleCountRef.current = 0;
    if (mountedRef.current) setDurationMillis(0);
    setStatusValue('idle');
  }, [drainQueue, enqueue, setStatusValue]);

  const previousResetKeyRef = React.useRef(resetKey);
  React.useEffect(() => {
    const previous = previousResetKeyRef.current;
    previousResetKeyRef.current = resetKey;
    if (previous !== resetKey && statusRef.current !== 'idle') void stop();
  }, [resetKey, stop]);

  return { status, pendingCount, durationMillis, start, stop, cancel, togglePause };
}
