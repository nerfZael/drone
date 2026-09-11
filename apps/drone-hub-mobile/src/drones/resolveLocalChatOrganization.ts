import type { CompanionOrganizationOperation } from '@drone/assistant-chat';
import { buildChatOrganizationIntent, buildSidebarChatTree, type SidebarLayoutState } from '@drone/hub-model/sidebar';
import type { LocalDroneRecord } from './local-drone-records';

type ChatOrganization = Exclude<CompanionOrganizationOperation, { type: 'set_drone_group' }>;

/** Call inside the local write queue so names and membership reflect preceding writes. */
export function resolveLocalChatOrganization(operation: ChatOrganization, drones: readonly LocalDroneRecord[], layout: SidebarLayoutState) {
  const drone = drones.find((item) => item.id === operation.droneId);
  if (!drone) throw new Error('Phone drone was not found');
  const tree = buildSidebarChatTree({
    droneId: drone.id,
    chatNames: [...new Set([...(layout.sidebarChatOrderByDrone[drone.id] ?? []), ...Object.keys(drone.chats)])]
      .filter((name) => Boolean(drone.chats[name])),
    groupPaths: layout.sidebarChatGroupPathsByDrone[drone.id] ?? [],
    groupByChat: layout.sidebarChatGroupByChat,
    nodeOrderByParent: layout.sidebarChatNodeOrderByParent,
  });
  return buildChatOrganizationIntent(operation, tree);
}
