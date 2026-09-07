import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'bun:test';

import { ResourceSubscriptionSettingsSection } from '../src/droneHub/app/ResourceSubscriptionSettingsSection';
import type { UseResourceSubscriptionSettingsResult } from '../src/droneHub/app/use-resource-subscription-settings';

function model(
  overrides: Partial<UseResourceSubscriptionSettingsResult> = {},
): UseResourceSubscriptionSettingsResult {
  return {
    settings: {
      ok: true,
      eventTypes: ['chat.idle', 'question_request.resolved'],
      settings: {} as any,
    },
    draft: {
      enabled: true,
      deliveryMode: 'queue',
      eventDeliveryModes: { 'question_request.resolved': 'asap' },
      githubPollingIntervalMs: '60',
      batchWindowMs: '15',
      maxEventsPerPrompt: '30',
      maxActiveSubscriptionsPerConversation: '50',
      maxAutomatedRunsPerConversationPerHour: '100',
      deliveryRetryLimit: '10',
      terminalEventRetentionDays: '30',
      deliveryRetentionDays: '30',
    },
    loading: false,
    saving: false,
    dirty: true,
    error: null,
    notice: null,
    setDraft: () => {},
    load: async () => {},
    save: async () => {},
    ...overrides,
  };
}

test('shows the global default, inherited event delivery, and explicit event override', () => {
  const html = renderToStaticMarkup(
    <ResourceSubscriptionSettingsSection subscriptions={model()} />,
  );
  expect(html).toContain('Default event delivery');
  expect(html).toContain('Use default (Queued)');
  expect(html).toContain('ASAP');
  expect(html).toContain('next available delivery point');
  expect(html).toContain('Polling, batching, and rate limits still apply');
});

test('keeps loading and failed saves visible and disables delivery changes while saving', () => {
  const loading = renderToStaticMarkup(
    <ResourceSubscriptionSettingsSection
      subscriptions={model({ settings: null, draft: null, loading: true })}
    />,
  );
  expect(loading).toContain('Loading subscription settings');
  const saving = renderToStaticMarkup(
    <ResourceSubscriptionSettingsSection subscriptions={model({ saving: true })} />,
  );
  expect(saving).toMatch(/disabled="" title="Default event delivery"/);
  const failed = renderToStaticMarkup(
    <ResourceSubscriptionSettingsSection
      subscriptions={model({ error: 'Could not save settings.' })}
    />,
  );
  expect(failed).toContain('Could not save settings.');
  expect(failed).toContain('ASAP');
});
