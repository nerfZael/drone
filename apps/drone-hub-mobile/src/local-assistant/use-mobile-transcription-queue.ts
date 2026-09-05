import React from 'react';
import { readGroqApiKey } from './local-assistant-settings';
import { drainReadyMobileDictationTranscripts } from './mobile-dictation-queue';
import { transcribeMobileVoiceRecording } from './mobile-groq-transcription';
import {
  deleteMobileVoiceRecordingFile,
  type MobileVoiceRecordingClip,
} from './use-mobile-chat-voice-recorder';

const MINIMUM_RECORDING_MILLIS = 1_000;

type TranscriptionClip = {
  id: string;
  uri: string;
  status: 'pending' | 'ready' | 'failed';
  text: string;
  error: string;
  attempt: number;
  abortController: AbortController | null;
  task: Promise<void> | null;
};

/**
 * Transcribes finished recordings in parallel while delivering their text in
 * recording order. A clip that finishes before an earlier one waits in the
 * queue until everything recorded before it has been delivered, so the draft
 * always reads in the order the user spoke.
 */
export function useMobileTranscriptionQueue({
  onTranscript,
  onNotice,
  onError,
}: {
  onTranscript(transcript: string): void;
  onNotice(message: string): void;
  onError(message: string): void;
}) {
  const [, setQueueRevision] = React.useState(0);
  const clipsRef = React.useRef<TranscriptionClip[]>([]);
  const clipSequenceRef = React.useRef(0);
  const mountedRef = React.useRef(true);
  const onTranscriptRef = React.useRef(onTranscript);
  const onNoticeRef = React.useRef(onNotice);
  const onErrorRef = React.useRef(onError);
  onTranscriptRef.current = onTranscript;
  onNoticeRef.current = onNotice;
  onErrorRef.current = onError;

  const refresh = React.useCallback(() => {
    if (mountedRef.current) setQueueRevision((current) => current + 1);
  }, []);

  const flushReady = React.useCallback(() => {
    const previousLength = clipsRef.current.length;
    const transcripts = drainReadyMobileDictationTranscripts(clipsRef.current);
    for (const transcript of transcripts) onTranscriptRef.current(transcript);
    if (clipsRef.current.length !== previousLength) refresh();
  }, [refresh]);

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
      const task = readGroqApiKey()
        .then((apiKey) =>
          transcribeMobileVoiceRecording({
            uri: clip.uri,
            apiKey,
            signal: abortController.signal,
            deleteFile: false,
          }),
        )
        .then((transcript) => {
          if (clip.attempt !== attempt || abortController.signal.aborted) return;
          clip.status = 'ready';
          clip.text = transcript;
          deleteMobileVoiceRecordingFile(clip.uri);
        })
        .catch((transcriptionError: unknown) => {
          if (clip.attempt !== attempt || abortController.signal.aborted) return;
          const message =
            transcriptionError instanceof Error
              ? transcriptionError.message
              : String(transcriptionError ?? 'Transcription failed.');
          if (message === 'No speech detected.') {
            clip.status = 'ready';
            clip.text = '';
            deleteMobileVoiceRecordingFile(clip.uri);
            onNoticeRef.current('No speech was detected in that recording.');
            return;
          }
          clip.status = 'failed';
          clip.error = message;
          onErrorRef.current(message);
        })
        .finally(() => {
          if (clip.attempt !== attempt) return;
          clip.abortController = null;
          clip.task = null;
          flushReady();
          refresh();
        });
      clip.task = task;
      refresh();
      return task;
    },
    [flushReady, refresh],
  );

  const enqueue = React.useCallback(
    (clip: MobileVoiceRecordingClip): Promise<void> | null => {
      if (!mountedRef.current) {
        deleteMobileVoiceRecordingFile(clip.uri);
        return null;
      }
      if (clip.durationMillis < MINIMUM_RECORDING_MILLIS) {
        deleteMobileVoiceRecordingFile(clip.uri);
        onNoticeRef.current('Recording too short — discarded.');
        return null;
      }
      const queued: TranscriptionClip = {
        id: `mobile-transcription-${Date.now().toString(36)}-${++clipSequenceRef.current}`,
        uri: clip.uri,
        status: 'pending',
        text: '',
        error: '',
        attempt: 0,
        abortController: null,
        task: null,
      };
      clipsRef.current.push(queued);
      return transcribeClip(queued);
    },
    [transcribeClip],
  );

  const retryFailed = React.useCallback(() => {
    const clip = clipsRef.current.find((candidate) => candidate.status === 'failed');
    if (!clip) return;
    void transcribeClip(clip);
  }, [transcribeClip]);

  const discardFailed = React.useCallback(() => {
    const index = clipsRef.current.findIndex((candidate) => candidate.status === 'failed');
    if (index < 0) return;
    const [clip] = clipsRef.current.splice(index, 1);
    clip?.abortController?.abort();
    deleteMobileVoiceRecordingFile(clip?.uri);
    flushReady();
    refresh();
  }, [flushReady, refresh]);

  const clear = React.useCallback(() => {
    for (const clip of clipsRef.current) {
      clip.attempt += 1;
      clip.abortController?.abort();
      deleteMobileVoiceRecordingFile(clip.uri);
    }
    clipsRef.current = [];
    refresh();
  }, [refresh]);

  /** Waits for every queued clip; resolves true when all text was delivered. */
  const awaitAll = React.useCallback(async (): Promise<boolean> => {
    const tasks = clipsRef.current
      .map((clip) => clip.task)
      .filter((task): task is Promise<void> => Boolean(task));
    await Promise.allSettled(tasks);
    flushReady();
    return clipsRef.current.length === 0;
  }, [flushReady]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const clip of clipsRef.current) {
        clip.attempt += 1;
        clip.abortController?.abort();
        deleteMobileVoiceRecordingFile(clip.uri);
      }
      clipsRef.current = [];
    };
  }, []);

  const pendingCount = clipsRef.current.filter((clip) => clip.status === 'pending').length;
  const failed = clipsRef.current.find((clip) => clip.status === 'failed') ?? null;

  return {
    pendingCount,
    failedClip: failed ? { id: failed.id, error: failed.error } : null,
    hasClips: clipsRef.current.length > 0,
    enqueue,
    retryFailed,
    discardFailed,
    clear,
    awaitAll,
  };
}
