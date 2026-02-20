import React from 'react';
import { stripAnsi, timeAgo } from '../../domain';
import type { TranscriptItem } from '../types';
import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import { IconBot, IconJobs, IconSpinner, IconTldr, IconUser } from './icons';

type TldrState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: string }
  | { status: 'error'; error: string };

export const TranscriptTurn = React.memo(
  function TranscriptTurn({
    item,
    nowMs,
    parsingJobs,
    onCreateJobs,
    messageId,
    tldr,
    showTldr,
    onToggleTldr,
    onHoverAgentMessage,
    showRoleIcons = true,
  }: {
    item: TranscriptItem;
    nowMs: number;
    parsingJobs: boolean;
    onCreateJobs: (opts: { turn: number; message: string }) => void;
    messageId: string;
    tldr: TldrState | null;
    showTldr: boolean;
    onToggleTldr: (item: TranscriptItem) => void;
    onHoverAgentMessage: (item: TranscriptItem | null) => void;
    showRoleIcons?: boolean;
  }) {
    const cleaned = item.ok ? stripAnsi(item.output) : stripAnsi(item.error || 'failed');
    const promptIso = item.promptAt || item.at;
    const agentIso = item.completedAt || item.at;
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
      : cleaned;
    return (
      <div className="animate-fade-in">
        {/* User message */}
        <div className="flex justify-end mb-3">
          <div className={`${showRoleIcons ? 'max-w-[85%]' : 'max-w-full'} min-w-[120px]`}>
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
          {showRoleIcons && (
            <div className="flex-shrink-0 w-7 h-7 rounded bg-[var(--user-subtle)] border border-[rgba(148,163,184,.15)] flex items-center justify-center mt-6 ml-3">
              <IconUser className="text-[var(--user)] w-3.5 h-3.5" />
            </div>
          )}
        </div>

        {/* Agent response */}
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
              onMouseEnter={() => onHoverAgentMessage(item)}
              onMouseLeave={() => onHoverAgentMessage(null)}
              data-message-id={messageId}
            >
              <CollapsibleMarkdown
                text={displayedText}
                fadeTo={item.ok ? 'var(--accent-subtle)' : 'var(--red-subtle)'}
                className={showingTldr ? 'dh-markdown--muted' : item.ok ? 'dh-markdown--agent' : 'dh-markdown--error'}
                preserveLeadParagraph
              />

              <div className="absolute bottom-2 right-2 flex items-center gap-1">
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

                {item.ok && (
                  <button
                    type="button"
                    onClick={() => onCreateJobs({ turn: item.turn, message: cleaned })}
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
              </div>
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
    a.onCreateJobs === b.onCreateJobs &&
    a.messageId === b.messageId &&
    a.showTldr === b.showTldr &&
    (a.tldr?.status ?? 'idle') === (b.tldr?.status ?? 'idle') &&
    ((a.tldr && a.tldr.status === 'ready' ? a.tldr.summary : '') === (b.tldr && b.tldr.status === 'ready' ? b.tldr.summary : '')) &&
    ((a.tldr && a.tldr.status === 'error' ? a.tldr.error : '') === (b.tldr && b.tldr.status === 'error' ? b.tldr.error : '')) &&
    a.onToggleTldr === b.onToggleTldr &&
    a.onHoverAgentMessage === b.onHoverAgentMessage &&
    (a.showRoleIcons ?? true) === (b.showRoleIcons ?? true),
);
