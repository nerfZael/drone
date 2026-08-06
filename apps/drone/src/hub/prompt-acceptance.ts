export type ChatPromptDeliveryMode = 'queue' | 'asap' | undefined;

export type ChatPromptAcceptancePlan = {
  enqueueMode: 'background';
  priority: 'queue' | 'asap';
};

export function chatPromptAcceptancePlan(
  deliveryMode: ChatPromptDeliveryMode,
): ChatPromptAcceptancePlan {
  return {
    enqueueMode: 'background',
    priority: deliveryMode === 'asap' ? 'asap' : 'queue',
  };
}
