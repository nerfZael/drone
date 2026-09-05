import React from 'react';
import { AppState } from 'react-native';
import { appendMobileDictationTranscript } from './mobile-dictation-queue';
import {
  normalizeMobileDictationText,
  readMobileDictationState,
  writeMobileDictationState,
} from './mobile-dictation-storage';
import type {
  MobileDictationDestination,
  MobileDictationDroneDestination,
  MobileDictationSendResult,
  MobileDictationTarget,
  MobileDictationTargetResult,
} from './mobile-dictation-types';
import { useSharedMobileChatVoiceRecorder } from './MobileChatVoiceRecorderContext';
import { useMobileTranscriptionQueue } from './use-mobile-transcription-queue';
import type { MobileVoiceRecordingStatus } from './mobile-voice-transcription-model';

const PERSIST_DEBOUNCE_MILLIS = 300;

export function useMobileDictation(options: {
  resolveTarget(destination: MobileDictationDroneDestination): MobileDictationTargetResult;
  send(target: MobileDictationTarget, text: string): Promise<MobileDictationSendResult>;
  sendToCompanion(text: string): Promise<MobileDictationSendResult>;
}) {
  const voice = useSharedMobileChatVoiceRecorder();
  const [hydrated, setHydrated] = React.useState(false);
  const [open, setOpenState] = React.useState(false);
  const [text, setTextState] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [finalizing, setFinalizing] = React.useState(false);
  const [networkSending, setNetworkSending] = React.useState(false);
  const openRef = React.useRef(open);
  const textRef = React.useRef(text);
  const mountedRef = React.useRef(true);
  const hydratedRef = React.useRef(false);
  const hydrationGateRef = React.useRef<{
    promise: Promise<void>;
    resolve(): void;
  } | null>(null);
  if (!hydrationGateRef.current) {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((nextResolve) => {
      resolve = nextResolve;
    });
    hydrationGateRef.current = { promise, resolve };
  }
  const interactedRef = React.useRef(false);
  const finalizingRef = React.useRef(false);
  const persistenceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownsRecorderErrorRef = React.useRef(false);
  const recordingCommandsRef = React.useRef<Promise<void>>(Promise.resolve());
  const resolveTargetRef = React.useRef(options.resolveTarget);
  const sendRef = React.useRef(options.send);
  const sendToCompanionRef = React.useRef(options.sendToCompanion);
  const getRecordingSessionRef = React.useRef(voice.getRecordingSession);
  const discardRecordingRef = React.useRef(voice.discardRecording);
  resolveTargetRef.current = options.resolveTarget;
  sendRef.current = options.send;
  sendToCompanionRef.current = options.sendToCompanion;
  getRecordingSessionRef.current = voice.getRecordingSession;
  discardRecordingRef.current = voice.discardRecording;

  const setOpen = React.useCallback((next: boolean) => {
    interactedRef.current = true;
    openRef.current = next;
    setOpenState(next);
  }, []);

  const setText = React.useCallback((next: string | ((current: string) => string)) => {
    interactedRef.current = true;
    const resolved = normalizeMobileDictationText(
      typeof next === 'function' ? next(textRef.current) : next,
    );
    textRef.current = resolved;
    setTextState(resolved);
  }, []);

  const persistImmediately = React.useCallback(() => {
    if (!hydratedRef.current) return;
    void writeMobileDictationState({ open: openRef.current, text: textRef.current });
  }, []);

  React.useEffect(() => {
    let active = true;
    void readMobileDictationState().then((persisted) => {
      if (!active) return;
      if (!interactedRef.current) {
        openRef.current = persisted.open;
        textRef.current = persisted.text;
        setOpenState(persisted.open);
        setTextState(persisted.text);
      }
      hydratedRef.current = true;
      setHydrated(true);
      hydrationGateRef.current?.resolve();
    });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
    persistenceTimerRef.current = setTimeout(() => {
      persistenceTimerRef.current = null;
      persistImmediately();
    }, PERSIST_DEBOUNCE_MILLIS);
  }, [hydrated, open, persistImmediately, text]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') persistImmediately();
    });
    return () => subscription.remove();
  }, [persistImmediately]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2_500);
    return () => clearTimeout(timer);
  }, [notice]);

  React.useEffect(() => {
    const message = voice.error.trim();
    if (!message || !ownsRecorderErrorRef.current) return;
    setError(message);
    voice.setError('');
    if (voice.session.kind === 'idle') ownsRecorderErrorRef.current = false;
  }, [voice.error, voice.session.kind, voice.setError]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
      persistImmediately();
      const session = getRecordingSessionRef.current();
      if (session.kind === 'dictation') {
        void discardRecordingRef.current('dictation');
      }
      ownsRecorderErrorRef.current = false;
    };
  }, [persistImmediately]);

  const appendTranscript = React.useCallback(
    (transcript: string) => {
      setText((current) => appendMobileDictationTranscript(current, transcript));
    },
    [setText],
  );

  const queue = useMobileTranscriptionQueue({
    onTranscript: appendTranscript,
    onNotice: setNotice,
    onError: setError,
  });
  const enqueueClip = queue.enqueue;

  const stopAndTranscribe = React.useCallback(async () => {
    const clip = await voice.finishRecording('dictation');
    ownsRecorderErrorRef.current = false;
    if (!clip) {
      const message = voice.getError().trim();
      if (message) setError(message);
      voice.setError('');
      return;
    }
    enqueueClip(clip);
  }, [enqueueClip, voice]);

  const runRecordingCommand = React.useCallback((command: () => Promise<void>) => {
    const task = recordingCommandsRef.current.then(command, command);
    recordingCommandsRef.current = task.catch(() => undefined);
    return task;
  }, []);

  const toggleRecording = React.useCallback(() => {
    setOpen(true);
    return runRecordingCommand(async () => {
      if (finalizingRef.current) return;
      setError('');
      setNotice('');
      const session = voice.getRecordingSession();
      if (
        session.kind === 'dictation' &&
        (session.status === 'starting' ||
          session.status === 'recording' ||
          session.status === 'paused' ||
          session.status === 'stopped')
      ) {
        await stopAndTranscribe();
        return;
      }
      if (session.kind !== 'idle') {
        setError('Another voice feature is already using the microphone.');
        return;
      }
      voice.setError('');
      ownsRecorderErrorRef.current = true;
      const started = await voice.startRecording('dictation');
      if (!started) {
        const message = voice.getError().trim();
        setError((current) => message || current || 'The recording could not be started.');
        voice.setError('');
        ownsRecorderErrorRef.current = false;
      }
    });
  }, [runRecordingCommand, setOpen, stopAndTranscribe, voice]);

  const openAndStart = React.useCallback(
    async (initialText = '') => {
      await hydrationGateRef.current?.promise;
      if (!mountedRef.current) return false;
      const adoptInitialText = !textRef.current && Boolean(initialText.trim());
      if (adoptInitialText) setText(initialText);
      await toggleRecording();
      return adoptInitialText;
    },
    [setText, toggleRecording],
  );

  const togglePause = React.useCallback(() => {
    if (finalizingRef.current) return;
    voice.toggleRecordingPause('dictation');
  }, [voice]);

  const cancelRecording = React.useCallback(() => {
    return runRecordingCommand(async () => {
      if (finalizingRef.current) return;
      const session = voice.getRecordingSession();
      if (session.kind !== 'dictation') return;
      await voice.discardRecording('dictation');
      ownsRecorderErrorRef.current = false;
      setNotice('Recording discarded.');
      setError('');
    });
  }, [runRecordingCommand, voice]);

  const clearQueuedClips = queue.clear;

  const discardAndClose = React.useCallback(async () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setFinalizing(true);
    setOpen(false);
    setText('');
    setError('');
    setNotice('');
    voice.setError('');
    ownsRecorderErrorRef.current = false;
    clearQueuedClips();
    try {
      await recordingCommandsRef.current;
      if (voice.getRecordingSession().kind === 'dictation') {
        await voice.discardRecording('dictation');
      }
    } finally {
      // A stop command already in flight can save and enqueue its clip after
      // the first clear. Sweep again after recorder commands settle so Close
      // remains destructive even in that race.
      clearQueuedClips();
      setText('');
      finalizingRef.current = false;
      if (mountedRef.current) setFinalizing(false);
      persistImmediately();
    }
  }, [clearQueuedClips, persistImmediately, setOpen, setText, voice]);

  const retryFailedClip = React.useCallback(() => {
    if (finalizingRef.current) return;
    setError('');
    queue.retryFailed();
  }, [queue.retryFailed]);

  const discardFailedClip = React.useCallback(() => {
    if (finalizingRef.current) return;
    setError('');
    queue.discardFailed();
  }, [queue.discardFailed]);

  const awaitOutstandingTranscriptions = queue.awaitAll;

  const requestSend = React.useCallback(
    async (destination: MobileDictationDestination) => {
      if (finalizingRef.current) return;
      let target: MobileDictationTarget | null = null;
      if (destination !== 'companion') {
        const targetResult = resolveTargetRef.current(destination);
        if (!targetResult.ok) {
          setOpen(true);
          setError(targetResult.error);
          return;
        }
        target = targetResult.target;
      }

      finalizingRef.current = true;
      setFinalizing(true);
      setOpen(true);
      setError('');
      setNotice('');
      try {
        await recordingCommandsRef.current;
        const session = voice.getRecordingSession();
        if (
          session.kind === 'dictation' &&
          (session.status === 'starting' ||
            session.status === 'recording' ||
            session.status === 'paused' ||
            session.status === 'stopped')
        ) {
          await stopAndTranscribe();
        }
        if (!(await awaitOutstandingTranscriptions())) {
          setError('A transcription failed. Retry or discard it before sending.');
          return;
        }
        const prompt = textRef.current.trim();
        if (!prompt) {
          setError('There is no dictated text to send.');
          return;
        }

        setNetworkSending(true);
        const result = target
          ? await sendRef.current(target, prompt)
          : await sendToCompanionRef.current(prompt);
        if (!result.ok) {
          setError(result.error || 'The dictated text could not be sent.');
          return;
        }
        setText('');
        setOpen(false);
        setError('');
        setNotice('');
        voice.setError('');
        persistImmediately();
      } catch (sendError: unknown) {
        const message = sendError instanceof Error ? sendError.message : String(sendError ?? '');
        setError(message.trim() || 'The dictated text could not be sent.');
      } finally {
        setNetworkSending(false);
        setFinalizing(false);
        finalizingRef.current = false;
      }
    },
    [
      awaitOutstandingTranscriptions,
      persistImmediately,
      setOpen,
      setText,
      stopAndTranscribe,
      voice,
    ],
  );

  const recordingSession = voice.session.kind === 'dictation' ? voice.session : null;
  const recordingStatus: MobileVoiceRecordingStatus = recordingSession?.status ?? 'idle';
  const microphoneUnavailable = voice.session.kind !== 'idle' && voice.session.kind !== 'dictation';

  return {
    hydrated,
    open,
    text,
    error,
    notice,
    pendingCount: queue.pendingCount,
    failedClip: queue.failedClip,
    finalizing,
    networkSending,
    recordingStatus,
    recordingDurationMillis: recordingSession?.durationMillis ?? 0,
    microphoneUnavailable,
    setText,
    openAndStart,
    toggleRecording,
    togglePause,
    cancelRecording,
    discardAndClose,
    retryFailedClip,
    discardFailedClip,
    requestSend,
  };
}
