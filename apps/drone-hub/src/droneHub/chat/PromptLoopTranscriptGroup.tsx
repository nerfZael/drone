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

type PromptLoopSummaryEntry = {
  rowKey: string;
  atIso: string;
  status: 'done' | 'failed' | 'pending';
  statusLabel: string;
  output: string;
  outputClassName?: string;
  fadeTo: string;
};

function normalizeFailureHint(raw: string): string {
  const text = stripAnsi(String(raw ?? '')).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const maxChars = 140;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizeRunIndex(item: PromptLoopPromptLike, fallback: number): number {
  const raw = Number(item.automation?.runIndex);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return fallback;
}

function normalizeAutomationStage(meta: PromptLoopPromptLike['automation']): 'run' | 'final-message' {
  const stage = String(meta?.stage ?? '').trim().toLowerCase();
  if (stage === 'final-message') return 'final-message';
  return 'run';
}

function isFinalMessageStage(meta: PromptLoopPromptLike['automation']): boolean {
  return normalizeAutomationStage(meta) === 'final-message';
}

function resolvePromptText(runs: TranscriptItem[], pendingRuns: PendingPrompt[]): string {
  const primaryRuns = runs.filter((run) => !isFinalMessageStage(run.automation));
  const primaryPendingRuns = pendingRuns.filter((run) => !isFinalMessageStage(run.automation));
  const fromPrompt = String(primaryRuns[0]?.prompt ?? '').trim();
  if (fromPrompt) return fromPrompt;
  const fromPendingPrompt = String(primaryPendingRuns[0]?.prompt ?? '').trim();
  if (fromPendingPrompt) return fromPendingPrompt;
  for (const run of primaryRuns) {
    const preview = String(run.automation?.promptPreview ?? '').trim();
    if (preview) return preview;
  }
  for (const run of primaryPendingRuns) {
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
  headerBadgeLabel,
  headerBadgeTone = 'running',
  headerActions,
  headerError,
}: {
  runs: TranscriptItem[];
  pendingRuns?: PendingPrompt[];
  nowMs: number;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  headerBadgeLabel?: string;
  headerBadgeTone?: 'running' | 'queued' | 'failed';
  headerActions?: React.ReactNode;
  headerError?: string | null;
}) {
  const [promptExpanded, setPromptExpanded] = React.useState(false);
  const [expandedRunKey, setExpandedRunKey] = React.useState<string | null>(null);
  const promptText = React.useMemo(() => resolvePromptText(runs, pendingRuns), [pendingRuns, runs]);
  const automationLabel = React.useMemo(() => resolveAutomationLabel(runs, pendingRuns), [pendingRuns, runs]);
  const promptNeedsTruncate = promptText.length > PROMPT_PREVIEW_MAX_CHARS;
  const promptDisplay = promptExpanded || !promptNeedsTruncate ? promptText : `${promptText.slice(0, PROMPT_PREVIEW_MAX_CHARS).trimEnd()}...`;
  const completedRows = React.useMemo(
    () =>
      runs
        .filter((item) => !isFinalMessageStage(item.automation))
        .map((item, idx): PromptLoopTranscriptRow => {
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
          outputClassName: item.ok ? 'dh-markdown--agent' : undefined,
          fadeTo: 'rgba(0,0,0,.14)',
        };
        }),
    [runs],
  );
  const pendingRows = React.useMemo(
    () =>
      pendingRuns
        .filter((item) => !isFinalMessageStage(item.automation))
        .map((item, idx): PromptLoopTranscriptRow => {
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
          outputClassName: item.state === 'failed' ? undefined : 'dh-markdown--agent',
          fadeTo: item.state === 'failed' ? 'var(--red-subtle)' : 'rgba(29,43,66,.2)',
        };
        }),
    [completedRows.length, pendingRuns],
  );
  const runRows = React.useMemo(() => {
    const combined = [...completedRows, ...pendingRows].map((row, idx) => ({ row, idx }));
    combined.sort((a, b) => (a.row.runIndex - b.row.runIndex) || (a.idx - b.idx));
    return combined.map((x) => x.row);
  }, [completedRows, pendingRows]);
  const summaryCompletedEntries = React.useMemo(
    () =>
      runs
        .filter((item) => isFinalMessageStage(item.automation))
        .map((item, idx): PromptLoopSummaryEntry => {
          const rowNumber = idx + 1;
          const rowKey = rowKeyForRun(item, rowNumber);
          const output = stripAnsi(item.ok ? item.output : item.error || 'failed');
          return {
            rowKey,
            atIso: String(item.completedAt ?? item.at ?? ''),
            status: item.ok ? 'done' : 'failed',
            statusLabel: item.ok ? 'Done' : 'Failed',
            output: output || (item.ok ? '(no output)' : 'failed'),
            outputClassName: item.ok ? 'dh-markdown--agent' : undefined,
            fadeTo: item.ok ? 'rgba(29,43,66,.2)' : 'var(--red-subtle)',
          };
        }),
    [runs],
  );
  const summaryPendingEntries = React.useMemo(
    () =>
      pendingRuns
        .filter((item) => isFinalMessageStage(item.automation))
        .map((item, idx): PromptLoopSummaryEntry => ({
          rowKey: rowKeyForPendingRun(item, idx + 1),
          atIso: String(item.updatedAt ?? item.at ?? ''),
          status: item.state === 'failed' ? 'failed' : 'pending',
          statusLabel: pendingRunStatusLabel(item.state),
          output: pendingRunOutput(item),
          outputClassName: item.state === 'failed' ? undefined : 'dh-markdown--agent',
          fadeTo: item.state === 'failed' ? 'var(--red-subtle)' : 'rgba(29,43,66,.2)',
        })),
    [pendingRuns],
  );
  const summaryEntries = React.useMemo(
    () => [...summaryCompletedEntries, ...summaryPendingEntries],
    [summaryCompletedEntries, summaryPendingEntries],
  );
  const latestSummary = summaryEntries.length > 0 ? summaryEntries[summaryEntries.length - 1] : null;

  React.useEffect(() => {
    if (!expandedRunKey) return;
    if (runRows.some((row) => row.rowKey === expandedRunKey)) return;
    setExpandedRunKey(null);
  }, [expandedRunKey, runRows]);

  if (runRows.length === 0 && !latestSummary) return null;

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
        {(headerBadgeLabel || headerActions) ? (
          <div className="flex items-center gap-2">
            {headerBadgeLabel ? (
              <span
                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] tracking-wide uppercase ${
                  headerBadgeTone === 'failed'
                    ? 'border-[rgba(255,90,90,.28)] bg-[var(--red-subtle)] text-[var(--red)]'
                    : headerBadgeTone === 'queued'
                      ? 'border-[rgba(96,165,250,.35)] bg-[rgba(59,130,246,.12)] text-[#60a5fa]'
                      : 'border-[rgba(255,178,36,.35)] bg-[var(--yellow-subtle)] text-[var(--yellow)]'
                }`}
              >
                {headerBadgeLabel}
              </span>
            ) : null}
            {headerActions}
          </div>
        ) : null}
      </div>
      {headerError ? <div className="mt-2 text-[10px] text-[var(--red)] whitespace-pre-wrap">{headerError}</div> : null}

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

      {runRows.length > 0 ? (
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
                        {row.status === 'failed' ? (
                          <div className="mt-1 text-[10px] text-[var(--red)] max-w-[340px]" title={stripAnsi(row.output)}>
                            {normalizeFailureHint(row.output) || 'Failed.'}
                          </div>
                        ) : null}
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
      ) : null}

      {latestSummary ? (
        <div className="mt-3 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Final message response</div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] tracking-wide uppercase ${
                  latestSummary.status === 'done'
                    ? 'border-[rgba(52,211,153,.25)] bg-[rgba(16,185,129,.08)] text-[#34d399]'
                    : latestSummary.status === 'failed'
                      ? 'border-[rgba(255,90,90,.28)] bg-[var(--red-subtle)] text-[var(--red)]'
                      : 'border-[rgba(255,178,36,.35)] bg-[var(--yellow-subtle)] text-[var(--yellow)]'
                }`}
              >
                {latestSummary.statusLabel}
              </span>
              <span className="text-[10px] text-[var(--muted-dim)]" title={new Date(latestSummary.atIso).toLocaleString()}>
                {timeAgo(latestSummary.atIso, nowMs)}
              </span>
            </div>
          </div>
          <div className="mt-2">
            <CollapsibleMarkdown
              text={latestSummary.output}
              fadeTo={latestSummary.fadeTo}
              className={latestSummary.outputClassName ?? ''}
              onOpenFileReference={onOpenFileReference}
              onOpenLink={onOpenLink}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});
