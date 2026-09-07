import type {
  ResourceSubscriptionDeliveryMode,
  ResourceSubscriptionEventType,
  ResourceSubscriptionSettings,
} from './resource-subscription-types';

export function resourceSubscriptionDeliveryMode(
  settings: ResourceSubscriptionSettings,
  eventType: ResourceSubscriptionEventType,
): ResourceSubscriptionDeliveryMode {
  return settings.eventDeliveryModes[eventType] ?? settings.deliveryMode;
}
