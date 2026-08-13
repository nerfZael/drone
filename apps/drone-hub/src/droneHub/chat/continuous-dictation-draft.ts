export function mergeDraftWithContinuousDictation(draft: string, dictation: string): string {
  const cleanDictation = dictation.trim();
  if (!cleanDictation) return draft;
  const cleanDraft = draft.trimEnd();
  return cleanDraft ? `${cleanDraft}\n${cleanDictation}` : cleanDictation;
}
