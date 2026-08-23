import { sidebarChatNodeId } from '@drone/hub-model/sidebar';

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
  if (!targetIsSelected) {
    return {
      chatNames: targetChatName === 'default' ? [] : [targetChatName],
      defaultChatKept: false,
    };
  }

  return {
    chatNames: chatNames.filter(
      (name) =>
        name !== 'default' &&
        selectedChatNodeIds.has(sidebarChatNodeId(droneId, name)),
    ),
    defaultChatKept: selectedChatNodeIds.has(sidebarChatNodeId(droneId, 'default')),
  };
}
