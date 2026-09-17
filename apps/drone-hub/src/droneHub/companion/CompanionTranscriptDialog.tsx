import React from 'react';
import { UiDialog } from '../../ui/components/Dialog';
import { CompanionJevRequests } from './CompanionJevRequests';
import type { JevDebugEntry } from './jev-debug';

/** Hand focus to the dialog only after the menu's focus scope has closed. */
export function useCompanionTranscriptDialog() {
  const [open, setOpen] = React.useState(false);
  const pending = React.useRef(false);
  return {
    open,
    requestOpen() { pending.current = true; },
    close() { pending.current = false; setOpen(false); },
    onMenuCloseAutoFocus(event: Event) {
      if (!pending.current) return false;
      pending.current = false;
      event.preventDefault(); // Restoring menu-trigger focus would dismiss the floating dialog.
      setOpen(true);
      return true;
    },
  };
}

export function CompanionTranscriptDialog({ captions, requests, onClose, portalContainer }: {
  captions: string;
  requests?: JevDebugEntry[];
  onClose(): void;
  portalContainer?: HTMLElement;
}) {
  const scroll = React.useRef<HTMLDivElement>(null);
  const follow = React.useRef(true);
  const [tab, setTab] = React.useState<'transcript' | 'requests'>('transcript');
  React.useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [captions]);
  return <UiDialog open onClose={onClose} title="Live voice transcript" size="large"
    description="Updates as you speak. Each send marker records the silence duration Jev saw for that decision."
    portalContainer={portalContainer} bodyClassName="min-h-0 !p-0">
    {requests ? <div role="tablist" aria-label="Transcript views" className="flex gap-3 border-b border-[var(--border)] px-5 py-2">
      {(['transcript', 'requests'] as const).map(value => <button key={value} id={`jev-${value}-tab`} type="button" role="tab" aria-selected={tab === value} aria-controls={`jev-${value}-panel`} onClick={() => setTab(value)} className="rounded px-3 py-1 text-sm aria-selected:bg-[var(--accent-subtle)]">{value === 'transcript' ? 'Transcript' : 'Jev requests'}</button>)}
    </div> : null}
    <div hidden={tab !== 'transcript'} id="jev-transcript-panel" role="tabpanel" aria-labelledby={requests ? 'jev-transcript-tab' : undefined}>
    <div ref={scroll} aria-label="Live voice transcript" tabIndex={0}
      onScroll={event => {
        const element = event.currentTarget;
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      }}
      className="dh-agent-activity-scrollbar h-[60vh] max-h-[calc(100dvh-12rem)] overflow-y-auto whitespace-pre-wrap break-words px-5 py-4 text-sm leading-7 text-[var(--fg-secondary)]">
      {captions || 'No voice transcript yet.'}
    </div>
    </div>
    {requests ? <div hidden={tab !== 'requests'} id="jev-requests-panel" role="tabpanel" aria-labelledby="jev-requests-tab" className="h-[60vh] max-h-[calc(100dvh-15rem)] overflow-y-auto"><CompanionJevRequests requests={requests} /></div> : null}
  </UiDialog>;
}
