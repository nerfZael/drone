import React from 'react';
import { timeAgo } from '../../domain';
import type { PlaybookDefinition, PlaybookRunQueueSummary } from '../types';
import { IconSpinner, IconTrash } from './icons';
import { SegmentedToolbarToggle } from './SegmentedToolbarToggle';

const PLAYBOOK_RUN_BATCH_MIN = 1;
const PLAYBOOK_RUN_BATCH_MAX = 50;
const PLAYBOOK_RUN_STARTUP_OPTIONS = [
  {
    value: 'parallel' as const,
    label: 'Parallel',
    title: 'Start first messages for all launched runs immediately.',
  },
  {
    value: 'serialized' as const,
    label: 'Serialized',
    title: 'Start the first message for each launched run one at a time.',
  },
];

export function playbookRunsRepoLabel(repoPathRaw: string): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'All repos';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

export function normalizePlaybookRunLaunchCount(raw: string): number {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value)) return PLAYBOOK_RUN_BATCH_MIN;
  return Math.max(PLAYBOOK_RUN_BATCH_MIN, Math.min(PLAYBOOK_RUN_BATCH_MAX, value));
}

type PlaybookRunLaunchControlsProps = {
  selectedPlaybook: PlaybookDefinition | null;
  selectedRepoPath: string;
  totalQueuedCount: number;
  launchCountInput: string;
  normalizedLaunchCount: number;
  serializeFirstMessageGroup: boolean;
  runDisabled: boolean;
  runDisabledReason: string;
  onLaunchCountInputChange: (value: string) => void;
  onSerializeFirstMessageGroupChange: (value: boolean) => void;
  onRun: () => void;
};

export function PlaybookRunLaunchControls({
  selectedPlaybook,
  selectedRepoPath,
  totalQueuedCount,
  launchCountInput,
  normalizedLaunchCount,
  serializeFirstMessageGroup,
  runDisabled,
  runDisabledReason,
  onLaunchCountInputChange,
  onSerializeFirstMessageGroupChange,
  onRun,
}: PlaybookRunLaunchControlsProps) {
  const startupMode = serializeFirstMessageGroup ? 'serialized' : 'parallel';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--muted-dim)]">
        <span className="font-semibold text-[var(--fg)] truncate max-w-[200px]">{selectedPlaybook?.label || 'No playbook'}</span>
        <span className="opacity-30">/</span>
        <span className="truncate max-w-[140px]">{selectedRepoPath ? playbookRunsRepoLabel(selectedRepoPath) : 'No repo'}</span>
        {totalQueuedCount > 0 && (
          <>
            <span className="opacity-30">/</span>
            <span className="text-[var(--yellow)]">{totalQueuedCount} queued</span>
          </>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <SegmentedToolbarToggle
          label="Startup"
          value={startupMode}
          options={PLAYBOOK_RUN_STARTUP_OPTIONS}
          onChange={(value) => onSerializeFirstMessageGroupChange(value === 'serialized')}
        />

        <label className="flex items-center gap-1.5 text-[10px] text-[var(--muted-dim)]">
          <span className="font-medium" style={{ fontFamily: 'var(--display)' }}>Count</span>
          <input
            type="number"
            min={PLAYBOOK_RUN_BATCH_MIN}
            max={PLAYBOOK_RUN_BATCH_MAX}
            step={1}
            value={launchCountInput}
            onChange={(event) => onLaunchCountInputChange(event.target.value)}
            className="h-7 w-[52px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 text-right text-[11px] font-semibold text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
            style={{ fontFamily: 'var(--code)' }}
          />
        </label>

        <span className="inline-flex" title={runDisabledReason}>
          <button
            type="button"
            onClick={onRun}
            disabled={runDisabled}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
              runDisabled
                ? 'cursor-not-allowed bg-[var(--surface-strong)] text-[var(--muted-dim)] opacity-40'
                : 'bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110 shadow-[var(--glow-accent)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {serializeFirstMessageGroup || normalizedLaunchCount > 1 ? 'Queue' : 'Run'}
          </button>
        </span>
      </div>
    </div>
  );
}

function queueStateClass(state: PlaybookRunQueueSummary['state']): string {
  if (state === 'error') return 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]';
  if (state === 'launching') return 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]';
  if (state === 'waiting') return 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]';
  return 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]';
}

function queueStateLabel(item: PlaybookRunQueueSummary): string {
  if (item.state === 'error') return 'Error';
  if (item.state === 'launching') return `Launching ${item.inFlightCount}`;
  if (item.state === 'waiting') return 'Waiting';
  return 'Queued';
}

type PlaybookRunQueueSectionProps = {
  queue: PlaybookRunQueueSummary[];
  selectedPlaybookLabel: string | null;
  selectedRepoPath: string;
  nowMs: number;
  actionBusyByKey: Record<string, true>;
  onClearQueuedRuns: () => void;
  onRemoveQueuedRun: (queueItemId: string) => void;
};

export function PlaybookRunQueueSection({
  queue,
  selectedPlaybookLabel,
  selectedRepoPath,
  nowMs,
  actionBusyByKey,
  onClearQueuedRuns,
  onRemoveQueuedRun,
}: PlaybookRunQueueSectionProps) {
  if (queue.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5 mb-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
          Launch Queue
        </span>
        <span className="rounded-md bg-[var(--surface-soft)] px-1.5 py-0.5 text-[9px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
          {queue.length}
        </span>
        <div className="flex-1 h-px bg-[linear-gradient(90deg,var(--border-subtle),transparent)]" />
        <button
          type="button"
          onClick={onClearQueuedRuns}
          disabled={Boolean(actionBusyByKey['queue:clear'])}
          className={`h-6 px-2 rounded-md text-[9px] font-semibold tracking-wide uppercase border transition-all ${
            actionBusyByKey['queue:clear']
              ? 'opacity-40 cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)]'
              : 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] hover:bg-[var(--red-subtle)] hover:border-[var(--red-border)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          {actionBusyByKey['queue:clear'] ? 'Clearing...' : 'Clear'}
        </button>
      </div>

      <table className="dh-task-table w-full">
        <thead>
          <tr>
            <th className="text-left">Playbook</th>
            <th className="text-left w-[90px]">State</th>
            <th className="text-left w-[100px]">Repo</th>
            <th className="text-right w-[60px]">Req</th>
            <th className="text-right w-[60px]">Done</th>
            <th className="text-right w-[60px]">Left</th>
            <th className="text-left w-[80px]">Added</th>
            <th className="w-[36px]" />
          </tr>
        </thead>
        <tbody>
          {queue.map((item) => {
            const busyKey = `queue:${item.id}`;
            return (
              <tr key={item.id}>
                <td>
                  <span className="text-[12px] font-medium text-[var(--fg)]">{item.playbookLabel}</span>
                  {item.serializeFirstMessageGroup && (
                    <span className="ml-1.5 inline-flex items-center rounded-md bg-[var(--yellow-subtle)] px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] text-[var(--yellow)]" style={{ fontFamily: 'var(--display)' }}>
                      Serial
                    </span>
                  )}
                </td>
                <td>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${queueStateClass(item.state)}`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    <span className="inline-block h-1 w-1 rounded-full bg-current opacity-70" />
                    {queueStateLabel(item)}
                  </span>
                </td>
                <td>
                  <span className="text-[10px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                    {playbookRunsRepoLabel(item.repoPath)}
                  </span>
                </td>
                <td className="text-right">
                  <span className="text-[11px] font-semibold text-[var(--fg)] tabular-nums" style={{ fontFamily: 'var(--code)' }}>
                    {item.requestedCount}
                  </span>
                </td>
                <td className="text-right">
                  <span className="text-[11px] text-[var(--muted)] tabular-nums" style={{ fontFamily: 'var(--code)' }}>
                    {item.launchedCount + item.inFlightCount}
                  </span>
                </td>
                <td className="text-right">
                  <span className="text-[11px] text-[var(--muted)] tabular-nums" style={{ fontFamily: 'var(--code)' }}>
                    {item.remainingCount}
                  </span>
                </td>
                <td>
                  <span className="text-[10px] text-[var(--muted-dim)] tabular-nums" style={{ fontFamily: 'var(--code)' }}>
                    {timeAgo(item.createdAt, nowMs)}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => onRemoveQueuedRun(item.id)}
                    disabled={Boolean(actionBusyByKey[busyKey])}
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-all ${
                      actionBusyByKey[busyKey]
                        ? 'opacity-40 cursor-not-allowed text-[var(--muted-dim)]'
                        : 'text-[var(--muted-dim)] hover:bg-[var(--red-subtle)] hover:text-[var(--red)]'
                    }`}
                    title={actionBusyByKey[busyKey] ? 'Removing...' : 'Remove queued launches'}
                  >
                    {actionBusyByKey[busyKey] ? <IconSpinner className="opacity-80" /> : <IconTrash className="opacity-80" />}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {queue.some((item) => item.error) && (
        <div className="mt-2 flex flex-col gap-1">
          {queue.filter((item) => item.error).map((item) => (
            <div key={item.id} className="flex items-center gap-1.5 text-[10px] text-[var(--red)]">
              <span className="h-1 w-1 rounded-full bg-[var(--red)] shrink-0" />
              <span className="truncate">{item.playbookLabel}: {item.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
