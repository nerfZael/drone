export type CompanionTextareaUndoSnapshot = {
  before: string;
  after: string;
  afterRevision: string;
};

export function companionTextareaUndoValue(
  snapshot: CompanionTextareaUndoSnapshot | null,
  currentValue: string,
  currentRevision: string,
): string | null {
  return snapshot?.after === currentValue && snapshot.afterRevision === currentRevision
    ? snapshot.before
    : null;
}
