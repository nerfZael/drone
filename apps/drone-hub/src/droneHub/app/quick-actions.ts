import type { DroneSummary } from '../types';
import { PORT_PREVIEW_STORAGE_KEY, PREVIEW_URL_STORAGE_KEY } from './app-config';
import { normalizePreviewUrl, readPortPreviewByDrone, readPreviewUrlByDrone } from './helpers';
import { readLocalStorageItem } from './hooks';

type DroneQuickTarget = Pick<DroneSummary, 'id' | 'containerPort' | 'hostPort'>;
type PortRow = { containerPort: number; hostPort: number };

function previewProxyUrl(droneIdRaw: string, containerPortRaw: number | null | undefined): string | null {
  const droneId = String(droneIdRaw ?? '').trim();
  const containerPort = Number(containerPortRaw);
  if (!droneId || !Number.isFinite(containerPort) || containerPort <= 0) return null;
  return `/api/drones/${encodeURIComponent(droneId)}/preview/${Math.floor(containerPort)}/`;
}

function localhostUrl(hostPortRaw: number | null | undefined): string | null {
  const hostPort = Number(hostPortRaw);
  if (!Number.isFinite(hostPort) || hostPort <= 0) return null;
  return `http://localhost:${Math.floor(hostPort)}/`;
}

function parseProxyContainerPort(urlRaw: string, droneIdRaw: string): number | null {
  const url = String(urlRaw ?? '').trim();
  const droneId = String(droneIdRaw ?? '').trim();
  if (!url || !droneId) return null;
  const escaped = droneId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = url.match(new RegExp(`^/api/drones/${escaped}/preview/(\\d+)(?:/|$)`));
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function readPreviewPreference(droneIdRaw: string): { overrideUrl: string | null; preferredContainerPort: number | null } {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return { overrideUrl: null, preferredContainerPort: null };
  try {
    const previewByDrone = readPreviewUrlByDrone(readLocalStorageItem(PREVIEW_URL_STORAGE_KEY));
    const overrideUrl = normalizePreviewUrl(String(previewByDrone[droneId] ?? '').trim());
    const portByDrone = readPortPreviewByDrone(readLocalStorageItem(PORT_PREVIEW_STORAGE_KEY));
    const preferredContainerPortRaw = Number(portByDrone[droneId]?.containerPort);
    const preferredContainerPort =
      Number.isFinite(preferredContainerPortRaw) && preferredContainerPortRaw > 0
        ? Math.floor(preferredContainerPortRaw)
        : null;
    return { overrideUrl: overrideUrl ?? null, preferredContainerPort };
  } catch {
    return { overrideUrl: null, preferredContainerPort: null };
  }
}

async function fetchLivePortRows(droneIdRaw: string): Promise<PortRow[] | null> {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return null;
  try {
    const r = await fetch(`/api/drones/${encodeURIComponent(droneId)}/ports`);
    if (!r.ok) return null;
    const text = await r.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.ok !== true || !Array.isArray(parsed.ports)) return null;
    const rows: PortRow[] = [];
    const seen = new Set<string>();
    for (const row of parsed.ports) {
      const containerPort = Number(row?.containerPort);
      const hostPort = Number(row?.hostPort);
      if (!Number.isFinite(containerPort) || containerPort <= 0 || !Number.isFinite(hostPort) || hostPort <= 0) continue;
      const key = `${Math.floor(containerPort)}:${Math.floor(hostPort)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ containerPort: Math.floor(containerPort), hostPort: Math.floor(hostPort) });
    }
    rows.sort((a, b) => a.containerPort - b.containerPort || a.hostPort - b.hostPort);
    return rows;
  } catch {
    return null;
  }
}

export function resolveDroneOpenTabUrl(drone: DroneQuickTarget): string | null {
  const droneId = String(drone?.id ?? '').trim();
  if (!droneId) return null;
  const prefs = readPreviewPreference(droneId);
  const hostFallback = localhostUrl(drone?.hostPort ?? null);
  if (hostFallback) return hostFallback;
  if (prefs.overrideUrl && !parseProxyContainerPort(prefs.overrideUrl, droneId)) return prefs.overrideUrl;
  const lastPortUrl = previewProxyUrl(droneId, prefs.preferredContainerPort ?? null);
  if (lastPortUrl) return lastPortUrl;
  const fallbackPreview = previewProxyUrl(droneId, Number(drone?.containerPort));
  if (fallbackPreview) return fallbackPreview;
  return null;
}

async function resolveDroneOpenTabUrlLive(drone: DroneQuickTarget): Promise<string | null> {
  const droneId = String(drone?.id ?? '').trim();
  if (!droneId) return null;
  const prefs = readPreviewPreference(droneId);
  const preferredContainerPort = prefs.preferredContainerPort ?? parseProxyContainerPort(prefs.overrideUrl ?? '', droneId) ?? null;
  const liveRows = await fetchLivePortRows(droneId);

  if (liveRows && liveRows.length > 0) {
    if (preferredContainerPort != null) {
      const mapped = liveRows.find((row) => row.containerPort === preferredContainerPort);
      if (mapped) return localhostUrl(mapped.hostPort);
    }
    const currentContainerPort = Number(drone?.containerPort);
    if (Number.isFinite(currentContainerPort) && currentContainerPort > 0) {
      const mapped = liveRows.find((row) => row.containerPort === Math.floor(currentContainerPort));
      if (mapped) return localhostUrl(mapped.hostPort);
    }
    if (prefs.overrideUrl && !parseProxyContainerPort(prefs.overrideUrl, droneId)) return prefs.overrideUrl;
    return localhostUrl(liveRows[0].hostPort);
  }

  if (prefs.overrideUrl) return prefs.overrideUrl;
  const hostFallback = localhostUrl(drone?.hostPort ?? null);
  if (hostFallback) return hostFallback;
  if (preferredContainerPort != null) return previewProxyUrl(droneId, preferredContainerPort);
  return previewProxyUrl(droneId, Number(drone?.containerPort));
}

export async function openDroneTabFromLastPreview(drone: DroneQuickTarget): Promise<boolean> {
  const url = await resolveDroneOpenTabUrlLive(drone);
  if (!url) return false;
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}
