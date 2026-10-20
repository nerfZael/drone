import { sidebarChatNodeId, sidebarChatRootNodeId } from '@drone/hub-model/sidebar';

export type SidebarNewChatPlaces = {
  sidebarChatOrderByDrone: Record<string, string[]>;
  sidebarChatGroupByChat: Record<string, string>;
  sidebarChatNodeOrderByParent: Record<string, string[]>;
};

/**
 * A new chat goes last in its drone's top level, in the sidebar and so on the organized canvas board, and stays there:
 * without a saved place it would go where its name sorts, first "Untitled N" and then the name it is given when its
 * first message is sent. The chats the drone lists without a saved place are saved where they show now, ahead of it.
 * A place left under the same name by an earlier chat (a group, a spot among siblings) is dropped.
 */
export function placeNewChatLastInSidebar(
  places: SidebarNewChatPlaces,
  droneId: string,
  listedChatNames: readonly string[],
  chatName: string,
): SidebarNewChatPlaces {
  if (!droneId || !chatName) return places;
  const nodeId = sidebarChatNodeId(droneId, chatName);
  const rootId = sidebarChatRootNodeId(droneId);

  const saved = (places.sidebarChatOrderByDrone[droneId] ?? []).filter((name) => name !== chatName);
  const savedSet = new Set(saved);
  const unsaved = [...new Set(listedChatNames)].filter((name) => name !== chatName && !savedSet.has(name));
  const sidebarChatOrderByDrone = { ...places.sidebarChatOrderByDrone, [droneId]: [...saved, ...unsaved, chatName] };

  let sidebarChatGroupByChat = places.sidebarChatGroupByChat;
  if (nodeId in sidebarChatGroupByChat) {
    const { [nodeId]: _left, ...rest } = sidebarChatGroupByChat;
    sidebarChatGroupByChat = rest;
  }

  let sidebarChatNodeOrderByParent = places.sidebarChatNodeOrderByParent;
  for (const [parentId, nodeIds] of Object.entries(places.sidebarChatNodeOrderByParent)) {
    if (parentId === rootId || !nodeIds.includes(nodeId)) continue;
    if (sidebarChatNodeOrderByParent === places.sidebarChatNodeOrderByParent) sidebarChatNodeOrderByParent = { ...sidebarChatNodeOrderByParent };
    sidebarChatNodeOrderByParent[parentId] = nodeIds.filter((id) => id !== nodeId);
  }
  // Without a saved order for the top level, it follows the drone's chat order, where the chat is now last.
  const rootOrder = places.sidebarChatNodeOrderByParent[rootId];
  if (rootOrder?.length) {
    if (sidebarChatNodeOrderByParent === places.sidebarChatNodeOrderByParent) sidebarChatNodeOrderByParent = { ...sidebarChatNodeOrderByParent };
    sidebarChatNodeOrderByParent[rootId] = [...rootOrder.filter((id) => id !== nodeId), nodeId];
  }

  return { sidebarChatOrderByDrone, sidebarChatGroupByChat, sidebarChatNodeOrderByParent };
}
