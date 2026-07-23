import React from 'react';
import { isStoppedRunError } from '@drone/assistant-chat';
import { stripAnsi } from '../../domain';
import type { PendingPrompt } from '../types';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { ChatMessageFrame } from './ChatMessageFrame';
import { ImageAttachmentChips, isAttachmentOnlyPrompt, normalizeImageAttachmentRefs } from './ImageAttachmentChips';
import type { MarkdownFileReference } from './MarkdownMessage';
import { RelativeTimeText } from './RelativeTimeText';
import { AgentPlanList } from './AgentPlanList';
import { WorkingElapsedStatus } from './WorkingElapsedStatus';
import { UserChatMessage } from './UserChatMessage';
import { ChangedFilesCard } from './ChangedFilesCard';
import { StoppedRunNotice } from './StoppedRunNotice';

export const PendingTranscriptTurn = React.memo(function PendingTranscriptTurn({
  item,
  showRoleIcons = false,
  onCancelQueued,
  onOpenFileReference,
  onOpenLink,
  droneId,
  droneHomePath,
  cancelBusy = false,
  cancelError = null,
  autoExpandPrompt = false,
}: {
  item: PendingPrompt;
  showRoleIcons?: boolean;
  onCancelQueued?: (promptId: string) => Promise<void> | void;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  droneId?: string;
  droneHomePath?: string;
  cancelBusy?: boolean;
  cancelError?: string | null;
  autoExpandPrompt?: boolean;
}) {
  const attachments = normalizeImageAttachmentRefs((item as any).attachments);
  const promptText = isAttachmentOnlyPrompt(item.prompt, attachments) ? '' : item.prompt;
  const isFailed = item.state === 'failed';
  const observability =
    item.observability?.state === 'status-unavailable'
      ? {
          message: String(item.observability.message ?? '').trim() || 'Prompt status is temporarily unavailable.',
          lastCheckedAt: String(item.observability.lastCheckedAt ?? '').trim(),
          lastError: String(item.observability.lastError ?? '').trim(),
        }
      : null;
  const isStopped = isFailed && isStoppedRunError(item.error);
  const badgeLabel = isFailed && !isStopped ? 'Failed' : null;
  const canCancelQueued = item.state === 'queued' && Boolean(onCancelQueued);
  const showAgentPendingBubble = !(item.state === 'queued' && !isFailed);
  const agentCopyText = isFailed ? stripAnsi(item.error || 'failed to send') : 'Working…';
  const queuedFooter = item.state === 'queued' ? (
    <div className="mt-2 flex items-center justify-between gap-3">
      <span
        role="status"
        aria-label={
          item.deliveryMode === 'asap'
            ? 'ASAP, waiting for the next safe delivery point'
            : 'Queued, waiting to send'
        }
        title={
          item.deliveryMode === 'asap'
            ? 'Will run before queued follow-ups'
            : 'Waiting to send'
        }
        className="inline-flex items-center gap-1.5 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--user-muted)]"
      >
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.35" />
          <path
            d="M8 4.75V8l2.1 1.35"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {item.deliveryMode === 'asap' ? 'ASAP' : 'Queued'}
      </span>
      {canCancelQueued ? (
        <button
          type="button"
          onClick={() => void onCancelQueued?.(item.id)}
          disabled={cancelBusy}
          className="inline-flex min-h-5 items-center rounded px-1 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)] transition-colors hover:bg-[var(--red-subtle)] hover:text-[var(--red)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--red)] disabled:cursor-not-allowed disabled:text-[var(--muted-dim)]"
          aria-label="Cancel queued prompt"
          title="Cancel queued prompt"
        >
          {cancelBusy ? 'Canceling…' : 'Cancel'}
        </button>
      ) : null}
    </div>
  ) : null;
  const pendingHeader = badgeLabel ? (
    <span
      className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--red)]"
      style={{ fontFamily: 'var(--display)' }}
    >
      {badgeLabel}
    </span>
  ) : null;

  return (
    <div className={`animate-fade-in ${isFailed && !isStopped ? 'opacity-90' : ''}`}>
      <UserChatMessage
        at={item.at}
        showRoleIcons={showRoleIcons}
        headerEnd={pendingHeader}
        text={promptText}
        autoExpand={autoExpandPrompt}
        onOpenFileReference={onOpenFileReference}
        onOpenLink={onOpenLink}
        attachmentContent={(
          <>
            <ImageAttachmentChips
              attachments={attachments}
              droneId={droneId}
              droneHomePath={droneHomePath}
              onOpenFileReference={onOpenFileReference}
            />
            {queuedFooter}
          </>
        )}
      />

      {isStopped ? (
        <>
          <StoppedRunNotice reason={item.error} at={item.updatedAt ?? item.at} />
          <ChangedFilesCard fileChanges={item.fileChanges} />
        </>
      ) : showAgentPendingBubble ? (
        <ChatMessageFrame
          role="assistant"
          at={isFailed ? item.at : undefined}
          showRoleIcon={showRoleIcons}
          showRoleLabel={showRoleIcons}
          plainAssistant={!showRoleIcons}
          error={isFailed}
        >
          <ChatMessageCopyAction text={agentCopyText} />
          {isFailed ? (
            <div className="whitespace-pre-wrap text-[var(--text-12-5)] leading-[1.6] text-[var(--red)]">
              {stripAnsi(item.error || 'failed to send')}
            </div>
          ) : (
            <>
              <WorkingElapsedStatus startedAt={item.at} />
              {observability ? (
                <div className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-[var(--text-10-5)] leading-[1.45] text-[var(--yellow)]">
                  <div>{observability.message}</div>
                  {observability.lastCheckedAt ? (
                    <div className="mt-0.5 font-mono text-[var(--text-9)] text-[var(--muted-dim)]">
                      Last checked <RelativeTimeText at={observability.lastCheckedAt} />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <AgentPlanList plan={item.agentPlan} running showTopDivider={false} />
              {cancelError ? (
                <div className="mt-2 whitespace-pre-wrap text-[var(--text-10)] text-[var(--red)]">
                  {stripAnsi(cancelError)}
                </div>
              ) : null}
            </>
          )}
          <ChangedFilesCard fileChanges={item.fileChanges} />
        </ChatMessageFrame>
      ) : cancelError ? (
        <div className="mt-2 whitespace-pre-wrap text-right text-[var(--text-10)] text-[var(--red)]">
          {stripAnsi(cancelError)}
        </div>
      ) : null}
    </div>
  );
});
