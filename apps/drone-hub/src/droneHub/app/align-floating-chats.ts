import type { DockviewApi } from 'dockview';
import { placeSideChat, type WorkspaceRect } from './side-chat-placement';
import { moveFloatingGroup } from './use-floating-window-keeper';

export const SIDE_CHAT_PANEL_PREFIX = 'side-chat:';

/** Reset floating forks in panel creation order, leaving the main chat and tools in place. */
export function alignFloatingChats(api: DockviewApi, occupied: WorkspaceRect[] = []): Record<string, WorkspaceRect> {
  const panels = api.panels.filter((panel) => panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX)
    && panel.group.api.location.type === 'floating');
  const placed = [...occupied];
  const boundsByChat: Record<string, WorkspaceRect> = {};
  for (const [index, panel] of panels.entries()) {
    if (panel.group.api.isMaximized()) panel.group.api.exitMaximized();
    const bounds = placeSideChat(api, placed, index);
    // Move the frame in place. Re-adding the panel detached its DOM (scroll
    // position lost, transcript back at the top) and bounced the active
    // group through the main chat, which flickered as a result.
    moveFloatingGroup(api, panel.group, bounds);
    Object.defineProperty(boundsByChat, panel.id.slice(SIDE_CHAT_PANEL_PREFIX.length), {
      value: bounds, enumerable: true, configurable: true, writable: true,
    });
    placed.push(bounds);
  }
  return boundsByChat;
}
