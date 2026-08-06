import { eventNotificationEventLabel } from '@drone/assistant-chat';
import {
  normalizeChatResourceSubscriptionsPayload,
  type ChatResourceSubscriptionInfo,
} from '../../domain';

export type ChatResourceSubscription = ChatResourceSubscriptionInfo;

export function normalizeChatResourceSubscriptions(raw: unknown): ChatResourceSubscription[] {
  return normalizeChatResourceSubscriptionsPayload(raw);
}

export function chatSubscriptionResourceLabel(
  subscription: Pick<
    ChatResourceSubscription,
    'resourceType' | 'resourceId' | 'resourceLabel' | 'resourceConfig'
  >,
): string {
  if (subscription.resourceType === 'cron') {
    return `Schedule · ${chatSubscriptionScheduleLabel(subscription)}`;
  }
  if (subscription.resourceType === 'pull_request') {
    return `Pull request · ${subscription.resourceId}`;
  }
  if (subscription.resourceType === 'repository') {
    return `Repository · ${subscription.resourceId}`;
  }
  return `Chat · ${subscription.resourceLabel || subscription.resourceId}`;
}

export function chatSubscriptionSummary(subscriptions: ChatResourceSubscription[]): string {
  if (subscriptions.length === 0) return '';
  if (subscriptions.length > 1) return `Subscriptions · ${subscriptions.length}`;
  const subscription = subscriptions[0]!;
  const events = subscription.events.map(chatSubscriptionEventLabel).join(', ');
  const resource =
    subscription.resourceType === 'cron'
      ? chatSubscriptionScheduleLabel(subscription)
      : subscription.resourceType === 'chat'
        ? subscription.resourceLabel || subscription.resourceId
        : subscription.resourceId;
  return [events, resource].filter(Boolean).join(' · ');
}

export function chatSubscriptionNextRunLabel(
  subscription: Pick<
    ChatResourceSubscription,
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

export function chatSubscriptionEventLabel(event: string): string {
  return eventNotificationEventLabel(event);
}

export function chatSubscriptionDisplayIntent(
  intent: string,
  subscriptions: ChatResourceSubscription[],
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

function chatSubscriptionScheduleLabel(
  subscription: Pick<ChatResourceSubscription, 'resourceConfig'>,
): string {
  const expression =
    subscription.resourceConfig?.description ||
    subscription.resourceConfig?.expression ||
    'Cron schedule';
  const timeZone = subscription.resourceConfig?.timeZone || 'UTC';
  return `${expression} · ${timeZone}`;
}
