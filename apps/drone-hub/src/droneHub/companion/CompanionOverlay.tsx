import React from 'react';
import {
  companionToolActivityLabel,
  groupCompanionToolActivity,
  type CompanionStatus,
} from '@drone/assistant-chat';
import { AgentRunSummaryLine } from '../chat/WorkingElapsedStatus';
import { ChatMessageBody } from '../chat/ChatMessageBody';
import { formatChatVoiceDuration } from '../chat/use-chat-voice-recorder';
import { useCompanion } from './CompanionContext';
import { CompanionProposalCard } from './CompanionProposalCard';
import { useCompanionWorkspace } from './CompanionWorkspaceContext';

function Chevron({ open }: { open: boolean }) {
  return <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>›</span>;
}

function companionStatusLabel(status: CompanionStatus, recordingPaused: boolean): string {
  if (recordingPaused) return 'Listening paused';
  if (status === 'starting') return 'Starting microphone';
  if (status === 'recording') return 'Listening';
  if (status === 'transcribing') return 'Transcribing';
  if (status === 'working') return 'Working';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Stopped';
  if (status === 'error') return 'Needs attention';
  return 'Idle';
}

function CompanionStatusIndicator({
  status,
  recordingPaused,
}: {
  status: CompanionStatus;
  recordingPaused: boolean;
}) {
  const label = companionStatusLabel(status, recordingPaused);
  const tone = recordingPaused
    ? 'bg-[var(--yellow)]'
    : status === 'recording' || status === 'error'
      ? 'bg-[var(--red)]'
      : status === 'completed'
        ? 'bg-[var(--green)]'
        : status === 'cancelled'
          ? 'bg-[var(--muted-dim)]'
          : 'bg-[var(--accent)]';
  const active = !recordingPaused && ['starting', 'recording', 'transcribing', 'working'].includes(status);
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${tone} ${active ? 'animate-pulse' : ''}`}
      title={label}
      aria-label={`Companion status: ${label}`}
      role="status"
    />
  );
}

function CompanionHeaderButton({
  label,
  tone = 'neutral',
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  const classes = tone === 'danger'
    ? 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]'
    : tone === 'success'
      ? 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]'
      : tone === 'accent'
        ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
        : 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40 ${classes}`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function CompanionOverlay() {
  const companion = useCompanion();
  const workspace = useCompanionWorkspace();
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
  const activityGroups = groupCompanionToolActivity(companion.activity);
  return (
    <div className="fixed bottom-4 right-4 z-[80] flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] flex-col items-end gap-3 min-[860px]:w-auto min-[860px]:flex-row">
      {companion.proposal ? (
        <CompanionProposalCard
          proposal={companion.proposal}
          defaultRepoPath={companion.proposalDefaultRepoPath ?? ''}
          execution={companion.proposalExecution}
          executionProgress={companion.proposalExecutionProgress}
          executing={companion.proposalExecuting}
          companionStatus={companion.status}
          droneNames={companion.proposalDroneNames}
          resolveDroneName={(droneId) => workspace?.resolveDroneName(droneId) ?? null}
          onExecute={() => void companion.executeProposal()}
          onDiscard={companion.discardProposal}
        />
      ) : null}
      <aside
        className="flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] shadow-2xl min-[860px]:w-[28rem]"
        aria-label="Companion"
      >
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <CompanionStatusIndicator
            status={companion.status}
            recordingPaused={companion.recordingPaused}
          />
          <div className="truncate text-sm font-[var(--weight-semibold)] text-[var(--fg)]">
            Companion
          </div>
          {companion.status === 'recording' ? (
            <span
              className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--muted)]"
              aria-label={`${formatChatVoiceDuration(companion.durationMillis)} elapsed`}
            >
              {formatChatVoiceDuration(companion.durationMillis)}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {companion.status === 'recording' ? (
            <>
              <CompanionHeaderButton
                label="Discard recording"
                tone="danger"
                onClick={() => void companion.discardRecording()}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </CompanionHeaderButton>
              <CompanionHeaderButton
                label={companion.recordingPaused ? 'Resume recording' : 'Pause recording'}
                tone={companion.recordingPaused ? 'accent' : 'neutral'}
                onClick={companion.toggleRecordingPause}
              >
                {companion.recordingPaused ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                    <path d="M8 5v14l11-7Z" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M9 5v14" />
                    <path d="M15 5v14" />
                  </svg>
                )}
              </CompanionHeaderButton>
              <CompanionHeaderButton
                label="Finish recording and send"
                tone="success"
                onClick={() => void companion.toggle()}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="1" />
                </svg>
              </CompanionHeaderButton>
            </>
          ) : null}
          {companion.status === 'starting' || companion.status === 'transcribing' ? (
            <CompanionHeaderButton
              label="Discard recording"
              tone="danger"
              onClick={() => void companion.discardRecording()}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </CompanionHeaderButton>
          ) : null}
          {companion.status === 'working' ? (
            <CompanionHeaderButton label="Stop Companion turn" tone="danger" onClick={companion.stop}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="1" />
              </svg>
            </CompanionHeaderButton>
          ) : null}
          <button
            type="button"
            onClick={() => void companion.close()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-lg text-[var(--muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            aria-label="Close Companion"
            title="Close Companion"
          >
            ×
          </button>
        </div>
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
                {activityGroups.map((group) => (
                  <React.Fragment key={group.key}>
                    {group.parallel ? (
                      <div
                        className="flex items-center gap-2 py-1 text-[9px] uppercase tracking-wider text-[var(--muted-dim)]"
                        aria-label={`${group.items.length} tool calls ran in parallel`}
                      >
                        <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                        <span>Parallel · {group.items.length}</span>
                        <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                      </div>
                    ) : null}
                    {group.items.map((item) => (
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
                              : 'Completed'}{' '}
                          · {companionToolActivityLabel(item)}
                        </summary>
                        <div className="mt-1 space-y-2 text-[10px] text-[var(--muted-dim)]">
                          {item.args !== undefined ? (
                            <div>
                              <div className="font-[var(--weight-semibold)] uppercase tracking-wide">Arguments</div>
                              <pre className="overflow-auto whitespace-pre-wrap break-words">
                                {JSON.stringify(item.args, null, 2)}
                              </pre>
                            </div>
                          ) : null}
                          {item.error !== undefined ? (
                            <div>
                              <div className="font-[var(--weight-semibold)] uppercase tracking-wide">Error</div>
                              <pre className="overflow-auto whitespace-pre-wrap break-words">
                                {JSON.stringify(item.error, null, 2)}
                              </pre>
                            </div>
                          ) : item.result !== undefined ? (
                            <div>
                              <div className="font-[var(--weight-semibold)] uppercase tracking-wide">Result</div>
                              <pre className="overflow-auto whitespace-pre-wrap break-words">
                                {JSON.stringify(item.result, null, 2)}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ))}
                  </React.Fragment>
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
    </div>
  );
}
