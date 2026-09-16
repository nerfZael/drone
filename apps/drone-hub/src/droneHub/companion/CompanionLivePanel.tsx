import React from 'react';
import { useCompanion } from './CompanionContext';
import { CompanionMenuItem } from './CompanionOptionsMenu';

const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export function CompanionLivePanel() {
  const companion = useCompanion();
  const live = companion?.live;
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);
  if (!live || (!live.enabled && !live.settingsError && !live.captions)) return null;
  const active = live.status === 'connecting' || live.status === 'listening';
  return (
    <>
      {live.settingsError ? <div role="alert" className="px-2.5 py-1.5 text-xs text-[var(--red)]">
        {live.settingsError}{' '}
        <button type="button" className="underline" onClick={() => void live.load()}>Retry</button>
      </div> : null}
      {active ? <>
        <CompanionMenuItem
          icon={<svg {...iconProps}><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M19 11a7 7 0 0 1-14 0M12 18v3" /></svg>}
          label="Microphone"
          description={live.announcing ? 'Muted while announcing a subscription update' : live.muted ? 'Unmute microphone' : 'Mute microphone'}
          meta={live.muted ? 'Muted' : 'Live'}
          checked={!live.muted}
          onSelect={live.toggleMute}
          disabled={live.announcing}
        />
        {live.announcing ? <p className="px-2.5 py-1.5 text-xs text-[var(--fg-secondary)]">Announcing a subscription update. Voice will stop automatically.</p> : null}
        <CompanionMenuItem
          icon={<svg {...iconProps} fill="currentColor" stroke="none"><rect x="7" y="7" width="10" height="10" rx="1" /></svg>}
          label="End voice"
          onSelect={live.stop}
        />
      </> : null}
      {live.playbackBlocked ? (
        <CompanionMenuItem icon={<svg {...iconProps}><path d="M8 5v14l11-7Z" /></svg>} label="Play voice audio" onSelect={live.play} />
      ) : null}
      {live.error ? <p role="alert" className="px-2.5 py-1.5 text-xs text-[var(--red)]">{live.error}</p> : null}
      <CompanionMenuItem
        icon={<svg {...iconProps}><path d="M4 5h16M4 10h16M4 15h10M4 20h7" /></svg>}
        label="Voice transcript"
        expanded={transcriptOpen}
        controls="companion-voice-transcript"
        onSelect={() => setTranscriptOpen((value) => !value)}
      />
      {transcriptOpen ? <div id="companion-voice-transcript" className="dh-agent-activity-scrollbar mx-1 mb-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-[5px] bg-[var(--surface-inset-faint)] px-2.5 py-2 text-xs text-[var(--fg-secondary)]" aria-label="Live voice captions">
        {live.captions || 'No voice transcript yet.'}
      </div> : null}
    </>
  );
}
