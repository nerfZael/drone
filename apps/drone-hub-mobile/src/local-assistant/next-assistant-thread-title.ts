export function nextAssistantThreadTitle(threads: Array<{ title?: string }>): string {
  const used = new Set(
    threads
      .map((thread) => /^Thread (\d+)$/.exec(String(thread.title ?? '').trim())?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number),
  );
  let number = 1;
  while (used.has(number)) number += 1;
  return `Thread ${number}`;
}
