import { CHANGE_REQUEST_SUBSCRIPTION_EVENTS } from './change-request-subscription-events';
import type {
  ResourceEvent,
  ResourceSubscriptionEventType,
  ResourceSubscriptionProvider,
  ResourceSubscriptionType,
} from './resource-subscription-types';

const CHAT_EVENTS = ['chat.idle', 'chat.failed'] as const;
const GITHUB_REPOSITORY_EVENTS = [
  'pull_request.opened',
  'pull_request.comment.created',
  'pull_request.merged',
  'pull_request.closed',
] as const;
const GITHUB_PULL_REQUEST_EVENTS = [
  'pull_request.comment.created',
  'pull_request.merged',
  'pull_request.closed',
] as const;
const GITHUB_PULL_REQUEST_TERMINAL_EVENTS = ['pull_request.merged', 'pull_request.closed'] as const;
const CHANGE_REQUEST_TERMINAL_EVENTS = ['change_request.merged', 'change_request.closed'] as const;
const CRON_EVENTS = ['cron.triggered'] as const;

export const MCP_RESOURCE_SUBSCRIPTION_EVENTS = [
  ...CHAT_EVENTS,
  ...GITHUB_REPOSITORY_EVENTS,
  ...CHANGE_REQUEST_SUBSCRIPTION_EVENTS,
] as const;

type ResourceSubscriptionCapability = {
  supportedEvents: readonly ResourceSubscriptionEventType[];
  terminalEvents: readonly ResourceSubscriptionEventType[];
};

const RESOURCE_SUBSCRIPTION_CAPABILITIES: Partial<
  Record<
    `${ResourceSubscriptionProvider}/${ResourceSubscriptionType}`,
    ResourceSubscriptionCapability
  >
> = {
  'drone-hub/chat': {
    supportedEvents: CHAT_EVENTS,
    terminalEvents: [],
  },
  'drone-hub/change_request': {
    supportedEvents: CHANGE_REQUEST_SUBSCRIPTION_EVENTS,
    terminalEvents: CHANGE_REQUEST_TERMINAL_EVENTS,
  },
  'drone-hub/cron': {
    supportedEvents: CRON_EVENTS,
    terminalEvents: [],
  },
  'github/repository': {
    supportedEvents: GITHUB_REPOSITORY_EVENTS,
    terminalEvents: [],
  },
  'github/pull_request': {
    supportedEvents: GITHUB_PULL_REQUEST_EVENTS,
    terminalEvents: GITHUB_PULL_REQUEST_TERMINAL_EVENTS,
  },
};

export function resourceSubscriptionCapability(
  provider: ResourceSubscriptionProvider,
  resourceType: ResourceSubscriptionType,
): ResourceSubscriptionCapability | null {
  return RESOURCE_SUBSCRIPTION_CAPABILITIES[`${provider}/${resourceType}`] ?? null;
}

export function isTerminalResourceSubscriptionEvent(event: ResourceEvent): boolean {
  const capability = resourceSubscriptionCapability(event.provider, event.resourceType);
  return Boolean(capability?.terminalEvents.includes(event.eventType));
}
