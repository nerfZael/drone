import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';

import {
  ChatSubscriptionIndicator,
  DroneBranchIndicator,
} from '../src/droneHub/app/ChatComposerMetadata';
import {
  chatSubscriptionResourceLabel,
  chatSubscriptionSummary,
  normalizeChatResourceSubscriptions,
} from '../src/droneHub/app/chat-resource-subscriptions';

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
        events: ['pull_request.merged'],
        intent: 'Continue after merge.',
        status: 'active',
      },
    ]);
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

    expect(chatSubscriptionSummary(subscriptions.slice(0, 1))).toBe(
      'Subscribed · acme/widgets#42',
    );
    expect(chatSubscriptionSummary(subscriptions)).toBe('Subscriptions · 2');
    expect(chatSubscriptionResourceLabel(subscriptions[0]!)).toBe(
      'Pull request · acme/widgets#42',
    );

    const html = renderToStaticMarkup(
      React.createElement(ChatSubscriptionIndicator, { subscriptions }),
    );
    expect(html).toContain('data-chat-subscription-indicator="true"');
    expect(html).toContain('Subscriptions · 2');
    expect(html).not.toContain('role="dialog"');
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
});
