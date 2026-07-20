import React from 'react';

import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { VideoPreview } from '../media/VideoPreview';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { DroneHubTaskList } from './DroneHubTaskList';
import { LinkedPullRequestCards, type LinkedPullRequestContext } from './LinkedPullRequestCards';
import type { MarkdownFileReference } from './MarkdownMessage';
import { extractAgentCopilotFromAgentMessage } from './agent-copilot-parser';
import type { DroneHubTask } from './drone-hub-task-parser';
import { extractDroneHubTasksFromAgentMessage } from './drone-hub-task-parser';
import type { DroneHubTaskSpawnMode } from './drone-hub-task-spawn';
import { IconImage, IconJobs, IconOpen, IconSpinner } from './icons';
import { collectInlineAgentMedia, type InlineAgentMedia } from './inline-agent-media';

export type AgentMessageContent = {
  text: string;
  tasks: DroneHubTask[];
};

export function extractAgentMessageContent(text: string, enabled = true): AgentMessageContent {
  if (!enabled) return { text, tasks: [] };
  const taskData = extractDroneHubTasksFromAgentMessage(text);
  const copilotData = extractAgentCopilotFromAgentMessage(taskData.cleanedText);
  return { text: copilotData.cleanedText, tasks: taskData.tasks };
}

export type AgentMessageExtrasProps = {
  text: string;
  tasks: DroneHubTask[];
  messageId: string;
  parsingJobs?: boolean;
  actionsEnabled?: boolean;
  onCreateJobs?: (message: string) => void;
  onSpawnTask?: (
    mode: DroneHubTaskSpawnMode,
    task: DroneHubTask,
  ) => Promise<{ ok: boolean; error?: string | null }>;
  linkedPullRequestContext?: LinkedPullRequestContext;
  linkedCardsClassName?: string;
  droneId?: string;
  droneHomePath?: string;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  afterContent?: React.ReactNode;
  actionEnd?: React.ReactNode;
};

export function AgentMessageExtras({
  text,
  tasks,
  messageId,
  parsingJobs = false,
  actionsEnabled = true,
  onCreateJobs,
  onSpawnTask,
  linkedPullRequestContext,
  linkedCardsClassName,
  droneId,
  droneHomePath,
  onOpenFileReference,
  onOpenLink,
  afterContent,
  actionEnd,
}: AgentMessageExtrasProps) {
  const inlineMediaEnabled = useDroneHubUiStore((state) => state.transcriptInlineImages);
  const inlineMediaOverride = useDroneHubUiStore(
    (state) => state.transcriptInlineImageOverrides[messageId],
  );
  const setInlineMediaOverride = useDroneHubUiStore(
    (state) => state.setTranscriptInlineImageOverride,
  );
  const inlineMedia = React.useMemo(
    () => collectInlineAgentMedia(text, droneId, droneHomePath),
    [droneHomePath, droneId, text],
  );
  const [failedMediaById, setFailedMediaById] = React.useState<Record<string, true>>({});
  const inlineMediaVisible =
    typeof inlineMediaOverride === 'boolean' ? inlineMediaOverride : inlineMediaEnabled;
  const showInlineMedia = inlineMedia.length > 0 && inlineMediaVisible;
  const inlineMediaToggleLabel = showInlineMedia ? 'Hide inline media' : 'Show inline media';

  const openInlineMediaTarget = React.useCallback(
    (media: InlineAgentMedia) => {
      if (media.fileRef && onOpenFileReference) {
        onOpenFileReference(media.fileRef);
        return;
      }
      const target = String(media.linkHref ?? media.src ?? '').trim();
      if (!target) return;
      if (onOpenLink?.(target)) return;
      window.open(target, '_blank', 'noopener,noreferrer');
    },
    [onOpenFileReference, onOpenLink],
  );

  React.useEffect(() => {
    setFailedMediaById({});
  }, [messageId]);

  return (
    <>
      {actionsEnabled && onSpawnTask && tasks.length > 0 ? (
        <DroneHubTaskList tasks={tasks} onSpawnTask={onSpawnTask} />
      ) : null}

      {showInlineMedia ? (
        <div className="mt-2">
          <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2">
            {inlineMedia.map((media) => (
              <div
                key={media.id}
                className="relative overflow-hidden rounded-[var(--radius-medium)] bg-[var(--surface-inset)]"
              >
                {media.kind === 'image' ? (
                  <button
                    type="button"
                    onClick={() => openInlineMediaTarget(media)}
                    className="block w-full"
                    title={`Open ${media.label} from message link`}
                  >
                    {failedMediaById[media.id] ? (
                      <div className="flex min-h-[120px] items-center justify-center px-3 text-center text-[var(--text-11)] text-[var(--muted)]">
                        Failed to load image.
                      </div>
                    ) : (
                      <img
                        src={media.src}
                        alt={media.label}
                        loading="lazy"
                        className="h-auto max-h-[340px] w-full bg-[var(--panel)] object-contain"
                        onError={() =>
                          setFailedMediaById((current) => ({
                            ...current,
                            [media.id]: true,
                          }))
                        }
                      />
                    )}
                  </button>
                ) : failedMediaById[media.id] ? (
                  <div className="flex min-h-[120px] items-center justify-center px-3 text-center text-[var(--text-11)] text-[var(--muted)]">
                    Failed to load video.
                  </div>
                ) : (
                  <VideoPreview
                    src={media.src}
                    label={media.label}
                    className="block max-h-[340px] w-full bg-[var(--panel)]"
                    onError={() =>
                      setFailedMediaById((current) => ({
                        ...current,
                        [media.id]: true,
                      }))
                    }
                  />
                )}
                {media.kind === 'video' ? (
                  <button
                    type="button"
                    onClick={() => openInlineMediaTarget(media)}
                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--scrim-soft)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)]"
                    title={`Open ${media.label} from message link`}
                    aria-label={`Open ${media.label}`}
                  >
                    <IconOpen className="h-3.5 w-3.5 opacity-90" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <LinkedPullRequestCards
        text={text}
        context={linkedPullRequestContext}
        onOpenLink={onOpenLink}
        className={linkedCardsClassName}
      />
      {afterContent}

      <div className="absolute bottom-2 right-2 flex items-center gap-1">
        <ChatMessageCopyAction text={text} position="inline" />
        {inlineMedia.length > 0 ? (
          <button
            type="button"
            onClick={() => setInlineMediaOverride(messageId, !inlineMediaVisible)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded border opacity-100 transition-opacity ${
              showInlineMedia
                ? 'border-[var(--accent-muted)] bg-[var(--surface-inset-strong)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)]'
            } hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)]`}
            title={`${inlineMediaToggleLabel}${inlineMediaEnabled ? ' (global default on)' : ''}`}
            aria-label={inlineMediaToggleLabel}
          >
            <IconImage className="h-3.5 w-3.5 opacity-90" />
          </button>
        ) : null}
        {actionsEnabled && onCreateJobs && text.trim() ? (
          <button
            type="button"
            onClick={() => onCreateJobs(text)}
            disabled={parsingJobs}
            className={`inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)] transition-opacity hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)] ${
              parsingJobs ? 'cursor-wait opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            title="Create jobs from this agent message"
            aria-label="Create jobs from this agent message"
          >
            {parsingJobs ? (
              <IconSpinner className="h-3.5 w-3.5 text-[var(--accent)]" />
            ) : (
              <IconJobs className="h-3.5 w-3.5 opacity-90" />
            )}
          </button>
        ) : null}
        {actionEnd}
      </div>
    </>
  );
}
