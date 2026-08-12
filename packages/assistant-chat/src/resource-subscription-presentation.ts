import { eventNotificationEventLabel } from './event-notification.js';

export type PresentedChatResourceSubscription = {
  id: string;
  provider: 'drone-hub' | 'github';
  resourceType: 'chat' | 'repository' | 'pull_request' | 'change_request' | 'cron';
  resourceId: string;
  resourceLabel: string;
  resourceDroneId?: string;
  resourceChatName?: string;
  resourceConfig: {
    expression: string;
    timeZone: string;
    description: string;
  } | null;
  events: string[];
  intent: string;
  status: 'active';
  nextEventAt: string | null;
};

export function normalizePresentedChatResourceSubscriptions(
  raw: unknown,
): PresentedChatResourceSubscription[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: any) => {
    const id = String(item?.id ?? '').trim();
    const resourceId = String(item?.resourceId ?? '').trim();
    if (!id || !resourceId || item?.status !== 'active') return [];
    const resourceType = presentedResourceType(item?.resourceType);
    const expression = String(item?.resourceConfig?.expression ?? '').trim();
    const resourceConfig =
      resourceType === 'cron' && item?.resourceConfig && typeof item.resourceConfig === 'object'
        ? {
            expression,
            description: String(item.resourceConfig.description ?? '').trim() || expression,
            timeZone: String(item.resourceConfig.timeZone ?? '').trim() || 'UTC',
          }
        : null;
    const nextEventAtRaw = String(item?.nextEventAt ?? '').trim();
    const nextEventAt = Number.isFinite(Date.parse(nextEventAtRaw))
      ? new Date(nextEventAtRaw).toISOString()
      : null;
    const resourceDroneId = String(item?.resourceDroneId ?? '').trim();
    const resourceChatName = String(item?.resourceChatName ?? '').trim();
    return [
      {
        id,
        provider: item?.provider === 'github' ? 'github' : 'drone-hub',
        resourceType,
        resourceId,
        resourceLabel: String(item?.resourceLabel ?? '').trim(),
        ...(resourceDroneId ? { resourceDroneId } : {}),
        ...(resourceChatName ? { resourceChatName } : {}),
        resourceConfig,
        events: Array.isArray(item?.events)
          ? item.events.map((event: unknown) => String(event ?? '').trim()).filter(Boolean)
          : [],
        intent: String(item?.intent ?? '').trim(),
        status: 'active' as const,
        nextEventAt,
      },
    ];
  });
}

export function presentedChatSubscriptionResourceLabel(
  subscription: Pick<
    PresentedChatResourceSubscription,
    'resourceType' | 'resourceId' | 'resourceLabel' | 'resourceConfig'
  >,
): string {
  if (subscription.resourceType === 'cron') {
    return `Schedule · ${presentedChatSubscriptionScheduleLabel(subscription)}`;
  }
  if (subscription.resourceType === 'pull_request') {
    return `Pull request · ${subscription.resourceId}`;
  }
  if (subscription.resourceType === 'change_request') {
    return `Change request · ${subscription.resourceLabel || `#${subscription.resourceId}`}`;
  }
  if (subscription.resourceType === 'repository') {
    return `Repository · ${subscription.resourceId}`;
  }
  return `Chat · ${subscription.resourceLabel || subscription.resourceId}`;
}

export function presentedChatSubscriptionSummary(
  subscriptions: PresentedChatResourceSubscription[],
): string {
  if (subscriptions.length === 0) return '';
  if (subscriptions.length > 1) return `Subscriptions · ${subscriptions.length}`;
  const subscription = subscriptions[0]!;
  const events = subscription.events.map(eventNotificationEventLabel).join(', ');
  const resource =
    subscription.resourceType === 'cron'
      ? presentedChatSubscriptionScheduleLabel(subscription)
      : subscription.resourceType === 'chat'
        ? subscription.resourceLabel || subscription.resourceId
        : subscription.resourceType === 'change_request'
          ? subscription.resourceLabel || `#${subscription.resourceId}`
          : subscription.resourceId;
  return [events, resource].filter(Boolean).join(' · ');
}

export function presentedChatSubscriptionNextRunLabel(
  subscription: Pick<
    PresentedChatResourceSubscription,
    'resourceType' | 'resourceConfig' | 'nextEventAt'
  >,
): string {
  if (subscription.resourceType !== 'cron' || !subscription.nextEventAt) return '';
  const next = new Date(subscription.nextEventAt);
  if (!Number.isFinite(next.getTime())) return '';
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: subscription.resourceConfig?.timeZone || 'UTC',
      timeZoneName: 'short',
    }).format(next);
    return `Next run · ${formatted}`;
  } catch {
    return `Next run · ${next.toISOString()}`;
  }
}

export function presentedChatSubscriptionDisplayIntent(
  intent: string,
  subscriptions: PresentedChatResourceSubscription[],
): string {
  let displayed = intent;
  for (const subscription of subscriptions) {
    if (
      subscription.resourceType !== 'chat' ||
      !subscription.resourceDroneId ||
      !subscription.resourceChatName ||
      !subscription.resourceLabel
    ) {
      continue;
    }
    displayed = displayed
      .split(`${subscription.resourceDroneId}/${subscription.resourceChatName}`)
      .join(subscription.resourceLabel);
  }
  return displayed;
}

function presentedChatSubscriptionScheduleLabel(
  subscription: Pick<PresentedChatResourceSubscription, 'resourceConfig'>,
): string {
  const expression =
    subscription.resourceConfig?.description ||
    subscription.resourceConfig?.expression ||
    'Cron schedule';
  const timeZone = subscription.resourceConfig?.timeZone || 'UTC';
  return `${expression} · ${timeZone}`;
}

function presentedResourceType(raw: unknown): PresentedChatResourceSubscription['resourceType'] {
  const value = String(raw ?? '');
  if (
    value === 'repository' ||
    value === 'pull_request' ||
    value === 'change_request' ||
    value === 'cron'
  ) {
    return value;
  }
  return 'chat';
}
