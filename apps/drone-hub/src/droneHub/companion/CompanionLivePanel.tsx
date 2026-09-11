import React from 'react';
import { companionToolActivityLabel } from '@drone/assistant-chat';
import { useCompanion } from './CompanionContext';

export function CompanionLivePanel() {
  const companion = useCompanion();
  const live = companion?.live;
  if (!live || (!live.enabled && !live.settingsError)) return null;
  const active = live.status === 'connecting' || live.status === 'listening';
  const runningTools = companion.activity.filter((item) => item.status === 'running');
  const button = 'rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--panel-hover)] disabled:opacity-40';
  return (
    <div className="space-y-2 border-b border-[var(--border-subtle)] px-3.5 py-2 text-xs">
      {live.settingsError ? <div role="alert" className="text-[var(--red)]">
        {live.settingsError} <button className={button} onClick={() => void live.load()}>Retry setting</button>
      </div> : null}
      {live.enabled ? <>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-[var(--fg-secondary)]">
            {live.status === 'connecting' ? 'Connecting Live voice…'
              : live.status === 'listening' ? live.muted ? 'Live voice · microphone muted' : 'Live voice · listening'
                : live.status === 'error' ? 'Live voice unavailable' : 'Live voice ready'}
          </span>
          <button className={button} disabled={live.loading || live.saving || (!active && ['starting', 'recording', 'transcribing'].includes(companion.status))}
            onClick={() => active ? live.stop() : void companion.toggle()}>
            {active ? 'End voice' : 'Start voice'}
          </button>
          {live.status === 'listening' ? <button className={button} aria-pressed={live.muted} onClick={live.toggleMute}>
            {live.muted ? 'Unmute mic' : 'Mute mic'}
          </button> : null}
          {live.playbackBlocked ? <button className={button} onClick={live.play}>Play voice audio</button> : null}
        </div>
        <p className="text-[var(--muted)]">
          {live.backendModel ? `Backend at voice start: ${live.backendModel}. ` : 'Uses the backend model in Companion settings. '}
          {active ? 'End voice keeps an active backend task running; unsent voice follow-ups are discarded.' : 'Press Start voice or the Companion microphone shortcut.'}
        </p>
        {active ? <p className="text-[var(--muted-dim)]">Microphone and speaker stay connected. Voice time, including silence, is billed separately.</p> : null}
        {active ? <p className="break-words text-[var(--muted-dim)]">Target: {live.workspaceLabel}. Start a new voice conversation to capture a different workspace. Sending typed text ends voice.</p> : null}
        {live.queued > 0 ? <p role="status">{live.queued} voice {live.queued === 1 ? 'request waiting' : 'requests waiting'} for the backend. Corrections may wait for the current task.</p> : null}
        {companion.status === 'working' ? <p role="status" className="text-[var(--accent)]">
          Backend: {runningTools.length ? runningTools.map(companionToolActivityLabel).join(' · ') : 'Working…'}
          {' '}Expand tool calls above for details.
        </p> : null}
        {live.error ? <p role="alert" className="text-[var(--red)]">{live.error}</p> : null}
        {live.captions ? <details open>
          <summary className="cursor-pointer text-[var(--muted)]">Voice conversation</summary>
          <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[var(--fg-secondary)]" aria-label="Live voice captions">
            {live.captions}
          </div>
        </details> : null}
      </> : null}
    </div>
  );
}
