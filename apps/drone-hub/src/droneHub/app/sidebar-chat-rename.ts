import { sidebarChatNodeId } from '@drone/hub-model/sidebar';

export type SidebarChatPlaces = {
  sidebarChatOrderByDrone: Record<string, string[]>;
  sidebarChatGroupByChat: Record<string, string>;
  sidebarChatNodeOrderByParent: Record<string, string[]>;
  mutedChatIds: string[];
};

/**
 * A renamed chat keeps its place in the sidebar, and so on the organized canvas board: its group, its position among
 * its siblings and its mute are kept under its name or node id, which the rename changes. As the Hub's rename_chat
 * tool does for renames made there. Each part comes back unchanged (the same object) when the chat is not in it.
 */
export function renameChatInSidebarPlaces(places: SidebarChatPlaces, droneId: string, oldName: string, newName: string): SidebarChatPlaces {
  if (!droneId || !oldName || !newName || oldName === newName) return places;
  const oldNodeId = sidebarChatNodeId(droneId, oldName);
  const newNodeId = sidebarChatNodeId(droneId, newName);
  const renameIn = (list: string[], from: string, to: string) => (list.includes(from)
    ? [...new Set(list.map((entry) => (entry === from ? to : entry)))]
    : list);

  const chatOrder = places.sidebarChatOrderByDrone[droneId];
  const sidebarChatOrderByDrone = chatOrder && chatOrder.includes(oldName)
    ? { ...places.sidebarChatOrderByDrone, [droneId]: renameIn(chatOrder, oldName, newName) }
    : places.sidebarChatOrderByDrone;

  let sidebarChatGroupByChat = places.sidebarChatGroupByChat;
  if (oldNodeId in sidebarChatGroupByChat) {
    const { [oldNodeId]: group, ...rest } = sidebarChatGroupByChat;
    sidebarChatGroupByChat = group ? { ...rest, [newNodeId]: group } : rest;
  }

  let sidebarChatNodeOrderByParent = places.sidebarChatNodeOrderByParent;
  for (const [parentId, nodeIds] of Object.entries(places.sidebarChatNodeOrderByParent)) {
    const renamed = renameIn(nodeIds, oldNodeId, newNodeId);
    if (renamed === nodeIds) continue;
    if (sidebarChatNodeOrderByParent === places.sidebarChatNodeOrderByParent) sidebarChatNodeOrderByParent = { ...sidebarChatNodeOrderByParent };
    sidebarChatNodeOrderByParent[parentId] = renamed;
  }

  return {
    sidebarChatOrderByDrone,
    sidebarChatGroupByChat,
    sidebarChatNodeOrderByParent,
    mutedChatIds: renameIn(places.mutedChatIds, oldNodeId, newNodeId),
  };
}
