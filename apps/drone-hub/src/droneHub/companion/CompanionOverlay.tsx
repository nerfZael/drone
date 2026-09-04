import React from 'react';
import {
  companionToolActivityLabel,
  groupCompanionToolActivity,
  type CompanionStatus,
} from '@drone/assistant-chat';
import { formatWorkingDuration } from '../chat/WorkingElapsedStatus';
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
  const [expanded, setExpanded] = React.useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = React.useState(false);
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (companion?.status !== 'working') return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [companion?.status]);
  React.useEffect(() => {
    if (companion?.status === 'idle') {
      setExpanded(false);
      setTranscriptExpanded(false);
    }
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
          resolveCreationDefaults={(repoPath) => {
            try {
              return workspace?.resolveDroneCreationDefaults(repoPath) ?? null;
            } catch {
              return null;
            }
          }}
          onExecute={() => void companion.executeProposal()}
          onDiscard={companion.discardProposal}
        />
      ) : null}
      <aside
        className="flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] shadow-2xl min-[860px]:w-[28rem]"
        aria-label="Companion"
      >
      {/* Header doubles as the user's message once a transcript exists. */}
      <div className="flex shrink-0 items-start gap-2.5 border-b border-[var(--border-subtle)] py-2 pl-3.5 pr-2">
        <div className="flex h-7 shrink-0 items-center">
          <CompanionStatusIndicator
            status={companion.status}
            recordingPaused={companion.recordingPaused}
          />
        </div>
        <div className="flex min-h-7 min-w-0 flex-1 items-center">
          {companion.transcript ? (
            <button
              type="button"
              onClick={() => setTranscriptExpanded((value) => !value)}
              aria-expanded={transcriptExpanded}
              aria-label={transcriptExpanded ? 'Collapse your message' : 'Expand your message'}
              title={transcriptExpanded ? undefined : companion.transcript}
              className={`w-full whitespace-pre-wrap break-words rounded-sm text-left text-xs leading-relaxed text-[var(--fg-secondary)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                transcriptExpanded ? '' : 'line-clamp-[10]'
              }`}
            >
              {companion.transcript}
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-xs font-[var(--weight-semibold)] text-[var(--fg)]">
              <span className="truncate">
                {companionStatusLabel(companion.status, companion.recordingPaused)}
              </span>
              {companion.status === 'recording' ? (
                <span
                  className="shrink-0 font-mono text-[10px] font-[var(--weight-regular)] tabular-nums text-[var(--muted)]"
                  aria-label={`${formatChatVoiceDuration(companion.durationMillis)} elapsed`}
                >
                  {formatChatVoiceDuration(companion.durationMillis)}
                </span>
              ) : null}
            </div>
          )}
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

      {/* Body: the reply is what the user came for. */}
      {companion.error || companion.reply ? (
        <div className="min-h-0 overflow-y-auto">
          {companion.error ? (
            <div className="mx-3 mt-2.5 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-xs text-[var(--red)]">
              {companion.error}
            </div>
          ) : null}
          {companion.reply ? (
            <div className="px-3.5 py-2.5">
              <ChatMessageBody role="assistant" text={companion.reply} autoExpand />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Footer: run duration and tool calls, secondary but one click away. */}
      {active || companion.activity.length > 0 ? (
        <div className="shrink-0 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} tool calls`}
            onClick={() => setExpanded((value) => !value)}
            disabled={companion.activity.length === 0}
            className="flex h-7 w-full items-center gap-2 px-3.5 text-left text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--fg-secondary)] focus-visible:text-[var(--fg-secondary)] focus-visible:outline-none disabled:cursor-default disabled:hover:text-[var(--muted)]"
          >
            {active ? (
              <svg className="h-3 w-3 shrink-0 animate-spin text-[var(--accent)] motion-reduce:animate-none" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
                <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : null}
            <span className="tabular-nums">
              {active ? 'Working' : 'Worked'} for {formatWorkingDuration(duration)}
            </span>
            {companion.activity.length ? (
              <span className="text-[var(--muted-dim)]">
                · {companion.activity.length} tool {companion.activity.length === 1 ? 'call' : 'calls'}
              </span>
            ) : null}
            {companion.activity.length ? (
              <span className="ml-auto text-[var(--muted-dim)]"><Chevron open={expanded} /></span>
            ) : null}
          </button>
          {expanded && companion.activity.length ? (
            <div className="dh-agent-activity-scrollbar max-h-52 overflow-y-auto border-t border-[var(--border-subtle)] px-3.5 py-1.5">
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
                      className="py-0.5 text-[11px]"
                    >
                      <summary className="flex cursor-pointer items-center gap-1.5 text-[var(--fg-secondary)]">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            item.status === 'running'
                              ? 'animate-pulse bg-[var(--accent)]'
                              : item.status === 'failed'
                                ? 'bg-[var(--red)]'
                                : 'bg-[var(--green)]'
                          }`}
                          aria-label={item.status === 'running' ? 'Running' : item.status === 'failed' ? 'Failed' : 'Completed'}
                          role="img"
                        />
                        <span className="truncate">{companionToolActivityLabel(item)}</span>
                      </summary>
                      <div className="mt-1 space-y-2 pl-3 text-[10px] text-[var(--muted-dim)]">
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
      </aside>
    </div>
  );
}
