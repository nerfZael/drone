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
  buildContainerPreviewUrl,
  droneHomePath,
  isDroneStartingOrSeeding,
  normalizeContainerPathInput,
  normalizePortRows,
  normalizePreviewUrl,
  readPortPreviewByDrone,
  readPreviewUrlByDrone,
  rewriteLoopbackUrlToContainerPreview,
  sameReachabilityMap,
} from './helpers';
import {
  fetchJson,
  probeLocalhostPort,
  readLocalStorageItem,
  usePersistedLocalStorageItem,
  usePoll,
} from './hooks';

type UseFilesAndPortsPaneStateArgs = {
  currentDrone: DroneSummary | null;
  requestJson: <T>(url: string, init?: RequestInit) => Promise<T>;
};

export function useFilesAndPortsPaneState({ currentDrone, requestJson }: UseFilesAndPortsPaneStateArgs) {
  const [fsPathByDrone, setFsPathByDrone] = React.useState<Record<string, string>>({});
  const [fsRefreshNonce, setFsRefreshNonce] = React.useState(0);

  const defaultFsPathForCurrentDrone = React.useMemo(() => {
    if (!currentDrone) return '/dvm-data/home';
    return droneHomePath(currentDrone);
  }, [currentDrone?.name, currentDrone?.repoAttached, currentDrone?.repoPath]);

  const currentFsPath = React.useMemo(() => {
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId) return '/dvm-data/home';
    const saved = fsPathByDrone[droneId];
    return normalizeContainerPathInput(saved || defaultFsPathForCurrentDrone);
  }, [currentDrone?.id, defaultFsPathForCurrentDrone, fsPathByDrone]);

  const setCurrentFsPath = React.useCallback(
    (nextPath: string) => {
      const droneId = String(currentDrone?.id ?? '').trim();
      if (!droneId) return;
      const normalized = normalizeContainerPathInput(nextPath);
      setFsPathByDrone((prev) => {
        if ((prev[droneId] ?? '') === normalized) return prev;
        return { ...prev, [droneId]: normalized };
      });
    },
    [currentDrone?.id],
  );

  const refreshFsList = React.useCallback(() => {
    setFsRefreshNonce((n) => n + 1);
  }, []);

  const fsPollIntervalMs = currentDrone ? 8000 : 60000;
  const {
    value: fsResp,
    error: fsError,
    loading: fsLoading,
  } = usePoll<DroneFsListPayload>(
    () =>
      currentDrone && !isDroneStartingOrSeeding(currentDrone.hubPhase)
        ? requestJson(`/api/drones/${encodeURIComponent(currentDrone.id)}/fs/list?path=${encodeURIComponent(currentFsPath)}`)
        : Promise.resolve({ ok: true, id: '', name: '', path: '/', entries: [] }),
    fsPollIntervalMs,
    [currentDrone?.id, currentDrone?.hubPhase, currentFsPath, fsRefreshNonce],
  );
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
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return null;
    const saved = portPreviewByDrone[droneName];
    if (!saved) return null;
    return (
      portRows.find(
        (p) =>
          p.containerPort === saved.containerPort && p.hostPort === saved.hostPort,
      ) ??
      portRows.find((p) => p.containerPort === saved.containerPort) ??
      portRows.find((p) => p.hostPort === saved.hostPort) ??
      null
    );
  }, [currentDrone?.name, portPreviewByDrone, portRows]);
  const portRowsSignature = React.useMemo(
    () => portRows.map((p) => `${p.containerPort}:${p.hostPort}`).join(','),
    [portRows],
  );

  const setSelectedPreviewPort = React.useCallback(
    (port: DronePortMapping | null) => {
      const droneName = String(currentDrone?.name ?? '').trim();
      if (!droneName) return;
      if (port) {
        // Selecting a port should make preview follow that port URL.
        setPreviewUrlByDrone((prev) => {
          if (!prev[droneName]) return prev;
          const next = { ...prev };
          delete next[droneName];
          return next;
        });
      }
      setPortPreviewByDrone((prev) => {
        const next = { ...prev };
        if (!port) {
          if (!next[droneName]) return prev;
          delete next[droneName];
          return next;
        }
        const prevSel = next[droneName];
        if (
          prevSel &&
          prevSel.hostPort === port.hostPort &&
          prevSel.containerPort === port.containerPort
        ) {
          return prev;
        }
        next[droneName] = {
          hostPort: port.hostPort,
          containerPort: port.containerPort,
        };
        return next;
      });
    },
    [currentDrone?.name],
  );

  const selectedPreviewDefaultUrl = React.useMemo(
    () =>
      selectedPreviewPort && currentDrone?.name
        ? buildContainerPreviewUrl(
            currentDrone.name,
            selectedPreviewPort.containerPort,
          )
        : null,
    [currentDrone?.name, selectedPreviewPort],
  );

  const selectedPreviewUrlOverride = React.useMemo(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return null;
    return previewUrlByDrone[droneName] ?? null;
  }, [currentDrone?.name, previewUrlByDrone]);

  const setSelectedPreviewUrlOverride = React.useCallback(
    (nextUrl: string | null) => {
      const droneName = String(currentDrone?.name ?? '').trim();
      if (!droneName) return;
      setPreviewUrlByDrone((prev) => {
        const next = { ...prev };
        const normalized = nextUrl ? normalizePreviewUrl(nextUrl) : null;
        if (!normalized) {
          if (!next[droneName]) return prev;
          delete next[droneName];
          return next;
        }
        const rewritten = rewriteLoopbackUrlToContainerPreview(
          normalized,
          droneName,
          portRows,
        );
        const finalUrl =
          normalizePreviewUrl(rewritten || normalized) ??
          (rewritten || normalized);
        const defaultUrl = selectedPreviewDefaultUrl
          ? normalizePreviewUrl(selectedPreviewDefaultUrl) ??
            selectedPreviewDefaultUrl
          : null;
        if (defaultUrl && finalUrl === defaultUrl) {
          if (!next[droneName]) return prev;
          delete next[droneName];
          return next;
        }
        if (next[droneName] === finalUrl) return prev;
        next[droneName] = finalUrl;
        return next;
      });
    },
    [currentDrone?.name, portRows, selectedPreviewDefaultUrl],
  );

  React.useEffect(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return;
    const currentOverride = previewUrlByDrone[droneName];
    if (!currentOverride) return;
    const rewritten = rewriteLoopbackUrlToContainerPreview(
      currentOverride,
      droneName,
      portRows,
    );
    if (!rewritten) return;
    const rewrittenNormalized = normalizePreviewUrl(rewritten) ?? rewritten;
    const defaultUrl = selectedPreviewDefaultUrl
      ? normalizePreviewUrl(selectedPreviewDefaultUrl) ?? selectedPreviewDefaultUrl
      : null;
    const nextValue =
      defaultUrl && rewrittenNormalized === defaultUrl ? null : rewrittenNormalized;
    setPreviewUrlByDrone((prev) => {
      if (prev[droneName] !== currentOverride) return prev;
      const next = { ...prev };
      if (!nextValue) {
        delete next[droneName];
      } else {
        next[droneName] = nextValue;
      }
      return next;
    });
  }, [currentDrone?.name, portRows, previewUrlByDrone, selectedPreviewDefaultUrl]);

  React.useEffect(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName || portRows.length === 0) return;
    let mounted = true;
    const probeTargets =
      selectedPreviewPort &&
      portRows.some(
        (p) =>
          p.hostPort === selectedPreviewPort.hostPort &&
          p.containerPort === selectedPreviewPort.containerPort,
      )
        ? [selectedPreviewPort]
        : [];

    const warmStatuses = () => {
      setPortReachabilityByDrone((prev) => {
        const current = prev[droneName] ?? {};
        const nextForDrone: PortReachabilityByHostPort = {};
        for (const p of portRows) {
          const key = String(p.hostPort);
          nextForDrone[key] = current[key] ?? 'checking';
        }
        if (sameReachabilityMap(current, nextForDrone)) return prev;
        return { ...prev, [droneName]: nextForDrone };
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
        const current = prev[droneName] ?? {};
        const checksByHostPort = new Map<string, 'up' | 'down'>(
          checks.map((c) => [String(c.hostPort), c.state]),
        );
        const nextForDrone: PortReachabilityByHostPort = {};
        for (const p of portRows) {
          const key = String(p.hostPort);
          nextForDrone[key] = checksByHostPort.get(key) ?? current[key] ?? 'checking';
        }
        if (sameReachabilityMap(current, nextForDrone)) return prev;
        return { ...prev, [droneName]: nextForDrone };
      });
    };

    warmStatuses();
    if (probeTargets.length === 0) return;
    void probe();

    return () => {
      mounted = false;
    };
  }, [
    currentDrone?.name,
    portRows,
    portRowsSignature,
    selectedPreviewPort?.containerPort,
    selectedPreviewPort?.hostPort,
  ]);

  const currentPortReachability = React.useMemo(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return {};
    return portReachabilityByDrone[droneName] ?? {};
  }, [currentDrone?.name, portReachabilityByDrone]);

  return {
    defaultFsPathForCurrentDrone,
    currentFsPath,
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

