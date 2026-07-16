import React from 'react';

export type DroneDropActionModalDrone = {
  group: string | null;
  id: string;
  label: string;
};

type DroneDropActionModalProps = {
  droppedDrones: DroneDropActionModalDrone[];
  onAssignAll: () => Promise<{ ok: boolean }>;
  onRequestClose: () => void;
  targetDroneLabel: string;
};

export function DroneDropActionModal({
  droppedDrones,
  onAssignAll,
  onRequestClose,
  targetDroneLabel,
}: DroneDropActionModalProps) {
  const [assigning, setAssigning] = React.useState(false);
  const droppedCount = droppedDrones.length;

  const handleAssignAll = React.useCallback(async () => {
    if (assigning) return;
    setAssigning(true);
    try {
      const result = await onAssignAll();
      if (result.ok) onRequestClose();
    } finally {
      setAssigning(false);
    }
  }, [assigning, onAssignAll, onRequestClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Assign drones"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !assigning) onRequestClose();
      }}
    >
      <div className="w-full max-w-[560px] rounded-[18px] border border-[var(--border-subtle)] bg-[rgba(12,16,24,.98)] shadow-[0_28px_90px_rgba(0,0,0,.46)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Assign drones
            </div>
            <div className="mt-2 text-[18px] font-semibold text-[var(--fg)]">
              Assign {droppedCount} drone{droppedCount === 1 ? '' : 's'} to {targetDroneLabel}?
            </div>
            <div className="mt-1 text-[13px] leading-5 text-[var(--muted)]">
              This adds every dropped drone to the target drone's assigned relationships.
            </div>
          </div>
          <button
            type="button"
            onClick={onRequestClose}
            disabled={assigning}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)] text-[18px] text-[var(--muted)] transition-all hover:border-[var(--border)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="flex max-h-[280px] flex-col gap-2 overflow-y-auto">
            {droppedDrones.map((drone) => (
              <div key={drone.id} className="rounded-[12px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-4 py-3">
                <div className="truncate text-[13px] font-medium text-[var(--fg-secondary)]">{drone.label}</div>
                {drone.group ? <div className="truncate text-[10px] text-[var(--muted-dim)]">{drone.group}</div> : null}
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={onRequestClose}
              disabled={assigning}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border-subtle)] px-4 text-[12px] font-semibold text-[var(--muted)] transition-all hover:border-[var(--border)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleAssignAll()}
              disabled={assigning}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-4 text-[12px] font-semibold text-[var(--accent)] transition-all hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {assigning ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
