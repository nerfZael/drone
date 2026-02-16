export function bashQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function shellQuoteIfNeeded(s: string): string {
  const v = String(s);
  // Conservative "safe" set: avoid quoting common path-ish tokens.
  // If anything looks weird, fall back to full bash quoting.
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(v)) return v;
  return bashQuote(v);
}

export function normalizeContainerPath(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '/';
  return s.startsWith('/') ? s : `/${s}`;
}

export function encodeRemotePath(p: string): string {
  // Keep "/" separators while escaping segments.
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export function hexEncodeUtf8(s: string): string {
  return Buffer.from(String(s ?? ''), 'utf8').toString('hex');
}

export function parseBoolParam(raw: string | null, defaultValue: boolean): boolean {
  if (raw == null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
  return defaultValue;
}

