import { getHubSettingsRepository } from '../../host/hub-settings-repository';
import {
  DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
  type ResourceSubscriptionSettings,
} from './resource-subscription-types';

export const RESOURCE_SUBSCRIPTION_SETTINGS_KEY = 'resource-subscriptions';

function boundedInteger(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function normalizeResourceSubscriptionSettings(raw: unknown): ResourceSubscriptionSettings {
  const value =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const defaults = DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS;
  return {
    enabled: value.enabled !== false,
    githubPollingIntervalMs: boundedInteger(
      value.githubPollingIntervalMs,
      defaults.githubPollingIntervalMs,
      15_000,
      60 * 60 * 1000,
    ),
    batchWindowMs: boundedInteger(value.batchWindowMs, defaults.batchWindowMs, 0, 5 * 60_000),
    maxEventsPerPrompt: boundedInteger(
      value.maxEventsPerPrompt,
      defaults.maxEventsPerPrompt,
      1,
      100,
    ),
    maxActiveSubscriptionsPerConversation: boundedInteger(
      value.maxActiveSubscriptionsPerConversation,
      defaults.maxActiveSubscriptionsPerConversation,
      1,
      500,
    ),
    maxAutomatedRunsPerConversationPerHour: boundedInteger(
      value.maxAutomatedRunsPerConversationPerHour,
      defaults.maxAutomatedRunsPerConversationPerHour,
      1,
      1_000,
    ),
    deliveryRetryLimit: boundedInteger(
      value.deliveryRetryLimit,
      defaults.deliveryRetryLimit,
      1,
      50,
    ),
    terminalEventRetentionDays: boundedInteger(
      value.terminalEventRetentionDays,
      defaults.terminalEventRetentionDays,
      1,
      365,
    ),
    deliveryRetentionDays: boundedInteger(
      value.deliveryRetentionDays,
      defaults.deliveryRetentionDays,
      1,
      365,
    ),
  };
}

export async function readResourceSubscriptionSettings(): Promise<ResourceSubscriptionSettings> {
  const record = (await getHubSettingsRepository()).get<unknown>(
    RESOURCE_SUBSCRIPTION_SETTINGS_KEY,
  );
  return normalizeResourceSubscriptionSettings(record?.value);
}

export async function writeResourceSubscriptionSettings(
  raw: unknown,
): Promise<ResourceSubscriptionSettings> {
  const settings = normalizeResourceSubscriptionSettings(raw);
  await (
    await getHubSettingsRepository()
  ).put(RESOURCE_SUBSCRIPTION_SETTINGS_KEY, settings, {
    updatedAt: new Date().toISOString(),
  });
  return settings;
}
