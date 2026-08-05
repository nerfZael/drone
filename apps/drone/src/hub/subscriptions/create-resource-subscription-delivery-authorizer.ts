import { mcpChatAccessAllowsDrone, normalizeMcpChatAccessScope } from '../mcp-chat-access';
import type { ChatResourceLocation } from './resource-subscription-repository';
import type { ResourceSubscription } from './resource-subscription-types';

export function createResourceSubscriptionDeliveryAuthorizer(deps: {
  resolveChatResource: (resourceId: string) => ChatResourceLocation | null;
  loadRegistry: () => Promise<any>;
}) {
  return async (
    subscription: ResourceSubscription,
    subscriber: ChatResourceLocation,
  ): Promise<boolean> => {
    const registry = await deps.loadRegistry();
    const subscriberChat = registry?.drones?.[subscriber.droneId]?.chats?.[subscriber.chatName];
    if (String(subscriberChat?.id ?? '').trim() !== subscriber.chatId) return false;

    const scope = normalizeMcpChatAccessScope(
      subscriberChat?.droneHubMcpAccessScope,
      subscriber.droneId,
    );
    const selectedDroneRefs = scope.droneIds.flatMap((droneId) => {
      const name = String(registry?.drones?.[droneId]?.name ?? '').trim();
      return name && name !== droneId ? [droneId, name] : [droneId];
    });
    const canReadDrone = (drone: any) => {
      const id = String(drone?.id ?? '').trim();
      const name = String(drone?.name ?? '').trim();
      return Boolean(
        id &&
        (mcpChatAccessAllowsDrone(scope, 'read', id, selectedDroneRefs) ||
          (name && mcpChatAccessAllowsDrone(scope, 'read', name, selectedDroneRefs))),
      );
    };

    if (subscription.provider === 'drone-hub' && subscription.resourceType === 'chat') {
      const target = deps.resolveChatResource(subscription.resourceId);
      return Boolean(target && canReadDrone(registry?.drones?.[target.droneId]));
    }
    return true;
  };
}
