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
