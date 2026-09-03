import React from 'react';
import type { AgentRunFileChanges } from '@blip/protocol';
import { normalizeAgentSkillUses, type AgentSkillUse } from '@drone/assistant-chat';

import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import type { AgentPlan } from '../types';
import { VideoPreview } from '../media/VideoPreview';
import { AgentPlanList } from './AgentPlanList';
import { LinkedPullRequestCards, type LinkedPullRequestContext } from './LinkedPullRequestCards';
import { LinkedChangeRequestCards } from './LinkedChangeRequestCards';
import type { MarkdownFileReference } from './MarkdownMessage';
import { IconImage, IconOpen } from './icons';
import { collectInlineAgentMedia, type InlineAgentMedia } from './inline-agent-media';
import { ChangedFilesCard } from './ChangedFilesCard';
import { prefetchSkillPillEditorData, SkillPillEditorDialog } from './SkillPillEditorDialog';

export function resolveInlineMediaToggleState(inlineMediaVisible: boolean): {
  active: boolean;
  label: 'Hide inline media' | 'Show inline media';
} {
  return inlineMediaVisible
    ? { active: false, label: 'Hide inline media' }
    : { active: true, label: 'Show inline media' };
}

export type AgentMessageExtrasProps = {
  text: string;
  messageId: string;
  actionsEnabled?: boolean;
  linkedPullRequestContext?: LinkedPullRequestContext;
  droneId?: string;
  droneHomePath?: string;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  plan?: AgentPlan;
  skillsUsed?: AgentSkillUse[];
  fileChanges?: AgentRunFileChanges;
  initiallyExpandFileChanges?: boolean;
  initiallyExpandLinkedPullRequests?: boolean;
  actionEnd?: React.ReactNode;
};

export function AgentMessageExtras({
  text,
  messageId,
  actionsEnabled = true,
  linkedPullRequestContext,
  droneId,
  droneHomePath,
  onOpenFileReference,
  onOpenLink,
  plan,
  skillsUsed,
  fileChanges,
  initiallyExpandFileChanges = false,
  initiallyExpandLinkedPullRequests = false,
  actionEnd,
}: AgentMessageExtrasProps) {
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
  const [editingSkillName, setEditingSkillName] = React.useState<string | null>(null);
  const inlineMediaVisible = inlineMediaOverride !== false;
  const showInlineMedia = inlineMedia.length > 0 && inlineMediaVisible;
  const inlineMediaToggle = resolveInlineMediaToggleState(inlineMediaVisible);
  const hasPlan = Boolean(plan?.items.length);
  const normalizedSkillsUsed = normalizeAgentSkillUses(skillsUsed);
  const hasMessageActions = inlineMedia.length > 0 || Boolean(actionEnd);

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

  const messageActions = (
    <>
      {inlineMedia.length > 0 ? (
        <button
          type="button"
          onClick={() => setInlineMediaOverride(messageId, !inlineMediaVisible)}
          className={`pointer-events-none inline-flex h-7 w-7 items-center justify-center rounded border opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 ${
            inlineMediaToggle.active
              ? 'border-[var(--accent-muted)] bg-[var(--surface-inset-strong)] text-[var(--accent)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)]'
          } hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)]`}
          title={inlineMediaToggle.label}
          aria-label={inlineMediaToggle.label}
          aria-pressed={inlineMediaToggle.active}
        >
          <IconImage className="h-3.5 w-3.5 opacity-90" />
        </button>
      ) : null}
      {actionEnd}
    </>
  );

  return (
    <>
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

      <ChangedFilesCard
        fileChanges={fileChanges}
        initiallyExpanded={initiallyExpandFileChanges}
      />
      <LinkedPullRequestCards
        text={text}
        context={linkedPullRequestContext}
        onOpenLink={onOpenLink}
        initiallyExpanded={initiallyExpandLinkedPullRequests}
      />
      <LinkedChangeRequestCards
        text={text}
        droneId={droneId}
        disabled={
          !actionsEnabled ||
          Boolean(
            linkedPullRequestContext &&
            (!linkedPullRequestContext.repoAttached || linkedPullRequestContext.disabled),
          )
        }
        initiallyExpanded={initiallyExpandLinkedPullRequests}
      />
      <AgentPlanList
        plan={plan}
        headerActions={hasPlan && hasMessageActions ? messageActions : undefined}
      />

      {normalizedSkillsUsed.length > 0 ? (
        <div
          data-agent-skills-used="true"
          aria-label="Skills used by this agent run"
          className="mt-2 flex flex-wrap items-center gap-1.5"
        >
          {normalizedSkillsUsed.map((skill) => (
            <button
              type="button"
              key={skill.name.toLowerCase()}
              title={`Edit ${skill.name} skill`}
              aria-haspopup="dialog"
              onPointerEnter={() => void prefetchSkillPillEditorData()}
              onFocus={() => void prefetchSkillPillEditorData()}
              onClick={() => setEditingSkillName(skill.name)}
              className="inline-flex max-w-full items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-0.5 font-mono text-[var(--text-10)] text-[var(--muted)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <span className="truncate">{skill.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {editingSkillName ? (
        <SkillPillEditorDialog
          skillName={editingSkillName}
          onClose={() => setEditingSkillName(null)}
        />
      ) : null}

      {!hasPlan && hasMessageActions ? (
        <div
          data-agent-message-actions="true"
          className="mt-1 flex min-h-7 items-center justify-end gap-1"
        >
          {messageActions}
        </div>
      ) : null}
    </>
  );
}
