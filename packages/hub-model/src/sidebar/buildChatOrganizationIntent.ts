import { flattenSidebarChatTreeChatNodeIds, sidebarChatGroupNodeId, type SidebarChatTreeModel } from './chat-groups';
import type { SidebarMoveIntent } from './mutations';

type ChatOrganizationOperation =
  | { type: 'create_chat_group'; droneId: string; group: string; parentGroup?: string }
  | { type: 'rename_chat_group'; droneId: string; group: string; newName: string }
  | { type: 'delete_chat_group'; droneId: string; group: string }
  | { type: 'move_chats'; droneId: string; chats: string[]; targetGroup: string };

/** Resolve named chat/group operations against the current tree, preserving its order. */
export function buildChatOrganizationIntent(operation: ChatOrganizationOperation, tree: SidebarChatTreeModel): SidebarMoveIntent | null {
  if (tree.droneId !== operation.droneId) throw new Error('Chat tree belongs to another drone');
  if (operation.type === 'move_chats' && operation.chats.length === 0) throw new Error('At least one chat is required');
  const groupNode = (path: string) => {
    const node = tree.nodesById[sidebarChatGroupNodeId(operation.droneId, path)];
    if (!node || node.kind !== 'folder') throw new Error(`Unknown chat group: ${path}`);
    return node;
  };
  let intent: SidebarMoveIntent;
  if (operation.type === 'create_chat_group') {
    if (operation.parentGroup) groupNode(operation.parentGroup);
    const path = [operation.parentGroup, operation.group].filter(Boolean).join('/');
    if (tree.nodesById[sidebarChatGroupNodeId(operation.droneId, path)]) throw new Error(`Chat group already exists: ${path}`);
    intent = { kind: 'chat-group-create', droneId: operation.droneId, path };
  } else if (operation.type === 'rename_chat_group') {
    groupNode(operation.group);
    const parent = operation.group.split('/').slice(0, -1).join('/');
    const newPath = [parent, operation.newName].filter(Boolean).join('/');
    if (newPath === operation.group) return null;
    if (tree.nodesById[sidebarChatGroupNodeId(operation.droneId, newPath)]) throw new Error(`Chat group already exists: ${newPath}`);
    intent = { kind: 'chat-group-rename', droneId: operation.droneId, path: operation.group, newPath };
  } else if (operation.type === 'delete_chat_group') {
    groupNode(operation.group);
    intent = { kind: 'chat-group-delete', droneId: operation.droneId, path: operation.group };
  } else {
    const target = operation.targetGroup ? groupNode(operation.targetGroup) : null;
    const selected = new Set(operation.chats);
    for (const name of selected) {
      if (!Object.values(tree.nodesById).some((node) => node.kind === 'chat' && node.chatName === name)) throw new Error(`Unknown sidebar chat: ${name}. Temporary side chats must be kept in the sidebar before moving them into groups.`);
    }
    // Use tree order rather than the order in which the agent named the chats.
    const activeNodeIds = flattenSidebarChatTreeChatNodeIds(tree).filter((id) => selected.has((tree.nodesById[id] as { chatName: string }).chatName));
    const first = tree.nodesById[activeNodeIds[0]!]!;
    const sourceParent = first.parentId === tree.rootId ? null : tree.nodesById[first.parentId];
    intent = {
      kind: 'chat-tree-move', droneId: operation.droneId, itemKind: 'chat',
      activeNodeId: activeNodeIds[0]!, activeNodeIds,
      sourcePath: sourceParent?.kind === 'folder' ? sourceParent.path : null,
      sourceSiblingNodeIds: tree.childIdsByParent[first.parentId] ?? [],
      targetPath: operation.targetGroup || null,
      targetSiblingNodeIds: tree.childIdsByParent[target?.id ?? tree.rootId] ?? [],
      placement: 'inside',
    };
  }
  return intent;
}
