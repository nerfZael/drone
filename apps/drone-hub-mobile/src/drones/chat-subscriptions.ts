import {
  eventNotificationEventLabel,
  normalizePresentedChatResourceSubscriptions,
  presentedChatSubscriptionDisplayIntent,
  presentedChatSubscriptionNextRunLabel,
  presentedChatSubscriptionResourceLabel,
  presentedChatSubscriptionSummary,
  type PresentedChatResourceSubscription,
} from '@drone/assistant-chat';

export type MobileChatSubscription = PresentedChatResourceSubscription;

export const normalizeMobileChatSubscriptions = normalizePresentedChatResourceSubscriptions;
export const mobileChatSubscriptionSummary = presentedChatSubscriptionSummary;
export const mobileChatSubscriptionResourceLabel = presentedChatSubscriptionResourceLabel;
export const mobileChatSubscriptionNextRunLabel = presentedChatSubscriptionNextRunLabel;
export const mobileChatSubscriptionEventLabel = eventNotificationEventLabel;
export const mobileChatSubscriptionDisplayIntent = presentedChatSubscriptionDisplayIntent;
