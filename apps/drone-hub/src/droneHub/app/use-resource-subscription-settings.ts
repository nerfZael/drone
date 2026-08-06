import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ResourceSubscriptionSettings,
  ResourceSubscriptionSettingsResponse,
} from './settings-types';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsPostMutation, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type ResourceSubscriptionSettingsDraft = Record<
  Exclude<keyof ResourceSubscriptionSettings, 'enabled'>,
  string
> & { enabled: boolean };

export type UseResourceSubscriptionSettingsResult = ReturnType<typeof useResourceSubscriptionSettings>;

export function useResourceSubscriptionSettings(
  requestJson: RequestJsonFn,
) {
  const queryClient = useQueryClient();
  const queryKey = settingsQueryKey('resource-subscriptions');
  const query = useSettingsQuery<ResourceSubscriptionSettingsResponse>(
    requestJson,
    queryKey,
    '/api/resource-subscriptions/settings',
  );
  const [draft, setDraft] = React.useState<ResourceSubscriptionSettingsDraft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const dirty = Boolean(
    query.data && draft && !sameDraft(draft, toDraft(query.data.settings)),
  );

  const applySettings = React.useCallback((data: ResourceSubscriptionSettingsResponse) => {
    setDraft(toDraft(data.settings));
  }, []);

  React.useEffect(() => {
    if (query.data) applySettings(query.data);
  }, [applySettings, query.data]);

  const load = React.useCallback(async () => {
    setError(null);
    setNotice(null);
    const { data } = await query.refetch();
    if (data) applySettings(data);
  }, [applySettings, query.refetch]);

  const saveMutation = useSettingsPostMutation<
    ResourceSubscriptionSettingsResponse,
    { settings: ResourceSubscriptionSettings }
  >(requestJson, '/api/resource-subscriptions/settings');

  const save = React.useCallback(async () => {
    if (!draft) return;
    const parsed = fromDraft(draft);
    if (!parsed) {
      setError('Each subscription setting must be a whole number within the range shown.');
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const response = await saveMutation.mutateAsync({ settings: parsed });
      queryClient.setQueryData(queryKey, response);
      applySettings(response);
      setNotice('Saved resource subscription settings.');
    } catch (saveError) {
      setError(settingsErrorMessage(saveError));
    }
  }, [applySettings, draft, queryClient, queryKey, saveMutation]);

  return {
    settings: query.data ?? null,
    draft,
    loading: query.isFetching,
    saving: saveMutation.isPending,
    dirty,
    error: settingsQueryError(error, false, query),
    notice,
    setDraft,
    load,
    save,
  };
}

function sameDraft(
  left: ResourceSubscriptionSettingsDraft,
  right: ResourceSubscriptionSettingsDraft,
): boolean {
  return (Object.keys(left) as Array<keyof ResourceSubscriptionSettingsDraft>).every(
    (key) => left[key] === right[key],
  );
}

function toDraft(settings: ResourceSubscriptionSettings): ResourceSubscriptionSettingsDraft {
  return {
    enabled: settings.enabled,
    githubPollingIntervalMs: String(Math.round(settings.githubPollingIntervalMs / 1_000)),
    batchWindowMs: String(Math.round(settings.batchWindowMs / 1_000)),
    maxEventsPerPrompt: String(settings.maxEventsPerPrompt),
    maxActiveSubscriptionsPerConversation: String(settings.maxActiveSubscriptionsPerConversation),
    maxAutomatedRunsPerConversationPerHour: String(settings.maxAutomatedRunsPerConversationPerHour),
    deliveryRetryLimit: String(settings.deliveryRetryLimit),
    terminalEventRetentionDays: String(settings.terminalEventRetentionDays),
    deliveryRetentionDays: String(settings.deliveryRetentionDays),
  };
}

function fromDraft(draft: ResourceSubscriptionSettingsDraft): ResourceSubscriptionSettings | null {
  const integer = (value: string, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const githubPollingSeconds = integer(draft.githubPollingIntervalMs, 15, 3_600);
  const batchWindowSeconds = integer(draft.batchWindowMs, 0, 300);
  const maxEventsPerPrompt = integer(draft.maxEventsPerPrompt, 1, 100);
  const maxActive = integer(draft.maxActiveSubscriptionsPerConversation, 1, 500);
  const maxRuns = integer(draft.maxAutomatedRunsPerConversationPerHour, 1, 1_000);
  const retries = integer(draft.deliveryRetryLimit, 1, 50);
  const terminalRetention = integer(draft.terminalEventRetentionDays, 1, 365);
  const deliveryRetention = integer(draft.deliveryRetentionDays, 1, 365);
  if (
    githubPollingSeconds == null ||
    batchWindowSeconds == null ||
    maxEventsPerPrompt == null ||
    maxActive == null ||
    maxRuns == null ||
    retries == null ||
    terminalRetention == null ||
    deliveryRetention == null
  )
    return null;
  return {
    enabled: draft.enabled,
    githubPollingIntervalMs: githubPollingSeconds * 1_000,
    batchWindowMs: batchWindowSeconds * 1_000,
    maxEventsPerPrompt,
    maxActiveSubscriptionsPerConversation: maxActive,
    maxAutomatedRunsPerConversationPerHour: maxRuns,
    deliveryRetryLimit: retries,
    terminalEventRetentionDays: terminalRetention,
    deliveryRetentionDays: deliveryRetention,
  };
}
