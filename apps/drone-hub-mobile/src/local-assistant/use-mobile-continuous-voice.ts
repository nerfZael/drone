import {
  ContinuousVoiceSegmenter,
  normalizePcm16Audio,
  pcm16ToWaveBytes,
  type ContinuousVoiceActivity,
  type ContinuousVoiceSegment,
} from '@drone/assistant-chat';
import React from 'react';
import { AppState, Platform, Vibration } from 'react-native';
import {
  getRecordingPermissionsAsync,
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
  type AudioStreamStatus,
} from 'expo-audio';
import { readGroqApiKey } from './local-assistant-settings';
import { transcribeMobileVoiceWave } from './mobile-groq-transcription';
import { MobileAudioStreamStartGate } from './mobile-audio-stream-start-gate';
import type {
  MobileMicrophoneCoordinator,
  MobileMicrophoneLease,
} from './mobile-microphone-coordinator';
import {
  resolveMobileContinuousVoiceNativeAction,
  type MobileContinuousVoiceStatus,
} from './mobile-continuous-voice-lifecycle';
import {
  ensureMobileBackgroundRecordingPermission,
  ensureMobileRecordingPermission,
} from './mobile-recording-permission';
import {
  loadMobileVoiceInputSettings,
  mobileVoiceInputSilenceMillis,
  type MobileVoiceInputSettings,
} from './mobile-voice-input-settings';

export type { MobileContinuousVoiceStatus } from './mobile-continuous-voice-lifecycle';

export type StartMobileContinuousVoiceInput = {
  targetKey: string;
  onTranscript(text: string, deliveryId: string): Promise<boolean>;
};

const MAX_PENDING_SEGMENTS = 8;
const MAX_RETAINED_SEGMENTS = MAX_PENDING_SEGMENTS + 1;

function statusForActivity(activity: ContinuousVoiceActivity): MobileContinuousVoiceStatus {
  return activity === 'silence' ? 'listening' : activity;
}

export function mobileContinuousVoiceStatusLabel(
  status: MobileContinuousVoiceStatus,
  pendingCount: number,
): string {
  if (status === 'starting') return 'Starting continuous voice…';
  if (status === 'speech') return 'Speech detected';
  if (status === 'thought-pause') return 'Waiting for end of thought';
  if (status === 'recovering') return 'Microphone interrupted · reconnecting…';
  if (status === 'paused') return `Paused${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  if (status === 'stopping') return `Finishing${pendingCount ? ` · ${pendingCount} pending` : ''}…`;
  if (status === 'error') return 'Continuous voice needs attention';
  if (status === 'listening') return `Listening${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  return '';
}

export function useMobileContinuousVoice({
  microphoneCoordinator,
  onError,
  onBackgroundActivityChange,
}: {
  microphoneCoordinator: MobileMicrophoneCoordinator;
  onError(message: string): void;
  onBackgroundActivityChange(active: boolean): void;
}) {
  const [status, setStatus] = React.useState<MobileContinuousVoiceStatus>('idle');
  const [pendingCount, setPendingCount] = React.useState(0);
  const [durationMillis, setDurationMillis] = React.useState(0);
  const [targetKey, setTargetKey] = React.useState<string | null>(null);
  const mountedRef = React.useRef(false);
  const generationRef = React.useRef(0);
  const statusRef = React.useRef(status);
  const pausedRef = React.useRef(false);
  const finishingRef = React.useRef(false);
  const segmenterRef = React.useRef<ContinuousVoiceSegmenter | null>(null);
  const settingsRef = React.useRef<MobileVoiceInputSettings | null>(null);
  const queueRef = React.useRef<ContinuousVoiceSegment[]>([]);
  const drainRef = React.useRef<Promise<void> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const onTranscriptRef = React.useRef<StartMobileContinuousVoiceInput['onTranscript'] | null>(null);
  const sessionIdRef = React.useRef('');
  const contextRef = React.useRef('');
  const sampleCountRef = React.useRef(0);
  const nativeStatusHandlerRef = React.useRef<((status: AudioStreamStatus) => void) | null>(null);
  const nativeStopHandlerRef = React.useRef<(() => Promise<void>) | null>(null);
  const backgroundActivityRef = React.useRef(false);
  const microphoneLeaseRef = React.useRef<MobileMicrophoneLease | null>(null);
  const startPromiseRef = React.useRef<Promise<boolean> | null>(null);
  const nativeStartPromiseRef = React.useRef<Promise<void> | null>(null);
  const streamStartGateRef = React.useRef(new MobileAudioStreamStartGate());

  const setBackgroundActivity = React.useCallback(
    (active: boolean) => {
      if (backgroundActivityRef.current === active) return;
      backgroundActivityRef.current = active;
      onBackgroundActivityChange(active);
    },
    [onBackgroundActivityChange],
  );

  const setStatusValue = React.useCallback((next: MobileContinuousVoiceStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const releaseMicrophone = React.useCallback(async () => {
    const lease = microphoneLeaseRef.current;
    if (!lease) return;
    await lease.release(async () => {
      await setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
      }).catch(() => undefined);
    });
    if (microphoneLeaseRef.current === lease) microphoneLeaseRef.current = null;
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
          const settings = settingsRef.current;
          const deliver = onTranscriptRef.current;
          if (!settings || !deliver) throw new Error('Continuous voice lost its target chat.');
          const transcript = await transcribeMobileVoiceWave({
            wave: pcm16ToWaveBytes(segment.pcm),
            apiKey: await readGroqApiKey(),
            settings,
            prompt: contextRef.current,
            signal: controller.signal,
          });
          if (generationRef.current !== generation) return;
          const cleanTranscript = transcript.trim();
          if (cleanTranscript) {
            const accepted = await deliver(
              cleanTranscript,
              `${sessionIdRef.current}.${segment.sequence}`,
            );
            if (!accepted) throw new Error('The chat did not accept the voice steering message.');
            contextRef.current = `${contextRef.current} ${cleanTranscript}`.trim().slice(-1_200);
            if (settings.confirmationFeedback) Vibration.vibrate(20);
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

  const handleBuffer = React.useCallback(
    (buffer: AudioStreamBuffer) => {
      if (pausedRef.current || !segmenterRef.current || statusRef.current === 'idle') return;
      const pcm = normalizePcm16Audio({
        pcm: new Int16Array(buffer.data.slice(0)),
        sampleRate: buffer.sampleRate,
        channels: buffer.channels,
      });
      sampleCountRef.current += pcm.length;
      const result = segmenterRef.current.push(pcm);
      if (statusRef.current !== 'stopping') setStatusValue(statusForActivity(result.activity));
      if (result.segments.length) enqueue(result.segments);
      if (mountedRef.current && sampleCountRef.current % 8_000 < pcm.length) {
        setDurationMillis(Math.round((sampleCountRef.current / 16_000) * 1_000));
      }
    },
    [enqueue, setStatusValue],
  );

  const handleNativeStatus = React.useCallback((next: AudioStreamStatus) => {
    nativeStatusHandlerRef.current?.(next);
  }, []);

  const { stream } = useAudioStream({
    sampleRate: 16_000,
    channels: 1,
    encoding: 'int16',
    onBuffer: handleBuffer,
    onStatus: handleNativeStatus,
  });

  const stopNativeStreamNow = React.useCallback(() => {
    try {
      stream.stop();
    } catch {
      // The Expo shared object may already be released during provider teardown.
    }
  }, [stream]);

  const startNativeStream = React.useCallback(async () => {
    if (nativeStartPromiseRef.current) return nativeStartPromiseRef.current;
    const work = (async () => {
      await stream.start();
    })();
    nativeStartPromiseRef.current = work;
    try {
      await work;
    } finally {
      if (nativeStartPromiseRef.current === work) nativeStartPromiseRef.current = null;
    }
  }, [stream]);

  const activateStream = React.useCallback(
    async (generation: number): Promise<boolean> => {
      return streamStartGateRef.current.start(async (isCurrent) => {
        await setAudioModeAsync({
          allowsRecording: true,
          allowsBackgroundRecording: true,
          playsInSilentMode: true,
        });
        if (!isCurrent() || generationRef.current !== generation) return;
        await startNativeStream();
        if (!isCurrent() || generationRef.current !== generation) {
          stopNativeStreamNow();
        }
      });
    },
    [startNativeStream, stopNativeStreamNow],
  );

  const stopPendingStream = React.useCallback(async () => {
    // This first stop invalidates Android's native start request even when it is
    // still suspended while binding the foreground recording service.
    await streamStartGateRef.current.cancel(stopNativeStreamNow);
    await nativeStartPromiseRef.current?.catch(() => undefined);
    stopNativeStreamNow();
  }, [stopNativeStreamNow]);

  const cancel = React.useCallback(async () => {
    const pendingStart = startPromiseRef.current;
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    stopNativeStreamNow();
    await pendingStart?.catch(() => undefined);
    await stopPendingStream();
    setBackgroundActivity(false);
    segmenterRef.current?.discard();
    segmenterRef.current = null;
    settingsRef.current = null;
    queueRef.current = [];
    drainRef.current = null;
    onTranscriptRef.current = null;
    pausedRef.current = false;
    finishingRef.current = false;
    sampleCountRef.current = 0;
    await releaseMicrophone();
    if (mountedRef.current) {
      setPendingCount(0);
      setDurationMillis(0);
      setTargetKey(null);
    }
    setStatusValue('idle');
  }, [
    releaseMicrophone,
    setBackgroundActivity,
    setStatusValue,
    stopNativeStreamNow,
    stopPendingStream,
  ]);

  React.useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || statusRef.current !== 'recovering' || stream.isStreaming) return;
      const generation = generationRef.current;
      void activateStream(generation).catch((error: any) => {
        if (generationRef.current !== generation || statusRef.current !== 'recovering') return;
        pausedRef.current = true;
        setStatusValue('error');
        onError(error?.message ?? String(error));
      });
    });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      abortRef.current?.abort();
      stopNativeStreamNow();
      setBackgroundActivity(false);
      void stopPendingStream().then(releaseMicrophone);
      subscription.remove();
    };
  }, [
    activateStream,
    onError,
    releaseMicrophone,
    setBackgroundActivity,
    setStatusValue,
    stopNativeStreamNow,
    stopPendingStream,
    stream,
  ]);

  const startOperation = React.useCallback(
    async (input: StartMobileContinuousVoiceInput): Promise<boolean> => {
      if (statusRef.current !== 'idle') return false;
      const microphoneLease = microphoneCoordinator.acquire('continuous');
      if (!microphoneLease) {
        onError(
          microphoneCoordinator.getSnapshot() === 'single-shot'
            ? 'A voice message is already using the microphone.'
            : 'The microphone is still finishing the previous continuous session.',
        );
        return false;
      }
      microphoneLeaseRef.current = microphoneLease;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setStatusValue('starting');
      onError('');
      try {
        if (!(await readGroqApiKey())) {
          throw new Error(
            'GROQ API key is not configured on this phone. Copy it in Built-in agent settings first.',
          );
        }
        if (generationRef.current !== generation) return false;
        const permission = await ensureMobileRecordingPermission({
          getPermission: getRecordingPermissionsAsync,
          requestPermission: requestRecordingPermissionsAsync,
        });
        if (!permission.granted) {
          throw new Error(
            permission.canAskAgain === false
              ? 'Microphone permission is disabled. Enable it in the phone’s system settings.'
              : 'Microphone permission was denied.',
          );
        }
        if (generationRef.current !== generation) return false;
        await ensureMobileBackgroundRecordingPermission({
          platform: Platform.OS,
          platformVersion: Number(Platform.Version),
          requestPermission: requestNotificationPermissionsAsync,
        });
        if (generationRef.current !== generation) return false;
        if (AppState.currentState !== 'active') {
          throw new Error('Start continuous voice while Drone Hub is in the foreground.');
        }
        const settings = await loadMobileVoiceInputSettings();
        if (generationRef.current !== generation) return false;
        settingsRef.current = settings;
        segmenterRef.current = new ContinuousVoiceSegmenter({
          silenceMillis: mobileVoiceInputSilenceMillis(settings),
          noiseHandling: settings.noiseHandling,
        });
        onTranscriptRef.current = input.onTranscript;
        sessionIdRef.current = `mobile-voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        contextRef.current = '';
        sampleCountRef.current = 0;
        pausedRef.current = false;
        finishingRef.current = false;
        if (mountedRef.current) setTargetKey(input.targetKey);
        setBackgroundActivity(true);
        if (!(await activateStream(generation))) return false;
        setStatusValue('listening');
        return true;
      } catch (error: any) {
        if (generationRef.current !== generation) return false;
        await stopPendingStream();
        setBackgroundActivity(false);
        segmenterRef.current = null;
        onTranscriptRef.current = null;
        if (mountedRef.current) setTargetKey(null);
        await releaseMicrophone();
        setStatusValue('idle');
        onError(error?.message ?? String(error));
        return false;
      }
    },
    [
      activateStream,
      microphoneCoordinator,
      onError,
      releaseMicrophone,
      setBackgroundActivity,
      setStatusValue,
      stopPendingStream,
    ],
  );

  const start = React.useCallback(
    async (input: StartMobileContinuousVoiceInput): Promise<boolean> => {
      if (startPromiseRef.current || statusRef.current !== 'idle') return false;
      const work = startOperation(input);
      startPromiseRef.current = work;
      try {
        return await work;
      } finally {
        if (startPromiseRef.current === work) startPromiseRef.current = null;
      }
    },
    [startOperation],
  );

  const togglePause = React.useCallback(async () => {
    if (statusRef.current === 'error' && finishingRef.current) {
      pausedRef.current = false;
      setStatusValue('stopping');
      onError('');
      await drainQueue();
      if ((statusRef.current as MobileContinuousVoiceStatus) === 'error') return;
      finishingRef.current = false;
      onTranscriptRef.current = null;
      settingsRef.current = null;
      sampleCountRef.current = 0;
      await releaseMicrophone();
      setBackgroundActivity(false);
      if (mountedRef.current) {
        setDurationMillis(0);
        setTargetKey(null);
      }
      setStatusValue('idle');
      return;
    }
    if (statusRef.current === 'recovering') {
      pausedRef.current = true;
      setStatusValue('paused');
      return;
    }
    if (
      statusRef.current === 'paused' ||
      statusRef.current === 'error'
    ) {
      const generation = generationRef.current;
      try {
        if (!stream.isStreaming) {
          if (!(await activateStream(generation))) return;
        }
        pausedRef.current = false;
        setStatusValue('listening');
        onError('');
        if (queueRef.current.length) void drainQueue();
      } catch (error: any) {
        if (generationRef.current !== generation) return;
        pausedRef.current = true;
        setStatusValue('error');
        onError(error?.message ?? String(error));
      }
      return;
    }
    if (statusRef.current === 'idle' || statusRef.current === 'starting') return;
    pausedRef.current = true;
    setStatusValue('paused');
  }, [
    activateStream,
    drainQueue,
    onError,
    releaseMicrophone,
    setBackgroundActivity,
    setStatusValue,
    stream,
  ]);

  const stop = React.useCallback(async () => {
    if (statusRef.current === 'idle' || statusRef.current === 'error') return;
    if (statusRef.current === 'starting') {
      const pendingStart = startPromiseRef.current;
      generationRef.current += 1;
      abortRef.current?.abort();
      stopNativeStreamNow();
      await pendingStart?.catch(() => undefined);
      await stopPendingStream();
      setBackgroundActivity(false);
      segmenterRef.current?.discard();
      segmenterRef.current = null;
      settingsRef.current = null;
      onTranscriptRef.current = null;
      pausedRef.current = false;
      finishingRef.current = false;
      await releaseMicrophone();
      if (mountedRef.current) setTargetKey(null);
      setStatusValue('idle');
      return;
    }
    pausedRef.current = true;
    finishingRef.current = true;
    setStatusValue('stopping');
    await stopPendingStream();
    const finalSegment = segmenterRef.current?.flush() ?? null;
    segmenterRef.current = null;
    if (finalSegment) enqueue([finalSegment]);
    await drainQueue();
    if ((statusRef.current as MobileContinuousVoiceStatus) === 'error') return;
    finishingRef.current = false;
    onTranscriptRef.current = null;
    settingsRef.current = null;
    pausedRef.current = false;
    sampleCountRef.current = 0;
    await releaseMicrophone();
    setBackgroundActivity(false);
    if (mountedRef.current) {
      setDurationMillis(0);
      setTargetKey(null);
    }
    setStatusValue('idle');
  }, [
    drainQueue,
    enqueue,
    releaseMicrophone,
    setBackgroundActivity,
    setStatusValue,
    stopNativeStreamNow,
    stopPendingStream,
  ]);

  nativeStopHandlerRef.current = stop;
  nativeStatusHandlerRef.current = (next) => {
    const current = statusRef.current;
    const action = resolveMobileContinuousVoiceNativeAction(current, next.reason);
    if (action === 'finish') {
      void nativeStopHandlerRef.current?.();
      return;
    }
    if (action === 'checkpoint-and-recover') {
      const interruptedSegment = segmenterRef.current?.flush() ?? null;
      if (interruptedSegment) enqueue([interruptedSegment]);
      setStatusValue('recovering');
      onError('');
      return;
    }
    if (action === 'resume') {
      setStatusValue('listening');
      onError('');
    }
  };

  return { status, pendingCount, durationMillis, targetKey, start, stop, cancel, togglePause };
}
