import React from 'react';
import { stripAnsi } from '../../domain';
import type { TranscriptItem } from '../types';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { ChatMessageBody } from './ChatMessageBody';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { DroneHubTaskList } from './DroneHubTaskList';
import { ImageAttachmentChips, isAttachmentOnlyPrompt, normalizeImageAttachmentRefs } from './ImageAttachmentChips';
import type { MarkdownFileReference } from './MarkdownMessage';
import type { DroneHubTask } from './drone-hub-task-parser';
import type { DroneHubTaskSpawnMode } from './drone-hub-task-spawn';
import { extractAgentCopilotFromAgentMessage } from './agent-copilot-parser';
import { extractDroneHubTasksFromAgentMessage } from './drone-hub-task-parser';
import { collectInlineAgentMedia, type InlineAgentMedia } from './inline-agent-media';
import { IconAlert, IconCheck, IconImage, IconJobs, IconOpen, IconSnapshot, IconSpinner, IconTldr } from './icons';
import { VideoPreview } from '../media/VideoPreview';
import { AgentPlanList } from './AgentPlanList';
import { LinkedPullRequestCards, type LinkedPullRequestContext } from './LinkedPullRequestCards';
import { ChatMessageFrame } from './ChatMessageFrame';

type TldrState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: string }
  | { status: 'error'; error: string };

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
    tldr,
    showTldr,
    onToggleTldr,
    onRollbackDockerSnapshot,
    onHoverAgentMessage,
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
    tldr: TldrState | null;
    showTldr: boolean;
    onToggleTldr: (item: TranscriptItem) => void;
    onRollbackDockerSnapshot?: (item: TranscriptItem) => void | Promise<void>;
    onHoverAgentMessage: (item: TranscriptItem | null) => void;
    onOpenFileReference?: (ref: MarkdownFileReference) => void;
    onOpenLink?: (href: string) => boolean;
    linkedPullRequestContext?: LinkedPullRequestContext;
    droneId?: string;
    droneHomePath?: string;
    showRoleIcons?: boolean;
    actionsEnabled?: boolean;
    dockerSnapshotsEnabled?: boolean;
  }) {
    const transcriptInlineImages = useDroneHubUiStore((s) => s.transcriptInlineImages);
    const inlineImagesOverride = useDroneHubUiStore((s) => s.transcriptInlineImageOverrides[messageId]);
    const setInlineImagesOverride = useDroneHubUiStore((s) => s.setTranscriptInlineImageOverride);
    const attachments = normalizeImageAttachmentRefs((item as any).attachments);
    const promptText = isAttachmentOnlyPrompt(item.prompt, attachments) ? '' : item.prompt;
    const cleaned = item.ok ? stripAnsi(item.output) : stripAnsi(item.error || 'failed');
    const extractedTaskData = React.useMemo(
      () => (item.ok ? extractDroneHubTasksFromAgentMessage(cleaned) : { cleanedText: cleaned, tasks: [] }),
      [cleaned, item.ok],
    );
    const extractedCopilotData = React.useMemo(
      () =>
        item.ok
          ? extractAgentCopilotFromAgentMessage(extractedTaskData.cleanedText)
          : { cleanedText: extractedTaskData.cleanedText, copilot: null, error: null },
      [extractedTaskData.cleanedText, item.ok],
    );
    const cleanedAgentMessage = extractedCopilotData.cleanedText;
    const droneHubTasks = extractedTaskData.tasks;
    const promptIso = item.promptAt || item.at;
    const agentIso = item.completedAt || item.at;
    const autoContinueBadge = resolveAutoContinueBadge(item.agentMessageAutoContinue);
    const dockerSnapshot = item.dockerSnapshot;
    const dockerSnapshotBusy = dockerSnapshot?.status === 'creating' || dockerSnapshot?.status === 'restoring';
    const canRollbackDockerSnapshot = Boolean(item.ok && dockerSnapshot?.id && dockerSnapshot.status === 'ready' && onRollbackDockerSnapshot);
    const tldrStatus = tldr?.status ?? 'idle';
    const tldrLoading = tldrStatus === 'loading';
    const tldrError = tldr && tldr.status === 'error' ? tldr.error : '';
    const tldrSummary = tldr && tldr.status === 'ready' ? tldr.summary : '';
    const showingTldr = Boolean(showTldr);
    const displayedText = showingTldr
      ? tldrStatus === 'ready'
        ? tldrSummary
        : tldrStatus === 'error'
          ? `TLDR failed: ${tldrError || 'unknown error'}`
          : 'Generating TLDR…'
      : cleanedAgentMessage;
    const inlineMedia = React.useMemo(
      () => collectInlineAgentMedia(cleanedAgentMessage, droneId, droneHomePath),
      [cleanedAgentMessage, droneId, droneHomePath],
    );
    const [failedInlineMediaById, setFailedInlineMediaById] = React.useState<Record<string, true>>({});
    const inlineMediaVisible =
      typeof inlineImagesOverride === 'boolean' ? inlineImagesOverride : transcriptInlineImages;
    const showInlineMedia = Boolean(
      inlineMedia.length > 0 && inlineMediaVisible,
    );
    const inlineMediaToggleLabel = showInlineMedia ? 'Hide inline media' : 'Show inline media';
    const openInlineMediaTarget = React.useCallback(
      (media: InlineAgentMedia) => {
        if (media.fileRef && onOpenFileReference) {
          onOpenFileReference(media.fileRef);
          return;
        }
        const target = String(media.linkHref ?? media.src ?? '').trim();
        if (!target) return;
        if (onOpenLink) {
          const handled = Boolean(onOpenLink(target));
          if (handled) return;
        }
        window.open(target, '_blank', 'noopener,noreferrer');
      },
      [onOpenFileReference, onOpenLink],
    );
    React.useEffect(() => {
      setFailedInlineMediaById({});
    }, [messageId]);
    return (
      <div className="animate-fade-in">
        <ChatMessageFrame role="user" at={promptIso} showRoleIcon={showRoleIcons}>
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
          messageId={messageId}
          onMouseEnter={() => onHoverAgentMessage(item)}
          onMouseLeave={() => onHoverAgentMessage(null)}
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
                text={displayedText}
                error={!item.ok}
                muted={showingTldr}
                preserveLeadParagraph
                toggleOnMessageClick
                onOpenFileReference={onOpenFileReference}
                onOpenLink={onOpenLink}
              />
              {actionsEnabled && item.ok && droneHubTasks.length > 0 ? (
                <DroneHubTaskList tasks={droneHubTasks} onSpawnTask={onSpawnDroneHubTask} />
              ) : null}
              {showInlineMedia && (
                <div className="mt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
                    {inlineMedia.map((media) => (
                      <div key={media.id} className="relative rounded-md bg-[rgba(0,0,0,.16)] overflow-hidden">
                        {media.kind === 'image' ? (
                          <button
                            type="button"
                            onClick={() => openInlineMediaTarget(media)}
                            className="block w-full"
                            title={`Open ${media.label} from message link`}
                          >
                            {failedInlineMediaById[media.id] ? (
                              <div className="min-h-[120px] flex items-center justify-center text-[11px] text-[var(--muted)] px-3 text-center">
                                Failed to load image.
                              </div>
                            ) : (
                              <img
                                src={media.src}
                                alt={media.label}
                                loading="lazy"
                                className="w-full h-auto max-h-[340px] object-contain bg-[var(--panel)]"
                                onError={() =>
                                  setFailedInlineMediaById((prev) => ({
                                    ...prev,
                                    [media.id]: true,
                                  }))
                                }
                              />
                            )}
                          </button>
                        ) : failedInlineMediaById[media.id] ? (
                          <div className="min-h-[120px] flex items-center justify-center text-[11px] text-[var(--muted)] px-3 text-center">
                            Failed to load video.
                          </div>
                        ) : (
                          <VideoPreview
                            src={media.src}
                            label={media.label}
                            className="block w-full max-h-[340px] bg-[var(--panel)]"
                            onError={() =>
                              setFailedInlineMediaById((prev) => ({
                                ...prev,
                                [media.id]: true,
                              }))
                            }
                          />
                        )}
                        {media.kind === 'video' ? (
                          <button
                            type="button"
                            onClick={() => openInlineMediaTarget(media)}
                            className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded border bg-[rgba(0,0,0,.55)] border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)]"
                            title={`Open ${media.label} from message link`}
                            aria-label={`Open ${media.label}`}
                          >
                            <IconOpen className="w-3.5 h-3.5 opacity-90" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <LinkedPullRequestCards
                text={cleanedAgentMessage}
                context={linkedPullRequestContext}
                onOpenLink={onOpenLink}
                className={item.agentPlan?.items.length ? undefined : 'mb-8 md:mb-0 md:mr-40'}
              />
              <AgentPlanList
                plan={item.agentPlan}
                className="mb-8 md:mb-0 md:mr-40"
              />

              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                <ChatMessageCopyAction text={cleanedAgentMessage} position="inline" />
                {inlineMedia.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setInlineImagesOverride(
                        messageId,
                        !inlineMediaVisible,
                      )
                    }
                    disabled={false}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity ${
                      showInlineMedia ? 'text-[var(--accent)] border-[var(--accent-muted)] bg-[rgba(0,0,0,.25)]' : 'text-[var(--muted)] border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)]'
                    } opacity-100 hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[rgba(0,0,0,.25)]`}
                    title={`${inlineMediaToggleLabel}${transcriptInlineImages ? ' (global default on)' : ''}`}
                    aria-label={inlineMediaToggleLabel}
                  >
                    <IconImage className="w-3.5 h-3.5 opacity-90" />
                  </button>
                )}
                {actionsEnabled ? (
                  <button
                    type="button"
                    onClick={() => onToggleTldr(item)}
                    disabled={false}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity ${
                      tldrLoading ? 'opacity-100 cursor-wait' : 'opacity-0 group-hover:opacity-100'
                    } ${
                      showingTldr ? 'text-[var(--accent)] border-[var(--accent-muted)] bg-[rgba(0,0,0,.25)]' : 'text-[var(--muted)] border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)]'
                    } hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[rgba(0,0,0,.25)]`}
                    title={
                      tldrStatus === 'error'
                        ? `TLDR failed: ${tldrError || 'unknown error'}`
                        : showingTldr
                          ? 'Show original (W)'
                          : 'Generate/show TLDR (W)'
                    }
                    aria-label="Toggle TLDR"
                  >
                    {tldrLoading ? <IconSpinner className="w-3.5 h-3.5 text-[var(--accent)]" /> : <IconTldr className="w-3.5 h-3.5 opacity-90" />}
                  </button>
                ) : null}

                {actionsEnabled && item.ok && (
                  <button
                    type="button"
                    onClick={() => onCreateJobs({ turn: item.turn, message: cleanedAgentMessage })}
                    disabled={parsingJobs}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity ${
                      parsingJobs ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    } ${
                      parsingJobs ? 'cursor-wait' : ''
                    } bg-[rgba(0,0,0,.15)] border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[rgba(0,0,0,.25)]`}
                    title="Create jobs from this agent message"
                    aria-label="Create jobs from this agent message"
                  >
                    {parsingJobs ? <IconSpinner className="w-3.5 h-3.5 text-[var(--accent)]" /> : <IconJobs className="w-3.5 h-3.5 opacity-90" />}
                  </button>
                )}
                {actionsEnabled && item.ok && dockerSnapshot && (dockerSnapshotBusy || dockerSnapshot.status === 'failed' || onRollbackDockerSnapshot) ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (canRollbackDockerSnapshot) void onRollbackDockerSnapshot?.(item);
                    }}
                    disabled={!canRollbackDockerSnapshot || dockerSnapshotBusy}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity ${
                      dockerSnapshotBusy ? 'opacity-100 cursor-wait' : 'opacity-0 group-hover:opacity-100'
                    } ${
                      canRollbackDockerSnapshot
                        ? 'bg-[rgba(0,0,0,.15)] border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[rgba(0,0,0,.25)]'
                        : dockerSnapshot.status === 'failed'
                          ? 'bg-[rgba(0,0,0,.15)] border-[rgba(255,90,90,.25)] text-[var(--red)]'
                          : 'bg-[rgba(0,0,0,.15)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
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
                      <IconSpinner className="w-3.5 h-3.5 text-[var(--accent)]" />
                    ) : (
                      <IconSnapshot className="w-3.5 h-3.5 opacity-90" />
                    )}
                  </button>
                ) : actionsEnabled && item.ok && dockerSnapshotsEnabled ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-[rgba(0,0,0,.15)] border-[var(--border-subtle)] text-[var(--muted-dim)] cursor-not-allowed"
                    title="No Docker snapshot exists for this message. Only messages completed after snapshots were enabled can be rolled back."
                    aria-label="No Docker snapshot for this message"
                  >
                    <IconSnapshot className="w-3.5 h-3.5 opacity-80" />
                  </button>
                ) : null}
              </div>
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
    a.showTldr === b.showTldr &&
    (a.tldr?.status ?? 'idle') === (b.tldr?.status ?? 'idle') &&
    ((a.tldr && a.tldr.status === 'ready' ? a.tldr.summary : '') === (b.tldr && b.tldr.status === 'ready' ? b.tldr.summary : '')) &&
    ((a.tldr && a.tldr.status === 'error' ? a.tldr.error : '') === (b.tldr && b.tldr.status === 'error' ? b.tldr.error : '')) &&
    a.onToggleTldr === b.onToggleTldr &&
    a.onRollbackDockerSnapshot === b.onRollbackDockerSnapshot &&
    a.onHoverAgentMessage === b.onHoverAgentMessage &&
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
