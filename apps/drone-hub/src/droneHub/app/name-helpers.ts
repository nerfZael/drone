export function isUntitledLikeDroneName(raw: string): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return false;
  if (s === 'untitled') return true;
  if (!s.startsWith('untitled-')) return false;
  const rest = s.slice('untitled-'.length);
  if (!rest) return false;
  // `uniqueDraftDroneName()` can create:
  // - untitled-2, untitled-3, ...
  // - untitled-<base36>, untitled-<base36>-2, ...
  return /^\d+$/.test(rest) || /^[a-z0-9]{4,18}(?:-\d+)?$/.test(rest);
}

export function normalizeDraftDroneName(input: string): string {
  const cleaned = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 48).replace(/-+$/g, '');
}

export function droneNameHasWhitespace(input: string): boolean {
  // Display names can contain spaces; only reject characters that break ids/paths/payloads.
  return /[\r\n\t]/.test(String(input ?? ''));
}
