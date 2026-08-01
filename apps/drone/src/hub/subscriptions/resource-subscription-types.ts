export const RESOURCE_SUBSCRIPTION_EVENTS = [
  'chat.idle',
  'chat.failed',
  'pull_request.opened',
  'pull_request.comment.created',
  'pull_request.merged',
  'pull_request.closed',
] as const;

export type ResourceSubscriptionEventType = (typeof RESOURCE_SUBSCRIPTION_EVENTS)[number];
export type ResourceSubscriptionProvider = 'drone-hub' | 'github';
export type ResourceSubscriptionType = 'chat' | 'repository' | 'pull_request';
export type ResourceSubscriptionStatus = 'active' | 'completed' | 'cancelled' | 'paused';

export type ResourceSubscriptionSubscriber = {
  chatId: string;
  droneId: string;
  chatName: string;
};

export type ResourceSubscription = {
  id: string;
  subscriber: ResourceSubscriptionSubscriber;
  provider: ResourceSubscriptionProvider;
  resourceType: ResourceSubscriptionType;
  resourceId: string;
  resourceRef: string;
  events: ResourceSubscriptionEventType[];
  intent: string;
  status: ResourceSubscriptionStatus;
  cursor: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
};

export type ResourceEvent = {
  id: string;
  providerEventId: string;
  provider: ResourceSubscriptionProvider;
  resourceType: ResourceSubscriptionType;
  resourceId: string;
  parentResourceId: string | null;
  eventType: ResourceSubscriptionEventType;
  occurredAt: string;
  summary: string;
  providerContent: Record<string, unknown>;
};

export type ResourceSubscriptionSettings = {
  enabled: boolean;
  githubPollingIntervalMs: number;
  batchWindowMs: number;
  maxEventsPerPrompt: number;
  maxActiveSubscriptionsPerConversation: number;
  maxAutomatedRunsPerConversationPerHour: number;
  deliveryRetryLimit: number;
  terminalEventRetentionDays: number;
  deliveryRetentionDays: number;
};

export const DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS: ResourceSubscriptionSettings = {
  enabled: true,
  githubPollingIntervalMs: 60_000,
  batchWindowMs: 15_000,
  maxEventsPerPrompt: 30,
  maxActiveSubscriptionsPerConversation: 50,
  maxAutomatedRunsPerConversationPerHour: 100,
  deliveryRetryLimit: 10,
  terminalEventRetentionDays: 30,
  deliveryRetentionDays: 30,
};

export function resourceRef(
  provider: ResourceSubscriptionProvider,
  resourceType: ResourceSubscriptionType,
  resourceId: string,
): string {
  return `${provider}:${resourceType}:${resourceId}`;
}
