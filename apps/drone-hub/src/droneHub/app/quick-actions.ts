import type { DroneSummary } from '../types';
import { PORT_PREVIEW_STORAGE_KEY, PREVIEW_URL_STORAGE_KEY } from './app-config';
import { normalizePreviewUrl, readPortPreviewByDrone, readPreviewUrlByDrone } from './helpers';
import { readLocalStorageItem } from './hooks';

type DroneQuickTarget = Pick<DroneSummary, 'id' | 'containerPort' | 'hostPort'>;

function previewProxyUrl(droneIdRaw: string, containerPortRaw: number): string | null {
  const droneId = String(droneIdRaw ?? '').trim();
  const containerPort = Number(containerPortRaw);
  if (!droneId || !Number.isFinite(containerPort) || containerPort <= 0) return null;
  return `/api/drones/${encodeURIComponent(droneId)}/preview/${Math.floor(containerPort)}/`;
}

export function resolveDroneOpenTabUrl(drone: DroneQuickTarget): string | null {
  const droneId = String(drone?.id ?? '').trim();
  if (!droneId) return null;

  try {
    const previewByDrone = readPreviewUrlByDrone(readLocalStorageItem(PREVIEW_URL_STORAGE_KEY));
    const override = normalizePreviewUrl(String(previewByDrone[droneId] ?? '').trim());
    if (override) return override;

    const portByDrone = readPortPreviewByDrone(readLocalStorageItem(PORT_PREVIEW_STORAGE_KEY));
    const lastPort = Number(portByDrone[droneId]?.containerPort);
    const lastPortUrl = previewProxyUrl(droneId, lastPort);
    if (lastPortUrl) return lastPortUrl;
  } catch {
    // ignore storage errors and fall back to live defaults below
  }

  const fallbackPreview = previewProxyUrl(droneId, Number(drone?.containerPort));
  if (fallbackPreview) return fallbackPreview;

  const hostPort = Number(drone?.hostPort);
  if (Number.isFinite(hostPort) && hostPort > 0) return `http://localhost:${Math.floor(hostPort)}/`;
  return null;
}

export function openDroneTabFromLastPreview(drone: DroneQuickTarget): boolean {
  const url = resolveDroneOpenTabUrl(drone);
  if (!url) return false;
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}
