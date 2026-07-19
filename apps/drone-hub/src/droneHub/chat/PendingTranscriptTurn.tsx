import React from 'react';
import { stripAnsi } from '../../domain';
import type { PendingPrompt } from '../types';
import { copyText } from '../app/clipboard';
import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import { ChatMessageFrame } from './ChatMessageFrame';
import { ImageAttachmentChips, isAttachmentOnlyPrompt, normalizeImageAttachmentRefs } from './ImageAttachmentChips';
import type { MarkdownFileReference } from './MarkdownMessage';
import { RelativeTimeText } from './RelativeTimeText';
import { IconCopy, TypingDots } from './icons';
import { AgentPlanList } from './AgentPlanList';

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
  const [copiedToastRole, setCopiedToastRole] = React.useState<'user' | 'agent' | null>(null);
  const copiedToastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const badgeLabel = isStopped ? 'Stopped' : isFailed ? 'Failed' : item.state === 'queued' ? 'Queued' : 'Pending';
  const canCancelQueued = item.state === 'queued' && !item.automation && Boolean(onCancelQueued);
  const showAgentPendingBubble = !(item.state === 'queued' && !isFailed);
  const userCopyText = String(promptText ?? '');
  const agentCopyText = isFailed
    ? stripAnsi(item.error || 'failed to send')
    : item.state === 'sending'
      ? 'Sending…'
      : item.state === 'sent'
        ? 'Waiting…'
        : 'Typing…';
  const showCopiedToast = React.useCallback((role: 'user' | 'agent') => {
    setCopiedToastRole(role);
    if (copiedToastTimerRef.current != null) clearTimeout(copiedToastTimerRef.current);
    copiedToastTimerRef.current = setTimeout(() => {
      setCopiedToastRole((prev) => (prev === role ? null : prev));
      copiedToastTimerRef.current = null;
    }, 1200);
  }, []);
  React.useEffect(
    () => () => {
      if (copiedToastTimerRef.current != null) {
        clearTimeout(copiedToastTimerRef.current);
        copiedToastTimerRef.current = null;
      }
    },
    [],
  );
  React.useEffect(() => {
    setCopiedToastRole(null);
  }, [item.id, item.state, item.updatedAt]);

  const pendingHeader = (
    <>
      <span
        className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
          isFailed
            ? isStopped
              ? 'border-[rgba(255,178,36,.2)] bg-[var(--yellow-subtle)] text-[var(--yellow)]'
              : 'border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] text-[var(--red)]'
            : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
        }`}
        style={{ fontFamily: 'var(--display)' }}
      >
        <span className="inline-flex items-center gap-1">
          {badgeLabel}
          {item.state === 'queued' && !isFailed ? <TypingDots color="var(--muted-dim)" /> : null}
        </span>
      </span>
      {canCancelQueued ? (
        <button
          type="button"
          onClick={() => void onCancelQueued?.(item.id)}
          disabled={cancelBusy}
          className={`inline-flex h-5 items-center rounded border px-1.5 text-[9px] font-semibold uppercase tracking-wide transition-all ${
            cancelBusy
              ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] opacity-100'
              : 'pointer-events-none border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-0 group-hover/pending-turn:pointer-events-auto group-hover/pending-turn:opacity-100 hover:border-[rgba(255,90,90,.35)] hover:text-[var(--red)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
          title="Cancel queued prompt"
        >
          {cancelBusy ? 'Canceling...' : 'Cancel'}
        </button>
      ) : null}
    </>
  );

  return (
    <div className="group/pending-turn animate-fade-in opacity-90">
      <ChatMessageFrame role="user" at={item.at} showRoleIcon={showRoleIcons} headerEnd={pendingHeader}>
        {copiedToastRole === 'user' ? (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute right-10 top-2 z-20 rounded border border-[rgba(148,163,184,.28)] bg-[rgba(0,0,0,.42)] px-2 py-0.5 text-[9px] uppercase tracking-wide text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Copied
          </div>
        ) : null}
        {userCopyText.length > 0 ? (
          <button
            type="button"
            onClick={() => void copyText(userCopyText).then(() => showCopiedToast('user'))}
            className="pointer-events-none absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] text-[var(--muted)] opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:border-[var(--user-muted)] hover:bg-[rgba(0,0,0,.25)] hover:text-[var(--user)] focus-visible:pointer-events-auto focus-visible:opacity-100"
            title="Copy user message"
            aria-label="Copy user message"
          >
            <IconCopy className="h-3.5 w-3.5 opacity-90" />
          </button>
        ) : null}
        {promptText ? (
          <CollapsibleMarkdown
            text={promptText}
            fadeTo="var(--user-dim)"
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
          at={item.at}
          showRoleIcon={showRoleIcons}
          error={isFailed && !isStopped}
          warning={isStopped}
        >
              {copiedToastRole === 'agent' ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="absolute top-2 right-10 z-20 pointer-events-none rounded border border-[rgba(148,163,184,.28)] bg-[rgba(0,0,0,.42)] px-2 py-0.5 text-[9px] uppercase tracking-wide text-[var(--fg-secondary)]"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Copied
                </div>
              ) : null}
              {agentCopyText.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    void copyText(agentCopyText).then(() => showCopiedToast('agent'));
                  }}
                  className="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity pointer-events-none opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto bg-[rgba(0,0,0,.15)] border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[rgba(0,0,0,.25)]"
                  title="Copy agent message"
                  aria-label="Copy agent message"
                >
                  <IconCopy className="w-3.5 h-3.5 opacity-90" />
                </button>
              ) : null}
              {isFailed ? (
                <div
                  className={`text-[12.5px] leading-[1.6] whitespace-pre-wrap ${
                    isStopped ? 'text-[var(--yellow)]' : 'text-[var(--red)]'
                  }`}
                >
                  {stripAnsi(item.error || 'failed to send')}
                </div>
              ) : (
                <>
                  <div className="text-[12.5px] leading-[1.6] text-[var(--muted)] flex items-center gap-2">
                    <TypingDots color="var(--accent)" />
                    {item.state === 'sending' ? 'Sending…' : item.state === 'sent' ? 'Waiting…' : 'Typing…'}
                  </div>
                  {observability ? (
                    <div className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-[10.5px] leading-[1.45] text-[var(--yellow)]">
                      <div>{observability.message}</div>
                      {observability.lastCheckedAt ? (
                        <div className="mt-0.5 text-[9px] text-[var(--muted-dim)] font-mono">
                          Last checked <RelativeTimeText at={observability.lastCheckedAt} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <AgentPlanList plan={item.agentPlan} running />
                  {cancelError ? (
                    <div className="mt-2 text-[10px] text-[var(--red)] whitespace-pre-wrap">{stripAnsi(cancelError)}</div>
                  ) : null}
                </>
              )}
        </ChatMessageFrame>
      ) : cancelError ? (
        <div className="mt-2 text-[10px] text-[var(--red)] whitespace-pre-wrap text-right">{stripAnsi(cancelError)}</div>
      ) : null}
    </div>
  );
});
