/**
 * Dragging a file tab out of the editor's tab strip and dropping it on the
 * workspace grid opens that file in its own window. The tab strip stamps the
 * drag with this payload; the dockable workspace accepts and reads it.
 */

export const FILE_TAB_DRAG_TYPE = 'application/x-drone-hub-file-tab';
export const FILE_PANEL_PREFIX = 'file-tab:';
export const FOCUS_FILE_PANEL_EVENT = 'drone-hub:focus-file-panel';

export type FileTabDragPayload = {
  droneId: string;
  tabId: string;
  path: string;
  name: string;
};

type DataTransferLike = Pick<DataTransfer, 'types' | 'getData'>;

export function setFileTabDragPayload(dataTransfer: Pick<DataTransfer, 'setData'>, payload: FileTabDragPayload): void {
  dataTransfer.setData(FILE_TAB_DRAG_TYPE, JSON.stringify(payload));
}

export function hasFileTabDragPayload(event: { dataTransfer?: DataTransferLike | null } | null | undefined): boolean {
  const types = event?.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes(FILE_TAB_DRAG_TYPE));
}

export function readFileTabDragPayload(event: { dataTransfer?: DataTransferLike | null } | null | undefined): FileTabDragPayload | null {
  if (!hasFileTabDragPayload(event)) return null;
  try {
    const parsed = JSON.parse(event?.dataTransfer?.getData(FILE_TAB_DRAG_TYPE) || 'null') as Partial<FileTabDragPayload> | null;
    const droneId = String(parsed?.droneId ?? '').trim();
    const tabId = String(parsed?.tabId ?? '').trim();
    const path = String(parsed?.path ?? '').trim();
    if (!droneId || !tabId || !path) return null;
    const name = String(parsed?.name ?? '').trim() || path.split('/').filter(Boolean).pop() || path;
    return { droneId, tabId, path, name };
  } catch {
    return null;
  }
}

export function filePanelId(tabId: string): string {
  return `${FILE_PANEL_PREFIX}${tabId}`;
}

export function fileTabIdFromPanelId(panelId: string): string | null {
  return panelId.startsWith(FILE_PANEL_PREFIX) ? panelId.slice(FILE_PANEL_PREFIX.length) : null;
}

export type DropPosition = 'top' | 'bottom' | 'left' | 'right' | 'center';
export type FilePanelPosition =
  | { direction: 'within' | 'above' | 'below' | 'left' | 'right'; referenceGroup: string }
  | { direction: 'above' | 'below' | 'left' | 'right' };

const EDGE_DIRECTION = { top: 'above', bottom: 'below', left: 'left', right: 'right' } as const;

/**
 * Where a dropped file tab's window goes: inside the pane it was dropped on,
 * beside that pane, or along the workspace edge when no pane was under it.
 */
export function filePanelPositionForDrop(position: DropPosition, referenceGroup: string | null | undefined): FilePanelPosition {
  if (referenceGroup) {
    return position === 'center'
      ? { direction: 'within', referenceGroup }
      : { direction: EDGE_DIRECTION[position], referenceGroup };
  }
  return { direction: position === 'center' ? 'right' : EDGE_DIRECTION[position] };
}

export function focusFilePanel(droneId: string, tabId: string): boolean {
  if (typeof window === 'undefined') return false;
  const event = new CustomEvent(FOCUS_FILE_PANEL_EVENT, { detail: { droneId, tabId }, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
