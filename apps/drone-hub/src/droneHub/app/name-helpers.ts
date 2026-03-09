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

export function allocateUntitledDisplayName(names: Iterable<string>): string {
  const usedNums = new Set<number>();
  for (const raw of names) {
    const match = String(raw ?? '').trim().match(/^untitled\s+(\d+)$/i);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 1 && Math.floor(value) === value) {
      usedNums.add(value);
    }
  }
  for (let i = 1; i <= 9999; i += 1) {
    if (!usedNums.has(i)) return `Untitled ${i}`;
  }
  return `Untitled ${Date.now().toString(36)}`;
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
