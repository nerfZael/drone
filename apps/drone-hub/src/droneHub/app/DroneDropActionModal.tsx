import React from 'react';
import type { RepoTransferActionResult, RepoTransferProbeStatus } from './use-workspace-actions';

export type DroneDropActionModalDrone = {
  group: string | null;
  id: string;
  label: string;
};

type DroneDropActionModalProps = {
  droppedDrones: DroneDropActionModalDrone[];
  onAssignAll: () => Promise<RepoTransferActionResult>;
  onProbeSyncStatus: (sourceDroneId: string, targetDroneId: string) => Promise<RepoTransferProbeStatus>;
  onRequestClose: () => void;
  onSyncDrone: (sourceDroneId: string, targetDroneId: string) => Promise<RepoTransferActionResult>;
  targetDroneId: string;
  targetDroneLabel: string;
};

type ProbeState = {
  detail: string;
  kind: RepoTransferProbeStatus['kind'] | 'loading';
  label: string;
  syncAllowed: boolean;
};

const LOADING_PROBE_STATE: ProbeState = {
  kind: 'loading',
  label: 'Checking sync state…',
  detail: 'Inspecting whether this drone has anything new to pull.',
  syncAllowed: false,
};

function probeToneClass(kind: ProbeState['kind']): string {
  if (kind === 'ready') return 'border-[rgba(84,189,126,.32)] bg-[rgba(10,28,18,.92)] text-[var(--green)]';
  if (kind === 'nothing-to-sync') return 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)]';
  if (kind === 'sync-with-confirmation') return 'border-[rgba(255,178,36,.35)] bg-[rgba(31,22,9,.92)] text-[var(--yellow)]';
  if (kind === 'blocked') return 'border-[rgba(255,90,90,.35)] bg-[rgba(27,13,15,.92)] text-[var(--red)]';
  return 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)]';
}

function syncActionLabel(probe: ProbeState, rowBusy: boolean): string {
  if (rowBusy) return 'Syncing…';
  if (probe.kind === 'loading') return 'Checking…';
  if (probe.kind === 'sync-with-confirmation') return 'Confirm & sync';
  if (probe.kind === 'nothing-to-sync') return 'Up to date';
  if (probe.kind === 'blocked') return 'Unavailable';
  return 'Sync';
}

export function DroneDropActionModal({
  droppedDrones,
  onAssignAll,
  onProbeSyncStatus,
  onRequestClose,
  onSyncDrone,
  targetDroneId,
  targetDroneLabel,
}: DroneDropActionModalProps) {
  const [assigning, setAssigning] = React.useState(false);
  const [syncingDroneId, setSyncingDroneId] = React.useState<string | null>(null);
  const [probeByDroneId, setProbeByDroneId] = React.useState<Record<string, ProbeState>>({});
  const probeSessionRef = React.useRef(0);
  const probeRequestSeqRef = React.useRef<Record<string, number>>({});

  const busy = assigning || Boolean(syncingDroneId);
  const droppedCount = droppedDrones.length;

  const refreshProbe = React.useCallback(
    async (sourceDroneIdRaw: string) => {
      const sourceDroneId = String(sourceDroneIdRaw ?? '').trim();
      if (!sourceDroneId) return;
      const sessionId = probeSessionRef.current;
      const nextSeq = (probeRequestSeqRef.current[sourceDroneId] ?? 0) + 1;
      probeRequestSeqRef.current[sourceDroneId] = nextSeq;
      setProbeByDroneId((prev) => ({
        ...prev,
        [sourceDroneId]: LOADING_PROBE_STATE,
      }));
      const next = await onProbeSyncStatus(sourceDroneId, targetDroneId);
      if (probeSessionRef.current !== sessionId) return;
      if ((probeRequestSeqRef.current[sourceDroneId] ?? 0) !== nextSeq) return;
      setProbeByDroneId((prev) => ({
        ...prev,
        [sourceDroneId]: {
          kind: next.kind,
          label: next.label,
          detail: next.detail,
          syncAllowed: next.syncAllowed,
        },
      }));
    },
    [onProbeSyncStatus, targetDroneId],
  );

  React.useEffect(() => {
    probeSessionRef.current += 1;
    probeRequestSeqRef.current = {};
    setAssigning(false);
    setSyncingDroneId(null);
    const nextState: Record<string, ProbeState> = {};
    for (const drone of droppedDrones) {
      const droneId = String(drone.id ?? '').trim();
      if (!droneId) continue;
      nextState[droneId] = LOADING_PROBE_STATE;
    }
    setProbeByDroneId(nextState);
    void Promise.all(
      droppedDrones.map(async (drone) => {
        const droneId = String(drone.id ?? '').trim();
        if (!droneId) return;
        await refreshProbe(droneId);
      }),
    );
  }, [droppedDrones, refreshProbe, targetDroneId]);

  React.useEffect(
    () => () => {
      probeSessionRef.current += 1;
      probeRequestSeqRef.current = {};
    },
    [],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      onRequestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onRequestClose]);

  const handleAssignAll = React.useCallback(async () => {
    if (busy) return;
    setAssigning(true);
    try {
      const result = await onAssignAll();
      if (result.ok) onRequestClose();
    } finally {
      setAssigning(false);
    }
  }, [busy, onAssignAll, onRequestClose]);

  const handleSyncDrone = React.useCallback(
    async (sourceDroneIdRaw: string) => {
      const sourceDroneId = String(sourceDroneIdRaw ?? '').trim();
      if (!sourceDroneId || busy) return;
      setSyncingDroneId(sourceDroneId);
      try {
        const result = await onSyncDrone(sourceDroneId, targetDroneId);
        if (result.ok) {
          await refreshProbe(sourceDroneId);
        }
      } finally {
        setSyncingDroneId((current) => (current === sourceDroneId ? null : current));
      }
    },
    [busy, onSyncDrone, refreshProbe, targetDroneId],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Drone drop actions"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onRequestClose();
      }}
    >
      <div className="w-full max-w-[760px] rounded-[18px] border border-[var(--border-subtle)] bg-[rgba(12,16,24,.98)] shadow-[0_28px_90px_rgba(0,0,0,.46)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Drop Actions
            </div>
            <div className="mt-2 text-[18px] font-semibold text-[var(--fg)]">
              {droppedCount} drone{droppedCount === 1 ? '' : 's'} dropped into {targetDroneLabel}
            </div>
            <div className="mt-1 text-[13px] leading-5 text-[var(--muted)]">
              Choose whether to assign all dropped drones to this drone or sync them into it one by one.
            </div>
          </div>
          <button
            type="button"
            onClick={onRequestClose}
            disabled={busy}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-[18px] transition-all ${
              busy
                ? 'cursor-not-allowed border-[var(--border-subtle)] text-[var(--muted-dim)] opacity-40'
                : 'border-[var(--border-subtle)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg)]'
            }`}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="rounded-[16px] border border-[var(--accent-muted)] bg-[rgba(123,188,255,.08)] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[var(--fg)]">Assign all</div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
                  Add all dropped drones to {targetDroneLabel}&rsquo;s fleet, matching the current behavior but with confirmation first.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleAssignAll();
                }}
                disabled={busy}
                className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-[12px] font-semibold transition-all ${
                  busy
                    ? 'cursor-not-allowed border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)] opacity-50'
                    : 'border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[rgba(123,188,255,.16)]'
                }`}
              >
                {assigning ? 'Assigning…' : `Assign ${droppedCount} drone${droppedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[14px] font-semibold text-[var(--fg)]">Sync into {targetDroneLabel}</div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
                  Pull each source drone into the target one individually. Each row is checked first so up-to-date drones show as nothing to sync.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void Promise.all(droppedDrones.map(async (drone) => await refreshProbe(drone.id)));
                }}
                disabled={busy}
                className={`inline-flex h-9 items-center justify-center rounded-lg px-3 text-[11px] font-semibold transition-all ${
                  busy
                    ? 'cursor-not-allowed border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)] opacity-50'
                    : 'border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg-secondary)]'
                }`}
              >
                Refresh
              </button>
            </div>

            <div className="mt-4 flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1">
              {droppedDrones.map((drone) => {
                const probe = probeByDroneId[drone.id] ?? LOADING_PROBE_STATE;
                const rowBusy = syncingDroneId === drone.id;
                return (
                  <div
                    key={drone.id}
                    className="rounded-[14px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                            Drone
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-[var(--fg-secondary)]">{drone.label}</div>
                            {drone.group ? <div className="truncate text-[10px] text-[var(--muted-dim)]">{drone.group}</div> : null}
                          </div>
                        </div>
                        <div className={`mt-3 inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${probeToneClass(probe.kind)}`}>
                          {probe.label}
                        </div>
                        <div className="mt-2 text-[12px] leading-5 text-[var(--muted)]">{probe.detail}</div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          void handleSyncDrone(drone.id);
                        }}
                        disabled={busy || rowBusy || !probe.syncAllowed}
                        className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-[12px] font-semibold transition-all ${
                          busy || rowBusy || !probe.syncAllowed
                            ? 'cursor-not-allowed border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)] opacity-50'
                            : 'border border-[var(--accent-muted)] bg-[rgba(255,255,255,.04)] text-[var(--fg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]'
                        }`}
                      >
                        {syncActionLabel(probe, rowBusy)}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
