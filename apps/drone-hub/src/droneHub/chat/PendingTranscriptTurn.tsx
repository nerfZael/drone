import React from 'react';
import { stripAnsi } from '../../domain';
import type { PendingPrompt } from '../types';
import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { ChatMessageFrame } from './ChatMessageFrame';
import { ImageAttachmentChips, isAttachmentOnlyPrompt, normalizeImageAttachmentRefs } from './ImageAttachmentChips';
import type { MarkdownFileReference } from './MarkdownMessage';
import { RelativeTimeText } from './RelativeTimeText';
import { TypingDots } from './icons';
import { AgentPlanList } from './AgentPlanList';
import { WorkingElapsedStatus } from './WorkingElapsedStatus';

export const PendingTranscriptTurn = React.memo(function PendingTranscriptTurn({
  item,
  showRoleIcons = true,
  onCancelQueued,
  onOpenFileReference,
  onOpenLink,
  droneId,
  droneHomePath,
  cancelBusy = false,
  cancelError = null,
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
  const isStopped =
    isFailed && /stopped by user|stopped before submission|stopped because the drone was archived|stopped because the drone was deleted/i.test(String(item.error ?? ''));
  const badgeLabel = isStopped
    ? 'Stopped'
    : isFailed
      ? 'Failed'
      : item.state === 'queued'
        ? 'Queued'
        : null;
  const canCancelQueued = item.state === 'queued' && !item.automation && Boolean(onCancelQueued);
  const showAgentPendingBubble = !(item.state === 'queued' && !isFailed);
  const userCopyText = String(promptText ?? '');
  const agentCopyText = isFailed ? stripAnsi(item.error || 'failed to send') : 'Working…';
  const pendingHeader = badgeLabel || canCancelQueued ? (
    <>
      {badgeLabel ? (
        <span
          className={`rounded border px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide ${
            isFailed
              ? isStopped
                ? 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]'
                : 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          <span className="inline-flex items-center gap-1">
            {badgeLabel}
            {item.state === 'queued' && !isFailed ? <TypingDots color="var(--muted-dim)" /> : null}
          </span>
        </span>
      ) : null}
      {canCancelQueued ? (
        <button
          type="button"
          onClick={() => void onCancelQueued?.(item.id)}
          disabled={cancelBusy}
          className={`inline-flex h-5 items-center rounded border px-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide transition-all ${
            cancelBusy
              ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] opacity-100'
              : 'pointer-events-none border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] opacity-0 group-hover/pending-turn:pointer-events-auto group-hover/pending-turn:opacity-100 hover:border-[var(--red-border)] hover:text-[var(--red)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
          title="Cancel queued prompt"
        >
          {cancelBusy ? 'Canceling...' : 'Cancel'}
        </button>
      ) : null}
    </>
  ) : null;

  return (
    <div className={`group/pending-turn animate-fade-in ${isFailed || item.state === 'queued' ? 'opacity-90' : ''}`}>
      <ChatMessageFrame
        role="user"
        at={item.at}
        showRoleIcon={showRoleIcons}
        showRoleLabel={showRoleIcons}
        headerEnd={pendingHeader}
      >
        <ChatMessageCopyAction text={userCopyText} />
        {promptText ? (
          <CollapsibleMarkdown
            text={promptText}
            fadeTo="var(--user-bubble)"
            className="dh-markdown--user"
            onOpenFileReference={onOpenFileReference}
            onOpenLink={onOpenLink}
          />
        ) : null}
        <ImageAttachmentChips
          attachments={attachments}
          droneId={droneId}
          droneHomePath={droneHomePath}
          onOpenFileReference={onOpenFileReference}
        />
      </ChatMessageFrame>

      {showAgentPendingBubble ? (
        <ChatMessageFrame
          role="assistant"
          at={isFailed ? item.at : undefined}
          showRoleIcon={showRoleIcons}
          showRoleLabel={showRoleIcons}
          plainAssistant={!showRoleIcons}
          error={isFailed && !isStopped}
          warning={isStopped}
        >
          <ChatMessageCopyAction text={agentCopyText} />
          {isFailed ? (
            <div
              className={`whitespace-pre-wrap text-[var(--text-12-5)] leading-[1.6] ${
                isStopped ? 'text-[var(--yellow)]' : 'text-[var(--red)]'
              }`}
            >
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
              <AgentPlanList plan={item.agentPlan} running />
              {cancelError ? (
                <div className="mt-2 whitespace-pre-wrap text-[var(--text-10)] text-[var(--red)]">
                  {stripAnsi(cancelError)}
                </div>
              ) : null}
            </>
          )}
        </ChatMessageFrame>
      ) : cancelError ? (
        <div className="mt-2 whitespace-pre-wrap text-right text-[var(--text-10)] text-[var(--red)]">
          {stripAnsi(cancelError)}
        </div>
      ) : null}
    </div>
  );
});
