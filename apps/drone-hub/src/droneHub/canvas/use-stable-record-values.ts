import React from 'react';

function shallowEqualObjects(a: object, b: object): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}

/** The record with each value kept from the last render while it is shallowly equal. */
export function useStableRecordValues<T extends object>(record: Record<string, T>): Record<string, T> {
  const previousRef = React.useRef<Record<string, T>>({});
  return React.useMemo(() => {
    const previous = previousRef.current;
    const next: Record<string, T> = {};
    let changed = Object.keys(previous).length !== Object.keys(record).length;
    for (const [key, value] of Object.entries(record)) {
      const kept = previous[key];
      if (kept !== undefined && (kept === value || shallowEqualObjects(kept, value))) {
        next[key] = kept;
      } else {
        next[key] = value;
        changed = true;
      }
    }
    const result = changed ? next : previous;
    previousRef.current = result;
    return result;
  }, [record]);
}
