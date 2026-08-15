import React from 'react';
import { AgentRunSummaryLine } from '../chat/WorkingElapsedStatus';
import { ChatMessageBody } from '../chat/ChatMessageBody';
import { formatChatVoiceDuration } from '../chat/use-chat-voice-recorder';
import { useCompanion } from './CompanionContext';

function Chevron({ open }: { open: boolean }) {
  return <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>›</span>;
}

export function CompanionOverlay() {
  const companion = useCompanion();
  const [expanded, setExpanded] = React.useState(true);
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (companion?.status !== 'working') return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [companion?.status]);
  if (!companion || companion.status === 'idle') return null;
  const active = companion.status === 'working';
  const duration = companion.startedAt
    ? Math.max(0, (companion.endedAt ?? Date.now()) - companion.startedAt)
    : 0;
  return (
    <aside
      className="fixed bottom-4 right-4 z-[80] flex max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] shadow-2xl"
      aria-label="Companion"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-[var(--weight-semibold)] text-[var(--fg)]">Companion</div>
          <div className="truncate text-xs text-[var(--muted)]">
            {companion.status === 'starting' ? 'Starting microphone…' : null}
            {companion.status === 'recording'
              ? `Listening · ${formatChatVoiceDuration(companion.durationMillis)}`
              : null}
            {companion.status === 'transcribing' ? 'Transcribing…' : null}
            {companion.status === 'working' ? 'Working…' : null}
            {companion.status === 'completed' ? 'Completed' : null}
            {companion.status === 'cancelled' ? 'Cancelled' : null}
            {companion.status === 'error' ? 'Needs attention' : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void companion.close()}
          className="rounded px-2 py-1 text-lg text-[var(--muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)]"
          aria-label="Close Companion"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {companion.transcript ? (
          <div className="border-b border-[var(--border-subtle)] px-4 py-2 text-xs text-[var(--muted)]">
            “{companion.transcript}”
          </div>
        ) : null}
        {active || companion.activity.length > 0 ? (
          <div className="px-1">
            <AgentRunSummaryLine
              active={active}
              durationMs={duration}
              detail={
                companion.activity.length
                  ? `${companion.activity.length} tool ${companion.activity.length === 1 ? 'call' : 'calls'}`
                  : undefined
              }
              expanded={expanded}
              onToggle={() => setExpanded((value) => !value)}
              trailing={<Chevron open={expanded} />}
            />
            {expanded && companion.activity.length ? (
              <div className="dh-agent-activity-scrollbar max-h-52 overflow-y-auto border-l border-[var(--border-subtle)] px-3 py-2">
                {companion.activity.map((item) => (
                  <details
                    key={item.callId}
                    className="py-1 text-xs"
                    open={item.status === 'running'}
                  >
                    <summary className="cursor-pointer text-[var(--fg-secondary)]">
                      {item.status === 'running'
                        ? 'Running'
                        : item.status === 'failed'
                          ? 'Failed'
                          : 'Used'}{' '}
                      {item.tool}
                    </summary>
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words text-[10px] text-[var(--muted-dim)]">
                      {JSON.stringify(item.error ?? item.result ?? item.args, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {companion.error ? (
          <div className="m-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-xs text-[var(--red)]">
            {companion.error}
          </div>
        ) : null}
        {companion.reply ? (
          <div className="px-4 py-3">
            <ChatMessageBody role="assistant" text={companion.reply} autoExpand />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
