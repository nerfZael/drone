import React from 'react';

import { IconChatThread, IconPlus, IconSidebarCollapse, IconTrash } from '../app/icons';
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
  assistantThreadStatusTone,
  formatUpdatedAt,
} from './assistant-formatters';
import type { AssistantPanelMode, AssistantThread } from './assistant-types';

export function AssistantThreadSidebar({
  threads,
  activeThreadId,
  mode,
  onCreateThread,
  onSelectThread,
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
  mode: AssistantPanelMode;
  onCreateThread: () => void;
  onSelectThread: (thread: AssistantThread) => void;
  onDeleteThread: (thread: AssistantThread) => void;
  onModeChange: (mode: AssistantPanelMode) => void;
  onOpenPairing: () => void;
  desktopVoiceStatus: DesktopAssistantVoiceStatus;
  onToggleDesktopVoice: () => void;
  onStartDesktopVoiceRecording: () => void;
  onStopDesktopVoice: () => void;
  onCollapse: () => void;
}) {
  const voiceMode = mode === 'voice';
  const desktopVoiceActive = isDesktopAssistantVoiceActive(desktopVoiceStatus);
  const desktopVoiceBusy = isDesktopAssistantVoiceBusy(desktopVoiceStatus);
  const desktopVoiceHeardText = desktopAssistantVoiceHeardText(desktopVoiceStatus);
  const desktopVoiceLabel = desktopAssistantVoiceControlLabel(desktopVoiceStatus);
  const desktopVoiceMainTitle = desktopAssistantVoiceControlTitle(desktopVoiceStatus);
  const desktopVoiceRealtimeAvailable = desktopVoiceStatus.realtime?.available === true;
  const desktopVoiceRealtimeEnabled = desktopVoiceStatus.realtime?.enabled === true;
  return (
    <aside className="flex w-52 max-w-[46%] min-w-0 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[rgba(0,0,0,.14)]">
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-[var(--border)] px-2">
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
          <IconSidebarCollapse className="h-3.5 w-3.5" />
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
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                      : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectThread(thread)}
                    className="min-h-[58px] w-full min-w-0 px-2 py-1.5 pr-8 text-left"
                    aria-current={active ? 'true' : undefined}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${assistantThreadStatusTone(thread.status)}`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[12px] font-semibold ${active ? 'text-[var(--fg)]' : 'text-[var(--fg-secondary)]'}`}
                      >
                        {thread.title || 'Untitled thread'}
                      </span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--muted-dim)]">
                      <span className="truncate">
                        {assistantThreadStatusLabel(thread.status, 'idle')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatUpdatedAt(thread.updatedAt)}</span>
                      {messageCount > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{messageCount}</span>
                        </>
                      ) : null}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteThread(thread)}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded text-[var(--muted-dim)] opacity-0 hover:bg-[rgba(255,90,90,.1)] hover:text-[var(--red)] group-hover:opacity-100 focus:opacity-100"
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
              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_0_18px_rgba(167,139,250,.16)]'
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
  );
}
