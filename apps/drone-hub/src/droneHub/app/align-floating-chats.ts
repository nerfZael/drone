import type { DockviewApi } from 'dockview';
import { placeSideChat, type WorkspaceRect } from './side-chat-placement';

export const SIDE_CHAT_PANEL_PREFIX = 'side-chat:';

/** Reset floating forks in panel creation order, leaving the main chat and tools in place. */
export function alignFloatingChats(api: DockviewApi, occupied: WorkspaceRect[] = []): Record<string, WorkspaceRect> {
  const panels = api.panels.filter((panel) => panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX)
    && panel.group.api.location.type === 'floating');
  const activePanel = api.activePanel;
  const placed = [...occupied];
  const boundsByChat: Record<string, WorkspaceRect> = {};
  for (const [index, panel] of panels.entries()) {
    if (panel.group.api.isMaximized()) panel.group.api.exitMaximized();
    const bounds = placeSideChat(api, placed, index);
    // Move the existing panel so its chat content and draft remain mounted.
    api.addFloatingGroup(panel, bounds);
    Object.defineProperty(boundsByChat, panel.id.slice(SIDE_CHAT_PANEL_PREFIX.length), {
      value: bounds, enumerable: true, configurable: true, writable: true,
    });
    placed.push(bounds);
  }
  if (panels.length) activePanel?.api.setActive();
  return boundsByChat;
}
