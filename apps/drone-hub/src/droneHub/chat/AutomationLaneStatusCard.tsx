import React from 'react';
import { timeAgo } from '../../domain';
import { IconSpinner } from './icons';

type AutomationLaneStatusCardProps = {
  nowMs: number;
  status: 'queued' | 'running';
  automationLabel: string;
  runsTotal?: number;
  runsCompleted?: number;
  atIso?: string | null;
  queueId?: string | null;
  cancelBusy?: boolean;
  cancelError?: string | null;
  stopAllBusy?: boolean;
  stopRunsOnlyBusy?: boolean;
  stopError?: string | null;
  onCancelQueued?: (queueId: string) => void;
  onStopAll?: () => void;
  onStopRunsOnly?: () => void;
};

export const AutomationLaneStatusCard = React.memo(function AutomationLaneStatusCard({
  nowMs,
  status,
  automationLabel,
  runsTotal = 0,
  runsCompleted = 0,
  atIso,
  queueId,
  cancelBusy = false,
  cancelError = null,
  stopAllBusy = false,
  stopRunsOnlyBusy = false,
  stopError = null,
  onCancelQueued,
  onStopAll,
  onStopRunsOnly,
}: AutomationLaneStatusCardProps) {
  const label = String(automationLabel ?? '').trim() || 'Automation';
  const ts = String(atIso ?? '').trim();
  const canCancel = status === 'queued' && !!queueId && !!onCancelQueued;
  const canStop = status === 'running' && (Boolean(onStopAll) || Boolean(onStopRunsOnly));

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Automation
          </div>
          <div className="text-[13px] text-[var(--fg-secondary)] mt-1">{label}</div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9px] tracking-wide uppercase ${
              status === 'running'
                ? 'border-[rgba(255,178,36,.35)] bg-[var(--yellow-subtle)] text-[var(--yellow)]'
                : 'border-[rgba(96,165,250,.35)] bg-[rgba(59,130,246,.12)] text-[#60a5fa]'
            }`}
          >
            {status === 'running' ? <IconSpinner className="w-2.5 h-2.5" /> : null}
            {status === 'running' ? 'Running' : 'Queued'}
          </span>
          {ts ? (
            <span className="text-[10px] text-[var(--muted-dim)]" title={new Date(ts).toLocaleString()}>
              {timeAgo(ts, nowMs)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 text-[12px] text-[var(--muted)]">
        {status === 'running' ? `${Math.max(0, runsCompleted)}/${Math.max(0, runsTotal)} runs` : `${Math.max(0, runsTotal)} runs queued`}
      </div>

      {canCancel ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!queueId) return;
              onCancelQueued?.(queueId);
            }}
            disabled={cancelBusy}
            className={`inline-flex items-center h-7 px-2 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
              cancelBusy
                ? 'opacity-100 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)]'
                : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--red)] hover:border-[rgba(255,90,90,.35)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Cancel queued automation"
          >
            {cancelBusy ? 'Canceling...' : 'Cancel'}
          </button>
        </div>
      ) : null}

      {canStop ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onStopAll ? (
            <button
              type="button"
              onClick={() => onStopAll()}
              disabled={stopAllBusy || stopRunsOnlyBusy}
              className={`inline-flex items-center h-7 px-2 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                stopAllBusy || stopRunsOnlyBusy
                  ? 'opacity-100 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)]'
                  : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--red)] hover:border-[rgba(255,90,90,.35)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Stop remaining runs and skip final message"
            >
              {stopAllBusy ? 'Stopping...' : 'Stop all'}
            </button>
          ) : null}
          {onStopRunsOnly ? (
            <button
              type="button"
              onClick={() => onStopRunsOnly()}
              disabled={stopAllBusy || stopRunsOnlyBusy}
              className={`inline-flex items-center h-7 px-2 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                stopAllBusy || stopRunsOnlyBusy
                  ? 'opacity-100 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)]'
                  : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Stop remaining runs and still send final message when possible"
            >
              {stopRunsOnlyBusy ? 'Stopping...' : 'Stop runs only'}
            </button>
          ) : null}
        </div>
      ) : null}

      {cancelError ? <div className="mt-2 text-[10px] text-[var(--red)] whitespace-pre-wrap">{cancelError}</div> : null}
      {stopError ? <div className="mt-2 text-[10px] text-[var(--red)] whitespace-pre-wrap">{stopError}</div> : null}
    </div>
  );
});
