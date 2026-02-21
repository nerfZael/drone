import React from 'react';
import { stripAnsi, timeAgo } from '../../domain';
import type { PendingPrompt } from '../types';
import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import type { MarkdownFileReference } from './MarkdownMessage';
import { IconBot, IconUser, TypingDots } from './icons';

const MANUAL_UNSTICK_STALE_MS = 2 * 60_000;

function parseTimeMs(raw: string | undefined): number | null {
  const ms = Date.parse(String(raw ?? ''));
  return Number.isFinite(ms) ? ms : null;
}

export const PendingTranscriptTurn = React.memo(function PendingTranscriptTurn({
  item,
  nowMs,
  showRoleIcons = true,
  onRequestUnstick,
  onOpenFileReference,
  onOpenLink,
  unstickBusy = false,
  unstickError = null,
}: {
  item: PendingPrompt;
  nowMs: number;
  showRoleIcons?: boolean;
  onRequestUnstick?: (promptId: string) => Promise<void> | void;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  unstickBusy?: boolean;
  unstickError?: string | null;
}) {
  const isFailed = item.state === 'failed';
  const badgeLabel = isFailed ? 'Failed' : item.state === 'queued' ? 'Queued' : 'Pending';
  const activeAtMs = parseTimeMs(item.updatedAt ?? item.at);
  const ageMs = activeAtMs == null ? 0 : Math.max(0, nowMs - activeAtMs);
  const canRequestUnstick =
    !isFailed &&
    (item.state === 'sending' || item.state === 'sent') &&
    ageMs >= MANUAL_UNSTICK_STALE_MS &&
    Boolean(onRequestUnstick);
  return (
    <div className="animate-fade-in opacity-90">
      <div className="flex justify-end mb-3">
        <div className={`${showRoleIcons ? 'max-w-[85%]' : 'max-w-full'} min-w-[120px]`}>
          <div className="flex items-center justify-end gap-2 mb-1.5">
            <span
              className={`text-[9px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded border ${
                isFailed
                  ? 'text-[var(--red)] bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)]'
                  : 'text-[var(--muted-dim)] bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {badgeLabel}
            </span>
            <span className="text-[9px] leading-none text-[var(--muted-dim)] font-mono" title={new Date(item.at).toLocaleString()}>
              {timeAgo(item.at, nowMs)}
            </span>
            <span
              className="text-[10px] font-semibold text-[var(--user-muted)] tracking-wide uppercase"
              style={{ fontFamily: 'var(--display)' }}
            >
              You
            </span>
          </div>
          <div className="bg-[var(--user-dim)] border border-[rgba(148,163,184,.14)] rounded-lg rounded-tr-sm px-4 py-3">
            <CollapsibleMarkdown
              text={item.prompt}
              fadeTo="var(--user-dim)"
              className="dh-markdown--user"
              onOpenFileReference={onOpenFileReference}
              onOpenLink={onOpenLink}
            />
          </div>
        </div>
        {showRoleIcons && (
          <div className="flex-shrink-0 w-7 h-7 rounded bg-[var(--user-subtle)] border border-[rgba(148,163,184,.15)] flex items-center justify-center mt-6 ml-3">
            <IconUser className="text-[var(--user)] w-3.5 h-3.5" />
          </div>
        )}
      </div>

      <div className={showRoleIcons ? 'flex gap-3' : 'flex'}>
        {showRoleIcons && (
          <div className="flex-shrink-0 w-7 h-7 rounded bg-[var(--accent-subtle)] border border-[rgba(167,139,250,.15)] flex items-center justify-center mt-6">
            <IconBot className="text-[var(--accent)] w-3.5 h-3.5" />
          </div>
        )}
        <div className={`${showRoleIcons ? 'max-w-[85%]' : 'max-w-full'} min-w-[120px]`}>
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-[10px] font-semibold text-[var(--accent)] tracking-wide uppercase"
              style={{ fontFamily: 'var(--display)' }}
            >
              Agent
            </span>
            <span className="text-[9px] leading-none text-[var(--muted-dim)] font-mono" title={new Date(item.at).toLocaleString()}>
              {timeAgo(item.at, nowMs)}
            </span>
          </div>
          <div
            className={`border rounded-lg rounded-tl-sm px-4 py-3 ${
              isFailed ? 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)]' : 'bg-[var(--accent-subtle)] border-[rgba(167,139,250,.12)]'
            }`}
          >
            {isFailed ? (
              <div className="text-[12.5px] leading-[1.6] text-[var(--red)] whitespace-pre-wrap">
                {stripAnsi(item.error || 'failed to send')}
              </div>
            ) : (
              <>
                <div className="text-[12.5px] leading-[1.6] text-[var(--muted)] flex items-center gap-2">
                  <TypingDots color="var(--accent)" />
                  {item.state === 'queued'
                    ? 'Queued…'
                    : item.state === 'sending'
                      ? 'Sending…'
                      : item.state === 'sent'
                        ? 'Waiting…'
                        : 'Typing…'}
                </div>
                {canRequestUnstick ? (
                  <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
                    <span className="text-[10px] text-[var(--muted-dim)]">Still waiting for agent completion.</span>
                    <button
                      type="button"
                      onClick={() => {
                        void onRequestUnstick?.(item.id);
                      }}
                      disabled={unstickBusy}
                      className={`inline-flex items-center h-5 px-1.5 rounded border text-[9px] font-semibold tracking-wide uppercase transition-all ${
                        unstickBusy
                          ? 'opacity-50 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)]'
                          : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                      title="Force-finalize this stuck prompt"
                    >
                      {unstickBusy ? 'Unsticking...' : 'Unstick'}
                    </button>
                  </div>
                ) : null}
                {unstickError ? (
                  <div className="mt-2 text-[10px] text-[var(--red)] whitespace-pre-wrap">{stripAnsi(unstickError)}</div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
