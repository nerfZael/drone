import type React from 'react';

export function removeRecordKey<T extends Record<string, any>>(prev: T, key: string): T {
  if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev;
  const next = { ...prev };
  delete next[key];
  return next;
}

export function beginRecordBusyKey(
  setBusy: React.Dispatch<React.SetStateAction<Record<string, true>>>,
  inFlight: Set<string>,
  key: string,
): boolean {
  // React may defer or replay state updaters. Claim the request synchronously,
  // and keep the updater pure so starting work never depends on rendering.
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  setBusy((prev) => ({ ...prev, [key]: true }));
  return true;
}
