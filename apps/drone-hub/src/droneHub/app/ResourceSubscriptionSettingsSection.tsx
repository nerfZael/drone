import React from 'react';
import { eventNotificationEventLabel } from '@drone/assistant-chat';
import { UiButton, UiMenuSelect, UiSwitch } from '../../ui/components';
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
          Controls event delivery, polling, batching, run limits, retries, and retention.
        </div>
      </div>
      {error ? (
        <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-12 text-[var(--red)]">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-12 text-[var(--green)]">
          {notice}
        </div>
      ) : null}
      {loading && !draft ? (
        <div className="text-12 text-[var(--muted-dim)]">
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
          <div className="flex flex-col gap-3">
            <div className="flex max-w-sm flex-col gap-1.5">
              <span className="dh-type-label">Default event delivery</span>
              <UiMenuSelect
                value={draft?.deliveryMode ?? 'queue'}
                disabled={disabled}
                entries={[
                  { value: 'queue', label: 'Queued' },
                  { value: 'asap', label: 'ASAP' },
                ]}
                onValueChange={(value) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          deliveryMode: value === 'asap' ? 'asap' : 'queue',
                        }
                      : current,
                  )
                }
                title="Default event delivery"
              />
            </div>
            <p className="dh-type-supporting">
              Queued waits for the current response to finish. ASAP uses the agent’s next available
              delivery point, including steering an active response when supported. Polling,
              batching, and rate limits still apply. Saved changes take effect within a few seconds.
              Messages already sent to the prompt queue keep their delivery mode.
            </p>
            <p className="dh-type-supporting">
              Waiting events with the same delivery mode share a queue item. Your first queued
              message can join it; later messages stay separate. New events can join that item
              ahead of later messages until delivery starts. Large groups use another queue item.
            </p>
            <div className="dh-type-label">Delivery by event type</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(subscriptions.settings?.eventTypes ?? []).map((eventType) => (
                <div key={eventType} className="flex min-w-0 flex-col gap-1.5">
                  <span className="dh-type-label">{eventNotificationEventLabel(eventType)}</span>
                  <UiMenuSelect
                    value={draft?.eventDeliveryModes[eventType] ?? 'inherit'}
                    disabled={disabled}
                    entries={[
                      {
                        value: 'inherit',
                        label: `Use default (${draft?.deliveryMode === 'asap' ? 'ASAP' : 'Queued'})`,
                      },
                      { value: 'queue', label: 'Queued' },
                      { value: 'asap', label: 'ASAP' },
                    ]}
                    onValueChange={(value) =>
                      setDraft((current) => {
                        if (!current) return current;
                        const eventDeliveryModes = { ...current.eventDeliveryModes };
                        if (value === 'queue' || value === 'asap')
                          eventDeliveryModes[eventType] = value;
                        else delete eventDeliveryModes[eventType];
                        return { ...current, eventDeliveryModes };
                      })
                    }
                    title={`${eventNotificationEventLabel(eventType)} delivery`}
                  />
                </div>
              ))}
            </div>
            {subscriptions.settings && !subscriptions.settings.eventTypes?.length ? (
              <p className="dh-type-supporting">No event types are available.</p>
            ) : null}
          </div>
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
                  className="h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-13 text-[var(--fg)] transition-colors focus:border-[var(--accent-muted)] focus:outline-none disabled:opacity-40"
                />
                <span className="text-10 text-[var(--muted-dim)]">
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
