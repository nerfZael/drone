import type { DroneSummary } from '../types';
import {
  isSameOrDescendantSidebarGroupPath,
  rewriteSidebarGroupPathPrefix,
} from './sidebar-group-paths';
import type { SidebarGroup } from './use-sidebar-view-model';

export const SIDEBAR_VISIBLE_MULTI_CHAT_GROUP = '__sidebar-visible-drones__';

export function renameSelectedGroupMultiChatGroup(
  selectedGroupMultiChat: string | null,
  currentGroup: string,
  nextGroup: string,
  repoGroupPath: string | null,
): string | null {
  if (!selectedGroupMultiChat) return null;
  const prefix = repoGroupPath ? `repo-scope:${repoGroupPath}:` : '';
  if (prefix && !selectedGroupMultiChat.startsWith(prefix)) return selectedGroupMultiChat;
  const selectedGroupPath = prefix
    ? selectedGroupMultiChat.slice(prefix.length)
    : selectedGroupMultiChat;
  if (!isSameOrDescendantSidebarGroupPath(selectedGroupPath, currentGroup)) {
    return selectedGroupMultiChat;
  }
  return `${prefix}${rewriteSidebarGroupPathPrefix(
    selectedGroupPath,
    currentGroup,
    nextGroup,
  )}`;
}

export function selectedGroupMultiChatTargetsGroup(
  selectedGroupMultiChat: string | null,
  group: string,
  repoGroupPath: string | null,
): boolean {
  if (!selectedGroupMultiChat) return false;
  const prefix = repoGroupPath ? `repo-scope:${repoGroupPath}:` : '';
  if (prefix && !selectedGroupMultiChat.startsWith(prefix)) return false;
  const selectedGroupPath = prefix
    ? selectedGroupMultiChat.slice(prefix.length)
    : selectedGroupMultiChat;
  return isSameOrDescendantSidebarGroupPath(selectedGroupPath, group);
}

export function resolveSelectedGroupMultiChatData(
  selectedGroupMultiChat: string | null,
  sidebarGroups: SidebarGroup[],
  sidebarVisibleDrones: DroneSummary[],
) {
  if (!selectedGroupMultiChat) return null;
  if (selectedGroupMultiChat === SIDEBAR_VISIBLE_MULTI_CHAT_GROUP) {
    return {
      group: SIDEBAR_VISIBLE_MULTI_CHAT_GROUP,
      label: 'Visible in Sidebar',
      kind: 'group' as const,
      items: sidebarVisibleDrones,
    };
  }
  for (const repository of sidebarGroups) {
    if (repository.kind !== 'repo') continue;
    const prefix = `repo-scope:${repository.group}:`;
    if (!selectedGroupMultiChat.startsWith(prefix)) continue;
    const groupPath = selectedGroupMultiChat.slice(prefix.length);
    if (!groupPath) return null;
    return {
      group: selectedGroupMultiChat,
      label: `${repository.label} / ${groupPath}`,
      kind: 'group' as const,
      items: repository.items.filter((drone) => {
        const droneGroup = String(drone.group ?? '').trim();
        return Boolean(
          droneGroup && isSameOrDescendantSidebarGroupPath(droneGroup, groupPath),
        );
      }),
    };
  }
  const exact = sidebarGroups.find((group) => group.group === selectedGroupMultiChat);
  if (exact?.kind === 'repo') return exact;
  const matches = sidebarGroups.filter((group) =>
    isSameOrDescendantSidebarGroupPath(group.group, selectedGroupMultiChat),
  );
  if (matches.length === 0) return exact ?? null;
  return {
    group: selectedGroupMultiChat,
    label: exact?.label ?? selectedGroupMultiChat,
    kind: 'group' as const,
    items: matches.flatMap((group) => group.items),
  };
}
