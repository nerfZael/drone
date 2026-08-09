import {
  ContinuousVoiceSession,
  normalizePcm16Audio,
  pcm16ToWaveBytes,
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
} from './mobile-voice-input-settings';

export type { MobileContinuousVoiceStatus } from './mobile-continuous-voice-lifecycle';

export type StartMobileContinuousVoiceInput = {
  targetKey: string;
  onTranscript(text: string, deliveryId: string): Promise<boolean>;
};

export function mobileContinuousVoiceStatusLabel(
  status: MobileContinuousVoiceStatus,
  pendingCount: number,
): string {
  if (status === 'starting') return 'Starting continuous voice…';
  if (status === 'speech') return 'Speech detected';
  if (status === 'thought-pause') return 'Waiting for end of thought';
  if (status === 'recovering') return 'Microphone interrupted · reconnecting…';
  if (status === 'paused') return `Paused${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  if (status === 'stopping') {
    return `Finishing${pendingCount ? ` · ${pendingCount} pending` : ''}…`;
  }
  if (status === 'error') return 'Continuous voice needs attention';
  if (status === 'listening') {
    return `Listening${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  }
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
  const nativeStatusHandlerRef = React.useRef<((status: AudioStreamStatus) => void) | null>(null);
  const nativeStopHandlerRef = React.useRef<(() => Promise<void>) | null>(null);
  const backgroundActivityRef = React.useRef(false);
  const microphoneLeaseRef = React.useRef<MobileMicrophoneLease | null>(null);
  const startPromiseRef = React.useRef<Promise<boolean> | null>(null);
  const nativeStartPromiseRef = React.useRef<Promise<void> | null>(null);
  const streamStartGateRef = React.useRef(new MobileAudioStreamStartGate());
  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;

  const setBackgroundActivity = React.useCallback(
    (active: boolean) => {
      if (backgroundActivityRef.current === active) return;
      backgroundActivityRef.current = active;
      onBackgroundActivityChange(active);
    },
    [onBackgroundActivityChange],
  );

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

  const handleBuffer = React.useCallback(
    (buffer: AudioStreamBuffer) => {
      session.push(
        normalizePcm16Audio({
          pcm: new Int16Array(buffer.data.slice(0)),
          sampleRate: buffer.sampleRate,
          channels: buffer.channels,
        }),
      );
    },
    [session],
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
    const work = stream.start();
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
        if (!isCurrent() || generationRef.current !== generation) stopNativeStreamNow();
      });
    },
    [startNativeStream, stopNativeStreamNow],
  );

  const stopPendingStream = React.useCallback(async () => {
    await streamStartGateRef.current.cancel(stopNativeStreamNow);
    await nativeStartPromiseRef.current?.catch(() => undefined);
    stopNativeStreamNow();
  }, [stopNativeStreamNow]);

  const finishPlatformCleanup = React.useCallback(async () => {
    await releaseMicrophone();
    setBackgroundActivity(false);
    if (mountedRef.current) setTargetKey(null);
  }, [releaseMicrophone, setBackgroundActivity]);

  const cancel = React.useCallback(async () => {
    const pendingStart = startPromiseRef.current;
    generationRef.current += 1;
    session.cancel();
    stopNativeStreamNow();
    await pendingStart?.catch(() => undefined);
    await stopPendingStream();
    await finishPlatformCleanup();
  }, [finishPlatformCleanup, session, stopNativeStreamNow, stopPendingStream]);

  React.useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || session.status !== 'recovering' || stream.isStreaming) return;
      const generation = generationRef.current;
      void activateStream(generation).catch((error: any) => {
        if (generationRef.current !== generation || session.status !== 'recovering') return;
        session.reportError(error?.message ?? String(error));
      });
    });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      session.cancel();
      stopNativeStreamNow();
      setBackgroundActivity(false);
      void stopPendingStream().then(releaseMicrophone);
      subscription.remove();
    };
  }, [
    activateStream,
    releaseMicrophone,
    session,
    setBackgroundActivity,
    stopNativeStreamNow,
    stopPendingStream,
    stream,
  ]);

  const startOperation = React.useCallback(
    async (input: StartMobileContinuousVoiceInput): Promise<boolean> => {
      if (session.status !== 'idle') return false;
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
      if (!session.begin()) {
        await releaseMicrophone();
        return false;
      }
      onError('');
      try {
        if (!(await readGroqApiKey())) {
          throw new Error(
            'GROQ API key is not configured on this phone. Copy it in Built-in agent settings first.',
          );
        }
        if (generationRef.current !== generation) return false;
        const settings = await loadMobileVoiceInputSettings();
        if (generationRef.current !== generation) return false;
        session.configure({
          sessionId: `mobile-voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          endpointConfig: {
            silenceMillis: mobileVoiceInputSilenceMillis(settings),
            noiseHandling: settings.noiseHandling,
          },
          transcribe: async ({ segment, context, signal }) =>
            await transcribeMobileVoiceWave({
              wave: pcm16ToWaveBytes(segment.pcm),
              apiKey: await readGroqApiKey(),
              settings,
              prompt: context,
              signal,
            }),
          deliver: input.onTranscript,
          ...(settings.confirmationFeedback ? { confirm: () => Vibration.vibrate(20) } : {}),
        });
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
        if (mountedRef.current) setTargetKey(input.targetKey);
        setBackgroundActivity(true);
        if (!(await activateStream(generation))) return false;
        session.listen();
        return true;
      } catch (error: any) {
        if (generationRef.current !== generation) return false;
        await stopPendingStream();
        session.cancel();
        await finishPlatformCleanup();
        onError(error?.message ?? String(error));
        return false;
      }
    },
    [
      activateStream,
      finishPlatformCleanup,
      microphoneCoordinator,
      onError,
      releaseMicrophone,
      session,
      setBackgroundActivity,
      stopPendingStream,
    ],
  );

  const start = React.useCallback(
    async (input: StartMobileContinuousVoiceInput): Promise<boolean> => {
      if (startPromiseRef.current || session.status !== 'idle') return false;
      const work = startOperation(input);
      startPromiseRef.current = work;
      try {
        return await work;
      } finally {
        if (startPromiseRef.current === work) startPromiseRef.current = null;
      }
    },
    [session, startOperation],
  );

  const togglePause = React.useCallback(async () => {
    if (session.status === 'error' && session.isFinishing) {
      onError('');
      if ((await session.resume()) === 'finished') await finishPlatformCleanup();
      return;
    }
    if (session.status === 'recovering') {
      session.pause();
      return;
    }
    if (session.status === 'paused' || session.status === 'error') {
      const generation = generationRef.current;
      try {
        if (!stream.isStreaming && !(await activateStream(generation))) return;
        onError('');
        await session.resume();
      } catch (error: any) {
        if (generationRef.current !== generation) return;
        session.reportError(error?.message ?? String(error));
      }
      return;
    }
    session.pause();
  }, [activateStream, finishPlatformCleanup, onError, session, stream]);

  const stop = React.useCallback(async () => {
    if (session.status === 'idle' || session.status === 'error') return;
    if (session.status === 'starting') {
      const pendingStart = startPromiseRef.current;
      generationRef.current += 1;
      session.cancel();
      stopNativeStreamNow();
      await pendingStart?.catch(() => undefined);
      await stopPendingStream();
      await finishPlatformCleanup();
      return;
    }
    await stopPendingStream();
    if (await session.finish()) await finishPlatformCleanup();
  }, [finishPlatformCleanup, session, stopNativeStreamNow, stopPendingStream]);

  nativeStopHandlerRef.current = stop;
  nativeStatusHandlerRef.current = (next) => {
    const action = resolveMobileContinuousVoiceNativeAction(session.status, next.reason);
    if (action === 'finish') {
      void nativeStopHandlerRef.current?.();
      return;
    }
    if (action === 'checkpoint-and-recover') {
      session.interrupt();
      onError('');
      return;
    }
    if (action === 'resume') {
      session.recover();
      onError('');
    }
  };

  return { status, pendingCount, durationMillis, targetKey, start, stop, cancel, togglePause };
}
