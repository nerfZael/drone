const held = new Set<readonly string[]>();

function publish(): void {
  window.droneHubDesktop?.setUnsavedChanges?.([...new Set([...held].flat())]);
}

/**
 * Names what is unsaved for the desktop app's "close without saving?" dialog, alongside the beforeunload
 * handler that actually holds the window open. Call the returned function once the changes are saved or gone.
 */
export function holdUnsavedChanges(labels: readonly string[]): () => void {
  const entry = [...labels];
  held.add(entry);
  publish();
  return () => {
    held.delete(entry);
    publish();
  };
}
