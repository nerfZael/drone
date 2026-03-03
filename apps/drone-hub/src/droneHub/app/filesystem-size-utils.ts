export const BYTES_PER_MIB = 1024 * 1024;

export function parseUploadMaxMiBDraft(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i <= 0) return null;
  return i;
}

export function miBToBytes(mib: number): number {
  return Math.max(1, Math.floor(mib)) * BYTES_PER_MIB;
}

export function bytesToNearestMiB(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.round(n / BYTES_PER_MIB));
}

export function bytesToMinMiB(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.ceil(n / BYTES_PER_MIB));
}

export function bytesToMaxMiB(value: number, minMiB = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Math.max(1, minMiB);
  return Math.max(Math.max(1, minMiB), Math.floor(n / BYTES_PER_MIB));
}
