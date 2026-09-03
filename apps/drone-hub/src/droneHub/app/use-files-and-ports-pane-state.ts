import React from 'react';
import { usePaneReadiness } from '../panes/usePaneReadiness';
import type {
  DroneFsEntry,
  DroneFsListPayload,
  DronePortMapping,
  DronePortsPayload,
  DroneSummary,
  PortPreviewByDrone,
  PortReachabilityByDrone,
  PortReachabilityByHostPort,
  PreviewUrlByDrone,
} from '../types';
import {
  PORT_PREVIEW_STORAGE_KEY,
  PORT_STATUS_TIMEOUT_MS,
  PREVIEW_URL_STORAGE_KEY,
} from './app-config';
import {
  droneHomePath,
  isHostRuntimeDrone,
  isDroneStartingOrSeeding,
  normalizeContainerPathInput,
  normalizePortRows,
  normalizePreviewUrl,
  readPortPreviewByDrone,
  readPreviewUrlByDrone,
  resolveDefaultPreviewPort,
  rewriteContainerPreviewUrlToHostLoopback,
  rewriteLoopbackUrlToHostLoopback,
  sameReachabilityMap,
} from './helpers';
import {
  fetchJson,
  probeLocalhostPort,
  readLocalStorageItem,
  usePersistedLocalStorageItem,
  usePoll,
} from './hooks';

const FS_LIST_CACHE_MAX_AGE_MS = 5 * 60_000;
const FS_LIST_POLL_LOADING_MS = 8_000;
const FS_LIST_POLL_IDLE_MS = 30_000;
const FS_LIST_REQUEST_TIMEOUT_MS = 12_000;

type FsListCacheEntry = {
  atMs: number;
  payload: Extract<DroneFsListPayload, { ok: true }>;
};

export function sameDroneFsListPayload(
  left: DroneFsListPayload | null,
  right: Extract<DroneFsListPayload, { ok: true }>,
): boolean {
  if (!left?.ok) return false;
  if (left.id !== right.id || left.name !== right.name || left.path !== right.path) return false;
  if (left.entries.length !== right.entries.length) return false;
  for (let index = 0; index < left.entries.length; index += 1) {
    const leftEntry = left.entries[index];
    const rightEntry = right.entries[index];
    if (
      !rightEntry ||
      leftEntry.name !== rightEntry.name ||
      leftEntry.path !== rightEntry.path ||
      leftEntry.kind !== rightEntry.kind ||
      leftEntry.size !== rightEntry.size ||
      leftEntry.mtimeMs !== rightEntry.mtimeMs ||
      leftEntry.ext !== rightEntry.ext ||
      leftEntry.isGitIgnored !== rightEntry.isGitIgnored ||
      leftEntry.isImage !== rightEntry.isImage ||
      leftEntry.isVideo !== rightEntry.isVideo
    ) {
      return false;
    }
  }
  return true;
}

const fsListCache = new Map<string, FsListCacheEntry>();

function fsListCacheKey(droneIdRaw: string, pathRaw: string): string {
  return `${String(droneIdRaw ?? '').trim()}\u0000${String(pathRaw ?? '').trim() || '/'}`;
}

function readFsListCache(cacheKey: string): Extract<DroneFsListPayload, { ok: true }> | null {
  const cached = fsListCache.get(cacheKey);
  if (!cached || Date.now() - cached.atMs > FS_LIST_CACHE_MAX_AGE_MS) return null;
  return cached.payload;
}

function writeFsListCache(cacheKey: string, payload: Extract<DroneFsListPayload, { ok: true }>): void {
  if (!cacheKey) return;
  if (fsListCache.size > 300) fsListCache.clear();
  fsListCache.set(cacheKey, { atMs: Date.now(), payload });
}

export function invalidateFsListCacheForPath(droneIdRaw: string, pathRaw: string): void {
  const droneId = String(droneIdRaw ?? '').trim();
  const filePath = String(pathRaw ?? '').trim();
  if (!droneId || !filePath) return;
  const slash = filePath.lastIndexOf('/');
  const parentPath = slash > 0 ? filePath.slice(0, slash) : '/';
  fsListCache.delete(fsListCacheKey(droneId, parentPath || '/'));
}

export function invalidateFsListCachesForDrone(droneIdRaw: string): void {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return;
  for (const key of Array.from(fsListCache.keys())) {
    if (key.startsWith(`${droneId}\u0000`)) fsListCache.delete(key);
  }
}

type UseFilesAndPortsPaneStateArgs = {
  currentDrone: DroneSummary | null;
  requestJson: <T>(url: string, init?: RequestInit) => Promise<T>;
  filesEnabled: boolean;
  portsEnabled: boolean;
};

export function useFilesAndPortsPaneState({
  currentDrone,
  requestJson,
  filesEnabled,
  portsEnabled,
}: UseFilesAndPortsPaneStateArgs) {
  const [fsPathByDrone, setFsPathByDrone] = React.useState<Record<string, string>>({});
  const [fsRefreshNonce, setFsRefreshNonce] = React.useState(0);
  const [fsResp, setFsResp] = React.useState<DroneFsListPayload | null>(null);
  const [fsError, setFsError] = React.useState<string | null>(null);
  const [fsLoading, setFsLoading] = React.useState(true);
  const lastFsRefreshNonceRef = React.useRef(fsRefreshNonce);

  const defaultFsPathForCurrentDrone = React.useMemo(() => {
    if (!currentDrone) return '/';
    const homePath = droneHomePath(currentDrone);
    return homePath || '/';
  }, [currentDrone?.name, currentDrone?.repoAttached, currentDrone?.repoPath, currentDrone?.runtime]);

  const currentFsPath = React.useMemo(() => {
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId) return '/';
    const saved = fsPathByDrone[droneId];
    if (isHostRuntimeDrone(currentDrone)) {
      return String(saved || defaultFsPathForCurrentDrone).trim() || '/';
    }
    return normalizeContainerPathInput(saved || defaultFsPathForCurrentDrone);
  }, [currentDrone, defaultFsPathForCurrentDrone, fsPathByDrone]);

  const setFsPathForDrone = React.useCallback(
    (drone: Pick<DroneSummary, 'id' | 'runtime'> | null | undefined, nextPath: string) => {
      const droneId = String(drone?.id ?? '').trim();
      if (!droneId) return;
      const normalized = isHostRuntimeDrone(drone)
        ? String(nextPath ?? '').trim() || '/'
        : normalizeContainerPathInput(nextPath);
      setFsPathByDrone((prev) => {
        if ((prev[droneId] ?? '') === normalized) return prev;
        return { ...prev, [droneId]: normalized };
      });
    },
    [],
  );

  const setCurrentFsPath = React.useCallback(
    (nextPath: string) => {
      setFsPathForDrone(currentDrone, nextPath);
    },
    [currentDrone, setFsPathForDrone],
  );

  const refreshFsList = React.useCallback(() => {
    setFsRefreshNonce((n) => n + 1);
  }, []);

  React.useEffect(() => {
    if (!filesEnabled) {
      setFsLoading(false);
      return;
    }
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!currentDrone || !droneId || isDroneStartingOrSeeding(currentDrone.hubPhase)) {
      setFsResp({ ok: true, id: '', name: '', path: '/', entries: [] });
      setFsError(null);
      setFsLoading(false);
      return;
    }

    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let forceAfterBusy = false;
    let hasLoadedData = false;
    const forceInitialLoad = fsRefreshNonce !== lastFsRefreshNonceRef.current;
    lastFsRefreshNonceRef.current = fsRefreshNonce;
    const cacheKey = fsListCacheKey(droneId, currentFsPath);
    const cached = forceInitialLoad ? null : readFsListCache(cacheKey);
    if (cached) {
      hasLoadedData = true;
      setFsResp(cached);
      setFsError(null);
      setFsLoading(false);
    } else {
      setFsResp(null);
      setFsError(null);
      setFsLoading(true);
    }

    const clearTimer = () => {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
    };
    const scheduleNext = () => {
      clearTimer();
      timer = setTimeout(() => {
        void load(true, true);
      }, hasLoadedData ? FS_LIST_POLL_IDLE_MS : FS_LIST_POLL_LOADING_MS);
      (timer as any).unref?.();
    };

    const load = async (silent: boolean, force = false): Promise<void> => {
      if (!mounted) return;
      if (busy) {
        if (force) forceAfterBusy = true;
        return;
      }
      if (!force) {
        const fresh = readFsListCache(cacheKey);
        if (fresh) {
          hasLoadedData = true;
          setFsResp(fresh);
          setFsError(null);
          setFsLoading(false);
          scheduleNext();
          return;
        }
      }
      busy = true;
      if (!silent) setFsLoading(true);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FS_LIST_REQUEST_TIMEOUT_MS);
        const data = await requestJson<DroneFsListPayload>(
          `/api/drones/${encodeURIComponent(droneId)}/fs/list?path=${encodeURIComponent(currentFsPath)}`,
          { signal: controller.signal },
        ).catch((e: any) => {
          if (e?.name === 'AbortError') {
            throw new Error(`Files request timed out after ${Math.round(FS_LIST_REQUEST_TIMEOUT_MS / 1000)}s.`);
          }
          throw e;
        }).finally(() => clearTimeout(timer));
        if (!mounted) return;
        if ((data as any)?.ok !== true) {
          throw new Error(String((data as any)?.error ?? 'filesystem request failed'));
        }
        hasLoadedData = true;
        const payload = data as Extract<DroneFsListPayload, { ok: true }>;
        writeFsListCache(cacheKey, payload);
        setFsResp((current) => (sameDroneFsListPayload(current, payload) ? current : payload));
        setFsError(null);
      } catch (e: any) {
        if (!mounted) return;
        setFsError(e?.message ?? String(e));
      } finally {
        busy = false;
        if (mounted) {
          setFsLoading(false);
          if (forceAfterBusy) {
            forceAfterBusy = false;
            void load(false, true);
            return;
          }
          scheduleNext();
        }
      }
    };

    const onVisibilityChange = () => {
      if (!mounted || typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      clearTimer();
      void load(true, true);
    };

    void load(Boolean(cached) && !forceInitialLoad, Boolean(cached) || forceInitialLoad);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted = false;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [currentDrone?.id, currentDrone?.name, currentDrone?.hubPhase, currentFsPath, filesEnabled, fsRefreshNonce, requestJson]);

  const fsPayloadError =
    fsResp && (fsResp as any).ok === false ? String((fsResp as any)?.error ?? 'filesystem request failed') : null;
  const fsErrorCombined = fsError ?? fsPayloadError;
  const fsEntries =
    fsResp && (fsResp as any).ok === true ? (((fsResp as any).entries as DroneFsEntry[]) ?? []) : [];

  const filesPane = usePaneReadiness({
    hubPhase: currentDrone?.hubPhase,
    resetKey: `${currentDrone?.id ?? ''}\u0000files`,
    timeoutMs: 18_000,
  });
  const fsOkForCurrentDrone = Boolean(
    currentDrone &&
      (fsResp as any)?.ok === true &&
      String((fsResp as any)?.id ?? '').trim() === String(currentDrone.id ?? '').trim(),
  );
  React.useEffect(() => {
    if (fsOkForCurrentDrone) filesPane.markReady();
  }, [fsOkForCurrentDrone, filesPane.markReady]);
  const fsErrorUi = filesPane.suppressErrors ? null : fsErrorCombined;

  const portsPollIntervalMs = currentDrone ? 5000 : 60000;
  const {
    value: portsResp,
    error: portsError,
    loading: portsLoading,
  } = usePoll<DronePortsPayload>(
    () =>
      currentDrone && !isDroneStartingOrSeeding(currentDrone.hubPhase)
        ? fetchJson(`/api/drones/${encodeURIComponent(currentDrone.id)}/ports`)
        : Promise.resolve({ ok: true, id: '', name: '', ports: [] }),
    portsPollIntervalMs,
    [currentDrone?.id, currentDrone?.hubPhase],
    { enabled: portsEnabled },
  );
  const ports =
    portsResp && (portsResp as any).ok === true ? ((portsResp as any).ports as DronePortMapping[]) : null;
  const portsPayloadError =
    portsResp && (portsResp as any).ok === false
      ? String((portsResp as any)?.error ?? 'ports request failed')
      : null;
  const portsErrorCombined = portsError ?? portsPayloadError;

  const portsPane = usePaneReadiness({
    hubPhase: currentDrone?.hubPhase,
    resetKey: `${currentDrone?.id ?? ''}\u0000ports`,
    timeoutMs: 18_000,
  });
  const portsOkForCurrentDrone = Boolean(
    currentDrone &&
      (portsResp as any)?.ok === true &&
      String((portsResp as any)?.id ?? '').trim() === String(currentDrone.id ?? '').trim(),
  );
  React.useEffect(() => {
    if (portsOkForCurrentDrone) portsPane.markReady();
  }, [portsOkForCurrentDrone, portsPane.markReady]);
  const portsErrorUi = portsPane.suppressErrors ? null : portsErrorCombined;

  const portRows = React.useMemo(
    () =>
      normalizePortRows(
        ports,
        typeof currentDrone?.hostPort === 'number' && Number.isFinite(currentDrone.hostPort)
          ? currentDrone.hostPort
          : null,
        typeof currentDrone?.containerPort === 'number' &&
          Number.isFinite(currentDrone.containerPort)
          ? currentDrone.containerPort
          : null,
      ),
    [ports, currentDrone?.hostPort, currentDrone?.containerPort],
  );

  const [portPreviewByDrone, setPortPreviewByDrone] = React.useState<PortPreviewByDrone>(() =>
    readPortPreviewByDrone(readLocalStorageItem(PORT_PREVIEW_STORAGE_KEY)),
  );
  const [previewUrlByDrone, setPreviewUrlByDrone] = React.useState<PreviewUrlByDrone>(() =>
    readPreviewUrlByDrone(readLocalStorageItem(PREVIEW_URL_STORAGE_KEY)),
  );
  const [portReachabilityByDrone, setPortReachabilityByDrone] =
    React.useState<PortReachabilityByDrone>({});
  usePersistedLocalStorageItem(
    PORT_PREVIEW_STORAGE_KEY,
    JSON.stringify(portPreviewByDrone),
  );
  usePersistedLocalStorageItem(
    PREVIEW_URL_STORAGE_KEY,
    JSON.stringify(previewUrlByDrone),
  );

  const selectedPreviewPort = React.useMemo(() => {
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId || portRows.length === 0) return null;
    const saved = portPreviewByDrone[droneId];
    if (saved) {
      const savedPort = portRows.find((p) => p.containerPort === saved.containerPort) ?? null;
      if (savedPort) return savedPort;
    }
    return resolveDefaultPreviewPort(portRows, currentDrone?.containerPort);
  }, [currentDrone?.containerPort, currentDrone?.id, portPreviewByDrone, portRows]);
  const portRowsSignature = React.useMemo(
    () => portRows.map((p) => `${p.containerPort}:${p.hostPort}`).join(','),
    [portRows],
  );

  const setSelectedPreviewPort = React.useCallback(
    (port: DronePortMapping | null) => {
      const droneId = String(currentDrone?.id ?? '').trim();
      if (!droneId) return;
      if (port) {
        // Selecting a port should make preview follow that port URL.
        setPreviewUrlByDrone((prev) => {
          if (!prev[droneId]) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
      }
      setPortPreviewByDrone((prev) => {
        const next = { ...prev };
        if (!port) {
          if (!next[droneId]) return prev;
          delete next[droneId];
          return next;
        }
        const prevSel = next[droneId];
        if (prevSel && prevSel.containerPort === port.containerPort) {
          return prev;
        }
        next[droneId] = { containerPort: port.containerPort };
        return next;
      });
    },
    [currentDrone?.id],
  );

  const selectedPreviewDefaultUrl = React.useMemo(
    () =>
      selectedPreviewPort
        ? `http://localhost:${selectedPreviewPort.hostPort}/`
        : null,
    [selectedPreviewPort],
  );

  const selectedPreviewUrlOverride = React.useMemo(() => {
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId) return null;
    return previewUrlByDrone[droneId] ?? null;
  }, [currentDrone?.id, previewUrlByDrone]);

  const setSelectedPreviewUrlOverride = React.useCallback(
    (nextUrl: string | null) => {
      const droneId = String(currentDrone?.id ?? '').trim();
      if (!droneId) return;
      setPreviewUrlByDrone((prev) => {
        const next = { ...prev };
        const normalized = nextUrl ? normalizePreviewUrl(nextUrl) : null;
        if (!normalized) {
          if (!next[droneId]) return prev;
          delete next[droneId];
          return next;
        }
        const rewritten = rewriteLoopbackUrlToHostLoopback(
          normalized,
          portRows,
        );
        const rewrittenLegacyPreview = rewriteContainerPreviewUrlToHostLoopback(
          normalized,
          portRows,
        );
        const finalUrl =
          normalizePreviewUrl(rewritten || rewrittenLegacyPreview || normalized) ??
          (rewritten || rewrittenLegacyPreview || normalized);
        const defaultUrl = selectedPreviewDefaultUrl
          ? normalizePreviewUrl(selectedPreviewDefaultUrl) ??
            selectedPreviewDefaultUrl
          : null;
        if (defaultUrl && finalUrl === defaultUrl) {
          if (!next[droneId]) return prev;
          delete next[droneId];
          return next;
        }
        if (next[droneId] === finalUrl) return prev;
        next[droneId] = finalUrl;
        return next;
      });
    },
    [currentDrone?.id, portRows, selectedPreviewDefaultUrl],
  );

  React.useEffect(() => {
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId) return;
    const currentOverride = previewUrlByDrone[droneId];
    if (!currentOverride) return;
    const rewritten = rewriteLoopbackUrlToHostLoopback(
      currentOverride,
      portRows,
    );
    const rewrittenLegacyPreview = rewriteContainerPreviewUrlToHostLoopback(
      currentOverride,
      portRows,
    );
    if (!rewritten && !rewrittenLegacyPreview) return;
    const rewrittenValue = rewritten || rewrittenLegacyPreview;
    if (!rewrittenValue) return;
    const rewrittenNormalized = normalizePreviewUrl(rewrittenValue) ?? rewrittenValue;
    const defaultUrl = selectedPreviewDefaultUrl
      ? normalizePreviewUrl(selectedPreviewDefaultUrl) ?? selectedPreviewDefaultUrl
      : null;
    const nextValue =
      defaultUrl && rewrittenNormalized === defaultUrl ? null : rewrittenNormalized;
    setPreviewUrlByDrone((prev) => {
      if (prev[droneId] !== currentOverride) return prev;
      const next = { ...prev };
      if (!nextValue) {
        delete next[droneId];
      } else {
        next[droneId] = nextValue;
      }
      return next;
    });
  }, [currentDrone?.id, portRows, previewUrlByDrone, selectedPreviewDefaultUrl]);

  React.useEffect(() => {
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId || portRows.length === 0) return;
    let mounted = true;
    const probeTargets = [...portRows];

    const warmStatuses = () => {
      setPortReachabilityByDrone((prev) => {
        const current = prev[droneId] ?? {};
        const nextForDrone: PortReachabilityByHostPort = {};
        for (const p of portRows) {
          const key = String(p.hostPort);
          nextForDrone[key] = current[key] ?? 'checking';
        }
        if (sameReachabilityMap(current, nextForDrone)) return prev;
        return { ...prev, [droneId]: nextForDrone };
      });
    };

    const probe = async () => {
      const checks = await Promise.all(
        probeTargets.map(async (p) => ({
          hostPort: p.hostPort,
          state: (await probeLocalhostPort(p.hostPort, PORT_STATUS_TIMEOUT_MS))
            ? ('up' as const)
            : ('down' as const),
        })),
      );
      if (!mounted) return;
      setPortReachabilityByDrone((prev) => {
        const current = prev[droneId] ?? {};
        const checksByHostPort = new Map<string, 'up' | 'down'>(
          checks.map((c) => [String(c.hostPort), c.state]),
        );
        const nextForDrone: PortReachabilityByHostPort = {};
        for (const p of portRows) {
          const key = String(p.hostPort);
          nextForDrone[key] = checksByHostPort.get(key) ?? current[key] ?? 'checking';
        }
        if (sameReachabilityMap(current, nextForDrone)) return prev;
        return { ...prev, [droneId]: nextForDrone };
      });
    };

    warmStatuses();
    void probe();

    return () => {
      mounted = false;
    };
  }, [
    currentDrone?.id,
    portRows,
    portRowsSignature,
  ]);

  const currentPortReachability = React.useMemo(() => {
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId) return {};
    return portReachabilityByDrone[droneId] ?? {};
  }, [currentDrone?.id, portReachabilityByDrone]);

  return {
    defaultFsPathForCurrentDrone,
    currentFsPath,
    setFsPathForDrone,
    setCurrentFsPath,
    refreshFsList,
    fsEntries,
    fsLoading,
    fsError,
    fsErrorUi,
    filesPane,
    selectedPreviewPort,
    currentPortReachability,
    portsLoading,
    portsError,
    portsErrorUi,
    portsPane,
    selectedPreviewDefaultUrl,
    selectedPreviewUrlOverride,
    setSelectedPreviewUrlOverride,
    portRows,
    setSelectedPreviewPort,
  };
}
