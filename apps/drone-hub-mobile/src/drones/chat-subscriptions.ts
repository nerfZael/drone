export type MobileChatSubscription = {
  id: string;
  provider: 'drone-hub' | 'github';
  resourceType: 'chat' | 'repository' | 'pull_request';
  resourceId: string;
  events: string[];
  intent: string;
};

export function normalizeMobileChatSubscriptions(raw: unknown): MobileChatSubscription[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: any) => {
    const id = String(item?.id ?? '').trim();
    const resourceId = String(item?.resourceId ?? '').trim();
    if (!id || !resourceId || item?.status !== 'active') return [];
    return [
      {
        id,
        provider: item?.provider === 'github' ? 'github' : 'drone-hub',
        resourceType:
          item?.resourceType === 'repository' || item?.resourceType === 'pull_request'
            ? item.resourceType
            : 'chat',
        resourceId,
        events: Array.isArray(item?.events)
          ? item.events.map((event: unknown) => String(event ?? '').trim()).filter(Boolean)
          : [],
        intent: String(item?.intent ?? '').trim(),
      },
    ];
  });
}

export function mobileChatSubscriptionSummary(subscriptions: MobileChatSubscription[]): string {
  if (subscriptions.length === 0) return '';
  if (subscriptions.length > 1) return `Subscriptions · ${subscriptions.length}`;
  return `Subscribed · ${subscriptions[0]!.resourceId}`;
}

export function mobileChatSubscriptionResourceLabel(
  subscription: Pick<MobileChatSubscription, 'resourceType' | 'resourceId'>,
): string {
  if (subscription.resourceType === 'pull_request') {
    return `Pull request · ${subscription.resourceId}`;
  }
  if (subscription.resourceType === 'repository') {
    return `Repository · ${subscription.resourceId}`;
  }
  return `Chat · ${subscription.resourceId}`;
}

export function mobileChatSubscriptionEventLabel(event: string): string {
  return String(event ?? '')
    .trim()
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .filter(Boolean)
    .join(' · ');
}
