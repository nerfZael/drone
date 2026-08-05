import React from 'react';
import { AppState } from 'react-native';
import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioRecorder,
  type RecordingStatus,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { readGroqApiKey } from './local-assistant-settings';
import { ensureMobileRecordingPermission } from './mobile-recording-permission';
import { transcribeMobileVoiceRecording } from './mobile-groq-transcription';
import {
  MOBILE_GROQ_TRANSCRIPTION_MAX_BYTES,
  resolveMobileVoiceRecorderEvent,
  shouldDiscardMobileVoiceWhenInactive,
  type MobileVoiceRecordingStatus,
} from './mobile-voice-transcription-model';

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

export function useMobileChatVoiceRecorder({
  onError,
}: {
  onError(message: string): void;
}) {
  const [status, setStatus] = React.useState<MobileVoiceRecordingStatus>('idle');
  const statusRef = React.useRef<MobileVoiceRecordingStatus>('idle');
  const generationRef = React.useRef(0);
  const mountedRef = React.useRef(false);
  const stopPromiseRef = React.useRef<Promise<string> | null>(null);
  const transcribeAbortRef = React.useRef<AbortController | null>(null);
  const recorderRef = React.useRef<AudioRecorder | null>(null);
  const recordingUriRef = React.useRef<string | null>(null);

  const handleNativeStatus = React.useCallback(
    (next: RecordingStatus) => {
      // stop() completion events can arrive after the next recording has begun.
      // Never let an event from an older file replace or cancel the active session.
      const event = resolveMobileVoiceRecorderEvent({
        activeUri: recordingUriRef.current,
        eventUri: next.url,
        failed: next.hasError || Boolean(next.mediaServicesDidReset),
        // prepareToRecordAsync reports its own errors. Until it gives this
        // generation a URI, a callback cannot safely be attributed to it and
        // may be the delayed stop event from the previous recording.
        ignoreFailureWithoutActiveUri: statusRef.current === 'starting',
      });
      if (!event.handleFailure) return;
      generationRef.current += 1;
      transcribeAbortRef.current?.abort();
      transcribeAbortRef.current = null;
      statusRef.current = 'idle';
      const failedRecorder = recorderRef.current;
      const uri = event.uri;
      if (failedRecorder) {
        void failedRecorder
          .stop()
          .catch(() => undefined)
          .finally(() => deleteRecordingFile(uri));
      } else {
        deleteRecordingFile(uri);
      }
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      if (mountedRef.current) {
        setStatus('idle');
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
    [onError],
  );
  const recorder = useAudioRecorder(MOBILE_VOICE_RECORDING_OPTIONS, handleNativeStatus);
  const recorderState = useAudioRecorderState(recorder, 250);

  const setStatusValue = React.useCallback((next: MobileVoiceRecordingStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const deactivateRecordingMode = React.useCallback(async () => {
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, []);

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
      void deactivateRecordingMode();
    },
    [deactivateRecordingMode],
  );

  const discardRecording = React.useCallback(async () => {
    const previousStatus = statusRef.current;
    const controller = transcribeAbortRef.current;
    generationRef.current += 1;
    controller?.abort();
    transcribeAbortRef.current = null;
    stopPromiseRef.current = null;
    setStatusValue('idle');
    const shouldStop =
      previousStatus === 'starting' ||
      previousStatus === 'recording' ||
      previousStatus === 'paused';
    let uri = recordingUriRef.current || recorder.uri;
    recordingUriRef.current = uri;
    if (shouldStop) await recorder.stop().catch(() => undefined);
    uri = recordingUriRef.current || recorder.uri || uri;
    deleteRecordingFile(uri);
    recordingUriRef.current = null;
    await deactivateRecordingMode();
    onError('');
  }, [deactivateRecordingMode, onError, recorder, setStatusValue]);

  const startRecording = React.useCallback(async () => {
    if (statusRef.current !== 'idle') return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const staleUri = recordingUriRef.current;
    recordingUriRef.current = null;
    deleteRecordingFile(staleUri);
    setStatusValue('starting');
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
      if (!(await waitForAppForeground())) {
        throw new Error('Voice recording was cancelled when the app left the foreground.');
      }
      if (generationRef.current !== generation || !mountedRef.current) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (generationRef.current !== generation || !mountedRef.current) {
        await deactivateRecordingMode();
        return;
      }
      await recorder.prepareToRecordAsync();
      if (generationRef.current !== generation || !mountedRef.current) {
        await deactivateRecordingMode();
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
        await deactivateRecordingMode();
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
      await deactivateRecordingMode();
      setStatusValue('idle');
      onError(error?.message ?? String(error));
    }
  }, [deactivateRecordingMode, onError, recorder, setStatusValue]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;
      const interruptedStatus = statusRef.current;
      // Android can temporarily report a non-active state while its microphone
      // permission UI is open. The startup flow checks AppState after permission
      // and recorder preparation, so only discard sessions that have really begun.
      if (shouldDiscardMobileVoiceWhenInactive(interruptedStatus)) {
        void discardRecording().then(() => {
          if (mountedRef.current) {
            onError(
              interruptedStatus === 'transcribing'
                ? 'Voice transcription was cancelled when the app left the foreground.'
                : 'Voice recording was discarded when the app left the foreground.',
            );
          }
        });
      }
    });
    return () => subscription.remove();
  }, [discardRecording, onError]);

  const toggleRecordingPause = React.useCallback(() => {
    try {
      if (statusRef.current === 'recording') {
        recorder.pause();
        setStatusValue('paused');
      } else if (statusRef.current === 'paused') {
        recorder.record();
        setStatusValue('recording');
      }
    } catch (error: any) {
      onError(error?.message ?? String(error));
    }
  }, [onError, recorder, setStatusValue]);

  const transcribeRecording = React.useCallback(async (): Promise<string> => {
    if (statusRef.current !== 'recording' && statusRef.current !== 'paused') return '';
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let uri = '';
    let controller: AbortController | null = null;
    try {
      uri = recordingUriRef.current || recorder.uri || '';
      await recorder.stop();
      uri ||= recorder.uri || '';
      if (!uri) throw new Error('The voice recording could not be saved.');
      recordingUriRef.current = uri;
      await deactivateRecordingMode();
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
      if (generationRef.current !== generation && uri) deleteRecordingFile(uri);
      if (recordingUriRef.current === uri) recordingUriRef.current = null;
      await deactivateRecordingMode();
      if (generationRef.current === generation) setStatusValue('idle');
    }
  }, [deactivateRecordingMode, onError, recorder, setStatusValue]);

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
    durationMillis: status === 'starting' || status === 'idle' ? 0 : recorderState.durationMillis,
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
