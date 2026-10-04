export const SEEN_SPAWN_MODEL_LIMIT = 40;

export function normalizeSeenModelIds(value: unknown, limit = SEEN_SPAWN_MODEL_LIMIT): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = String(entry ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

export function mergeSeenModelIds(
  current: string[],
  incoming: Iterable<string | null | undefined>,
  limit = SEEN_SPAWN_MODEL_LIMIT,
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of incoming) {
    const id = String(entry ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
    if (next.length >= limit) return next;
  }
  for (const entry of current) {
    const id = String(entry ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
    if (next.length >= limit) break;
  }
  return next;
}
