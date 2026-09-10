import { mcpChatAccessAllowsDrone, normalizeMcpChatAccessScope } from '../mcp-chat-access';
import type { ChatResourceLocation } from './resource-subscription-repository';
import type { ResourceSubscription, ResourceEvent } from './resource-subscription-types';
import type { ChangeRequestSubscriptionTarget } from './change-request-subscription-events';

export function createResourceSubscriptionDeliveryAuthorizer(deps: {
  resolveChatResource: (resourceId: string) => ChatResourceLocation | null;
  resolveChangeRequest?: (requestNumber: number) => ChangeRequestSubscriptionTarget | null;
  loadRegistry: () => Promise<any>;
}) {
  return async (
    subscription: ResourceSubscription,
    subscriber: ChatResourceLocation,
    event?: ResourceEvent,
  ): Promise<boolean> => {
    const registry = await deps.loadRegistry();
    const canReadDrone = sourceDroneReader(registry, subscriber);
    if (!canReadDrone) return false;

    if (subscription.provider === 'drone-hub' && subscription.resourceType === 'custom_event') {
      const source = event?.providerContent.source as { droneId?: string } | undefined;
      return Boolean(source?.droneId && canReadDrone(registry?.drones?.[source.droneId]));
    }
    if (subscription.provider === 'drone-hub' && subscription.resourceType === 'chat') {
      const target = deps.resolveChatResource(subscription.resourceId);
      return Boolean(target && canReadDrone(registry?.drones?.[target.droneId]));
    }
    if (subscription.provider === 'drone-hub' && subscription.resourceType === 'change_request') {
      const requestNumber = Number(subscription.resourceId);
      const request =
        Number.isSafeInteger(requestNumber) && requestNumber > 0
          ? deps.resolveChangeRequest?.(requestNumber)
          : null;
      return Boolean(request && canReadDrone(registry?.drones?.[request.droneId]));
    }
    return true;
  };
}

// History and delivery use the same current source-drone read permissions.
function sourceDroneReader(registry: any, subscriber: ChatResourceLocation) {
  const subscriberChat = registry?.drones?.[subscriber.droneId]?.chats?.[subscriber.chatName];
  if (String(subscriberChat?.id ?? '').trim() !== subscriber.chatId) return null;

  const scope = normalizeMcpChatAccessScope(
    subscriberChat?.droneHubMcpAccessScope,
    subscriber.droneId,
  );
  const selectedDroneRefs = scope.droneIds.flatMap((droneId) => {
    const name = String(registry?.drones?.[droneId]?.name ?? '').trim();
    return name && name !== droneId ? [droneId, name] : [droneId];
  });
  return (drone: any) => {
    const id = String(drone?.id ?? '').trim();
    const name = String(drone?.name ?? '').trim();
    return Boolean(
      id &&
      (mcpChatAccessAllowsDrone(scope, 'read', id, selectedDroneRefs) ||
        (name && mcpChatAccessAllowsDrone(scope, 'read', name, selectedDroneRefs))),
    );
  };
}

export function createCustomEventHistorySourceReader(loadRegistry: () => Promise<any>) {
  return async (subscriber: ChatResourceLocation): Promise<string[]> => {
    const registry = await loadRegistry();
    const canReadDrone = sourceDroneReader(registry, subscriber);
    if (!canReadDrone) return [];
    return Object.values(registry?.drones ?? {})
      .filter(canReadDrone)
      .map((drone: any) => String(drone.id).trim());
  };
}
