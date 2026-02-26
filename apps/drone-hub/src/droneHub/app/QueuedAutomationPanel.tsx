import React from 'react';

type QueuedAutomationPanelItem = {
  queueId: string;
  automationId: string;
  automationLabel: string;
  runsTotal: number;
};

type QueuedAutomationPanelProps = {
  items: QueuedAutomationPanelItem[];
  cancellingById: Record<string, true>;
  cancelErrorById: Record<string, string>;
  onCancel: (queueId: string) => void;
};

export function QueuedAutomationPanel({ items, cancellingById, cancelErrorById, onCancel }: QueuedAutomationPanelProps) {
  if (items.length === 0) return null;

  return (
    <div className="px-4 pb-2">
      <div className="rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] overflow-hidden">
        <div
          className="px-3 py-1.5 text-[9px] uppercase tracking-[0.08em] text-[var(--muted-dim)] border-b border-[var(--border-subtle)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          Automation Queue
        </div>
        <div>
          {items.map((item) => {
            const queueId = String(item.queueId ?? '').trim();
            const label = String(item.automationLabel ?? '').trim() || String(item.automationId ?? '').trim() || 'Automation';
            const busy = Boolean(cancellingById[queueId]);
            const error = cancelErrorById[queueId] ?? '';
            return (
              <div key={queueId} className="group/queued-automation border-t first:border-t-0 border-[var(--border-subtle)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-[var(--fg-secondary)] truncate">{label}</div>
                    <div className="text-[10px] text-[var(--muted-dim)]">{item.runsTotal} runs queued</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCancel(queueId)}
                    disabled={busy}
                    className={`inline-flex items-center h-6 px-2 rounded border text-[9px] font-semibold tracking-wide uppercase transition-all ${
                      busy
                        ? 'opacity-100 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)]'
                        : 'opacity-0 pointer-events-none group-hover/queued-automation:opacity-100 group-hover/queued-automation:pointer-events-auto bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--red)] hover:border-[rgba(255,90,90,.35)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Cancel queued automation"
                  >
                    {busy ? 'Canceling...' : 'Cancel'}
                  </button>
                </div>
                {error ? <div className="mt-1 text-[10px] text-[var(--red)] whitespace-pre-wrap">{error}</div> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
