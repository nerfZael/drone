import React from 'react';
import {
  mergeDraftWithVoiceTranscript,
  useChatVoiceRecorder,
  type ChatVoiceRecordingStatus,
} from '../chat/use-chat-voice-recorder';

type InitialMessageVoiceControlsProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
};

export type InitialMessageVoiceControlsHandle = {
  stopAndAppendRecording: () => Promise<string | null>;
};

function voiceStatusLabel(status: ChatVoiceRecordingStatus): string {
  if (status === 'starting') return 'Starting...';
  if (status === 'recording') return 'Recording';
  if (status === 'paused') return 'Paused';
  if (status === 'transcribing') return 'Transcribing...';
  return '';
}

function MicrophoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5v14" />
      <path d="M15 5v14" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 7h10v10H7Z" />
    </svg>
  );
}

function DiscardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export const InitialMessageVoiceControls = React.forwardRef<InitialMessageVoiceControlsHandle, InitialMessageVoiceControlsProps>(
function InitialMessageVoiceControls(
  {
    value,
    onChange,
    disabled = false,
    textareaRef,
  },
  ref,
) {
  const [error, setError] = React.useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = React.useState(false);
  const actionTokenRef = React.useRef(0);
  const valueRef = React.useRef(value);

  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const {
    status,
    startRecording,
    toggleRecordingPause,
    discardRecording,
    stopRecordingForTranscript,
  } = useChatVoiceRecorder({
    onError: React.useCallback((message) => {
      setError(message.trim() ? message : null);
    }, []),
  });

  const voiceActive = status !== 'idle';
  const canPauseOrStop = status === 'recording' || status === 'paused';
  const controlsDisabled = disabled || actionInFlight;

  React.useEffect(() => {
    if (!disabled || !voiceActive) return;
    actionTokenRef.current += 1;
    setActionInFlight(false);
    void discardRecording();
  }, [disabled, discardRecording, voiceActive]);

  const beginAction = React.useCallback(() => {
    if (actionInFlight) return null;
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    setActionInFlight(true);
    return token;
  }, [actionInFlight]);

  const endAction = React.useCallback((token: number | null) => {
    if (token == null || actionTokenRef.current !== token) return;
    setActionInFlight(false);
  }, []);

  const stopAndAppend = React.useCallback(async (opts: { focus?: boolean } = {}): Promise<string | null> => {
    if (status === 'idle') return valueRef.current;
    if (!canPauseOrStop || actionInFlight) {
      setError((current) => current || 'Voice recording is not ready to transcribe yet.');
      return null;
    }
    const token = beginAction();
    if (token == null) return null;
    try {
      const before = valueRef.current;
      const transcript = await stopRecordingForTranscript();
      if (actionTokenRef.current !== token) return null;
      const next = mergeDraftWithVoiceTranscript(before, transcript);
      if (next === before) {
        setError((current) => current || 'No speech detected.');
        return null;
      }
      onChange(next);
      if (opts.focus !== false) {
        window.requestAnimationFrame(() => textareaRef?.current?.focus());
      }
      return next;
    } finally {
      endAction(token);
    }
  }, [actionInFlight, beginAction, canPauseOrStop, endAction, onChange, status, stopRecordingForTranscript, textareaRef]);

  React.useImperativeHandle(
    ref,
    () => ({
      stopAndAppendRecording: () => stopAndAppend({ focus: false }),
    }),
    [stopAndAppend],
  );

  const discard = React.useCallback(async () => {
    actionTokenRef.current += 1;
    setActionInFlight(false);
    setError(null);
    await discardRecording();
  }, [discardRecording]);

  const statusLabel = voiceStatusLabel(status);

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {error ? (
        <span className="max-w-[260px] truncate text-[var(--text-10)] text-[var(--red)]" title={error}>
          {error}
        </span>
      ) : statusLabel ? (
        <span className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--accent)]">
          {statusLabel}
        </span>
      ) : null}
      {status === 'idle' ? (
        <button
          type="button"
          onClick={() => {
            void startRecording();
          }}
          disabled={controlsDisabled}
          className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-all ${
            controlsDisabled
              ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] opacity-40'
              : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)]'
          }`}
          title="Record initial message"
          aria-label="Record initial message"
        >
          <MicrophoneIcon />
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              void discard();
            }}
            disabled={status === 'transcribing' || actionInFlight}
            className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-all ${
              status === 'transcribing' || actionInFlight
                ? 'cursor-not-allowed border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] opacity-40'
                : 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
            }`}
            title="Discard recording"
            aria-label="Discard recording"
          >
            <DiscardIcon />
          </button>
          <button
            type="button"
            onClick={toggleRecordingPause}
            disabled={!canPauseOrStop || actionInFlight}
            className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-all ${
              !canPauseOrStop || actionInFlight
                ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] opacity-40'
                : status === 'paused'
                  ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:bg-[var(--accent-subtle)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)]'
            }`}
            title={status === 'paused' ? 'Resume recording' : 'Pause recording'}
            aria-label={status === 'paused' ? 'Resume recording' : 'Pause recording'}
          >
            {status === 'paused' ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button
            type="button"
            onClick={() => {
              void stopAndAppend();
            }}
            disabled={!canPauseOrStop || actionInFlight}
            className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-all ${
              !canPauseOrStop || actionInFlight
                ? 'cursor-not-allowed border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)] opacity-40'
                : 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)] hover:bg-[var(--green-subtle)]'
            }`}
            title="Stop recording and transcribe"
            aria-label="Stop recording and transcribe"
          >
            <StopIcon />
          </button>
        </>
      )}
    </div>
  );
});
