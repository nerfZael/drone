import { describe, expect, test } from 'bun:test';

import {
  mobileChatSubscriptionDisplayIntent,
  mobileChatSubscriptionNextRunLabel,
  mobileChatSubscriptionResourceLabel,
  mobileChatSubscriptionSummary,
  normalizeMobileChatSubscriptions,
} from '../src/drones/chat-subscriptions';

describe('mobile chat subscription presentation', () => {
  test('presents native change requests by public number and title', () => {
    const [subscription] = normalizeMobileChatSubscriptions([
      {
        id: 'change-request-watch',
        provider: 'drone-hub',
        resourceType: 'change_request',
        resourceId: '42',
        resourceLabel: '#42 Improve subscriptions',
        resourceDroneId: 'drone-b',
        events: ['change_request.updated', 'change_request.merged'],
        status: 'active',
      },
    ]);

    expect(subscription?.resourceDroneId).toBe('drone-b');
    expect(mobileChatSubscriptionResourceLabel(subscription!)).toBe(
      'Change request · #42 Improve subscriptions',
    );
    expect(mobileChatSubscriptionSummary([subscription!])).toBe(
      'Change request updated, Change request merged · #42 Improve subscriptions',
    );
  });

  test('normalizes active subscriptions and summarizes their count', () => {
    const subscriptions = normalizeMobileChatSubscriptions([
      {
        id: 'chat-watch',
        provider: 'drone-hub',
        resourceType: 'chat',
        resourceId: 'target-chat',
        resourceLabel: 'Release helper / review',
        resourceDroneId: 'drone-b',
        resourceChatName: 'review',
        events: ['chat.idle', 'chat.failed'],
        intent: 'Wait for the target.',
        status: 'active',
      },
      {
        id: 'repo-watch',
        provider: 'github',
        resourceType: 'repository',
        resourceId: 'acme/widgets',
        events: ['pull_request.opened'],
        status: 'active',
      },
      {
        id: 'old-watch',
        provider: 'github',
        resourceType: 'repository',
        resourceId: 'acme/old',
        status: 'cancelled',
      },
    ]);

    expect(subscriptions).toHaveLength(2);
    expect(mobileChatSubscriptionSummary(subscriptions)).toBe('Subscriptions · 2');
    expect(mobileChatSubscriptionSummary(subscriptions.slice(0, 1))).toBe(
      'Chat idle, Chat failed · Release helper / review',
    );
    expect(mobileChatSubscriptionSummary(subscriptions.slice(1))).toBe(
      'PR opened · acme/widgets',
    );
    expect(mobileChatSubscriptionResourceLabel(subscriptions[0]!)).toBe(
      'Chat · Release helper / review',
    );
    expect(
      mobileChatSubscriptionDisplayIntent('Targets: drone-b/review', subscriptions),
    ).toBe('Targets: Release helper / review');
  });

  test('presents cron subscriptions by expression, time zone, and next run', () => {
    const [subscription] = normalizeMobileChatSubscriptions([
      {
        id: 'hourly-check',
        provider: 'drone-hub',
        resourceType: 'cron',
        resourceId: 'v1:opaque-schedule-hash',
        resourceConfig: {
          expression: '0 * * * *',
          timeZone: 'America/New_York',
          description: 'Every hour',
        },
        events: ['cron.triggered'],
        intent: 'Check the deployment.',
        status: 'active',
        nextEventAt: '2026-08-05T13:00:00.000Z',
      },
    ]);

    expect(subscription).toMatchObject({
      resourceType: 'cron',
      resourceConfig: {
        expression: '0 * * * *',
        timeZone: 'America/New_York',
        description: 'Every hour',
      },
      nextEventAt: '2026-08-05T13:00:00.000Z',
    });
    expect(mobileChatSubscriptionSummary([subscription!])).toBe(
      'Scheduled run · Every hour · America/New_York',
    );
    expect(mobileChatSubscriptionResourceLabel(subscription!)).toBe(
      'Schedule · Every hour · America/New_York',
    );
    expect(mobileChatSubscriptionNextRunLabel(subscription!)).toStartWith('Next run · ');
    expect(mobileChatSubscriptionSummary([subscription!])).not.toContain('opaque-schedule-hash');
  });
});
