export function clonedAssistantThreadTitle(
  sourceTitle: string,
  threads: Array<{ title?: string }>,
): string {
  const base = String(sourceTitle || 'Thread').trim().slice(0, 153) || 'Thread';
  const titles = new Set(threads.map((thread) => String(thread.title ?? '').trim()));
  const first = `${base} (copy)`;
  if (!titles.has(first)) return first;
  for (let copy = 2; copy < 10_000; copy += 1) {
    const suffix = ` (copy ${copy})`;
    const candidate = `${base.slice(0, 160 - suffix.length)}${suffix}`;
    if (!titles.has(candidate)) return candidate;
  }
  return `${base.slice(0, 145)} (${Date.now()})`;
}
