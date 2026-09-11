import {
  eventNotificationEventLabel,
  presentedChatSubscriptionDisplayIntent,
  presentedChatSubscriptionNextRunLabel,
  presentedChatSubscriptionResourceLabel,
  presentedChatSubscriptionSummary,
} from '@drone/assistant-chat';
import {
  normalizeChatResourceSubscriptionsPayload,
  type ChatResourceSubscriptionInfo,
} from '../../domain';

export type ChatResourceSubscription = ChatResourceSubscriptionInfo;

export const normalizeChatResourceSubscriptions = normalizeChatResourceSubscriptionsPayload;
export const chatSubscriptionResourceLabel = presentedChatSubscriptionResourceLabel;
export const chatSubscriptionSummary = presentedChatSubscriptionSummary;
export const chatSubscriptionNextRunLabel = presentedChatSubscriptionNextRunLabel;
export const chatSubscriptionEventLabel = eventNotificationEventLabel;
export const chatSubscriptionDisplayIntent = presentedChatSubscriptionDisplayIntent;

/**
 * Subscriptions worth surfacing in the composer. A questionnaire always comes
 * with its own resolved-event subscription, so listing it next to the visible
 * questions tells the user nothing new; the question card itself is the signal.
 */
export function presentableChatSubscriptions(
  subscriptions: ChatResourceSubscription[],
): ChatResourceSubscription[] {
  return subscriptions.filter((subscription) => subscription.resourceType !== 'question_request');
}
