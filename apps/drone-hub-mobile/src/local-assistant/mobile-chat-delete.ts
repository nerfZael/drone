import { deletableChatNames, sidebarChatNodeId } from '@drone/hub-model/sidebar';

export type MobileChatDeletePlan = {
  chatNames: string[];
  defaultChatKept: boolean;
};

export function resolveMobileChatDeletePlan({
  droneId,
  chatNames,
  targetChatName,
  selectedChatNodeIds,
}: {
  droneId: string;
  chatNames: readonly string[];
  targetChatName: string;
  selectedChatNodeIds: ReadonlySet<string>;
}): MobileChatDeletePlan {
  const targetIsSelected = selectedChatNodeIds.has(
    sidebarChatNodeId(droneId, targetChatName),
  );
  const selected = targetIsSelected
    ? chatNames.filter((name) => selectedChatNodeIds.has(sidebarChatNodeId(droneId, name)))
    : [targetChatName];
  const names = deletableChatNames(chatNames, selected);
  return {
    chatNames: names,
    defaultChatKept: selected.includes('default') && !names.includes('default'),
  };
}
