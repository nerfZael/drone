import React from 'react';
import { stripAnsi, timeAgo } from '../../domain';
import type { PendingPrompt } from '../types';
import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import { IconBot, IconUser, TypingDots } from './icons';

export const PendingTranscriptTurn = React.memo(function PendingTranscriptTurn({ item, nowMs }: { item: PendingPrompt; nowMs: number }) {
  const isFailed = item.state === 'failed';
  return (
    <div className="animate-fade-in opacity-90">
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] min-w-[120px]">
          <div className="flex items-center justify-end gap-2 mb-1.5">
            <span
              className={`text-[9px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded border ${
                isFailed
                  ? 'text-[var(--red)] bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)]'
                  : 'text-[var(--muted-dim)] bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {isFailed ? 'Failed' : 'Pending'}
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
            <CollapsibleMarkdown text={item.prompt} fadeTo="var(--user-dim)" className="dh-markdown--user" />
          </div>
        </div>
        <div className="flex-shrink-0 w-7 h-7 rounded bg-[var(--user-subtle)] border border-[rgba(148,163,184,.15)] flex items-center justify-center mt-6 ml-3">
          <IconUser className="text-[var(--user)] w-3.5 h-3.5" />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded bg-[var(--accent-subtle)] border border-[rgba(167,139,250,.15)] flex items-center justify-center mt-6">
          <IconBot className="text-[var(--accent)] w-3.5 h-3.5" />
        </div>
        <div className="max-w-[85%] min-w-[120px]">
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
              <div className="text-[12.5px] leading-[1.6] text-[var(--muted)] flex items-center gap-2">
                <TypingDots color="var(--accent)" />
                {item.state === 'sending' ? 'Sending…' : item.state === 'sent' ? 'Waiting…' : 'Typing…'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
