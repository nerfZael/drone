import React from 'react';

import {
  desktopAssistantVoiceControlLabel,
  desktopAssistantVoiceControlTitle,
  dispatchAssistantDesktopVoiceOff,
  dispatchAssistantDesktopVoiceRealtimeToggle,
  dispatchAssistantDesktopVoiceToggle,
  isDesktopAssistantVoiceActive,
  isDesktopAssistantVoiceBusy,
  subscribeAssistantDesktopVoiceStatus,
  type DesktopAssistantVoiceStatus,
} from './desktop-assistant-voice';

const DEFAULT_STATUS: DesktopAssistantVoiceStatus = {
  mode: 'off',
  message: 'Desktop voice is off.',
};

export function DesktopVoiceFloatingIndicator() {
  const [status, setStatus] = React.useState<DesktopAssistantVoiceStatus>(DEFAULT_STATUS);

  React.useEffect(() => subscribeAssistantDesktopVoiceStatus(setStatus), []);

  const clipboardBusy = status.clipboard?.mode === 'recording' || status.clipboard?.mode === 'transcribing';
  if ((status.mode === 'off' && !status.realtime?.available) || status.suspended?.active || clipboardBusy) return null;

  const active = isDesktopAssistantVoiceActive(status);
  const sleeping = status.mode === 'sleeping';
  const busy = isDesktopAssistantVoiceBusy(status);
  const awake = active && !sleeping;
  const realtimeAvailable = status.realtime?.available === true;
  const realtimeEnabled = status.realtime?.enabled === true;
  const controlTitle = desktopAssistantVoiceControlTitle(status);
  const controlLabel = desktopAssistantVoiceControlLabel(status);

  return (
    <div
      className="flex flex-col items-center gap-1"
      title={status.message || controlTitle}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={dispatchAssistantDesktopVoiceToggle}
          aria-pressed={active && status.mode !== 'sleeping'}
          aria-label="Toggle desktop assistant voice awake or sleep"
          title={controlTitle}
          className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-300 ${
            status.mode === 'error'
              ? 'border-[rgba(255,90,90,.5)] bg-[rgba(255,90,90,.1)] text-[var(--red)] hover:bg-[rgba(255,90,90,.14)]'
              : sleeping || status.mode === 'off'
                ? 'border-[rgba(148,163,184,.42)] bg-[rgba(148,163,184,.08)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)]'
                : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_0_22px_rgba(45,212,191,.34)] hover:bg-[rgba(45,212,191,.14)]'
          }`}
        >
          {awake ? (
            <span
              className={`absolute inset-0 rounded-full bg-[var(--accent)] opacity-25 ${busy ? 'animate-ping' : 'animate-pulse'}`}
              aria-hidden="true"
            />
          ) : null}
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="relative h-[18px] w-[18px]"
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
        {realtimeAvailable ? (
          <button
            type="button"
            onClick={dispatchAssistantDesktopVoiceRealtimeToggle}
            aria-pressed={realtimeEnabled}
            aria-label={realtimeEnabled ? 'Turn off realtime assistant voice' : 'Turn on realtime assistant voice'}
            title={realtimeEnabled ? 'Realtime assistant voice is on' : 'Realtime assistant voice is off'}
            className={`relative flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
              realtimeEnabled
                ? 'border-[var(--accent-muted)] bg-[rgba(45,212,191,.12)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(0,0,0,.28)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)]'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
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
        className="max-w-[96px] truncate rounded-full border border-[var(--border-subtle)] bg-[rgba(0,0,0,.28)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] backdrop-blur-sm"
        style={{ fontFamily: 'var(--display)' }}
      >
        {realtimeEnabled ? `${controlLabel} / RT` : controlLabel}
      </div>
      {active ? (
        <button
          type="button"
          onClick={dispatchAssistantDesktopVoiceOff}
          aria-label="Turn off desktop assistant voice"
          title="Turn off desktop assistant voice"
          className="flex h-7 w-[64px] items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.28)] text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)] backdrop-blur-sm transition-colors hover:border-[rgba(248,113,113,.35)] hover:bg-[rgba(248,113,113,.08)] hover:text-[var(--red)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          Off
        </button>
      ) : null}
    </div>
  );
}
