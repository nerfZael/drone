// Files that should open in the source editor the next time they are shown,
// whatever their usual view (a Markdown file normally opens in its preview).
// Kept for this session only: a new file just saved under a name like
// notes.md stays in the editor it was being typed in.
const pendingSourceMode = new Set<string>();

export function textViewModeKey(droneId: string, path: string): string {
  return JSON.stringify([droneId, path]);
}

export function openNextInSourceMode(droneId: string, path: string): void {
  pendingSourceMode.add(textViewModeKey(droneId, path));
}

/** Whether `key` was asked to open in source mode; the request is used up. */
export function takeSourceModeHint(key: string): boolean {
  return pendingSourceMode.delete(key);
}
