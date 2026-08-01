import React from 'react';
import type {
  ResourceSubscriptionSettings,
  ResourceSubscriptionSettingsResponse,
} from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type ResourceSubscriptionSettingsDraft = Record<
  Exclude<keyof ResourceSubscriptionSettings, 'enabled'>,
  string
> & { enabled: boolean };

export type UseResourceSubscriptionSettingsResult = {
  settings: ResourceSubscriptionSettingsResponse | null;
  draft: ResourceSubscriptionSettingsDraft | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  notice: string | null;
  setDraft: React.Dispatch<React.SetStateAction<ResourceSubscriptionSettingsDraft | null>>;
  load: () => Promise<void>;
  save: () => Promise<void>;
};

export function useResourceSubscriptionSettings(
  requestJson: RequestJsonFn,
): UseResourceSubscriptionSettingsResult {
  const [settings, setSettings] = React.useState<ResourceSubscriptionSettingsResponse | null>(null);
  const [draft, setDraft] = React.useState<ResourceSubscriptionSettingsDraft | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const dirty = Boolean(
    settings && draft && !sameDraft(draft, toDraft(settings.settings)),
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await requestJson<ResourceSubscriptionSettingsResponse>(
        '/api/resource-subscriptions/settings',
      );
      setSettings(response);
      setDraft(toDraft(response.settings));
    } catch (loadError: any) {
      setError(loadError?.message ?? String(loadError));
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = React.useCallback(async () => {
    if (!draft) return;
    const parsed = fromDraft(draft);
    if (!parsed) {
      setError('Each subscription setting must be a whole number within the range shown.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await requestJson<ResourceSubscriptionSettingsResponse>(
        '/api/resource-subscriptions/settings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ settings: parsed }),
        },
      );
      setSettings(response);
      setDraft(toDraft(response.settings));
      setNotice('Saved resource subscription settings.');
    } catch (saveError: any) {
      setError(saveError?.message ?? String(saveError));
    } finally {
      setSaving(false);
    }
  }, [draft, requestJson]);

  return { settings, draft, loading, saving, dirty, error, notice, setDraft, load, save };
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
