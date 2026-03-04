import type { DronePortMapping } from '../types';

export function shortPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 3) return p;
  return '.../' + parts.slice(-2).join('/');
}

export function normalizePreviewUrl(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return trimmed;
  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function displayUrlForPreviewInput(
  rawUrl: string | null,
  portRows: DronePortMapping[] = [],
): string {
  const raw = String(rawUrl ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = raw.startsWith('/') ? new URL(raw, 'http://local.preview') : new URL(raw);
    const m = parsed.pathname.match(/^\/api\/drones\/[^/]+\/preview(?:-open)?\/(\d+)(\/.*)?$/);
    if (m) {
      const containerPort = Number(m[1]);
      if (!Number.isFinite(containerPort) || containerPort <= 0) return raw;
      const tailPath = m[2] && m[2].length > 0 ? m[2] : '/';
      return `http://localhost:${containerPort}${tailPath}${parsed.search || ''}${parsed.hash || ''}`;
    }

    const host = String(parsed.hostname ?? '').toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const port = Number(parsed.port);
    if (!isLoopback || !Number.isFinite(port) || port <= 0) return raw;

    const mapped = portRows.find((p) => p.hostPort === Math.floor(port));
    if (!mapped) return raw;

    const protocol = parsed.protocol === 'https:' ? 'https' : 'http';
    const path = parsed.pathname && parsed.pathname.startsWith('/') ? parsed.pathname : '/';
    return `${protocol}://localhost:${mapped.containerPort}${path}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return raw;
  }
}
