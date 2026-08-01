import React from 'react';
import {
  isStoppedRunError,
  normalizeAgentRunActivity,
  resolveChatQueueActionPresentation,
} from '@drone/assistant-chat';
import { stripAnsi } from '../../domain';
import type { PendingPrompt } from '../types';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { ChatMessageFrame } from './ChatMessageFrame';
import {
  ImageAttachmentChips,
  isAttachmentOnlyPrompt,
  normalizeImageAttachmentRefs,
} from './ImageAttachmentChips';
import type { MarkdownFileReference } from './MarkdownMessage';
import { RelativeTimeText } from './RelativeTimeText';
import { AgentPlanList } from './AgentPlanList';
import { WorkingElapsedStatus } from './WorkingElapsedStatus';
import { UserChatMessage } from './UserChatMessage';
import { ChangedFilesCard } from './ChangedFilesCard';
import { StoppedRunNotice } from './StoppedRunNotice';
import { AgentRunActivityView } from '../assistant/AgentRunActivityView';
import {
  isSubscriptionEventPrompt,
  SubscriptionEventBadge,
} from './SubscriptionEventBadge';

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
  initiallyExpandFileChanges = false,
  onCreateNewChatNow,
  createNewChatBusy = false,
  createNewChatError = null,
  autoFocusCreateNewChat = false,
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
  initiallyExpandFileChanges?: boolean;
  onCreateNewChatNow?: (promptId: string) => Promise<void> | void;
  createNewChatBusy?: boolean;
  createNewChatError?: string | null;
  autoFocusCreateNewChat?: boolean;
}) {
  const attachments = normalizeImageAttachmentRefs((item as any).attachments);
  const promptText = isAttachmentOnlyPrompt(item.prompt, attachments) ? '' : item.prompt;
  const isSubscriptionEvent = isSubscriptionEventPrompt(item.prompt);
  const isFailed = item.state === 'failed';
  const observability =
    item.observability?.state === 'status-unavailable'
      ? {
          message:
            String(item.observability.message ?? '').trim() ||
            'Prompt status is temporarily unavailable.',
          lastCheckedAt: String(item.observability.lastCheckedAt ?? '').trim(),
          lastError: String(item.observability.lastError ?? '').trim(),
        }
      : null;
  const isStopped = isFailed && isStoppedRunError(item.error);
  const activity = normalizeAgentRunActivity(item.activity);
  const runStartedAt = item.startedAt ?? null;
  const badgeLabel = isFailed && !isStopped ? 'Failed' : null;
  const actionPresentation = resolveChatQueueActionPresentation(item.action, item.state);
  const canCancelQueued =
    Boolean(onCancelQueued) && (actionPresentation?.canCancel ?? item.state === 'queued');
  const createNowRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!autoFocusCreateNewChat || !actionPresentation?.canExecuteNow) return;
    createNowRef.current?.focus();
  }, [actionPresentation?.canExecuteNow, autoFocusCreateNewChat]);
  const showAgentPendingBubble = !actionPresentation && !(item.state === 'queued' && !isFailed);
  const agentCopyText = isFailed ? stripAnsi(item.error || 'failed to send') : 'Working…';
  const queuedFooter =
    item.state === 'queued' ? (
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-2">
        <span
          role="status"
          aria-label={
            actionPresentation
              ? 'Queued, waiting to create a fresh chat'
              : item.deliveryMode === 'asap'
                ? 'ASAP, waiting for the next safe delivery point'
                : 'Queued, waiting to send'
          }
          title={
            actionPresentation
              ? 'Creates a fresh chat after earlier messages finish'
              : item.deliveryMode === 'asap'
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
          {actionPresentation
            ? 'Waiting to create a fresh chat'
            : item.deliveryMode === 'asap'
              ? 'ASAP'
              : 'Queued'}
        </span>
        <div className="flex items-center gap-1.5">
          {actionPresentation?.canExecuteNow && onCreateNewChatNow ? (
            <button
              ref={createNowRef}
              type="button"
              onClick={() => void onCreateNewChatNow(item.id)}
              disabled={createNewChatBusy || cancelBusy}
              className="inline-flex min-h-7 items-center rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createNewChatBusy ? 'Creating…' : 'Create now'}
            </button>
          ) : null}
          {canCancelQueued ? (
            <button
              type="button"
              onClick={() => void onCancelQueued?.(item.id)}
              disabled={cancelBusy || createNewChatBusy}
              className="inline-flex min-h-5 items-center rounded px-1 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)] transition-colors hover:bg-[var(--red-subtle)] hover:text-[var(--red)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--red)] disabled:cursor-not-allowed disabled:text-[var(--muted-dim)]"
              aria-label={actionPresentation ? 'Cancel queued new chat' : 'Cancel queued prompt'}
              title={actionPresentation ? 'Cancel queued new chat' : 'Cancel queued prompt'}
            >
              {cancelBusy ? 'Canceling…' : 'Cancel'}
            </button>
          ) : null}
        </div>
      </div>
    ) : null;
  const statusBadge = actionPresentation ? (
    <span
      className={`rounded border px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide ${actionPresentation.state === 'failed' ? 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]' : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'}`}
      style={{ fontFamily: 'var(--display)' }}
    >
      {actionPresentation.label}
    </span>
  ) : badgeLabel ? (
    <span
      className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--red)]"
      style={{ fontFamily: 'var(--display)' }}
    >
      {badgeLabel}
    </span>
  ) : null;
  const pendingHeader = statusBadge || isSubscriptionEvent ? (
    <span className="inline-flex items-center gap-1.5">
      {isSubscriptionEvent ? <SubscriptionEventBadge /> : null}
      {statusBadge}
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
        attachmentContent={
          <>
            <ImageAttachmentChips
              attachments={attachments}
              droneId={droneId}
              droneHomePath={droneHomePath}
              onOpenFileReference={onOpenFileReference}
            />
            {queuedFooter}
            {actionPresentation?.state === 'failed' && item.error ? (
              <div className="mt-2 whitespace-pre-wrap text-[var(--text-10)] text-[var(--red)]">
                {stripAnsi(item.error)}
              </div>
            ) : null}
            {createNewChatError ? (
              <div className="mt-2 text-[var(--text-10)] text-[var(--red)]">
                {stripAnsi(createNewChatError)}
              </div>
            ) : null}
          </>
        }
      />

      {activity && !isFailed ? (
        <AgentRunActivityView
          activity={activity}
          active
          startedAt={runStartedAt}
          plan={item.agentPlan}
        />
      ) : null}
      {activity && isFailed ? (
        <AgentRunActivityView
          activity={activity}
          startedAt={runStartedAt}
          endedAt={item.updatedAt ?? item.at}
          at={item.updatedAt ?? item.at}
          plan={item.agentPlan}
        />
      ) : null}

      {isStopped ? (
        <>
          <StoppedRunNotice reason={item.error} at={item.updatedAt ?? item.at} />
          <ChangedFilesCard
            fileChanges={item.fileChanges}
            initiallyExpanded={initiallyExpandFileChanges}
          />
        </>
      ) : showAgentPendingBubble ? (
        <ChatMessageFrame
          role="assistant"
          at={isFailed ? item.at : undefined}
          showRoleIcon={showRoleIcons}
          showRoleLabel={showRoleIcons}
          plainAssistant={!showRoleIcons}
          error={isFailed}
          hoverActions={<ChatMessageCopyAction text={agentCopyText} position="hover-rail" />}
        >
          {isFailed ? (
            <div className="whitespace-pre-wrap text-[var(--text-12-5)] leading-[1.6] text-[var(--red)]">
              {stripAnsi(item.error || 'failed to send')}
            </div>
          ) : (
            <>
              {!activity ? <WorkingElapsedStatus startedAt={runStartedAt} /> : null}
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
              <AgentPlanList
                plan={activity ? undefined : item.agentPlan}
                running
                showTopDivider={false}
              />
              {cancelError ? (
                <div className="mt-2 whitespace-pre-wrap text-[var(--text-10)] text-[var(--red)]">
                  {stripAnsi(cancelError)}
                </div>
              ) : null}
            </>
          )}
          <ChangedFilesCard
            fileChanges={item.fileChanges}
            initiallyExpanded={initiallyExpandFileChanges}
          />
        </ChatMessageFrame>
      ) : cancelError ? (
        <div className="mt-2 whitespace-pre-wrap text-right text-[var(--text-10)] text-[var(--red)]">
          {stripAnsi(cancelError)}
        </div>
      ) : null}
    </div>
  );
});
