import type React from 'react';

export function removeRecordKey<T extends Record<string, any>>(prev: T, key: string): T {
  if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev;
  const next = { ...prev };
  delete next[key];
  return next;
}

export function beginRecordBusyKey(
  setBusy: React.Dispatch<React.SetStateAction<Record<string, true>>>,
  key: string,
): boolean {
  let shouldStart = false;
  setBusy((prev) => {
    if (prev[key]) return prev;
    shouldStart = true;
    return { ...prev, [key]: true };
  });
  return shouldStart;
}
