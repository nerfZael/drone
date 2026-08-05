export type ChatResourceSubscription = {
  id: string;
  provider: 'drone-hub' | 'github';
  resourceType: 'chat' | 'repository' | 'pull_request';
  resourceId: string;
  events: string[];
  intent: string;
  status: 'active';
};

export function normalizeChatResourceSubscriptions(raw: unknown): ChatResourceSubscription[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: any) => {
    const id = String(item?.id ?? '').trim();
    const provider = item?.provider === 'github' ? 'github' : 'drone-hub';
    const resourceType =
      item?.resourceType === 'repository' || item?.resourceType === 'pull_request'
        ? item.resourceType
        : 'chat';
    const resourceId = String(item?.resourceId ?? '').trim();
    if (!id || !resourceId || item?.status !== 'active') return [];
    return [
      {
        id,
        provider,
        resourceType,
        resourceId,
        events: Array.isArray(item?.events)
          ? item.events.map((event: unknown) => String(event ?? '').trim()).filter(Boolean)
          : [],
        intent: String(item?.intent ?? '').trim(),
        status: 'active' as const,
      },
    ];
  });
}

export function chatSubscriptionResourceLabel(
  subscription: Pick<ChatResourceSubscription, 'resourceType' | 'resourceId'>,
): string {
  if (subscription.resourceType === 'pull_request') {
    return `Pull request · ${subscription.resourceId}`;
  }
  if (subscription.resourceType === 'repository') {
    return `Repository · ${subscription.resourceId}`;
  }
  return `Chat · ${subscription.resourceId}`;
}

export function chatSubscriptionSummary(subscriptions: ChatResourceSubscription[]): string {
  if (subscriptions.length === 0) return '';
  if (subscriptions.length > 1) return `Subscriptions · ${subscriptions.length}`;
  const subscription = subscriptions[0]!;
  const events = subscription.events.map(chatSubscriptionEventLabel).join(', ');
  return [events, subscription.resourceId].filter(Boolean).join(' · ');
}

export function chatSubscriptionEventLabel(event: string): string {
  return eventNotificationEventLabel(event);
}
import { eventNotificationEventLabel } from '@drone/assistant-chat';
