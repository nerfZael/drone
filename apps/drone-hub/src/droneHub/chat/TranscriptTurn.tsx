import React from 'react';
import { stripAnsi } from '../../domain';
import type { TranscriptItem } from '../types';
import { AgentMessageExtras, extractAgentMessageContent } from './AgentMessageExtras';
import type { LinkedPullRequestContext } from './LinkedPullRequestCards';
import { ChatMessageBody } from './ChatMessageBody';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { ImageAttachmentChips, isAttachmentOnlyPrompt, normalizeImageAttachmentRefs } from './ImageAttachmentChips';
import type { MarkdownFileReference } from './MarkdownMessage';
import type { DroneHubTask } from './drone-hub-task-parser';
import type { DroneHubTaskSpawnMode } from './drone-hub-task-spawn';
import { IconAlert, IconCheck, IconSnapshot, IconSpinner } from './icons';
import { AgentPlanList } from './AgentPlanList';
import { ChatMessageFrame } from './ChatMessageFrame';

type AutoContinueBadge = {
  title: string;
  toneClassName: string;
  icon: 'spinner' | 'check' | 'alert';
};

type AgentMessageAutoContinueState = NonNullable<TranscriptItem['agentMessageAutoContinue']>;

function autoContinueSourceLabel(source: AgentMessageAutoContinueState['source'] | undefined): string {
  if (source === 'llm') return 'LLM';
  if (source === 'agent-copilot-json') return 'agent copilot JSON';
  if (source === 'heuristic') return 'heuristic';
  return 'unknown source';
}

function resolveAutoContinueBadge(state: TranscriptItem['agentMessageAutoContinue'] | undefined): AutoContinueBadge | null {
  if (!state?.status) return null;
  if (state.status === 'pending') {
    return {
      title: 'Checking whether Hub should auto-continue this chat.',
      toneClassName: 'text-[var(--muted-dim)]',
      icon: 'spinner',
    };
  }
  if (state.status === 'failed') {
    const error = String(state.error ?? '').trim();
    return {
      title: error ? `Auto-continue check failed: ${error}` : 'Auto-continue check failed.',
      toneClassName: 'text-[var(--red)]',
      icon: 'alert',
    };
  }

  const source = autoContinueSourceLabel(state.source);
  if (state.bucket === 'continue') {
    return {
      title: state.continuedAt
        ? `Auto-continue checked via ${source}: classified as continue. Hub sent the follow-up prompt.`
        : `Auto-continue checked via ${source}: classified as continue. Hub is sending the follow-up prompt.`,
      toneClassName: 'text-[var(--muted-dim)]',
      icon: 'check',
    };
  }
  return {
    title: `Auto-continue checked via ${source}: classified as wait for the next user turn. No follow-up prompt was sent.`,
    toneClassName: 'text-[var(--muted-dim)]',
    icon: 'check',
  };
}


function sameAttachments(aRaw: unknown, bRaw: unknown): boolean {
  const a = normalizeImageAttachmentRefs(aRaw);
  const b = normalizeImageAttachmentRefs(bRaw);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.name !== right.name) return false;
    if (left.mime !== right.mime) return false;
    if (left.size !== right.size) return false;
    if (String(left.path ?? '') !== String(right.path ?? '')) return false;
    if (String(left.relativePath ?? '') !== String(right.relativePath ?? '')) return false;
  }
  return true;
}

export const TranscriptTurn = React.memo(
  function TranscriptTurn({
    item,
    parsingJobs,
    onCreateJobs,
    onSpawnDroneHubTask,
    messageId,
    onRollbackDockerSnapshot,
    onOpenFileReference,
    onOpenLink,
    linkedPullRequestContext,
    droneId,
    droneHomePath,
    showRoleIcons = true,
    actionsEnabled = true,
    dockerSnapshotsEnabled = false,
  }: {
    item: TranscriptItem;
    parsingJobs: boolean;
    onCreateJobs: (opts: { turn: number; message: string }) => void;
    onSpawnDroneHubTask: (mode: DroneHubTaskSpawnMode, task: DroneHubTask) => Promise<{ ok: boolean; error?: string | null }>;
    messageId: string;
    onRollbackDockerSnapshot?: (item: TranscriptItem) => void | Promise<void>;
    onOpenFileReference?: (ref: MarkdownFileReference) => void;
    onOpenLink?: (href: string) => boolean;
    linkedPullRequestContext?: LinkedPullRequestContext;
    droneId?: string;
    droneHomePath?: string;
    showRoleIcons?: boolean;
    actionsEnabled?: boolean;
    dockerSnapshotsEnabled?: boolean;
  }) {
    const attachments = normalizeImageAttachmentRefs((item as any).attachments);
    const promptText = isAttachmentOnlyPrompt(item.prompt, attachments) ? '' : item.prompt;
    const cleaned = item.ok ? stripAnsi(item.output) : stripAnsi(item.error || 'failed');
    const agentMessage = React.useMemo(
      () => extractAgentMessageContent(cleaned, item.ok),
      [cleaned, item.ok],
    );
    const cleanedAgentMessage = agentMessage.text;
    const promptIso = item.promptAt || item.at;
    const agentIso = item.completedAt || item.at;
    const autoContinueBadge = resolveAutoContinueBadge(item.agentMessageAutoContinue);
    const dockerSnapshot = item.dockerSnapshot;
    const dockerSnapshotBusy = dockerSnapshot?.status === 'creating' || dockerSnapshot?.status === 'restoring';
    const canRollbackDockerSnapshot = Boolean(item.ok && dockerSnapshot?.id && dockerSnapshot.status === 'ready' && onRollbackDockerSnapshot);
    return (
      <div className="animate-fade-in">
        <ChatMessageFrame
          role="user"
          at={promptIso}
          showRoleIcon={showRoleIcons}
          showRoleLabel={showRoleIcons}
        >
          <ChatMessageCopyAction text={promptText} />
          <ChatMessageBody
            role="user"
            text={promptText}
            onOpenFileReference={onOpenFileReference}
            onOpenLink={onOpenLink}
          />
          <ImageAttachmentChips
            attachments={attachments}
            droneId={droneId}
            droneHomePath={droneHomePath}
            onOpenFileReference={onOpenFileReference}
          />
        </ChatMessageFrame>

        <ChatMessageFrame
          role="assistant"
          at={agentIso}
          error={!item.ok}
          showRoleIcon={showRoleIcons}
          showRoleLabel={showRoleIcons}
          plainAssistant={!showRoleIcons}
          headerEnd={autoContinueBadge ? (
            <span
              className={`inline-flex h-3.5 w-3.5 items-center justify-center ${autoContinueBadge.toneClassName}`}
              title={autoContinueBadge.title}
              aria-label={autoContinueBadge.title}
            >
              {autoContinueBadge.icon === 'spinner' ? <IconSpinner className="h-3 w-3" /> : null}
              {autoContinueBadge.icon === 'check' ? <IconCheck className="h-3 w-3" /> : null}
              {autoContinueBadge.icon === 'alert' ? <IconAlert className="h-3 w-3" /> : null}
            </span>
          ) : null}
        >
          <ChatMessageBody
            role="assistant"
            text={cleanedAgentMessage}
            error={!item.ok}
            preserveLeadParagraph
            toggleOnMessageClick
            onOpenFileReference={onOpenFileReference}
            onOpenLink={onOpenLink}
          />
          <AgentMessageExtras
            text={cleanedAgentMessage}
            tasks={agentMessage.tasks}
            messageId={messageId}
            parsingJobs={parsingJobs}
            actionsEnabled={actionsEnabled && item.ok}
            onCreateJobs={(message) => onCreateJobs({ turn: item.turn, message })}
            onSpawnTask={onSpawnDroneHubTask}
            linkedPullRequestContext={linkedPullRequestContext}
            linkedCardsClassName={
              item.agentPlan?.items.length ? undefined : 'mb-8'
            }
            droneId={droneId}
            droneHomePath={droneHomePath}
            onOpenFileReference={onOpenFileReference}
            onOpenLink={onOpenLink}
            afterContent={
              <AgentPlanList plan={item.agentPlan} className="mb-8" />
            }
            actionEnd={
              actionsEnabled && item.ok && dockerSnapshot &&
              (dockerSnapshotBusy || dockerSnapshot.status === 'failed' || onRollbackDockerSnapshot) ? (
                <button
                  type="button"
                  onClick={() => {
                    if (canRollbackDockerSnapshot) void onRollbackDockerSnapshot?.(item);
                  }}
                  disabled={!canRollbackDockerSnapshot || dockerSnapshotBusy}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-opacity ${
                    dockerSnapshotBusy ? 'cursor-wait opacity-100' : 'opacity-0 group-hover:opacity-100'
                  } ${
                    canRollbackDockerSnapshot
                      ? 'border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:bg-[rgba(0,0,0,.25)] hover:text-[var(--accent)]'
                      : dockerSnapshot.status === 'failed'
                        ? 'border-[rgba(255,90,90,.25)] bg-[rgba(0,0,0,.15)] text-[var(--red)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] text-[var(--muted-dim)]'
                  }`}
                  title={
                    dockerSnapshot.status === 'creating'
                      ? 'Creating Docker snapshot'
                      : dockerSnapshot.status === 'restoring'
                        ? 'Rolling back to this Docker snapshot'
                        : dockerSnapshot.status === 'failed'
                          ? `Docker snapshot failed: ${dockerSnapshot.error || 'unknown error'}`
                          : 'Roll back this drone to this Docker snapshot'
                  }
                  aria-label="Roll back to Docker snapshot"
                >
                  {dockerSnapshotBusy ? (
                    <IconSpinner className="h-3.5 w-3.5 text-[var(--accent)]" />
                  ) : (
                    <IconSnapshot className="h-3.5 w-3.5 opacity-90" />
                  )}
                </button>
              ) : actionsEnabled && item.ok && dockerSnapshotsEnabled ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] text-[var(--muted-dim)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  title="No Docker snapshot exists for this message. Only messages completed after snapshots were enabled can be rolled back."
                  aria-label="No Docker snapshot for this message"
                >
                  <IconSnapshot className="h-3.5 w-3.5 opacity-80" />
                </button>
              ) : null
            }
          />
        </ChatMessageFrame>
      </div>
    );
  },
  (a, b) =>
    a.item.turn === b.item.turn &&
    a.item.at === b.item.at &&
    a.item.ok === b.item.ok &&
    a.item.prompt === b.item.prompt &&
    a.item.session === b.item.session &&
    a.item.logPath === b.item.logPath &&
    a.item.output === b.item.output &&
    JSON.stringify(a.item.agentPlan?.items ?? []) === JSON.stringify(b.item.agentPlan?.items ?? []) &&
    (a.item.agentPlan?.source ?? '') === (b.item.agentPlan?.source ?? '') &&
    (a.item.agentMessageAutoContinue?.status ?? '') === (b.item.agentMessageAutoContinue?.status ?? '') &&
    (a.item.agentMessageAutoContinue?.bucket ?? '') === (b.item.agentMessageAutoContinue?.bucket ?? '') &&
    (a.item.agentMessageAutoContinue?.source ?? '') === (b.item.agentMessageAutoContinue?.source ?? '') &&
    (a.item.agentMessageAutoContinue?.continuedAt ?? '') === (b.item.agentMessageAutoContinue?.continuedAt ?? '') &&
    (a.item.agentMessageAutoContinue?.updatedAt ?? '') === (b.item.agentMessageAutoContinue?.updatedAt ?? '') &&
    (a.item.error ?? '') === (b.item.error ?? '') &&
    a.parsingJobs === b.parsingJobs &&
    a.onCreateJobs === b.onCreateJobs &&
    a.onSpawnDroneHubTask === b.onSpawnDroneHubTask &&
    a.messageId === b.messageId &&
    a.onRollbackDockerSnapshot === b.onRollbackDockerSnapshot &&
    a.onOpenFileReference === b.onOpenFileReference &&
    a.onOpenLink === b.onOpenLink &&
    (a.linkedPullRequestContext?.droneId ?? '') === (b.linkedPullRequestContext?.droneId ?? '') &&
    (a.linkedPullRequestContext?.repoPath ?? '') === (b.linkedPullRequestContext?.repoPath ?? '') &&
    (a.linkedPullRequestContext?.repoAttached ?? false) === (b.linkedPullRequestContext?.repoAttached ?? false) &&
    (a.linkedPullRequestContext?.disabled ?? false) === (b.linkedPullRequestContext?.disabled ?? false) &&
    a.linkedPullRequestContext?.openPullRequestsData === b.linkedPullRequestContext?.openPullRequestsData &&
    (a.linkedPullRequestContext?.openPullRequestsLoading ?? false) === (b.linkedPullRequestContext?.openPullRequestsLoading ?? false) &&
    (a.linkedPullRequestContext?.openPullRequestsError ?? '') === (b.linkedPullRequestContext?.openPullRequestsError ?? '') &&
    (a.droneId ?? '') === (b.droneId ?? '') &&
    (a.droneHomePath ?? '') === (b.droneHomePath ?? '') &&
    (a.dockerSnapshotsEnabled ?? false) === (b.dockerSnapshotsEnabled ?? false) &&
    sameAttachments((a.item as any).attachments, (b.item as any).attachments) &&
    (a.item.dockerSnapshot?.id ?? '') === (b.item.dockerSnapshot?.id ?? '') &&
    (a.item.dockerSnapshot?.status ?? '') === (b.item.dockerSnapshot?.status ?? '') &&
    (a.item.dockerSnapshot?.readyAt ?? '') === (b.item.dockerSnapshot?.readyAt ?? '') &&
    (a.item.dockerSnapshot?.restoredAt ?? '') === (b.item.dockerSnapshot?.restoredAt ?? '') &&
    (a.item.dockerSnapshot?.error ?? '') === (b.item.dockerSnapshot?.error ?? '') &&
    (a.showRoleIcons ?? true) === (b.showRoleIcons ?? true) &&
    (a.actionsEnabled ?? true) === (b.actionsEnabled ?? true),
);
