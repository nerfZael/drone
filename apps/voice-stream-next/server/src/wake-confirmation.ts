export function normalizeWakeConfirmationText(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function wakeConfirmationMatches(transcriptText: unknown, expectedPhrase: unknown): boolean {
  const expected = normalizeWakeConfirmationText(expectedPhrase);
  return Boolean(expected) && normalizeWakeConfirmationText(transcriptText) === expected;
}
