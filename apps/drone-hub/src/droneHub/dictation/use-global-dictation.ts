import React from 'react';
import type { ChatComposerSelection } from '../chat/ChatComposerEditor';
import { transcribeChatVoiceWav } from '../chat/use-chat-voice-recorder';
import { globalDictationShortcutAction } from './global-dictation-shortcuts';
import {
  appendGlobalDictationTranscript,
  drainReadyTranscriptionResults,
} from './global-dictation-queue';
import {
  normalizeGlobalDictationText,
  readGlobalDictationState,
  writeGlobalDictationState,
} from './global-dictation-storage';
import type {
  GlobalDictationDestination,
  GlobalDictationSendResult,
  GlobalDictationTarget,
  GlobalDictationTargetResult,
} from './global-dictation-types';
import { useDictationAudioRecorder, type DictationAudioClip } from './use-dictation-audio-recorder';

const MINIMUM_RECORDING_MILLIS = 1_000;
const PERSIST_DEBOUNCE_MILLIS = 300;

type TranscriptionClip = {
  id: string;
  wav: ArrayBuffer;
  status: 'pending' | 'ready' | 'failed';
  text: string;
  error: string;
  attempt: number;
  abortController: AbortController | null;
  task: Promise<void> | null;
};

type FailedDictationClip = {
  id: string;
  error: string;
};

type GlobalDictationControllerOptions = {
  resolveTarget(destination: GlobalDictationDestination): GlobalDictationTargetResult;
  send(target: GlobalDictationTarget, text: string): Promise<GlobalDictationSendResult>;
};

export function useGlobalDictation(options: GlobalDictationControllerOptions) {
  const initialState = React.useMemo(readGlobalDictationState, []);
  const [open, setOpenState] = React.useState(initialState.open);
  const [text, setTextState] = React.useState(initialState.text);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [, setQueueRevision] = React.useState(0);
  const [finalizing, setFinalizing] = React.useState(false);
  const [networkSending, setNetworkSending] = React.useState(false);
  const [destinationLabel, setDestinationLabel] = React.useState('');
  const [selection, setSelection] = React.useState<ChatComposerSelection>({ start: 0, end: 0 });
  const openRef = React.useRef(open);
  const textRef = React.useRef(text);
  const persistenceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipsRef = React.useRef<TranscriptionClip[]>([]);
  const clipSequenceRef = React.useRef(0);
  const finalizingRef = React.useRef(false);
  const resolveTargetRef = React.useRef(options.resolveTarget);
  const sendRef = React.useRef(options.send);
  resolveTargetRef.current = options.resolveTarget;
  sendRef.current = options.send;

  const setOpen = React.useCallback((next: boolean) => {
    openRef.current = next;
    setOpenState(next);
  }, []);

  const setText = React.useCallback((next: string | ((current: string) => string)) => {
    const resolved = normalizeGlobalDictationText(
      typeof next === 'function' ? next(textRef.current) : next,
    );
    textRef.current = resolved;
    setTextState(resolved);
  }, []);

  const reportRecordingError = React.useCallback(
    (message: string) => {
      setError(message);
      if (message) setOpen(true);
    },
    [setOpen],
  );
  const {
    status: recordingStatus,
    durationMillis: recordingDurationMillis,
    getStatus: getRecordingStatus,
    start: startRecording,
    finish: finishRecording,
    cancel: cancelRecordingCapture,
    togglePause: toggleRecordingPause,
  } = useDictationAudioRecorder(reportRecordingError);

  React.useEffect(() => {
    if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
    persistenceTimerRef.current = setTimeout(() => {
      persistenceTimerRef.current = null;
      writeGlobalDictationState({ open: openRef.current, text: textRef.current });
    }, PERSIST_DEBOUNCE_MILLIS);
  }, [open, text]);

  React.useEffect(() => {
    const persistImmediately = () => {
      writeGlobalDictationState({ open: openRef.current, text: textRef.current });
    };
    window.addEventListener('pagehide', persistImmediately);
    return () => {
      window.removeEventListener('pagehide', persistImmediately);
      if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
      persistImmediately();
      for (const clip of clipsRef.current) {
        clip.attempt += 1;
        clip.abortController?.abort();
      }
    };
  }, []);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshQueue = React.useCallback(() => {
    setQueueRevision((current) => current + 1);
  }, []);

  const appendTranscript = React.useCallback(
    (transcript: string) => {
      setText((current) => appendGlobalDictationTranscript(current, transcript));
    },
    [setText],
  );

  const flushReadyClips = React.useCallback(() => {
    const previousLength = clipsRef.current.length;
    const transcripts = drainReadyTranscriptionResults(clipsRef.current);
    for (const transcript of transcripts) appendTranscript(transcript);
    if (clipsRef.current.length !== previousLength) refreshQueue();
  }, [appendTranscript, refreshQueue]);

  const transcribeClip = React.useCallback(
    (clip: TranscriptionClip) => {
      clip.abortController?.abort();
      clip.attempt += 1;
      const attempt = clip.attempt;
      const abortController = new AbortController();
      clip.abortController = abortController;
      clip.status = 'pending';
      clip.error = '';
      clip.text = '';
      const task = transcribeChatVoiceWav(clip.wav, { signal: abortController.signal })
        .then((transcript) => {
          if (clip.attempt !== attempt || abortController.signal.aborted) return;
          clip.status = 'ready';
          clip.text = transcript;
          if (!transcript.trim()) setNotice('No speech was detected in that recording.');
        })
        .catch((transcriptionError: unknown) => {
          if (clip.attempt !== attempt || abortController.signal.aborted) return;
          clip.status = 'failed';
          clip.error =
            transcriptionError instanceof Error
              ? transcriptionError.message
              : String(transcriptionError ?? 'Transcription failed.');
        })
        .finally(() => {
          if (clip.attempt !== attempt) return;
          clip.abortController = null;
          clip.task = null;
          flushReadyClips();
          refreshQueue();
        });
      clip.task = task;
      refreshQueue();
      return task;
    },
    [flushReadyClips, refreshQueue],
  );

  const enqueueClip = React.useCallback(
    (audio: DictationAudioClip): Promise<void> | null => {
      if (audio.durationMillis < MINIMUM_RECORDING_MILLIS) {
        setNotice('Recording too short — discarded.');
        return null;
      }
      const clip: TranscriptionClip = {
        id: `dictation-${Date.now().toString(36)}-${++clipSequenceRef.current}`,
        wav: audio.wav,
        status: 'pending',
        text: '',
        error: '',
        attempt: 0,
        abortController: null,
        task: null,
      };
      clipsRef.current.push(clip);
      return transcribeClip(clip);
    },
    [transcribeClip],
  );

  const stopAndTranscribe = React.useCallback(async () => {
    const audio = await finishRecording();
    if (!audio) {
      setNotice('Recording too short — discarded.');
      return null;
    }
    return enqueueClip(audio);
  }, [enqueueClip, finishRecording]);

  const toggleRecording = React.useCallback(async () => {
    if (finalizingRef.current) return;
    setOpen(true);
    setError('');
    const status = getRecordingStatus();
    if (status === 'starting' || status === 'recording' || status === 'paused') {
      await stopAndTranscribe();
      return;
    }
    await startRecording();
  }, [getRecordingStatus, setOpen, startRecording, stopAndTranscribe]);

  const cancelRecording = React.useCallback(async () => {
    if (finalizingRef.current || getRecordingStatus() === 'idle') return;
    await cancelRecordingCapture();
    setNotice('Recording discarded.');
  }, [cancelRecordingCapture, getRecordingStatus]);

  const close = React.useCallback(async () => {
    if (finalizingRef.current) return;
    if (getRecordingStatus() !== 'idle') await cancelRecordingCapture();
    setOpen(false);
  }, [cancelRecordingCapture, getRecordingStatus, setOpen]);

  const clear = React.useCallback(async () => {
    if (finalizingRef.current) return;
    await cancelRecordingCapture();
    for (const clip of clipsRef.current) clip.abortController?.abort();
    clipsRef.current = [];
    refreshQueue();
    setText('');
    setError('');
    setNotice('');
    setOpen(false);
  }, [cancelRecordingCapture, refreshQueue, setOpen, setText]);

  const retryClip = React.useCallback(
    (id: string) => {
      if (finalizingRef.current) return;
      const clip = clipsRef.current.find((candidate) => candidate.id === id);
      if (!clip || clip.status !== 'failed') return;
      setError('');
      void transcribeClip(clip);
    },
    [transcribeClip],
  );

  const discardClip = React.useCallback(
    (id: string) => {
      if (finalizingRef.current) return;
      const index = clipsRef.current.findIndex((candidate) => candidate.id === id);
      if (index < 0) return;
      clipsRef.current[index]?.abortController?.abort();
      clipsRef.current.splice(index, 1);
      setError('');
      flushReadyClips();
      refreshQueue();
    },
    [flushReadyClips, refreshQueue],
  );

  const awaitOutstandingTranscriptions = React.useCallback(async (): Promise<boolean> => {
    const tasks = clipsRef.current
      .map((clip) => clip.task)
      .filter((task): task is Promise<void> => Boolean(task));
    await Promise.allSettled(tasks);
    flushReadyClips();
    return clipsRef.current.length === 0;
  }, [flushReadyClips]);

  const requestSend = React.useCallback(
    async (destination: GlobalDictationDestination) => {
      if (finalizingRef.current) return;
      const targetResult = resolveTargetRef.current(destination);
      if (!targetResult.ok) {
        setOpen(true);
        setError(targetResult.error);
        return;
      }

      finalizingRef.current = true;
      setFinalizing(true);
      setDestinationLabel(targetResult.target.label);
      setOpen(true);
      setError('');
      try {
        const status = getRecordingStatus();
        if (status === 'starting' || status === 'recording' || status === 'paused') {
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
        const result = await sendRef.current(targetResult.target, prompt);
        if (!result.ok) {
          setError(result.error || 'The dictated text could not be sent.');
          return;
        }
        setText('');
        setOpen(false);
        setNotice('');
        setDestinationLabel('');
      } catch (sendError: unknown) {
        const message = sendError instanceof Error ? sendError.message : String(sendError ?? '');
        setError(message.trim() || 'The dictated text could not be sent.');
      } finally {
        setNetworkSending(false);
        setFinalizing(false);
        finalizingRef.current = false;
      }
    },
    [awaitOutstandingTranscriptions, getRecordingStatus, setOpen, setText, stopAndTranscribe],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      const action = globalDictationShortcutAction(event);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (action === 'toggle-recording') {
        void toggleRecording();
      } else if (action === 'cancel-recording') {
        void cancelRecording();
      } else if (action === 'close') {
        void close();
      } else {
        void requestSend(action.destination);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [cancelRecording, close, requestSend, toggleRecording]);

  const queuedClips = clipsRef.current;
  const pendingCount = queuedClips.filter((clip) => clip.status === 'pending').length;
  const failedClips: FailedDictationClip[] = queuedClips
    .filter((clip) => clip.status === 'failed')
    .map((clip) => ({ id: clip.id, error: clip.error || 'Transcription failed.' }));

  return {
    open,
    text,
    error,
    notice,
    pendingCount,
    failedClips,
    finalizing,
    networkSending,
    destinationLabel,
    selection,
    recordingStatus,
    recordingDurationMillis,
    setText,
    setSelection,
    toggleRecording,
    cancelRecording,
    toggleRecordingPause,
    close,
    clear,
    retryClip,
    discardClip,
    requestSend,
  };
}
