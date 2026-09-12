import { CompanionCurrentWorkspaceAccess } from './CompanionCurrentWorkspaceAccess';
import { useRecorderCompanion } from '../dictation/RecorderCompanionContext';
import React from 'react';
import { Popover } from 'radix-ui';
import { contextMenuItemBaseClass } from '../../ui/dropdown';
import { CompanionActionNotifications } from './CompanionActionNotifications';
import {
  companionToolActivityLabel,
  companionCompactionLabel,
  groupCompanionToolActivity,
  type CompanionStatus,
} from '@drone/assistant-chat';
import { formatWorkingDuration } from '../chat/WorkingElapsedStatus';
import { ChatMessageBody } from '../chat/ChatMessageBody';
import { formatChatVoiceDuration } from '../chat/use-chat-voice-recorder';
import { useCompanion } from './CompanionContext';
import { CompanionWorkspacePicker } from './CompanionWorkspacePicker';
import { CompanionPromptEditor } from './CompanionPromptEditor';
import { CompanionInstructionsEditor } from './CompanionInstructionsEditor';
import { CompanionProposalCard } from './CompanionProposalCard';
import { CompanionProposalHistory } from './CompanionProposalHistory';
import { CompanionLivePanel } from './CompanionLivePanel';
import { CompanionSubscriptions } from './CompanionSubscriptions';
import { CompanionModelPicker } from './CompanionModelPicker';
import { useCompanionWorkspace } from './CompanionWorkspaceContext';

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

const CompanionMenuContext = React.createContext<(() => void) | null>(null);

function CompanionHeaderButton({
  label,
  menuLabel,
  tone = 'neutral',
  disabled = false,
  pressed,
  expanded,
  controls,
  onClick,
  children,
}: {
  label: string;
  menuLabel?: string;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  const closeMenu = React.useContext(CompanionMenuContext);
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
      onClick={() => { onClick(); if (pressed === undefined) closeMenu?.(); }}
      disabled={disabled}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      className={closeMenu ? `${contextMenuItemBaseClass} hover:bg-[var(--hover)] ${classes}` : `inline-flex h-7 w-7 items-center justify-center rounded-md border transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40 ${classes}`}
      title={label}
      aria-label={label}
    >
      {children}
      {closeMenu ? <span>{menuLabel ?? label}</span> : null}
    </button>
  );
}

export function CompanionOverlay() {
  const recorder = useRecorderCompanion();
  const recorderHeight = recorder?.height ?? 0;
  const companion = useCompanion();
  const workspace = useCompanionWorkspace();
  const [expanded, setExpanded] = React.useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = React.useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = React.useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = React.useState(false);
  const [instructionsEditorOpen, setInstructionsEditorOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const panelOpen = promptEditorOpen || workspacePickerOpen || instructionsEditorOpen;
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (companion?.status !== 'working') return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [companion?.status]);
  React.useEffect(() => {
    if (companion?.status === 'idle') {
      setExpanded(false);
      setMenuOpen(false);
      setTranscriptExpanded(false);
      setHistoryOpen(false);
    }
  }, [companion?.status]);
  React.useEffect(() => {
    if (companion?.proposalHistory.length === 0) setHistoryOpen(false);
  }, [companion?.proposalHistory.length]);
  if (!companion || (companion.status === 'idle' && !panelOpen)) return null;
  const active = companion.status === 'working';
  const duration = companion.startedAt != null
    ? Math.max(0, (companion.endedAt ?? Date.now()) - companion.startedAt)
    : 0;
  const activityGroups = groupCompanionToolActivity(companion.activity);
  const showProposal = Boolean(
    companion.proposal &&
    (!companion.autoApprove || companion.status === 'error' || companion.status === 'cancelled'),
  );
  const latestProposalExecution = companion.proposalHistory[
    companion.proposalHistory.length - 1
  ]?.execution;
  const latestProposalExecutionFailed = latestProposalExecution?.ok === false;
  return (
    <div data-companion-surface="true" style={recorderHeight > 0 ? {
      zIndex: panelOpen ? 100 : 80,
      bottom: recorderHeight + 32,
      maxHeight: `calc(100dvh - ${recorderHeight + 48}px)`,
      overflowY: 'auto',
    } : { zIndex: panelOpen ? 100 : 80 }} className="fixed bottom-4 right-4 z-[80] flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] flex-col items-end gap-3 min-[860px]:w-auto min-[860px]:flex-row">
      {historyOpen ? (
        <CompanionProposalHistory
          entries={companion.proposalHistory}
          onClose={() => setHistoryOpen(false)}
        />
      ) : showProposal && companion.proposal ? (
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
      <div className={`flex min-h-0 w-full flex-col gap-3 ${panelOpen ? 'min-[860px]:w-[34rem]' : 'min-[860px]:w-fit min-[860px]:max-w-[28rem]'}`}>
      {workspacePickerOpen ? <CompanionWorkspacePicker onClose={() => setWorkspacePickerOpen(false)} /> : null}
      {promptEditorOpen ? <CompanionPromptEditor onClose={() => setPromptEditorOpen(false)} /> : null}
      {instructionsEditorOpen ? <CompanionInstructionsEditor onClose={() => setInstructionsEditorOpen(false)} /> : null}
      {companion.autoApprove && companion.status !== 'idle' && companion.actionNotifications.length > 0 ? (
        <CompanionActionNotifications notifications={companion.actionNotifications} onDismiss={companion.dismissActionNotification} />
      ) : null}
      <aside
        className="flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-raised)] shadow-[var(--edge-highlight),var(--shadow-dialog)] min-[860px]:max-w-[28rem] min-[860px]:self-end"
        aria-label="Companion"
      >
      {/* Header doubles as the user's message once a transcript exists. */}
      <div className="flex shrink-0 items-start gap-2.5 py-1.5 pl-3 pr-1.5">
        <Popover.Root open={expanded} onOpenChange={setExpanded}>
          <Popover.Trigger asChild>
            <button type="button" aria-label={active ? 'Working — show tool activity' : 'Show Companion activity'}
              title={active ? 'Working' : 'Companion activity'}
              className="flex h-7 shrink-0 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
              {active ? <svg className="h-3 w-3 animate-spin text-[var(--accent)] motion-reduce:animate-none" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
                <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg> : <CompanionStatusIndicator status={companion.status} recordingPaused={companion.recordingPaused} />}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="top" align="start" sideOffset={8} aria-label="Companion activity" data-companion-surface="true"
              className="z-[110] w-[min(24rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel-raised)] shadow-[var(--shadow-dialog)]">
              <div className="px-3.5 py-2 text-xs text-[var(--muted)]">
                {active ? 'Working' : 'Worked'} for {formatWorkingDuration(duration)} · {companion.activity.length} tool calls
              </div>
        <div
          id="companion-tool-calls"
          className="dh-agent-activity-scrollbar max-h-52 shrink-0 overflow-y-auto border-b border-[var(--border-subtle)] bg-[var(--surface-inset-faint)] px-3.5 py-1.5"
        >
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
              {companion.activity.length === 0 ? <p className="px-3.5 pb-2 text-xs text-[var(--muted)]">No tool calls yet.</p> : null}
              {companion.compaction ? <p role="status" className="px-3.5 py-2 text-xs text-[var(--muted)]">{companionCompactionLabel(companion.compaction)}</p> : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div className="flex min-h-7 min-w-0 flex-1 items-center">
          {companion.transcript ? (
            <button
              type="button"
              onClick={() => setTranscriptExpanded((value) => !value)}
              aria-expanded={transcriptExpanded}
              aria-label={transcriptExpanded ? 'Collapse your message' : 'Expand your message'}
              title={transcriptExpanded ? undefined : companion.transcript}
              className={`w-full rounded-sm text-left text-xs leading-relaxed text-[var(--fg-secondary)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                transcriptExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'
              }`}
            >
              {companion.transcript}
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-xs font-[var(--weight-semibold)] text-[var(--fg)]">
              <span className="truncate">
                {companionStatusLabel(companion.status, companion.recordingPaused)}
              </span>
              {companion.status === 'recording' && companion.live?.status !== 'listening' ? (
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
        <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <CompanionSubscriptions subscriptions={companion.subscriptions ?? []} />
          <CompanionHeaderButton
            label={`Auto-approve proposals ${companion.autoApprove ? 'on' : 'off'}; double-tap Caps Lock to toggle`}
            tone={companion.autoApprove ? 'success' : 'neutral'}
            pressed={companion.autoApprove}
            onClick={companion.toggleAutoApprove}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m13 2-9 12h7l-1 8 9-12h-7z" />
            </svg>
          </CompanionHeaderButton>
          {companion.live ? <CompanionHeaderButton
            menuLabel={`Live voice ${companion.live.enabled ? 'on' : 'off'}`}
            label={companion.live.loading ? 'Loading Live voice setting' : companion.live.saving ? 'Saving Live voice setting'
              : `Live voice ${companion.live.enabled ? 'on' : 'off'}; remembered across Companion sessions`}
            tone={companion.live.enabled ? 'accent' : 'neutral'}
            pressed={companion.live.enabled}
            disabled={companion.live.loading || companion.live.saving || companion.switchingVoice || ['starting', 'transcribing'].includes(companion.status)}
            onClick={() => void companion.toggleLiveVoice()}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M3 10v4M7 6v12M12 3v18M17 6v12M21 10v4" />
            </svg>
          </CompanionHeaderButton> : null}
          <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Popover.Trigger asChild>
              <button type="button" aria-label="Companion options" title="Companion options"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                </svg>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content side="top" align="end" sideOffset={8} aria-label="Companion options" data-companion-surface="true"
                className="z-[110] w-[min(21rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel-raised)] p-1 shadow-[var(--shadow-dialog)]">
                <CompanionMenuContext.Provider value={() => setMenuOpen(false)}>

                  <CompanionHeaderButton
                    label={companion.proposalHistory.length > 0
                      ? `Show execution history${latestProposalExecutionFailed ? '; latest execution failed' : ''}`
                      : 'No proposals executed this session'}
                    disabled={companion.proposalHistory.length === 0}
                    tone={historyOpen ? 'accent' : latestProposalExecutionFailed ? 'danger' : 'neutral'}
                    expanded={historyOpen}
                    controls="companion-proposal-history"
                    onClick={() => setHistoryOpen((open) => !open)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </CompanionHeaderButton>
                  <CompanionHeaderButton
                    label="Companion workspaces"
                    expanded={workspacePickerOpen}
                    controls="companion-workspace-picker"
                    onClick={() => setWorkspacePickerOpen(true)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" />
                    </svg>
                  </CompanionHeaderButton>
                  <CompanionHeaderButton
                    label="Edit Companion system prompt"
                    expanded={promptEditorOpen}
                    controls="companion-prompt-editor"
                    onClick={() => setPromptEditorOpen(true)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m16 3 5 5-12 12-6 1 1-6Z" /><path d="m14 5 5 5" />
                    </svg>
                  </CompanionHeaderButton>
                  <CompanionHeaderButton
                    label="Edit Companion instructions"
                    expanded={instructionsEditorOpen}
                    controls="companion-instructions-editor"
                    onClick={() => setInstructionsEditorOpen(true)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 3h12l4 4v14H4Z" /><path d="M14 3v6h6M8 13h8M8 17h5" />
                    </svg>
                  </CompanionHeaderButton>
                  {companion.status === 'recording' && companion.live?.status !== 'listening' && companion.live?.status !== 'connecting' ? (
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
                  {(companion.status === 'starting' || companion.status === 'transcribing') && companion.live?.status !== 'listening' && companion.live?.status !== 'connecting' ? (
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
                    <CompanionHeaderButton label={companion.live?.status === 'listening' ? 'Stop Companion turn and end voice' : 'Stop Companion turn'} tone="danger" onClick={companion.stop}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <rect x="7" y="7" width="10" height="10" rx="1" />
                      </svg>
                    </CompanionHeaderButton>
                  ) : null}
                </CompanionMenuContext.Provider>
                <div className="my-1 border-t border-[var(--border-subtle)]" />
                <CompanionLivePanel />
                <CompanionModelPicker embedded />
                <div className="my-1 border-t border-[var(--border-subtle)]" />
                <div className="p-2"><CompanionCurrentWorkspaceAccess refreshKey={workspacePickerOpen} /></div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
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
            <div className="px-3 pb-2 pt-0.5">
              <ChatMessageBody role="assistant" text={companion.reply} autoExpand />
            </div>
          ) : null}
        </div>
      ) : null}


      </aside>
      </div>
    </div>
  );
}
