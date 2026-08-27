import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { renderEventNotificationPrompt } from '@drone/assistant-chat';

import {
  ChatSubscriptionIndicator,
  DroneChatComposerMetadata,
  DroneBranchIndicator,
} from '../src/droneHub/app/ChatComposerMetadata';
import {
  chatSubscriptionDisplayIntent,
  chatSubscriptionNextRunLabel,
  chatSubscriptionResourceLabel,
  chatSubscriptionSummary,
  normalizeChatResourceSubscriptions,
} from '../src/droneHub/app/chat-resource-subscriptions';
import { SubscriptionEventMessage } from '../src/droneHub/chat/SubscriptionEventBadge';

describe('chat resource subscription presentation', () => {
  test('keeps only active, displayable subscriptions', () => {
    expect(
      normalizeChatResourceSubscriptions([
        {
          id: 'active-pr',
          provider: 'github',
          resourceType: 'pull_request',
          resourceId: 'acme/widgets#42',
          events: ['pull_request.merged'],
          intent: 'Continue after merge.',
          status: 'active',
        },
        {
          id: 'cancelled-repo',
          provider: 'github',
          resourceType: 'repository',
          resourceId: 'acme/widgets',
          status: 'cancelled',
        },
      ]),
    ).toEqual([
      {
        id: 'active-pr',
        provider: 'github',
        resourceType: 'pull_request',
        resourceId: 'acme/widgets#42',
        resourceLabel: '',
        resourceConfig: null,
        events: ['pull_request.merged'],
        intent: 'Continue after merge.',
        status: 'active',
        nextEventAt: null,
      },
    ]);
  });

  test('presents cron subscriptions by schedule instead of their internal resource ID', () => {
    const [subscription] = normalizeChatResourceSubscriptions([
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
    expect(chatSubscriptionSummary([subscription!])).toBe(
      'Scheduled run · Every hour · America/New_York',
    );
    expect(chatSubscriptionResourceLabel(subscription!)).toBe(
      'Schedule · Every hour · America/New_York',
    );
    expect(chatSubscriptionNextRunLabel(subscription!)).toStartWith('Next run · ');
    expect(chatSubscriptionSummary([subscription!])).not.toContain('opaque-schedule-hash');
  });

  test('uses the resource for one subscription and a count for several', () => {
    const subscriptions = normalizeChatResourceSubscriptions([
      {
        id: 'one',
        provider: 'github',
        resourceType: 'pull_request',
        resourceId: 'acme/widgets#42',
        events: ['pull_request.merged'],
        status: 'active',
      },
      {
        id: 'two',
        provider: 'github',
        resourceType: 'repository',
        resourceId: 'acme/widgets',
        events: ['pull_request.opened'],
        status: 'active',
      },
    ]);

    expect(chatSubscriptionSummary(subscriptions.slice(0, 1))).toBe('PR merged · acme/widgets#42');
    expect(chatSubscriptionSummary(subscriptions.slice(1))).toBe('PR opened · acme/widgets');
    expect(chatSubscriptionSummary(subscriptions)).toBe('Subscriptions · 2');
    expect(chatSubscriptionResourceLabel(subscriptions[0]!)).toBe('Pull request · acme/widgets#42');

    const html = renderToStaticMarkup(
      React.createElement(ChatSubscriptionIndicator, { subscriptions }),
    );
    expect(html).toContain('data-chat-subscription-indicator="true"');
    expect(html).toContain('Subscriptions · 2');
    expect(html).not.toContain('role="dialog"');
  });

  test('uses the target drone and chat label instead of a durable chat ID', () => {
    const [onlyDefaultChat, namedChat] = normalizeChatResourceSubscriptions([
      {
        id: 'default-watch',
        provider: 'drone-hub',
        resourceType: 'chat',
        resourceId: '48ae4ad8-6dfe-4e5d-946a-4cd9c973293a',
        resourceLabel: 'Release helper',
        resourceDroneId: '48ae4ad8-6dfe-4e5d-946a-4cd9c973293a',
        resourceChatName: 'default',
        events: ['chat.idle', 'chat.failed'],
        status: 'active',
      },
      {
        id: 'review-watch',
        provider: 'drone-hub',
        resourceType: 'chat',
        resourceId: 'cecb8d75-60e3-412a-b16f-5f5a10a461cf',
        resourceLabel: 'Release helper / review',
        resourceDroneId: 'cecb8d75-60e3-412a-b16f-5f5a10a461cf',
        resourceChatName: 'review',
        events: ['chat.idle'],
        status: 'active',
      },
    ]);

    expect(chatSubscriptionResourceLabel(onlyDefaultChat!)).toBe('Chat · Release helper');
    expect(chatSubscriptionSummary([onlyDefaultChat!])).toBe(
      'Chat idle, Chat failed · Release helper',
    );
    expect(chatSubscriptionResourceLabel(namedChat!)).toBe(
      'Chat · Release helper / review',
    );
    expect(
      chatSubscriptionDisplayIntent(
        'Targets: 48ae4ad8-6dfe-4e5d-946a-4cd9c973293a/default, cecb8d75-60e3-412a-b16f-5f5a10a461cf/review',
        [onlyDefaultChat!, namedChat!],
      ),
    ).toBe('Targets: Release helper, Release helper / review');
  });

  test('presents native change request subscriptions with their public number and title', () => {
    const [subscription] = normalizeChatResourceSubscriptions([
      {
        id: 'change-request-watch',
        provider: 'drone-hub',
        resourceType: 'change_request',
        resourceId: '42',
        resourceLabel: '#42 Improve subscriptions',
        resourceDroneId: 'drone-b',
        events: ['change_request.updated', 'change_request.merged'],
        intent: 'Continue reviewing it.',
        status: 'active',
      },
    ]);

    expect(subscription).toMatchObject({
      resourceType: 'change_request',
      resourceId: '42',
      resourceDroneId: 'drone-b',
    });
    expect(chatSubscriptionResourceLabel(subscription!)).toBe(
      'Change request · #42 Improve subscriptions',
    );
    expect(chatSubscriptionSummary([subscription!])).toBe(
      'Change request updated, Change request merged · #42 Improve subscriptions',
    );
  });

  test('renders the primary chat subscription snapshot without a client fetch', () => {
    const subscriptions = normalizeChatResourceSubscriptions([
      {
        id: 'one',
        provider: 'github',
        resourceType: 'pull_request',
        resourceId: 'acme/widgets#42',
        events: ['pull_request.merged'],
        status: 'active',
      },
    ]);

    const html = renderToStaticMarkup(
      React.createElement(DroneChatComposerMetadata, {
        runtime: 'container',
        chatId: 'chat-1',
        initialSubscriptions: subscriptions,
      }),
    );

    expect(html).toContain('data-chat-subscription-indicator="true"');
    expect(html).toContain('PR merged · acme/widgets#42');
  });

  test('shows a read-only current branch indicator only when a branch is available', () => {
    const html = renderToStaticMarkup(
      React.createElement(DroneBranchIndicator, { branch: 'feature/composer-metadata' }),
    );
    expect(html).toContain('data-drone-branch-indicator="feature/composer-metadata"');
    expect(html).toContain('Current branch: feature/composer-metadata');
    expect(renderToStaticMarkup(React.createElement(DroneBranchIndicator, { branch: null }))).toBe(
      '',
    );
  });

  test('renders automated events as expandable notifications without exposing intent', () => {
    const prompt = renderEventNotificationPrompt({
      events: [
        {
          provider: 'github',
          resourceType: 'pull_request',
          resourceId: 'acme/widgets#42',
          eventType: 'pull_request.merged',
          intent: 'Deploy after merge.',
          summary: 'Pull request #42 merged.',
          providerContent: { mergedBy: 'octocat' },
        },
      ],
    });
    const html = renderToStaticMarkup(React.createElement(SubscriptionEventMessage, { prompt }));
    expect(html).toContain('Event notification');
    expect(html).toContain('PR merged');
    expect(html).toContain('Pull request · acme/widgets#42');
    expect(html).not.toContain('Deploy after merge.');
    expect(html).not.toContain('dronehub_event_notification');

    const chatPrompt = renderEventNotificationPrompt({
      events: [
        {
          provider: 'drone-hub',
          resourceType: 'chat',
          resourceId: '415ee2a4-f0b4-49da-b3e0-23d7096f5090',
          eventType: 'chat.idle',
          summary: 'Workstream 2 / 02 Character Models became idle.',
          providerContent: {
            chatLabel: 'Workstream 2 / 02 Character Models',
            chatId: '415ee2a4-f0b4-49da-b3e0-23d7096f5090',
            droneName: 'Workstream 2',
            chatName: '02 Character Models',
          },
        },
      ],
    });
    const chatHtml = renderToStaticMarkup(
      React.createElement(SubscriptionEventMessage, { prompt: chatPrompt }),
    );
    expect(chatHtml).toContain('Chat idle: 02 Character Models');
    expect(chatHtml).toContain('Drone: Workstream 2');
    expect(chatHtml).not.toContain('Chat · Workstream 2 / 02 Character Models');
    expect(chatHtml).toContain('data-event-notification-chat-link="true"');
    expect(chatHtml).toContain('data-event-notification-drone-link="true"');
    expect(chatHtml).toContain('aria-label="Open chat 02 Character Models in drone Workstream 2"');
    expect(chatHtml).toContain('aria-label="Open drone Workstream 2"');
  });
});
