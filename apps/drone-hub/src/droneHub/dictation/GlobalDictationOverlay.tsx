import React from 'react';
import { ChatComposerEditor } from '../chat/ChatComposerEditor';
import { formatChatVoiceDuration } from '../chat/use-chat-voice-recorder';
import { useIdleMonacoEditorPreload } from '../files/monaco-editor-loader';
import type {
  GlobalDictationDestination,
  GlobalDictationSendResult,
  GlobalDictationTarget,
  GlobalDictationTargetResult,
} from './global-dictation-types';
import { useGlobalDictation } from './use-global-dictation';

export type GlobalDictationOverlayProps = {
  activeChatLabel: string;
  resolveTarget(destination: GlobalDictationDestination): GlobalDictationTargetResult;
  send(target: GlobalDictationTarget, text: string): Promise<GlobalDictationSendResult>;
};

export function GlobalDictationOverlay(props: GlobalDictationOverlayProps) {
  useIdleMonacoEditorPreload();
  const dictation = useGlobalDictation(props);
  if (!dictation.open) return null;

  const recordingActive =
    dictation.recordingStatus === 'starting' ||
    dictation.recordingStatus === 'recording' ||
    dictation.recordingStatus === 'paused';
  const status = dictationStatusLabel({
    recordingStatus: dictation.recordingStatus,
    pendingCount: dictation.pendingCount,
    failedCount: dictation.failedClips.length,
    finalizing: dictation.finalizing,
    networkSending: dictation.networkSending,
    destinationLabel: dictation.destinationLabel,
  });
  const indicatorClass =
    dictation.recordingStatus === 'recording'
      ? 'bg-[var(--red)] animate-pulse'
      : dictation.recordingStatus === 'paused'
        ? 'bg-[var(--yellow)]'
        : dictation.failedClips.length > 0 || dictation.error
          ? 'bg-[var(--red)]'
          : 'bg-[var(--accent)]';

  return (
    <aside
      className="fixed bottom-4 right-4 z-[90] flex max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] shadow-2xl"
      aria-label="Dictation scratchpad"
      data-global-dictation-overlay="true"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${indicatorClass}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm font-[var(--weight-semibold)] text-[var(--fg)]">
              Dictation
            </span>
            <span className="truncate text-[var(--text-10)] text-[var(--muted)]" aria-live="polite">
              {status}
            </span>
            {recordingActive ? (
              <span
                className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--muted)]"
                aria-label={`${formatChatVoiceDuration(dictation.recordingDurationMillis)} elapsed`}
              >
                {formatChatVoiceDuration(dictation.recordingDurationMillis)}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-[9px] text-[var(--muted-dim)]">
            Current chat: {props.activeChatLabel || 'None selected'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <HeaderButton
            label="Clear dictation and close"
            onClick={() => void dictation.clear()}
            disabled={
              dictation.finalizing ||
              (!dictation.text &&
                !recordingActive &&
                dictation.pendingCount === 0 &&
                dictation.failedClips.length === 0)
            }
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h16" />
              <path d="M9 7V4h6v3" />
              <path d="m7 7 1 13h8l1-13" />
            </svg>
          </HeaderButton>
          <HeaderButton
            label="Close dictation (Numpad Decimal)"
            onClick={() => void dictation.close()}
            disabled={dictation.finalizing}
          >
            <span className="text-base leading-none">×</span>
          </HeaderButton>
        </div>
      </header>

      <div className="min-h-0 overflow-y-auto">
        {dictation.error || dictation.notice ? (
          <div
            className={`border-b border-[var(--border-subtle)] px-3 py-2 text-[var(--text-10)] ${dictation.error ? 'text-[var(--red)]' : 'text-[var(--muted)]'}`}
            role="status"
          >
            {dictation.error || dictation.notice}
          </div>
        ) : null}

        <ChatComposerEditor
          value={dictation.text}
          disabled={dictation.networkSending}
          initialSelection={dictation.selection}
          onChange={dictation.setText}
          onSelectionChange={dictation.setSelection}
          onSendQueued={() => void dictation.requestSend('current-chat')}
          ariaLabel="Edit dictated text"
          maxHeight="45vh"
        />

        {dictation.failedClips.length > 0 ? (
          <div className="space-y-1.5 border-t border-[var(--border-subtle)] px-3 py-2">
            {dictation.failedClips.map((clip) => (
              <div
                key={clip.id}
                className="flex items-center gap-2 rounded-md border border-[var(--red-border)] bg-[var(--red-subtle)] px-2 py-1.5 text-[var(--text-10)]"
              >
                <span className="min-w-0 flex-1 truncate text-[var(--red)]" title={clip.error}>
                  Transcription failed: {clip.error}
                </span>
                <button
                  type="button"
                  onClick={() => dictation.retryClip(clip.id)}
                  disabled={dictation.finalizing}
                  className="font-[var(--weight-semibold)] text-[var(--accent)] hover:underline disabled:opacity-40"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => dictation.discardClip(clip.id)}
                  disabled={dictation.finalizing}
                  className="font-[var(--weight-semibold)] text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-40"
                >
                  Discard
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
        <button
          type="button"
          onClick={() => void dictation.toggleRecording()}
          disabled={dictation.finalizing}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[var(--text-10)] font-[var(--weight-semibold)] transition-opacity hover:opacity-75 disabled:opacity-40 ${recordingActive ? 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]' : 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]'}`}
        >
          {recordingActive ? 'Stop + transcribe' : 'Record'}
          <kbd className="font-mono text-[9px] opacity-70">+</kbd>
        </button>
        {recordingActive ? (
          <>
            <button
              type="button"
              onClick={() => dictation.toggleRecordingPause()}
              disabled={dictation.recordingStatus === 'starting' || dictation.finalizing}
              className="inline-flex h-8 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-2.5 text-[var(--text-10)] text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-40"
            >
              {dictation.recordingStatus === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => void dictation.cancelRecording()}
              disabled={dictation.finalizing}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--red-border)] bg-[var(--red-subtle)] px-2.5 text-[var(--text-10)] text-[var(--red)] hover:opacity-75 disabled:opacity-40"
            >
              Discard <kbd className="font-mono text-[9px] opacity-70">−</kbd>
            </button>
          </>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-right text-[9px] text-[var(--muted-dim)]">
          Decimal closes
        </span>
      </div>

      <div className="grid shrink-0 grid-cols-5 gap-1 border-t border-[var(--border-subtle)] bg-[var(--surface-soft)] px-2 py-1.5">
        <DestinationButton
          shortcut="0"
          label="Current"
          onClick={() => void dictation.requestSend('current-chat')}
          disabled={dictation.finalizing}
        />
        <DestinationButton
          shortcut="1"
          label="Root drone"
          onClick={() => void dictation.requestSend('root-drone')}
          disabled={dictation.finalizing}
        />
        <DestinationButton
          shortcut="2"
          label="Group drone"
          onClick={() => void dictation.requestSend('group-drone')}
          disabled={dictation.finalizing}
        />
        <DestinationButton
          shortcut="3"
          label="New chat"
          onClick={() => void dictation.requestSend('new-chat')}
          disabled={dictation.finalizing}
        />
        <DestinationButton
          shortcut="4"
          label="Clone"
          onClick={() => void dictation.requestSend('clone-chat')}
          disabled={dictation.finalizing}
        />
      </div>
    </aside>
  );
}

function HeaderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-40"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function DestinationButton({
  shortcut,
  label,
  disabled,
  onClick,
}: {
  shortcut: string;
  label: string;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-w-0 rounded px-1 py-1 text-[9px] text-[var(--muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)] disabled:opacity-40"
      title={`Numpad ${shortcut}: send to ${label.toLowerCase()}`}
    >
      <kbd className="mr-1 font-mono text-[var(--accent)]">{shortcut}</kbd>
      <span className="truncate">{label}</span>
    </button>
  );
}

function dictationStatusLabel(args: {
  recordingStatus: 'idle' | 'starting' | 'recording' | 'paused';
  pendingCount: number;
  failedCount: number;
  finalizing: boolean;
  networkSending: boolean;
  destinationLabel: string;
}): string {
  if (args.networkSending) return `Sending to ${args.destinationLabel}…`;
  if (args.finalizing) {
    return args.pendingCount > 0
      ? `Finishing ${args.pendingCount} transcription${args.pendingCount === 1 ? '' : 's'}…`
      : 'Preparing to send…';
  }
  const pending = args.pendingCount > 0 ? ` · ${args.pendingCount} pending` : '';
  if (args.recordingStatus === 'starting') return `Starting microphone${pending}`;
  if (args.recordingStatus === 'recording') return `Recording${pending}`;
  if (args.recordingStatus === 'paused') return `Paused${pending}`;
  if (args.failedCount > 0)
    return `${args.failedCount} transcription${args.failedCount === 1 ? '' : 's'} failed`;
  if (args.pendingCount > 0)
    return `${args.pendingCount} transcription${args.pendingCount === 1 ? '' : 's'} pending`;
  return 'Ready';
}
