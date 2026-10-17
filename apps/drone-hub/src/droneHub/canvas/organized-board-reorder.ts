import {
  buildSidebarChatTree,
  sidebarChatNodeId,
  type SidebarChatTreeModel,
  type SidebarMoveIntent,
} from '@drone/hub-model/sidebar';

/**
 * A chat moved on the organized board, as the sidebar's own move: the board follows the sidebar's order, so the two
 * change together and the Hub keeps it. Dropped beside a chat in a sidebar group, it joins that group, as there.
 */
export function organizedChatMoveIntent({
  droneId,
  chatNames,
  groupPaths,
  groupByChat,
  nodeOrderByParent,
  activeChatName,
  overChatName,
  placement,
}: {
  droneId: string;
  /** The drone's chats in the sidebar's order. */
  chatNames: string[];
  groupPaths: string[];
  groupByChat: Record<string, string>;
  nodeOrderByParent: Record<string, string[]>;
  activeChatName: string;
  overChatName: string;
  placement: 'before' | 'after';
}): SidebarMoveIntent | null {
  const tree = buildSidebarChatTree({ droneId, chatNames, groupPaths, groupByChat, nodeOrderByParent });
  const active = tree.nodesById[sidebarChatNodeId(droneId, activeChatName)];
  const over = tree.nodesById[sidebarChatNodeId(droneId, overChatName)];
  if (active?.kind !== 'chat' || over?.kind !== 'chat' || active.id === over.id) return null;
  return {
    kind: 'chat-tree-move',
    droneId,
    itemKind: 'chat',
    activeNodeId: active.id,
    sourcePath: groupPathOf(tree, active.parentId),
    sourceSiblingNodeIds: tree.childIdsByParent[active.parentId] ?? [],
    targetPath: groupPathOf(tree, over.parentId),
    targetSiblingNodeIds: tree.childIdsByParent[over.parentId] ?? [],
    overNodeId: over.id,
    placement,
  };
}

function groupPathOf(tree: SidebarChatTreeModel, parentId: string): string | null {
  const parent = parentId === tree.rootId ? null : tree.nodesById[parentId];
  return parent?.kind === 'folder' ? parent.path : null;
}
