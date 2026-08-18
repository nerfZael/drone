import React from 'react';
import { AppState, Platform } from 'react-native';
import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioRecorder,
  type RecordingStatus,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { readGroqApiKey } from './local-assistant-settings';
import {
  ensureMobileBackgroundRecordingPermission,
  ensureMobileRecordingPermission,
} from './mobile-recording-permission';
import { transcribeMobileVoiceRecording } from './mobile-groq-transcription';
import type {
  MobileMicrophoneCoordinator,
  MobileMicrophoneLease,
} from './mobile-microphone-coordinator';
import {
  MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES,
  isUnexpectedMobileVoiceRecordingCompletion,
  resolveMobileVoiceRecorderEvent,
  shouldCancelMobileVoiceWhenInactive,
  type MobileVoiceRecordingStatus,
} from './mobile-voice-transcription-model';
import type {
  MobileRecordedVoiceSession,
  MobileRecordedVoiceSessionOwner,
} from './mobile-voice-session';

const MOBILE_VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 64_000,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    maxFileSize: MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES,
  },
};

const APP_FOREGROUND_RESUME_TIMEOUT_MS = 3_000;

async function waitForAppForeground(): Promise<boolean> {
  if (AppState.currentState === 'active') return true;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let subscription: { remove(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (active: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      subscription?.remove();
      resolve(active);
    };
    timer = setTimeout(
      () => finish(AppState.currentState === 'active'),
      APP_FOREGROUND_RESUME_TIMEOUT_MS,
    );
    subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') finish(true);
    });
    if (AppState.currentState === 'active') finish(true);
  });
}

async function ensureBackgroundRecordingPermission(): Promise<void> {
  await ensureMobileBackgroundRecordingPermission({
    platform: Platform.OS,
    platformVersion: Number(Platform.Version),
    requestPermission: requestNotificationPermissionsAsync,
  });
}

export function useMobileChatVoiceRecorder({
  microphoneCoordinator,
  onError,
}: {
  microphoneCoordinator: MobileMicrophoneCoordinator;
  onError(message: string): void;
}) {
  const [session, setSession] = React.useState<MobileRecordedVoiceSession>({
    kind: 'idle',
    status: 'idle',
  });
  const sessionRef = React.useRef(session);
  const generationRef = React.useRef(0);
  const mountedRef = React.useRef(false);
  const startPromiseRef = React.useRef<Promise<void> | null>(null);
  const stopPromiseRef = React.useRef<Promise<string> | null>(null);
  const transcribeAbortRef = React.useRef<AbortController | null>(null);
  const recorderRef = React.useRef<AudioRecorder | null>(null);
  const recordingUriRef = React.useRef<string | null>(null);
  const microphoneLeaseRef = React.useRef<MobileMicrophoneLease | null>(null);

  const setSessionValue = React.useCallback((next: MobileRecordedVoiceSession) => {
    sessionRef.current = next;
    if (mountedRef.current) setSession(next);
  }, []);

  const setStatusValue = React.useCallback((status: MobileVoiceRecordingStatus) => {
    if (status === 'idle') {
      setSessionValue({ kind: 'idle', status });
    } else if (sessionRef.current.kind !== 'idle') {
      setSessionValue({ ...sessionRef.current, status });
    }
  }, [setSessionValue]);

  const deactivateRecordingMode = React.useCallback(async () => {
    await setAudioModeAsync({
      allowsRecording: false,
      allowsBackgroundRecording: false,
    }).catch(() => undefined);
  }, []);

  const releaseMicrophone = React.useCallback(async () => {
    const lease = microphoneLeaseRef.current;
    if (!lease) return;
    await lease.release(deactivateRecordingMode);
    if (microphoneLeaseRef.current === lease) microphoneLeaseRef.current = null;
  }, [deactivateRecordingMode]);

  const handleNativeStatus = React.useCallback(
    (next: RecordingStatus) => {
      if (
        isUnexpectedMobileVoiceRecordingCompletion({
          status: sessionRef.current.status,
          activeUri: recordingUriRef.current,
          eventUri: next.url,
          finished: next.isFinished,
          failed: next.hasError || Boolean(next.mediaServicesDidReset),
          stopPending: Boolean(stopPromiseRef.current),
        })
      ) {
        recordingUriRef.current = next.url;
        setStatusValue('stopped');
        void releaseMicrophone();
        if (mountedRef.current) onError('');
        return;
      }
      // stop() completion events can arrive after the next recording has begun.
      // Never let an event from an older file replace or cancel the active session.
      const event = resolveMobileVoiceRecorderEvent({
        activeUri: recordingUriRef.current,
        eventUri: next.url,
        failed: next.hasError || Boolean(next.mediaServicesDidReset),
        // prepareToRecordAsync reports its own errors. Until it gives this
        // generation a URI, a callback cannot safely be attributed to it and
        // may be the delayed stop event from the previous recording.
        ignoreFailureWithoutActiveUri: sessionRef.current.status === 'starting',
      });
      if (!event.handleFailure) return;
      generationRef.current += 1;
      transcribeAbortRef.current?.abort();
      transcribeAbortRef.current = null;
      setStatusValue('idle');
      const failedRecorder = recorderRef.current;
      const uri = event.uri;
      if (failedRecorder) {
        void failedRecorder
          .stop()
          .catch(() => undefined)
          .finally(() => deleteRecordingFile(uri))
          .then(releaseMicrophone);
      } else {
        deleteRecordingFile(uri);
        void releaseMicrophone();
      }
      if (mountedRef.current) {
        onError(
          next.error?.trim() ||
            (next.url
              ? 'Voice recording reached the 25 MB limit.'
              : next.mediaServicesDidReset
                ? 'The device audio service restarted. Please record again.'
                : 'The microphone recording stopped unexpectedly.'),
        );
      }
    },
    [onError, releaseMicrophone, setStatusValue],
  );
  const recorder = useAudioRecorder(MOBILE_VOICE_RECORDING_OPTIONS, handleNativeStatus);
  const recorderState = useAudioRecorderState(recorder, 250);

  React.useLayoutEffect(() => {
    recorderRef.current = recorder;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      recorderRef.current = null;
      generationRef.current += 1;
      transcribeAbortRef.current?.abort();
      transcribeAbortRef.current = null;
    };
  }, [recorder]);

  React.useEffect(
    () => () => {
      const uri = recordingUriRef.current;
      recordingUriRef.current = null;
      deleteRecordingFile(uri);
      // useAudioRecorder owns and releases the native recorder on unmount. Its
      // shared object must not be read or stopped from this later cleanup.
      void releaseMicrophone();
    },
    [releaseMicrophone],
  );

  // Owner checks keep stale UI callbacks from mutating a newer session.
  const discardRecording = React.useCallback(async (owner: MobileRecordedVoiceSessionOwner) => {
    if (sessionRef.current.kind !== owner) return;
    const previousStatus = sessionRef.current.status;
    const pendingStart = startPromiseRef.current;
    const controller = transcribeAbortRef.current;
    generationRef.current += 1;
    controller?.abort();
    transcribeAbortRef.current = null;
    stopPromiseRef.current = null;
    const shouldStop =
      previousStatus === 'starting' ||
      previousStatus === 'recording' ||
      previousStatus === 'paused';
    // prepareToRecordAsync may still be binding Android's foreground recording
    // service. Let that native call settle before stop/retry so another prepare
    // cannot collide with the in-flight bind.
    await pendingStart?.catch(() => undefined);
    let uri = recordingUriRef.current || recorder.uri;
    recordingUriRef.current = uri;
    if (shouldStop) await recorder.stop().catch(() => undefined);
    uri = recordingUriRef.current || recorder.uri || uri;
    deleteRecordingFile(uri);
    recordingUriRef.current = null;
    await releaseMicrophone();
    setStatusValue('idle');
    onError('');
  }, [onError, recorder, releaseMicrophone, setStatusValue]);

  const startRecordingOperation = React.useCallback(async (owner: MobileRecordedVoiceSessionOwner) => {
    if (sessionRef.current.kind !== 'idle') return;
    const microphoneLease = microphoneCoordinator.acquire(owner);
    if (!microphoneLease) {
      const currentOwner = microphoneCoordinator.getSnapshot();
      onError(
        currentOwner === 'continuous'
          ? 'Continuous voice is already using the microphone.'
          : currentOwner === 'companion'
            ? 'Companion is already using the microphone.'
          : 'The microphone is still finishing the previous recording.',
      );
      return;
    }
    microphoneLeaseRef.current = microphoneLease;
    setSessionValue({ kind: owner, status: 'starting' });
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const staleUri = recordingUriRef.current;
    recordingUriRef.current = null;
    deleteRecordingFile(staleUri);
    onError('');
    try {
      if (!(await readGroqApiKey())) {
        throw new Error(
          'GROQ API key is not configured on this phone. Copy it in Built-in agent settings first.',
        );
      }
      if (generationRef.current !== generation || !mountedRef.current) return;
      const permission = await ensureMobileRecordingPermission({
        getPermission: getRecordingPermissionsAsync,
        requestPermission: requestRecordingPermissionsAsync,
      });
      if (generationRef.current !== generation || !mountedRef.current) return;
      if (!permission.granted) {
        throw new Error(
          permission.canAskAgain === false
            ? 'Microphone permission is disabled. Enable it in the phone’s system settings.'
            : 'Microphone permission was denied.',
        );
      }
      await ensureBackgroundRecordingPermission();
      if (generationRef.current !== generation || !mountedRef.current) return;
      if (!(await waitForAppForeground())) {
        throw new Error('Voice recording was cancelled when the app left the foreground.');
      }
      if (generationRef.current !== generation || !mountedRef.current) return;
      await setAudioModeAsync({
        allowsRecording: true,
        allowsBackgroundRecording: true,
        playsInSilentMode: true,
      });
      if (generationRef.current !== generation || !mountedRef.current) {
        return;
      }
      await recorder.prepareToRecordAsync();
      if (generationRef.current !== generation || !mountedRef.current) {
        return;
      }
      const uri = recorder.uri;
      recordingUriRef.current = uri;
      if (!(await waitForAppForeground())) {
        throw new Error('Voice recording was cancelled when the app left the foreground.');
      }
      if (generationRef.current !== generation || !mountedRef.current) {
        await recorder.stop().catch(() => undefined);
        deleteRecordingFile(uri);
        recordingUriRef.current = null;
        await releaseMicrophone();
        return;
      }
      recorder.record();
      setStatusValue('recording');
    } catch (error: any) {
      if (generationRef.current !== generation) return;
      const uri = recordingUriRef.current || recorder.uri;
      await recorder.stop().catch(() => undefined);
      deleteRecordingFile(uri);
      recordingUriRef.current = null;
      await releaseMicrophone();
      setStatusValue('idle');
      onError(error?.message ?? String(error));
    }
  }, [microphoneCoordinator, onError, recorder, releaseMicrophone, setSessionValue, setStatusValue]);

  const startRecording = React.useCallback(async (owner: MobileRecordedVoiceSessionOwner) => {
    if (startPromiseRef.current || sessionRef.current.kind !== 'idle') return false;
    const promise = startRecordingOperation(owner);
    startPromiseRef.current = promise;
    try {
      await promise;
      return (sessionRef.current.status as MobileVoiceRecordingStatus) === 'recording';
    } finally {
      if (startPromiseRef.current === promise) startPromiseRef.current = null;
    }
  }, [startRecordingOperation]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;
      const interruptedStatus = sessionRef.current.status;
      const interruptedOwner = sessionRef.current.kind;
      // The native background audio session keeps active and paused recordings
      // alive through screen lock. Startup synchronizes itself with foreground
      // state, while network transcription remains foreground-only/cancellable.
      if (
        interruptedOwner !== 'idle' &&
        shouldCancelMobileVoiceWhenInactive(interruptedStatus)
      ) {
        void discardRecording(interruptedOwner).then(() => {
          if (mountedRef.current) {
            onError('Voice transcription was cancelled when the app left the foreground.');
          }
        });
      }
    });
    return () => subscription.remove();
  }, [discardRecording, onError]);

  const toggleRecordingPause = React.useCallback((owner: MobileRecordedVoiceSessionOwner) => {
    if (sessionRef.current.kind !== owner) return;
    try {
      if (sessionRef.current.status === 'recording') {
        recorder.pause();
        setStatusValue('paused');
      } else if (sessionRef.current.status === 'paused') {
        recorder.record();
        setStatusValue('recording');
      }
    } catch (error: any) {
      onError(error?.message ?? String(error));
    }
  }, [onError, recorder, setStatusValue]);

  const transcribeRecording = React.useCallback(async (): Promise<string> => {
    const alreadyStopped = sessionRef.current.status === 'stopped';
    if (
      !alreadyStopped &&
      sessionRef.current.status !== 'recording' &&
      sessionRef.current.status !== 'paused'
    ) {
      return '';
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let uri = '';
    let controller: AbortController | null = null;
    try {
      uri = recordingUriRef.current || recorder.uri || '';
      if (!alreadyStopped) {
        await recorder.stop();
        uri ||= recorder.uri || '';
      }
      if (!uri) throw new Error('The voice recording could not be saved.');
      recordingUriRef.current = uri;
      await releaseMicrophone();
      if (generationRef.current !== generation) {
        deleteRecordingFile(uri);
        return '';
      }
      setStatusValue('transcribing');
      onError('');
      const apiKey = await readGroqApiKey();
      controller = new AbortController();
      transcribeAbortRef.current = controller;
      const transcript = await transcribeMobileVoiceRecording({
        uri,
        apiKey,
        signal: controller.signal,
      });
      return generationRef.current === generation ? transcript : '';
    } catch (error: any) {
      if (generationRef.current === generation && !controller?.signal.aborted) {
        onError(error?.message ?? String(error));
      }
      return '';
    } finally {
      if (transcribeAbortRef.current === controller) transcribeAbortRef.current = null;
      // The transcription helper deletes uploaded files itself. This second,
      // idempotent cleanup also covers failures before the upload begins.
      deleteRecordingFile(uri);
      if (recordingUriRef.current === uri) recordingUriRef.current = null;
      await releaseMicrophone();
      if (generationRef.current === generation) setStatusValue('idle');
    }
  }, [onError, recorder, releaseMicrophone, setStatusValue]);

  const stopRecordingForTranscript = React.useCallback(async (
    owner: MobileRecordedVoiceSessionOwner,
  ): Promise<string> => {
    if (sessionRef.current.kind !== owner) return '';
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
    session,
    durationMillis:
      session.status === 'starting' || session.status === 'idle' ? 0 : recorderState.durationMillis,
    startRecording,
    toggleRecordingPause,
    discardRecording,
    stopRecordingForTranscript,
  };
}

function deleteRecordingFile(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Recording cleanup is best-effort; cache eviction remains a fallback.
  }
}
