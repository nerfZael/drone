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

export function displayUrlForPreviewInput(rawUrl: string | null): string {
  const raw = String(rawUrl ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = raw.startsWith('/') ? new URL(raw, 'http://local.preview') : new URL(raw);
    const m = parsed.pathname.match(/^\/api\/drones\/[^/]+\/preview\/(\d+)(\/.*)?$/);
    if (!m) return raw;
    const containerPort = Number(m[1]);
    if (!Number.isFinite(containerPort) || containerPort <= 0) return raw;
    const tailPath = m[2] && m[2].length > 0 ? m[2] : '/';
    return `http://localhost:${containerPort}${tailPath}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return raw;
  }
}
