export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function formatCredits(microcredits: number): string {
  const credits = Number(microcredits) / 1_000_000;
  if (!Number.isFinite(credits)) return '0';
  const abs = Math.abs(credits);
  if (abs >= 100) return credits.toFixed(0);
  if (abs >= 1) return credits.toFixed(2);
  if (abs > 0) return credits.toFixed(4);
  return '0';
}
