import { useCrossWindowFocus } from '../../ui/use-cross-window-focus';
import { shouldCancelCompanionRecordingWithEscape } from './companion-shortcut';
import { useCompanionWindowHost } from './companion-window';
import { CompanionScreenPanel } from './CompanionScreenPanel';
import { AssistantContextUsageIndicator } from '../assistant/AssistantContextStatus';
import { useRecorderCompanion } from '../dictation/RecorderCompanionContext';
import React from 'react';
import { Popover } from 'radix-ui';
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
import { CompanionProposalStrip } from './CompanionProposalStrip';
import { CompanionOptionsMenu } from './CompanionOptionsMenu';
import { CompanionTranscriptDialog, useCompanionTranscriptDialog } from './CompanionTranscriptDialog';
import { CompanionSubscriptions } from './CompanionSubscriptions';
import { useCompanionWorkspace } from './CompanionWorkspaceContext';

function companionStatusLabel(status: CompanionStatus, recordingPaused: boolean): string {
  if (recordingPaused) return 'Paused';
  if (status === 'starting') return 'Starting microphone';
  if (status === 'recording') return 'Recording';
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
  if (recordingPaused) return (
    <span title={label} aria-label={`Companion status: ${label}`} role="status" className="flex h-3 w-3 shrink-0 items-center justify-center text-[var(--yellow)]">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="2" y="1" width="3" height="10" rx="0.5" />
        <rect x="7" y="1" width="3" height="10" rx="0.5" />
      </svg>
    </span>
  );
  const tone = status === 'recording' || status === 'error'
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
  pressed,
  onClick,
  children,
}: {
  label: string;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
  disabled?: boolean;
  pressed?: boolean;
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
      aria-pressed={pressed}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40 ${classes}`}
      title={label}
      aria-label={label}
    >
      {children}
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
  const transcriptDialog = useCompanionTranscriptDialog();
  const [workspacePickerOpen, setWorkspacePickerOpen] = React.useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = React.useState(false);
  const [instructionsEditorOpen, setInstructionsEditorOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  // Default each new selection to closed in auto-approve mode, without a frame
  // flashing open before an effect runs. Explicit number clicks override the default.
  const [proposalVisibility, setProposalVisibility] = React.useState<{
    targetId: string | null; autoApprove: boolean; hidden: boolean;
  } | null>(null);
  const proposalHidden = proposalVisibility !== null
    && proposalVisibility.targetId === companion?.selectedProposalId
    && proposalVisibility?.autoApprove === companion?.autoApprove
    ? proposalVisibility.hidden : Boolean(companion?.autoApprove);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const panelOpen = promptEditorOpen || workspacePickerOpen || instructionsEditorOpen || transcriptDialog.open;
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
  const visible = Boolean(companion && (companion.shortcutHint || (companion.panelVisibility !== 'closed' &&
    (companion.panelVisibility === 'open' || companion.status !== 'idle' || companion.live?.hasStarted || panelOpen))));
  const companionWindow = useCompanionWindowHost(visible);
  const popoverFocus = useCrossWindowFocus(companionWindow.portalContainer);
  React.useEffect(() => {
    if (!companionWindow.detached || !companionWindow.ownerWindow || companion?.switchingVoice ||
        companion?.live?.status === 'connecting' || companion?.live?.status === 'listening') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldCancelCompanionRecordingWithEscape({ key: event.key, repeat: event.repeat,
        isComposing: event.isComposing, voiceStatus: companion?.status ?? 'idle' })) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void companion?.discardRecording();
    };
    companionWindow.ownerWindow.addEventListener('keydown', onKeyDown, true);
    return () => companionWindow.ownerWindow?.removeEventListener('keydown', onKeyDown, true);
  }, [companionWindow.detached, companionWindow.ownerWindow, companion?.status, companion?.live?.status, companion?.switchingVoice, companion?.discardRecording]);
  if (!companion || !visible) return companionWindow.render(null);
  const active = companion.status === 'working';
  const liveActive = companion.live?.status === 'connecting' || companion.live?.status === 'listening';
  const duration = companion.startedAt != null
    ? Math.max(0, (companion.endedAt ?? Date.now()) - companion.startedAt)
    : 0;
  const activityGroups = groupCompanionToolActivity(companion.activity);
  // Floating window: the bar is docked to one window edge and never moves. Everything else
  // stacks away from it, upward when the bar sits low on the screen and downward when it sits high.
  const flowsDown = companionWindow.detached && companionWindow.flow === 'down';
  const popoverSide = flowsDown ? 'bottom' : 'top';
  return companionWindow.render(
    <div data-companion-surface="true" data-companion-window-panel="true" data-companion-flow={companionWindow.detached ? companionWindow.flow : undefined} style={companionWindow.detached ? { position: 'absolute', top: flowsDown ? 0 : 'auto', bottom: flowsDown ? 'auto' : 0, right: 0, width: '100%', maxHeight: 'var(--companion-max-height)', overflowY: 'auto', padding: 8, alignItems: 'flex-end', flexDirection: flowsDown ? 'column-reverse' : 'column' } : recorderHeight > 0 ? {
      zIndex: panelOpen ? 100 : 80,
      bottom: recorderHeight + 32,
      maxHeight: `calc(100dvh - ${recorderHeight + 48}px)`,
      overflowY: 'auto',
    } : { zIndex: panelOpen ? 100 : 80 }} className="fixed bottom-4 right-4 z-[80] flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] flex-col items-end gap-3 min-[860px]:w-auto min-[860px]:flex-row">
      {Boolean(companion.attachments?.length) && <div aria-label="Pending Companion attachments" className="flex max-w-sm flex-wrap gap-2 rounded-lg bg-[var(--panel)] p-2">
        {companion.attachments.map(image => <div key={image.id} className="flex items-center gap-2">
          <img src={`data:${image.mime};base64,${image.dataBase64}`} alt={image.name} className="h-16 w-24 rounded object-contain" />
          <button type="button" aria-label={`Remove ${image.name}`} onClick={() => companion.removeAttachment(image.id)}>Remove</button>
        </div>)}
        <span className="text-xs">Attached to your next instruction</span>
      </div>}
      {companion.screen ? <CompanionScreenPanel screen={companion.screen} /> : null}
      {historyOpen ? (
        <CompanionProposalHistory
          entries={companion.proposalHistory}
          onClose={() => setHistoryOpen(false)}
        />
      ) : companion.proposal && !proposalHidden ? (
        <CompanionProposalCard
          key={companion.selectedProposalId}
          proposal={companion.proposal}
          defaultRepoPath={companion.proposalDefaultRepoPath ?? ''}
          execution={companion.proposalExecution}
          executionProgress={companion.proposalExecutionProgress}
          executing={companion.selectedProposalExecuting}
          executionBlocked={companion.proposalExecuting}
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
          onExecute={() => void companion.executeProposal(companion.selectedProposalId ?? undefined, companion.proposals.find(item => item.targetId === companion.selectedProposalId)?.revision)}
          onDiscard={() => companion.discardProposal(companion.selectedProposalId ?? undefined, companion.proposals.find(item => item.targetId === companion.selectedProposalId)?.revision)}
        />
      ) : null}
      <div className={`flex min-h-0 w-full gap-3 ${flowsDown ? 'flex-col-reverse' : 'flex-col'} ${companionWindow.detached ? '' : panelOpen ? 'min-[860px]:w-[34rem]' : 'min-[860px]:w-fit min-[860px]:max-w-[28rem]'}`}>
      {workspacePickerOpen ? <CompanionWorkspacePicker onClose={() => setWorkspacePickerOpen(false)} /> : null}
      {promptEditorOpen ? <CompanionPromptEditor onClose={() => setPromptEditorOpen(false)} /> : null}
      {instructionsEditorOpen ? <CompanionInstructionsEditor onClose={() => setInstructionsEditorOpen(false)} /> : null}
      {transcriptDialog.open ? <CompanionTranscriptDialog captions={companion.live?.captions ?? ''}
        requests={companion.live?.mode === 'jev' ? companion.live.jevRequests : undefined}
        table={companion.live?.mode === 'jev' ? companion.live.jevTable : undefined}
        insight={companion.live?.mode === 'jev' ? companion.live.jevInsight : undefined}
        status={companion.live?.status}
        onResetTable={companion.live?.mode === 'jev' ? companion.live.resetJevTable : undefined}
        onClose={transcriptDialog.close} portalContainer={companionWindow.portalContainer} /> : null}
      {companion.autoApprove && companion.status !== 'idle' && companion.actionNotifications.length > 0 ? (
        <CompanionActionNotifications notifications={companion.actionNotifications} onDismiss={companion.dismissActionNotification} />
      ) : null}
      {/* The proposal strip docks onto the window's outer edge so it works even when the window is a single row. */}
      <div className={`flex min-h-0 w-full ${flowsDown ? 'flex-col-reverse' : 'flex-col'} ${companionWindow.detached ? '' : 'min-[860px]:max-w-[28rem] min-[860px]:self-end'}`}>
      <CompanionProposalStrip
        proposals={companion.proposals}
        selectedId={companion.selectedProposalId}
        selectedOpen={!proposalHidden}
        edge={flowsDown ? 'bottom' : 'top'}
        onSelect={(targetId) => {
          setProposalVisibility({ targetId, autoApprove: companion.autoApprove,
            hidden: targetId === companion.selectedProposalId ? !proposalHidden : false });
          if (targetId !== companion.selectedProposalId) companion.selectProposal(targetId);
          setHistoryOpen(false);
        }}
      />
      <aside
        className={`flex max-h-[calc(100vh-2rem)] w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-raised)] shadow-[var(--edge-highlight),var(--shadow-dialog)] ${companionWindow.detached && !flowsDown ? 'flex-col-reverse' : 'flex-col'} ${companion.proposals.length > 0 ? flowsDown ? 'rounded-br-none' : 'rounded-tr-none' : ''}`}
        aria-label="Companion"
      >
      {/* Header doubles as the user's message once a transcript exists. In the floating window it is the bar that stays put. */}
      <div data-companion-window-bar="true" data-companion-drag-handle={companionWindow.detached || undefined} className="flex shrink-0 items-start gap-2.5 py-1.5 pl-3 pr-1.5">
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
          <Popover.Portal container={companionWindow.portalContainer} key={String(companionWindow.detached)}>
            <Popover.Content onOpenAutoFocus={popoverFocus.onOpenAutoFocus} onCloseAutoFocus={popoverFocus.onCloseAutoFocus} onKeyDown={popoverFocus.onKeyDown} side={popoverSide} align="start" sideOffset={8} aria-label="Companion activity" data-companion-surface="true"
              className="z-[110] w-[min(24rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel-raised)] shadow-[var(--shadow-dialog)]">
              <div className="flex flex-wrap items-center gap-2 px-3.5 py-2 text-xs text-[var(--muted)]">
                <span className="flex-1">{active ? 'Working' : 'Worked'} for {formatWorkingDuration(duration)} · {companion.activity.length} tool calls</span>
                {companion.contextUsage ? (
                  <AssistantContextUsageIndicator usage={companion.contextUsage} />
                ) : null}
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
          {companion.shortcutHint ? (
            <span role="status" className="text-xs text-[var(--fg)]">
              {{ pause: companion.live?.mode === 'jev' ? 'Release to pause listening and decisions' : 'Release to pause recording', resume: companion.live?.mode === 'jev' ? 'Release to resume listening and decisions' : 'Release to resume recording',
                cancel: companion.live?.mode === 'jev' ? 'Release to stop listening · keep transcript' : 'Release to stop and discard recording', close: 'Release to close Companion · keep context',
                reset: 'Release to stop Companion and clear context' }[companion.shortcutHint]}
            </span>
          ) : companion.transcript ? (
            <div className="flex min-w-0 w-full items-start gap-1">
            {companionWindow.detached ? (
              <span data-companion-drag-handle="true" title={companion.transcript}
                className={`min-w-0 flex-1 cursor-move select-none text-xs leading-relaxed text-[var(--fg-secondary)] ${transcriptExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                {companion.transcript}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setTranscriptExpanded((value) => !value)}
              aria-expanded={transcriptExpanded}
              aria-label={transcriptExpanded ? 'Collapse your message' : 'Expand your message'}
              title={transcriptExpanded ? undefined : companion.transcript}
              className={`${companionWindow.detached ? 'shrink-0 px-1' : 'w-full'} rounded-sm text-left text-xs leading-relaxed text-[var(--fg-secondary)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                transcriptExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'
              }`}
            >
              {companionWindow.detached ? (
                <svg width="14" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d={transcriptExpanded ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'} />
                </svg>
              ) : companion.transcript}
            </button>
            </div>
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
        {companion.pendingTranscriptions > 0 && companion.status !== 'transcribing' ? (
          <span role="status" className="text-[10px] text-[var(--muted)]">
            Transcribing {companion.pendingTranscriptions} {companion.pendingTranscriptions === 1 ? 'clip' : 'clips'}
          </span>
        ) : null}
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
          {companion.live?.enabled || liveActive ? <CompanionHeaderButton
            label={liveActive ? 'Stop live voice; submitted work continues' : 'Start live voice'}
            tone={liveActive ? 'danger' : 'accent'}
            disabled={!liveActive && (companion.live.loading || companion.live.saving || companion.switchingVoice || ['starting', 'recording', 'transcribing'].includes(companion.status))}
            onClick={() => liveActive ? companion.live.stop() : void companion.toggle()}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
              {liveActive ? <rect x="6" y="6" width="12" height="12" rx="1" /> : <path d="M8 5v14l11-7Z" />}
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
            <Popover.Portal container={companionWindow.portalContainer} key={String(companionWindow.detached)}>
              <Popover.Content onOpenAutoFocus={popoverFocus.onOpenAutoFocus} onCloseAutoFocus={event => {
                if (!transcriptDialog.onMenuCloseAutoFocus(event)) popoverFocus.onCloseAutoFocus(event);
              }} onKeyDown={popoverFocus.onKeyDown} side={popoverSide} align="end" sideOffset={8} aria-label="Companion options" data-companion-surface="true"
                className="z-[110] w-[min(21rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel-raised)] p-1 shadow-[var(--shadow-dialog)]">
                <CompanionOptionsMenu
                  historyOpen={historyOpen}
                  onToggleHistory={() => setHistoryOpen((open) => !open)}
                  onOpenWorkspaces={() => setWorkspacePickerOpen(true)}
                  onOpenPrompt={() => setPromptEditorOpen(true)}
                  onOpenInstructions={() => setInstructionsEditorOpen(true)}
                  onOpenTranscript={transcriptDialog.requestOpen}
                  workspacePickerOpen={workspacePickerOpen}
                  promptEditorOpen={promptEditorOpen}
                  instructionsEditorOpen={instructionsEditorOpen}
                  onClose={() => setMenuOpen(false)}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <button
            type="button"
            onClick={() => void companion.dismiss()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-lg text-[var(--muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            aria-label="Close Companion"
            title="Close Companion and keep conversation context"
          >
            ×
          </button>
        </div>
        </div>
      </div>

      {companionWindow.error ? <p role="alert" className="px-3 py-2 text-xs text-[var(--red)]">{companionWindow.error}</p> : null}
      {/* Body: the reply is what the user came for. */}
      {companion.error || companion.reply ? (
        <div className="min-h-0 overflow-y-auto">
          {companion.error ? (
            <div className="mx-3 mt-2.5 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-xs text-[var(--red)]">
              {companion.error}
            </div>
          ) : null}
          {companion.reply ? (
            <div data-companion-drag-handle={companionWindow.detached || undefined}
              className={`px-3 ${companionWindow.detached && !flowsDown ? 'pb-0.5 pt-2' : 'pb-2 pt-0.5'} ${companionWindow.detached ? 'cursor-move select-none' : ''}`}>
              <ChatMessageBody role="assistant" text={companion.reply} autoExpand />
            </div>
          ) : null}
        </div>
      ) : null}


      </aside>
      </div>
      </div>
    </div>
  );
}
