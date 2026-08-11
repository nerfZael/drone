export type SidebarInlineSectionKind = 'chats' | 'children';

export type SidebarSelectionExpansionTracker = {
  initialized: boolean;
  key: string;
};

export function sidebarInlineSectionKey(droneIdRaw: string, kind: SidebarInlineSectionKind): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return `${kind}:${droneId}`;
}

export function observeSidebarSelectionForExpansion(
  tracker: SidebarSelectionExpansionTracker,
  droneIdRaw: string | null | undefined,
  chatNameRaw: string | null | undefined,
  available: boolean,
): boolean {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) {
    if (tracker.initialized) tracker.key = '';
    return false;
  }
  if (!available) return false;
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  const selectionKey = `${droneId}:${chatName}`;
  if (!tracker.initialized) {
    tracker.initialized = true;
    tracker.key = selectionKey;
    return false;
  }
  if (tracker.key === selectionKey) return false;
  tracker.key = selectionKey;
  return true;
}
