import React from 'react';
import { useCompanion } from './CompanionContext';

export function CompanionLivePanel() {
  const companion = useCompanion();
  const live = companion?.live;
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);
  if (!live || (!live.enabled && !live.settingsError && !live.captions)) return null;
  const active = live.status === 'connecting' || live.status === 'listening';
  const button = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--panel-hover)] disabled:opacity-40';
  return (
    <div className="border-b border-[var(--border-subtle)] pb-1 text-xs">
      {live.settingsError ? <div role="alert" className="p-2 text-[var(--red)]">
        {live.settingsError} <button className={button} onClick={() => void live.load()}>Retry voice setting</button>
      </div> : null}
      {active ? <>
        <button className={button} aria-pressed={live.muted} onClick={live.toggleMute}>
          {live.muted ? 'Unmute microphone' : 'Mute microphone'}
        </button>
        <button className={button} onClick={live.stop}>End voice</button>
      </> : null}
      {live.playbackBlocked ? <button className={button} onClick={live.play}>Play voice audio</button> : null}
      {live.error ? <p role="alert" className="p-2 text-[var(--red)]">{live.error}</p> : null}
      <button type="button" className={button} aria-expanded={transcriptOpen} aria-controls="companion-voice-transcript"
        onClick={() => setTranscriptOpen((value) => !value)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />
        </svg>
        Voice transcript
      </button>
      {transcriptOpen ? <div id="companion-voice-transcript" className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[var(--fg-secondary)]" aria-label="Live voice captions">
        {live.captions || 'No voice transcript yet.'}
      </div> : null}
    </div>
  );
}
