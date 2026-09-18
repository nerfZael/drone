import React from 'react';
import { UiDialog } from '../../ui/components/Dialog';
import { CompanionJevRequests } from './CompanionJevRequests';
import type { JevDebugEntry } from './jev-debug';
import type { ReflexTable } from '@drone/reflex';
import type { CompanionReflexInsight } from '@drone/assistant-chat';
import { CompanionAgentInsight } from './CompanionAgentInsight';

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

export function CompanionTranscriptDialog({ captions, requests, table, insight, status, onResetTable, onClose, portalContainer }: {
  captions: string;
  requests?: JevDebugEntry[];
  table?: ReflexTable | null;
  insight?: CompanionReflexInsight | null;
  status?: string;
  onResetTable?(): void;
  onClose(): void;
  portalContainer?: HTMLElement;
}) {
  const scroll = React.useRef<HTMLDivElement>(null);
  const follow = React.useRef(true);
  const [tab, setTab] = React.useState<'transcript' | 'agent' | 'requests'>('transcript');
  React.useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [captions]);
  return <UiDialog open onClose={onClose} title="Live voice transcript" size="large" hideHeader
    portalContainer={portalContainer} bodyClassName="min-h-0 !p-0">
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-1.5">
      {requests ? <div role="tablist" aria-label="Transcript views" className="flex gap-2">
        {(['transcript', 'agent', 'requests'] as const).map(value => <button key={value} id={`jev-${value}-tab`} type="button" role="tab" aria-selected={tab === value} aria-controls={`jev-${value}-panel`} onClick={() => setTab(value)} className="rounded px-3 py-1 text-sm aria-selected:bg-[var(--accent-subtle)]">{value === 'transcript' ? 'Transcript' : value === 'agent' ? 'Agent' : 'Decisions'}</button>)}
      </div> : <span className="text-sm text-[var(--muted)]">Live voice transcript</span>}
      <button type="button" aria-label="Close dialog" onClick={onClose} className="ml-auto rounded px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--hover)]">✕</button>
    </div>
    <div hidden={tab !== 'transcript'} id="jev-transcript-panel" role="tabpanel" aria-labelledby={requests ? 'jev-transcript-tab' : undefined}>
    <div ref={scroll} aria-label="Live voice transcript" tabIndex={0}
      onScroll={event => {
        const element = event.currentTarget;
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      }}
      className="dh-agent-activity-scrollbar h-[70vh] max-h-[calc(100dvh-8rem)] overflow-y-auto whitespace-pre-wrap break-words px-5 py-3 text-sm leading-7 text-[var(--fg-secondary)]">
      {captions || 'No voice transcript yet.'}
    </div>
    </div>
    {requests ? <div hidden={tab !== 'agent'} id="jev-agent-panel" role="tabpanel" aria-labelledby="jev-agent-tab" className="h-[70vh] max-h-[calc(100dvh-8rem)] overflow-y-auto"><CompanionAgentInsight insight={insight ?? null} status={status ?? 'idle'} onResetTable={onResetTable} /></div> : null}
    {requests ? <div hidden={tab !== 'requests'} id="jev-requests-panel" role="tabpanel" aria-labelledby="jev-requests-tab" className="h-[70vh] max-h-[calc(100dvh-8rem)] overflow-y-auto"><CompanionJevRequests requests={requests} table={table} /></div> : null}
  </UiDialog>;
}
