import React from 'react';
import { stripAnsi, timeAgo } from '../../domain';
import type { PendingPrompt, TranscriptItem } from '../types';
import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import type { MarkdownFileReference } from './MarkdownMessage';

const PROMPT_PREVIEW_MAX_CHARS = 220;

type PromptLoopPromptLike = {
  prompt?: string;
  automation?: TranscriptItem['automation'] | PendingPrompt['automation'];
};

type PromptLoopTranscriptRow = {
  rowKey: string;
  runIndex: number;
  atIso: string;
  status: 'done' | 'failed' | 'pending';
  statusLabel: string;
  output: string;
  outputClassName?: string;
  fadeTo: string;
};

function normalizeRunIndex(item: PromptLoopPromptLike, fallback: number): number {
  const raw = Number(item.automation?.runIndex);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return fallback;
}

function resolvePromptText(runs: TranscriptItem[], pendingRuns: PendingPrompt[]): string {
  const fromPrompt = String(runs[0]?.prompt ?? '').trim();
  if (fromPrompt) return fromPrompt;
  const fromPendingPrompt = String(pendingRuns[0]?.prompt ?? '').trim();
  if (fromPendingPrompt) return fromPendingPrompt;
  for (const run of runs) {
    const preview = String(run.automation?.promptPreview ?? '').trim();
    if (preview) return preview;
  }
  for (const run of pendingRuns) {
    const preview = String(run.automation?.promptPreview ?? '').trim();
    if (preview) return preview;
  }
  return '';
}

function resolveAutomationLabel(runs: TranscriptItem[], pendingRuns: PendingPrompt[]): string {
  for (const run of runs) {
    const label = String(run.automation?.automationLabel ?? '').trim();
    if (label) return label;
  }
  for (const run of pendingRuns) {
    const label = String(run.automation?.automationLabel ?? '').trim();
    if (label) return label;
  }
  for (const run of runs) {
    const id = String(run.automation?.automationId ?? '').trim();
    if (id) return id;
  }
  for (const run of pendingRuns) {
    const id = String(run.automation?.automationId ?? '').trim();
    if (id) return id;
  }
  return 'Automation';
}

function rowKeyForRun(item: TranscriptItem, fallback: number): string {
  const explicit = String(item.id ?? '').trim();
  if (explicit) return explicit;
  return `${normalizeRunIndex(item, fallback)}:${String(item.completedAt ?? item.at ?? '')}`;
}

function rowKeyForPendingRun(item: PendingPrompt, fallback: number): string {
  const explicit = String(item.id ?? '').trim();
  if (explicit) return explicit;
  return `${normalizeRunIndex(item, fallback)}:${String(item.updatedAt ?? item.at ?? '')}`;
}

function pendingRunStatusLabel(state: PendingPrompt['state']): string {
  if (state === 'failed') return 'Failed';
  if (state === 'queued') return 'Queued';
  return 'Pending';
}

function pendingRunOutput(item: PendingPrompt): string {
  if (item.state === 'failed') {
    const msg = String(item.error ?? '').trim();
    return msg || 'Prompt failed before the agent responded.';
  }
  if (item.state === 'queued') return 'Queued. Waiting to send prompt to agent.';
  return 'Prompt sent. Waiting for agent response.';
}

export const PromptLoopTranscriptGroup = React.memo(function PromptLoopTranscriptGroup({
  runs,
  pendingRuns = [],
  nowMs,
  onOpenFileReference,
  onOpenLink,
}: {
  runs: TranscriptItem[];
  pendingRuns?: PendingPrompt[];
  nowMs: number;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
}) {
  const [promptExpanded, setPromptExpanded] = React.useState(false);
  const [expandedRunKey, setExpandedRunKey] = React.useState<string | null>(null);
  const promptText = React.useMemo(() => resolvePromptText(runs, pendingRuns), [pendingRuns, runs]);
  const automationLabel = React.useMemo(() => resolveAutomationLabel(runs, pendingRuns), [pendingRuns, runs]);
  const promptNeedsTruncate = promptText.length > PROMPT_PREVIEW_MAX_CHARS;
  const promptDisplay = promptExpanded || !promptNeedsTruncate ? promptText : `${promptText.slice(0, PROMPT_PREVIEW_MAX_CHARS).trimEnd()}...`;
  const completedRows = React.useMemo(
    () =>
      runs.map((item, idx): PromptLoopTranscriptRow => {
        const rowNumber = idx + 1;
        const runIndex = normalizeRunIndex(item, rowNumber);
        const rowKey = rowKeyForRun(item, rowNumber);
        const output = stripAnsi(item.ok ? item.output : item.error || 'failed');
        return {
          rowKey,
          runIndex,
          atIso: String(item.completedAt ?? item.at ?? ''),
          status: item.ok ? 'done' : 'failed',
          statusLabel: item.ok ? 'Done' : 'Failed',
          output: output || (item.ok ? '(no output)' : 'failed'),
          outputClassName: item.ok ? 'dh-markdown--assistant' : undefined,
          fadeTo: 'rgba(0,0,0,.14)',
        };
      }),
    [runs],
  );
  const pendingRows = React.useMemo(
    () =>
      pendingRuns.map((item, idx): PromptLoopTranscriptRow => {
        const fallback = completedRows.length + idx + 1;
        const rowIndex = normalizeRunIndex(item, fallback);
        const rowKey = rowKeyForPendingRun(item, fallback);
        return {
          rowKey,
          runIndex: rowIndex,
          atIso: String(item.updatedAt ?? item.at ?? ''),
          status: item.state === 'failed' ? 'failed' : 'pending',
          statusLabel: pendingRunStatusLabel(item.state),
          output: pendingRunOutput(item),
          outputClassName: item.state === 'failed' ? undefined : 'dh-markdown--assistant',
          fadeTo: item.state === 'failed' ? 'var(--red-subtle)' : 'rgba(29,43,66,.2)',
        };
      }),
    [completedRows.length, pendingRuns],
  );
  const runRows = React.useMemo(() => [...completedRows, ...pendingRows], [completedRows, pendingRows]);

  React.useEffect(() => {
    if (!expandedRunKey) return;
    if (runRows.some((row) => row.rowKey === expandedRunKey)) return;
    setExpandedRunKey(null);
  }, [expandedRunKey, runRows]);

  if (runRows.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Automation
          </div>
          <div className="text-[13px] text-[var(--fg-secondary)] mt-1">
            {automationLabel} runs ({runRows.length})
          </div>
        </div>
      </div>

      {promptText ? (
        <div className="mt-3 rounded border border-[rgba(148,163,184,.16)] bg-[var(--user-dim)] px-3 py-2">
          <div className="text-[10px] text-[var(--muted-dim)] uppercase tracking-wide mb-1">Prompt</div>
          <div className="text-[12px] text-[var(--fg-secondary)] whitespace-pre-wrap break-words">{promptDisplay}</div>
          {promptNeedsTruncate ? (
            <button
              type="button"
              onClick={() => setPromptExpanded((v) => !v)}
              className="mt-2 text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--fg-secondary)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              {promptExpanded ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto rounded border border-[var(--border-subtle)]">
        <table className="w-full min-w-[560px] text-left">
          <thead className="bg-[rgba(255,255,255,.02)]">
            <tr>
              <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Run</th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Status</th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Updated</th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Details</th>
            </tr>
          </thead>
          <tbody>
            {runRows.map((row) => {
              const expanded = expandedRunKey === row.rowKey;
              return (
                <React.Fragment key={row.rowKey}>
                  <tr className="border-t border-[var(--border-subtle)]">
                    <td className="px-3 py-2 text-[12px] text-[var(--fg-secondary)] font-mono">#{row.runIndex}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] tracking-wide uppercase ${
                          row.status === 'done'
                            ? 'border-[rgba(52,211,153,.25)] bg-[rgba(16,185,129,.08)] text-[#34d399]'
                            : row.status === 'failed'
                              ? 'border-[rgba(255,90,90,.28)] bg-[var(--red-subtle)] text-[var(--red)]'
                              : 'border-[rgba(255,178,36,.35)] bg-[var(--yellow-subtle)] text-[var(--yellow)]'
                        }`}
                      >
                        {row.statusLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[var(--muted-dim)]" title={new Date(row.atIso).toLocaleString()}>
                      {timeAgo(row.atIso, nowMs)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpandedRunKey((prev) => (prev === row.rowKey ? null : row.rowKey))}
                        className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {expanded ? 'Hide' : 'Expand'}
                      </button>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="border-t border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)]">
                      <td className="px-3 py-3" colSpan={4}>
                        <CollapsibleMarkdown
                          text={row.output}
                          fadeTo={row.fadeTo}
                          className={row.outputClassName ?? ''}
                          onOpenFileReference={onOpenFileReference}
                          onOpenLink={onOpenLink}
                        />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
