import React from 'react';

import { IconChatThread, IconPencil, IconPlus, IconSidebarCollapse, IconTrash } from '../app/icons';
import {
  desktopAssistantVoiceControlLabel,
  desktopAssistantVoiceControlTitle,
  desktopAssistantVoiceHeardText,
  dispatchAssistantDesktopVoiceRealtimeToggle,
  isDesktopAssistantVoiceActive,
  isDesktopAssistantVoiceBusy,
  type DesktopAssistantVoiceStatus,
} from './desktop-assistant-voice';
import {
  assistantThreadStatusLabel,
  formatUpdatedAt,
} from './assistant-formatters';
import type { AssistantPanelMode, AssistantThread } from './assistant-types';

type AssistantThreadSidebarDockSide = 'left' | 'right';

type AssistantThreadSidebarDockPreview = {
  side: AssistantThreadSidebarDockSide;
  left: number;
  top: number;
  width: number;
  height: number;
};

function isAssistantThreadSidebarHeaderAction(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, input, select, textarea, a'));
}

export function AssistantThreadSidebar({
  threads,
  activeThreadId,
  dockSide,
  mode,
  onCreateThread,
  onSelectThread,
  onDockSideChange,
  onRenameThread,
  onDeleteThread,
  onModeChange,
  onOpenPairing,
  desktopVoiceStatus,
  onToggleDesktopVoice,
  onStartDesktopVoiceRecording,
  onStopDesktopVoice,
  onCollapse,
}: {
  threads: AssistantThread[];
  activeThreadId: string | null;
  dockSide: AssistantThreadSidebarDockSide;
  mode: AssistantPanelMode;
  onCreateThread: () => void;
  onSelectThread: (thread: AssistantThread) => void;
  onDockSideChange: (side: AssistantThreadSidebarDockSide) => void;
  onRenameThread: (thread: AssistantThread, title: string) => Promise<void>;
  onDeleteThread: (thread: AssistantThread) => void;
  onModeChange: (mode: AssistantPanelMode) => void;
  onOpenPairing: () => void;
  desktopVoiceStatus: DesktopAssistantVoiceStatus;
  onToggleDesktopVoice: () => void;
  onStartDesktopVoiceRecording: () => void;
  onStopDesktopVoice: () => void;
  onCollapse: () => void;
}) {
  const [renamingThreadId, setRenamingThreadId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [renameSaving, setRenameSaving] = React.useState(false);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const dockDragStartXRef = React.useRef<number | null>(null);
  const dockDragBoundsRef = React.useRef<DOMRect | null>(null);
  const [dockDragPreview, setDockDragPreview] = React.useState<AssistantThreadSidebarDockPreview | null>(null);
  const voiceMode = mode === 'voice';
  const desktopVoiceActive = isDesktopAssistantVoiceActive(desktopVoiceStatus);
  const desktopVoiceBusy = isDesktopAssistantVoiceBusy(desktopVoiceStatus);
  const desktopVoiceHeardText = desktopAssistantVoiceHeardText(desktopVoiceStatus);
  const desktopVoiceLabel = desktopAssistantVoiceControlLabel(desktopVoiceStatus);
  const desktopVoiceMainTitle = desktopAssistantVoiceControlTitle(desktopVoiceStatus);
  const desktopVoiceRealtimeAvailable = desktopVoiceStatus.realtime?.available === true;
  const desktopVoiceRealtimeEnabled = desktopVoiceStatus.realtime?.enabled === true;

  const resolveDockPreview = React.useCallback((clientX: number): AssistantThreadSidebarDockPreview | null => {
    const bounds = dockDragBoundsRef.current;
    if (!bounds) return null;
    const side: AssistantThreadSidebarDockSide = clientX > bounds.left + bounds.width / 2 ? 'right' : 'left';
    const width = Math.min(208, bounds.width * 0.46);
    return {
      side,
      left: side === 'right' ? bounds.right - width : bounds.left,
      top: bounds.top,
      width,
      height: bounds.height,
    };
  }, []);

  const finishDockDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const startX = dockDragStartXRef.current;
    const finalPreview = resolveDockPreview(event.clientX);
    if (commit && startX != null && Math.abs(event.clientX - startX) >= 8 && finalPreview) {
      onDockSideChange(finalPreview.side);
    }
    dockDragStartXRef.current = null;
    dockDragBoundsRef.current = null;
    setDockDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [onDockSideChange, resolveDockPreview]);

  React.useEffect(() => {
    if (!renamingThreadId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingThreadId]);

  const beginRename = (thread: AssistantThread) => {
    setRenameDraft(thread.title || 'Untitled thread');
    setRenamingThreadId(thread.id);
  };

  const cancelRename = () => {
    if (renameSaving) return;
    setRenamingThreadId(null);
    setRenameDraft('');
  };

  const commitRename = async (thread: AssistantThread) => {
    const title = renameDraft.trim();
    if (!title || title === thread.title) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      await onRenameThread(thread, title);
      setRenamingThreadId(null);
      setRenameDraft('');
    } catch {
      // The dock surfaces request errors; keep the editor open so the title can be retried.
    } finally {
      setRenameSaving(false);
    }
  };
  return (
    <>
      {dockDragPreview ? (
        <div className="pointer-events-none fixed inset-0 z-[10000]" aria-hidden="true">
          <div
            className="absolute border border-[rgba(148,163,184,.32)] bg-[rgba(148,163,184,.10)] shadow-[inset_0_0_0_1px_rgba(255,255,255,.025)]"
            style={{
              left: dockDragPreview.left,
              top: dockDragPreview.top,
              width: dockDragPreview.width,
              height: dockDragPreview.height,
            }}
          />
        </div>
      ) : null}
      <aside
        data-assistant-thread-sidebar="true"
        data-dock-side={dockSide}
        className={`flex w-52 max-w-[46%] min-w-0 flex-shrink-0 flex-col border-[var(--border)] bg-[rgba(0,0,0,.14)] ${dockSide === 'right' ? 'border-l' : 'border-r'}`}
      >
      <div
        className={`flex h-11 flex-shrink-0 touch-none select-none items-center gap-2 border-b border-[var(--border)] px-2 ${dockDragPreview ? 'cursor-grabbing' : 'cursor-grab'}`}
        title="Drag header to dock thread sidebar left or right"
        onPointerDown={(event) => {
          if (isAssistantThreadSidebarHeaderAction(event.target)) return;
          const root = event.currentTarget.closest('[data-assistant-dock-root="true"]');
          if (!(root instanceof HTMLElement)) return;
          dockDragStartXRef.current = event.clientX;
          dockDragBoundsRef.current = root.getBoundingClientRect();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const startX = dockDragStartXRef.current;
          if (startX == null) return;
          if (!dockDragPreview && Math.abs(event.clientX - startX) < 8) return;
          setDockDragPreview(resolveDockPreview(event.clientX));
        }}
        onPointerUp={(event) => finishDockDrag(event, true)}
        onPointerCancel={(event) => finishDockDrag(event, false)}
      >
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted)]">
          {voiceMode ? (
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <path d="M12 19v3" />
            </svg>
          ) : (
            <IconChatThread className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            {voiceMode ? 'Realtime' : 'Standard'}
          </div>
          <div className="text-[10px] text-[var(--muted-dim)]">
            {threads.length || 0} {voiceMode ? 'realtime' : 'standard'}
          </div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]"
          title="Hide thread sidebar"
          aria-label="Hide thread sidebar"
        >
          <IconSidebarCollapse className={`h-3.5 w-3.5 ${dockSide === 'right' ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <div className="flex-shrink-0 border-b border-[var(--border-subtle)] p-2">
        <button
          type="button"
          onClick={onCreateThread}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] hover:bg-[rgba(167,139,250,.16)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          <IconPlus className="h-3.5 w-3.5" />
          {voiceMode ? 'New Realtime Thread' : 'New Standard Thread'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {threads.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-[var(--muted-dim)]">
            {voiceMode ? 'No realtime threads yet.' : 'No standard threads yet.'}
          </div>
        ) : (
          <div className="space-y-1">
            {threads.map((thread) => {
              const active = thread.id === activeThreadId;
              const messageCount = thread.messageCount ?? thread.messages.length;
              return (
                <div
                  key={thread.id}
                  className={`group relative rounded border transition-colors ${
                    active
                      ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)]'
                      : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectThread(thread)}
                    className="min-h-[50px] w-full min-w-0 px-2 py-2 text-left"
                    aria-current={active ? 'true' : undefined}
                    title={thread.title || 'Untitled thread'}
                  >
                    <div
                      className={`truncate text-[12px] font-semibold ${active ? 'text-[var(--fg)]' : 'text-[var(--fg-secondary)]'}`}
                    >
                      {thread.title || 'Untitled thread'}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[10px] text-[var(--muted-dim)]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">
                          {assistantThreadStatusLabel(thread.status, 'idle')}
                        </span>
                        {messageCount > 0 ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{messageCount}</span>
                          </>
                        ) : null}
                      </span>
                      <span
                        className="flex-shrink-0 tabular-nums transition-opacity group-hover:opacity-0"
                      >
                        {formatUpdatedAt(thread.updatedAt)}
                      </span>
                    </div>
                  </button>
                  {renamingThreadId === thread.id ? (
                    <form
                      className="absolute inset-x-1.5 top-1.5 z-10"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void commitRename(thread);
                      }}
                    >
                      <input
                        ref={renameInputRef}
                        value={renameDraft}
                        maxLength={80}
                        disabled={renameSaving}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                        onBlur={() => void commitRename(thread)}
                        className="h-7 w-full rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-2 text-[11px] font-semibold text-[var(--fg)] outline-none focus:bg-[var(--panel)]"
                        aria-label={`Rename ${thread.title || 'thread'}`}
                      />
                    </form>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => beginRename(thread)}
                    className="absolute bottom-1 right-7 flex h-6 w-6 items-center justify-center rounded bg-[var(--panel-alt)] text-[var(--muted-dim)] opacity-0 hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] group-hover:opacity-100 focus:opacity-100"
                    title={`Rename ${thread.title || 'thread'}`}
                    aria-label={`Rename ${thread.title || 'thread'}`}
                  >
                    <IconPencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteThread(thread)}
                    className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded bg-[var(--panel-alt)] text-[var(--muted-dim)] opacity-0 hover:bg-[rgba(255,90,90,.1)] hover:text-[var(--red)] group-hover:opacity-100 focus:opacity-100"
                    title={`Delete ${thread.title || 'thread'}`}
                    aria-label={`Delete ${thread.title || 'thread'}`}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 space-y-2 border-t border-[var(--border)] p-2">
        <div className="flex flex-col items-center gap-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleDesktopVoice}
              aria-pressed={desktopVoiceActive && desktopVoiceStatus.mode !== 'sleeping'}
              aria-label="Toggle desktop assistant voice awake or sleep"
              title={desktopVoiceMainTitle}
              className={`relative flex h-16 w-16 items-center justify-center rounded-full border transition-all duration-200 ${
                desktopVoiceStatus.mode === 'error'
                  ? 'border-[rgba(255,90,90,.5)] bg-[rgba(255,90,90,.1)] text-[var(--red)]'
                  : desktopVoiceStatus.mode === 'sleeping'
                    ? 'border-[rgba(148,163,184,.45)] bg-[rgba(148,163,184,.08)] text-[var(--muted)]'
                    : desktopVoiceActive
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_0_24px_rgba(45,212,191,.22)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.035)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)]'
              }`}
            >
              {desktopVoiceBusy ? (
                <span
                  className="absolute inset-0 rounded-full bg-[var(--accent)] opacity-20 animate-ping"
                  aria-hidden="true"
                />
              ) : null}
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="relative h-7 w-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
                <path d="M8 21h8" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onStartDesktopVoiceRecording}
              disabled={desktopVoiceBusy}
              aria-label="Start assistant recording now"
              title={
                desktopVoiceBusy
                  ? 'Assistant voice is already recording'
                  : 'Start assistant recording now'
              }
              className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                desktopVoiceStatus.mode === 'recording'
                  ? 'border-[var(--accent-muted)] bg-[rgba(45,212,191,.12)] text-[var(--accent)]'
                  : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)]'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-[18px] w-[18px]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
                <path d="M8 21h8" />
                <path d="M19 5v4" />
                <path d="M17 7h4" />
              </svg>
            </button>
            {desktopVoiceRealtimeAvailable ? (
              <button
                type="button"
                onClick={dispatchAssistantDesktopVoiceRealtimeToggle}
                aria-pressed={desktopVoiceRealtimeEnabled}
                aria-label={
                  desktopVoiceRealtimeEnabled
                    ? 'Turn off realtime assistant voice'
                    : 'Turn on realtime assistant voice'
                }
                title={
                  desktopVoiceRealtimeEnabled
                    ? 'Realtime assistant voice is on'
                    : 'Realtime assistant voice is off'
                }
                className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                  desktopVoiceRealtimeEnabled
                    ? 'border-[var(--accent-muted)] bg-[rgba(45,212,191,.12)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)]'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-[18px] w-[18px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 12a8 8 0 0 1 8-8" />
                  <path d="M4 12a8 8 0 0 0 8 8" />
                  <path d="M20 12a8 8 0 0 0-8-8" />
                  <path d="M20 12a8 8 0 0 1-8 8" />
                  <path d="M8 12h8" />
                </svg>
              </button>
            ) : null}
          </div>
          <div
            className="max-w-full truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            {desktopVoiceRealtimeEnabled ? `${desktopVoiceLabel} / RT` : desktopVoiceLabel}
          </div>
          {desktopVoiceActive ? (
            <button
              type="button"
              onClick={onStopDesktopVoice}
              aria-label="Turn off desktop assistant voice"
              title="Turn off desktop assistant voice"
              className="flex h-8 w-[88px] items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)] transition-colors hover:border-[rgba(248,113,113,.35)] hover:bg-[rgba(248,113,113,.08)] hover:text-[var(--red)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Off
            </button>
          ) : null}
          {desktopVoiceHeardText ? (
            <div
              className="w-full truncate rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-2 py-1 text-center text-[10px] text-[var(--muted-dim)]"
              title={desktopVoiceHeardText}
            >
              {desktopVoiceStatus.recognizer?.textFinal ? 'Heard' : 'Hearing'}:{' '}
              {desktopVoiceHeardText}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onModeChange(voiceMode ? 'normal' : 'voice')}
          aria-pressed={voiceMode}
          title={voiceMode ? 'Show standard assistant threads' : 'Show realtime assistant threads'}
          className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded border px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
            voiceMode
              ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
              : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <path d="M12 19v3" />
          </svg>
          {voiceMode ? 'Realtime Mode' : 'Realtime'}
        </button>
        {voiceMode ? (
          <button
            type="button"
            onClick={onOpenPairing}
            title="Open Android pairing QR code"
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 3h7v7H3z" />
              <path d="M14 3h7v7h-7z" />
              <path d="M3 14h7v7H3z" />
              <path d="M14 14h3v3h-3z" />
              <path d="M19 14h2v7h-5" />
              <path d="M14 19h2" />
            </svg>
            Pair Android
          </button>
        ) : null}
      </div>
      </aside>
    </>
  );
}
