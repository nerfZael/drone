export const OPEN_FILE_EXPLORER_EVENT = 'dronehub:open-file-explorer';

/** Reveal the explorer without opening or selecting an editor window. */
export function requestFileExplorerOpen(droneId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_FILE_EXPLORER_EVENT, { detail: { droneId } }));
}
