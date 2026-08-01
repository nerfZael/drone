import React from 'react';
import { UiButton, UiSwitch } from '../../ui/components';
import type { UseResourceSubscriptionSettingsResult } from './use-resource-subscription-settings';

type Props = { subscriptions: UseResourceSubscriptionSettingsResult };

const fields = [
  ['githubPollingIntervalMs', 'GitHub poll interval', 'seconds', 15, 3_600],
  ['batchWindowMs', 'Batch window', 'seconds', 0, 300],
  ['maxEventsPerPrompt', 'Events per prompt', 'events', 1, 100],
  ['maxActiveSubscriptionsPerConversation', 'Active subscriptions', 'per conversation', 1, 500],
  ['maxAutomatedRunsPerConversationPerHour', 'Automated runs', 'per conversation/hour', 1, 1_000],
  ['deliveryRetryLimit', 'Delivery retries', 'attempts', 1, 50],
  ['terminalEventRetentionDays', 'Terminal-event retention', 'days', 1, 365],
  ['deliveryRetentionDays', 'Delivery retention', 'days', 1, 365],
] as const;

export function ResourceSubscriptionSettingsSection({ subscriptions }: Props) {
  const { draft, loading, saving, dirty, error, notice, setDraft, save } = subscriptions;
  const disabled = loading || saving || !draft;
  return (
    <section className="dh-settings-section">
      <div>
        <div className="dh-type-heading">Resource subscriptions</div>
        <div className="mt-1 dh-type-supporting">
          Controls chat and GitHub polling, batching, run limits, retries, and retention.
        </div>
      </div>
      {error ? (
        <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--green)]">
          {notice}
        </div>
      ) : null}
      {loading && !draft ? (
        <div className="text-[var(--text-12)] text-[var(--muted-dim)]">
          Loading subscription settings…
        </div>
      ) : (
        <>
          <UiSwitch
            checked={draft?.enabled === true}
            onCheckedChange={(enabled) =>
              setDraft((current) => (current ? { ...current, enabled } : current))
            }
            disabled={disabled}
            label="Enable resource subscriptions"
            description="Pause polling and delivery without deleting subscriptions or pending events when disabled."
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {fields.map(([key, label, unit, min, max]) => (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="dh-type-label">{label}</span>
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={1}
                  disabled={disabled}
                  value={draft?.[key] ?? ''}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, [key]: event.target.value } : current,
                    )
                  }
                  className="h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[var(--text-13)] text-[var(--fg)] transition-colors focus:border-[var(--accent-muted)] focus:outline-none disabled:opacity-40"
                />
                <span className="text-[var(--text-10)] text-[var(--muted-dim)]">
                  {unit} · {min.toLocaleString()}–{max.toLocaleString()}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      <div>
        <UiButton
          variant="primary"
          disabled={disabled || !dirty}
          onClick={() => void save()}
          loading={saving}
        >
          Save subscription settings
        </UiButton>
      </div>
    </section>
  );
}
