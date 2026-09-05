/** Structural sharing for normalized JSON snapshots, without serializing them. */
export function retainSnapshotValue<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next;
  if (Array.isArray(previous) !== Array.isArray(next)) return next;
  const old = previous as Record<string, unknown>;
  const fresh = next as Record<string, unknown>;
  const keys = Object.keys(fresh);
  let equal = Object.keys(old).length === keys.length;
  const retained = (Array.isArray(next) ? [...next] : { ...next }) as Record<string, unknown>;
  for (const key of keys) {
    retained[key] = retainSnapshotValue(old[key], fresh[key]);
    if (!Object.prototype.hasOwnProperty.call(old, key) || retained[key] !== old[key])
      equal = false;
  }
  return equal ? previous : (retained as T);
}
