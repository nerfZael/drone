export type ContinuousDictationLine = {
  id: string;
  text: string;
  order: number;
};

export function mergeDraftWithContinuousDictation(draft: string, dictation: string): string {
  const cleanDictation = dictation.trim();
  if (!cleanDictation) return draft;
  const cleanDraft = draft.trimEnd();
  return cleanDraft ? `${cleanDraft}\n${cleanDictation}` : cleanDictation;
}

export function continuousDictationLinesText(
  lines: readonly ContinuousDictationLine[],
): string {
  return lines.map((line) => line.text).join('\n');
}

export function restoreContinuousDictationLines(
  current: readonly ContinuousDictationLine[],
  restored: readonly ContinuousDictationLine[],
): ContinuousDictationLine[] {
  const linesById = new Map(restored.map((line) => [line.id, line]));
  for (const line of current) linesById.set(line.id, line);
  return [...linesById.values()].sort((left, right) => left.order - right.order);
}
