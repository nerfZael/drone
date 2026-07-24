import React from 'react';
import {
  agentRunActivityHasResponse,
  isStoppedRunError,
  normalizeAgentRunActivity,
  toolCalls,
} from '@drone/assistant-chat';
import { stripAnsi } from '../../domain';
import type { TranscriptItem } from '../types';
import { AgentMessageExtras, extractAgentMessageContent } from './AgentMessageExtras';
import type { LinkedPullRequestContext } from './LinkedPullRequestCards';
import { ChatMessageBody } from './ChatMessageBody';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import {
  ImageAttachmentChips,
  isAttachmentOnlyPrompt,
  normalizeImageAttachmentRefs,
} from './ImageAttachmentChips';
import type { MarkdownFileReference } from './MarkdownMessage';
import type { DroneHubTask } from './drone-hub-task-parser';
import type { DroneHubTaskSpawnMode } from './drone-hub-task-spawn';
import { IconSnapshot, IconSpinner } from './icons';
import { ChatMessageFrame } from './ChatMessageFrame';
import { collectInlineAgentMedia } from './inline-agent-media';
import { AgentRunSummaryLine } from './WorkingElapsedStatus';
import { UserChatMessage } from './UserChatMessage';
import { StoppedRunNotice } from './StoppedRunNotice';
import { AgentRunActivityView } from '../assistant/AgentRunActivityView';

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
    onSpawnDroneHubTask,
    messageId,
    onRollbackDockerSnapshot,
    onOpenFileReference,
    onOpenLink,
    linkedPullRequestContext,
    droneId,
    droneHomePath,
    showRoleIcons = false,
    actionsEnabled = true,
    dockerSnapshotsEnabled = false,
    autoExpandAgentMessage = false,
    initiallyExpandFileChanges = false,
  }: {
    item: TranscriptItem;
    onSpawnDroneHubTask: (
      mode: DroneHubTaskSpawnMode,
      task: DroneHubTask,
    ) => Promise<{ ok: boolean; error?: string | null }>;
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
    autoExpandAgentMessage?: boolean;
    initiallyExpandFileChanges?: boolean;
  }) {
    const attachments = normalizeImageAttachmentRefs((item as any).attachments);
    const promptText = isAttachmentOnlyPrompt(item.prompt, attachments) ? '' : item.prompt;
    const isStopped = !item.ok && isStoppedRunError(item.error);
    const cleaned = isStopped
      ? stripAnsi(item.output || '')
      : item.ok
        ? stripAnsi(item.output)
        : stripAnsi(item.error || 'failed');
    const agentMessage = React.useMemo(
      () => extractAgentMessageContent(cleaned, item.ok),
      [cleaned, item.ok],
    );
    const cleanedAgentMessage = agentMessage.text;
    const activity = normalizeAgentRunActivity(item.activity);
    const activityHasResponse = agentRunActivityHasResponse(activity);
    const activityToolCallCount =
      activity?.messages.reduce((count, message) => count + toolCalls(message).length, 0) ?? 0;
    const showFallbackResponse = !activityHasResponse || !item.ok;
    const renderedInlineMediaHrefs = React.useMemo(
      () =>
        collectInlineAgentMedia(cleanedAgentMessage, droneId, droneHomePath)
          .map((media) => media.linkHref)
          .filter((href): href is string => Boolean(href)),
      [cleanedAgentMessage, droneHomePath, droneId],
    );
    const promptIso = item.promptAt || item.at;
    const agentIso = item.completedAt || item.at;
    const promptStartedAtMs = Date.parse(String(promptIso ?? ''));
    const agentCompletedAtMs = Date.parse(String(item.completedAt ?? ''));
    const completedRunDurationMs =
      Number.isFinite(promptStartedAtMs) &&
      Number.isFinite(agentCompletedAtMs) &&
      agentCompletedAtMs >= promptStartedAtMs
        ? agentCompletedAtMs - promptStartedAtMs
        : null;
    const dockerSnapshot = item.dockerSnapshot;
    const dockerSnapshotBusy =
      dockerSnapshot?.status === 'creating' || dockerSnapshot?.status === 'restoring';
    const canRollbackDockerSnapshot = Boolean(
      item.ok &&
      dockerSnapshot?.id &&
      dockerSnapshot.status === 'ready' &&
      onRollbackDockerSnapshot,
    );
    return (
      <div className="group/turn animate-fade-in">
        <UserChatMessage
          at={promptIso}
          showRoleIcons={showRoleIcons}
          text={promptText}
          onOpenFileReference={onOpenFileReference}
          onOpenLink={onOpenLink}
          attachmentContent={
            <ImageAttachmentChips
              attachments={attachments}
              droneId={droneId}
              droneHomePath={droneHomePath}
              onOpenFileReference={onOpenFileReference}
            />
          }
        />

        {completedRunDurationMs !== null ? (
          <AgentRunSummaryLine
            active={false}
            durationMs={completedRunDurationMs}
            at={agentIso}
            detail={
              activityToolCallCount > 0
                ? `${activityToolCallCount} tool ${activityToolCallCount === 1 ? 'call' : 'calls'}`
                : undefined
            }
          />
        ) : null}

        {activity ? (
          <AgentRunActivityView
            activity={activity}
            messageExtras={{
              messageId,
              actionsEnabled: actionsEnabled && item.ok,
              onSpawnTask: onSpawnDroneHubTask,
              linkedPullRequestContext,
              droneId,
              droneHomePath,
              onOpenFileReference,
              onOpenLink,
              plan: item.agentPlan,
              fileChanges: item.fileChanges,
              initiallyExpandFileChanges,
              initiallyExpandLinkedPullRequests: autoExpandAgentMessage,
              actionEnd:
                actionsEnabled &&
                item.ok &&
                dockerSnapshot &&
                (dockerSnapshotBusy ||
                  dockerSnapshot.status === 'failed' ||
                  onRollbackDockerSnapshot) ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (canRollbackDockerSnapshot) void onRollbackDockerSnapshot?.(item);
                    }}
                    disabled={!canRollbackDockerSnapshot || dockerSnapshotBusy}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-opacity ${
                      dockerSnapshotBusy
                        ? 'cursor-wait opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    } ${
                      canRollbackDockerSnapshot
                        ? 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)]'
                        : 'cursor-default border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    }`}
                    aria-label={
                      dockerSnapshotBusy
                        ? 'Docker snapshot operation in progress'
                        : dockerSnapshot.status === 'failed'
                          ? dockerSnapshot.error || 'Docker snapshot failed'
                          : 'Rollback to this Docker snapshot'
                    }
                    title={
                      dockerSnapshotBusy
                        ? 'Snapshot operation in progress'
                        : dockerSnapshot.status === 'failed'
                          ? dockerSnapshot.error || 'Snapshot failed'
                          : 'Rollback to this Docker snapshot'
                    }
                  >
                    {dockerSnapshotBusy ? (
                      <IconSpinner className="h-3.5 w-3.5" />
                    ) : (
                      <IconSnapshot className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : undefined,
            }}
          />
        ) : null}

        {showFallbackResponse ? (
          <ChatMessageFrame
            role="assistant"
            at={completedRunDurationMs === null ? agentIso : undefined}
            error={!item.ok && !isStopped}
            showRoleIcon={showRoleIcons}
            showRoleLabel={showRoleIcons}
            plainAssistant={!showRoleIcons}
            hoverActions={
              cleanedAgentMessage ? (
                <ChatMessageCopyAction text={cleanedAgentMessage} position="hover-rail" />
              ) : undefined
            }
          >
            <ChatMessageBody
              role="assistant"
              text={cleanedAgentMessage}
              error={!item.ok && !isStopped}
              preserveLeadParagraph
              toggleOnMessageClick
              autoExpand={autoExpandAgentMessage}
              renderedInlineMediaHrefs={renderedInlineMediaHrefs}
              onOpenFileReference={onOpenFileReference}
              onOpenLink={onOpenLink}
            />
            <AgentMessageExtras
              text={cleanedAgentMessage}
              tasks={agentMessage.tasks}
              messageId={messageId}
              actionsEnabled={actionsEnabled && item.ok}
              onSpawnTask={onSpawnDroneHubTask}
              linkedPullRequestContext={linkedPullRequestContext}
              droneId={droneId}
              droneHomePath={droneHomePath}
              onOpenFileReference={onOpenFileReference}
              onOpenLink={onOpenLink}
              plan={item.agentPlan}
              fileChanges={item.fileChanges}
              initiallyExpandFileChanges={initiallyExpandFileChanges}
              initiallyExpandLinkedPullRequests={autoExpandAgentMessage}
              actionEnd={
                actionsEnabled &&
                item.ok &&
                dockerSnapshot &&
                (dockerSnapshotBusy ||
                  dockerSnapshot.status === 'failed' ||
                  onRollbackDockerSnapshot) ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (canRollbackDockerSnapshot) void onRollbackDockerSnapshot?.(item);
                    }}
                    disabled={!canRollbackDockerSnapshot || dockerSnapshotBusy}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-opacity ${
                      dockerSnapshotBusy
                        ? 'cursor-wait opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    } ${
                      canRollbackDockerSnapshot
                        ? 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)]'
                        : dockerSnapshot.status === 'failed'
                          ? 'border-[var(--red-border)] bg-[var(--surface-inset)] text-[var(--red)]'
                          : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted-dim)]'
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
                    className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted-dim)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    title="No Docker snapshot exists for this message. Only messages completed after snapshots were enabled can be rolled back."
                    aria-label="No Docker snapshot for this message"
                  >
                    <IconSnapshot className="h-3.5 w-3.5 opacity-80" />
                  </button>
                ) : null
              }
            />
          </ChatMessageFrame>
        ) : null}
        {isStopped ? <StoppedRunNotice reason={item.error} at={agentIso} /> : null}
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
    JSON.stringify(a.item.agentPlan?.items ?? []) ===
      JSON.stringify(b.item.agentPlan?.items ?? []) &&
    (a.item.agentPlan?.source ?? '') === (b.item.agentPlan?.source ?? '') &&
    (a.item.error ?? '') === (b.item.error ?? '') &&
    a.onSpawnDroneHubTask === b.onSpawnDroneHubTask &&
    a.messageId === b.messageId &&
    a.onRollbackDockerSnapshot === b.onRollbackDockerSnapshot &&
    a.onOpenFileReference === b.onOpenFileReference &&
    a.onOpenLink === b.onOpenLink &&
    (a.linkedPullRequestContext?.droneId ?? '') === (b.linkedPullRequestContext?.droneId ?? '') &&
    (a.linkedPullRequestContext?.repoPath ?? '') === (b.linkedPullRequestContext?.repoPath ?? '') &&
    (a.linkedPullRequestContext?.repoAttached ?? false) ===
      (b.linkedPullRequestContext?.repoAttached ?? false) &&
    (a.linkedPullRequestContext?.disabled ?? false) ===
      (b.linkedPullRequestContext?.disabled ?? false) &&
    a.linkedPullRequestContext?.openPullRequestsData ===
      b.linkedPullRequestContext?.openPullRequestsData &&
    (a.linkedPullRequestContext?.openPullRequestsLoading ?? false) ===
      (b.linkedPullRequestContext?.openPullRequestsLoading ?? false) &&
    (a.linkedPullRequestContext?.openPullRequestsError ?? '') ===
      (b.linkedPullRequestContext?.openPullRequestsError ?? '') &&
    (a.droneId ?? '') === (b.droneId ?? '') &&
    (a.droneHomePath ?? '') === (b.droneHomePath ?? '') &&
    (a.dockerSnapshotsEnabled ?? false) === (b.dockerSnapshotsEnabled ?? false) &&
    (a.autoExpandAgentMessage ?? false) === (b.autoExpandAgentMessage ?? false) &&
    (a.initiallyExpandFileChanges ?? false) === (b.initiallyExpandFileChanges ?? false) &&
    sameAttachments((a.item as any).attachments, (b.item as any).attachments) &&
    (a.item.dockerSnapshot?.id ?? '') === (b.item.dockerSnapshot?.id ?? '') &&
    (a.item.dockerSnapshot?.status ?? '') === (b.item.dockerSnapshot?.status ?? '') &&
    (a.item.dockerSnapshot?.readyAt ?? '') === (b.item.dockerSnapshot?.readyAt ?? '') &&
    (a.item.dockerSnapshot?.restoredAt ?? '') === (b.item.dockerSnapshot?.restoredAt ?? '') &&
    (a.item.dockerSnapshot?.error ?? '') === (b.item.dockerSnapshot?.error ?? '') &&
    (a.showRoleIcons ?? false) === (b.showRoleIcons ?? false) &&
    (a.actionsEnabled ?? true) === (b.actionsEnabled ?? true),
);
