import type { DockviewApi } from 'dockview';
import { SIDE_CHAT_PANEL_PREFIX } from './align-floating-chats';
import { readSideChatWorkspaceState, saveSideChatWorkspaceState } from './side-chat-workspace-state';

/** Reconcile window visibility after a grid change without deleting conversations. */
export function retainClosedSideChatWindows(droneId: string, api: DockviewApi): () => void {
  const before = api.panels.filter(panel => panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX)
    && panel.group.api.location.type === 'grid').map(panel => panel.id);
  return () => {
    const closed = new Set(readSideChatWorkspaceState(droneId).closedWindows);
    for (const id of before) if (!api.getPanel(id)) closed.add(id.slice(SIDE_CHAT_PANEL_PREFIX.length));
    // A preset can explicitly reopen a previously closed docked fork.
    for (const panel of api.panels) {
      if (panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX)) closed.delete(panel.id.slice(SIDE_CHAT_PANEL_PREFIX.length));
    }
    saveSideChatWorkspaceState(droneId, { closedWindows: [...closed] });
  };
}
