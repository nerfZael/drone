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
