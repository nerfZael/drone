import React from 'react';
import { stripAnsi, timeAgo } from '../../domain';
import type { TranscriptItem } from '../types';
import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import { IconBot, IconJobs, IconSpinner, IconUser } from './icons';

export const TranscriptTurn = React.memo(
  function TranscriptTurn({
    item,
    nowMs,
    parsingJobs,
    onCreateJobs,
  }: {
    item: TranscriptItem;
    nowMs: number;
    parsingJobs: boolean;
    onCreateJobs: (opts: { turn: number; message: string }) => void;
  }) {
    const cleaned = item.ok ? stripAnsi(item.output) : stripAnsi(item.error || 'failed');
    const promptIso = item.promptAt || item.at;
    const agentIso = item.completedAt || item.at;
    return (
      <div className="animate-fade-in">
        {/* User message */}
        <div className="flex justify-end mb-3">
          <div className="max-w-[85%] min-w-[120px]">
            <div className="flex items-center justify-end gap-2 mb-1.5">
              <span className="text-[9px] leading-none text-[var(--muted-dim)] font-mono"
                title={new Date(promptIso).toLocaleString()}
              >
                {timeAgo(promptIso, nowMs)}
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

        {/* Agent response */}
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
              <span className="text-[9px] leading-none text-[var(--muted-dim)] font-mono"
                title={new Date(agentIso).toLocaleString()}
              >
                {timeAgo(agentIso, nowMs)}
              </span>
            </div>
            <div
              className={`border rounded-lg rounded-tl-sm px-4 py-3 relative group ${
                item.ok
                  ? 'bg-[var(--accent-subtle)] border-[rgba(167,139,250,.12)]'
                  : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)]'
              }`}
            >
              <CollapsibleMarkdown
                text={cleaned}
                fadeTo={item.ok ? 'var(--accent-subtle)' : 'var(--red-subtle)'}
                className={item.ok ? 'dh-markdown--muted' : 'dh-markdown--error'}
                preserveLeadParagraph
              />

              {item.ok && (
                <button
                  type="button"
                  onClick={() => onCreateJobs({ turn: item.turn, message: cleaned })}
                  disabled={parsingJobs}
                  className={`absolute bottom-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity ${
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
            </div>
          </div>
        </div>
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
    (a.item.error ?? '') === (b.item.error ?? '') &&
    a.nowMs === b.nowMs &&
    a.parsingJobs === b.parsingJobs &&
    a.onCreateJobs === b.onCreateJobs,
);
