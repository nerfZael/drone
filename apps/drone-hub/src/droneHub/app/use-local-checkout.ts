import React from 'react';
import type { DroneSummary } from '../types';

export type LocalAutoUpdates = 'off' | 'commits' | 'all';

export type LocalCheckoutSession = {
  droneId: string;
  droneName: string;
  repoRoot: string;
  returnRef: string;
  returnSha: string;
  returnDetached: boolean;
  snapshotSha: string;
  snapshotKind: 'commit' | 'working-tree';
  sourceHeadSha: string;
  sourceTreeSha: string;
  sourceDirtyFileCount: number;
  activatedAt: string;
  updatedAt: string;
};

export type LocalCheckoutView = {
  ok: true;
  autoUpdates: LocalAutoUpdates;
  session: LocalCheckoutSession | null;
  updatedAt: string | null;
  operation: {
    kind: string;
    droneId: string | null;
  } | null;
  host: {
    currentHead: string | null;
    clean: boolean;
    interrupted: boolean;
  } | null;
  changed?: boolean;
  droneId?: string;
  expectedHeadSha?: string;
};

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export function isLocalCheckoutCancellation(error: unknown): boolean {
  return String((error as any)?.data?.code ?? '').trim() === 'local_operation_cancelled';
}

export type LocalCheckoutController = {
  view: LocalCheckoutView | null;
  loading: boolean;
  busy: boolean;
  refresh: () => Promise<LocalCheckoutView | null>;
  useLocally: (droneId: string) => Promise<LocalCheckoutView>;
  update: (includeDirty?: boolean) => Promise<LocalCheckoutView>;
  setAutoUpdates: (mode: LocalAutoUpdates) => Promise<LocalCheckoutView>;
  returnToOriginal: () => Promise<LocalCheckoutView>;
  prepareApply: (droneId: string) => Promise<LocalCheckoutView>;
};

function droneIsBusy(drone: DroneSummary | null | undefined): boolean {
  if (!drone) return false;
  if (drone.busy === true) return true;
  if (Array.isArray(drone.busyChats) && drone.busyChats.length > 0) return true;
  const phase = String(drone.hubPhase ?? '').trim().toLowerCase();
  return phase === 'creating' || phase === 'starting' || phase === 'seeding';
}

function autoUpdateKey(view: LocalCheckoutView, drones: DroneSummary[]): string {
  const session = view.session;
  if (!session || view.autoUpdates === 'off') return '';
  const drone = drones.find(
    (candidate) => String(candidate.id ?? '').trim() === session.droneId,
  );
  return [
    session.droneId,
    view.autoUpdates,
    String(drone?.lastActivityAt ?? ''),
  ].join(':');
}

export function useLocalCheckout(options: {
  drones: DroneSummary[];
  requestJson: RequestJson;
  onAutoUpdateError?: (message: string) => void;
}): LocalCheckoutController {
  const { drones, requestJson, onAutoUpdateError } = options;
  const [view, setView] = React.useState<LocalCheckoutView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyCount, setBusyCount] = React.useState(0);
  const autoAttemptKeyRef = React.useRef('');
  const autoUpdatePendingAfterBusyRef = React.useRef(false);

  const run = React.useCallback(
    async (url: string, init?: RequestInit): Promise<LocalCheckoutView> => {
      setBusyCount((count) => count + 1);
      try {
        const next = await requestJson<LocalCheckoutView>(url, init);
        setView(next);
        return next;
      } finally {
        setBusyCount((count) => Math.max(0, count - 1));
      }
    },
    [requestJson],
  );

  const refresh = React.useCallback(async (): Promise<LocalCheckoutView | null> => {
    try {
      const next = await requestJson<LocalCheckoutView>('/api/local-checkout');
      setView(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void refresh().catch(() => {
      setLoading(false);
    });
  }, [refresh]);

  const activeDrone =
    view?.session
      ? drones.find((drone) => String(drone.id ?? '').trim() === view.session?.droneId) ?? null
      : null;
  const activeBusy = droneIsBusy(activeDrone);
  const markAutoUpdateCurrent = React.useCallback(
    (next: LocalCheckoutView) => {
      autoAttemptKeyRef.current = autoUpdateKey(next, drones);
      autoUpdatePendingAfterBusyRef.current = false;
    },
    [drones],
  );

  const useLocally = React.useCallback(
    async (droneId: string) => {
      const next = await run(`/api/drones/${encodeURIComponent(droneId)}/repo/local/use`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      markAutoUpdateCurrent(next);
      return next;
    },
    [markAutoUpdateCurrent, run],
  );

  const update = React.useCallback(
    async (includeDirty?: boolean) => {
      const next = await run('/api/local-checkout/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          typeof includeDirty === 'boolean' ? { includeDirty } : {},
        ),
      });
      markAutoUpdateCurrent(next);
      return next;
    },
    [markAutoUpdateCurrent, run],
  );

  const setAutoUpdates = React.useCallback(
    async (mode: LocalAutoUpdates) => {
      const next = await run('/api/local-checkout', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoUpdates: mode }),
      });
      if (mode === 'off' || !next.session || activeBusy) return next;
      return await update(mode === 'all');
    },
    [activeBusy, run, update],
  );

  const returnToOriginal = React.useCallback(
    async () =>
      await run('/api/local-checkout/return', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    [run],
  );

  const prepareApply = React.useCallback(
    async (droneId: string) =>
      await run('/api/local-checkout/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ droneId }),
      }),
    [run],
  );

  React.useEffect(() => {
    const session = view?.session ?? null;
    const mode = view?.autoUpdates ?? 'off';
    if (!view || !session || mode === 'off') {
      autoUpdatePendingAfterBusyRef.current = false;
      return;
    }
    if (activeBusy) {
      autoUpdatePendingAfterBusyRef.current = true;
      return;
    }
    if (busyCount > 0) return;
    const key = autoUpdateKey(view, drones);
    if (
      !autoUpdatePendingAfterBusyRef.current &&
      autoAttemptKeyRef.current === key
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      autoUpdatePendingAfterBusyRef.current = false;
      autoAttemptKeyRef.current = key;
      void update(mode === 'all').catch((error: any) => {
        if (isLocalCheckoutCancellation(error)) return;
        onAutoUpdateError?.(
          String(error?.message ?? error ?? '').trim() || 'Local auto-update failed.',
        );
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [
    activeBusy,
    activeDrone?.lastActivityAt,
    busyCount,
    drones,
    onAutoUpdateError,
    update,
    view?.autoUpdates,
    view?.session,
  ]);

  return {
    view,
    loading,
    busy: busyCount > 0,
    refresh,
    useLocally,
    update,
    setAutoUpdates,
    returnToOriginal,
    prepareApply,
  };
}
