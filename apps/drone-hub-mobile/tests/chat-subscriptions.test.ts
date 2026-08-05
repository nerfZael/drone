import { describe, expect, test } from 'bun:test';

import {
  mobileChatSubscriptionResourceLabel,
  mobileChatSubscriptionSummary,
  normalizeMobileChatSubscriptions,
} from '../src/drones/chat-subscriptions';

describe('mobile chat subscription presentation', () => {
  test('normalizes active subscriptions and summarizes their count', () => {
    const subscriptions = normalizeMobileChatSubscriptions([
      {
        id: 'chat-watch',
        provider: 'drone-hub',
        resourceType: 'chat',
        resourceId: 'target-chat',
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
      'Chat idle, Chat failed · target-chat',
    );
    expect(mobileChatSubscriptionSummary(subscriptions.slice(1))).toBe(
      'PR opened · acme/widgets',
    );
    expect(mobileChatSubscriptionResourceLabel(subscriptions[0]!)).toBe('Chat · target-chat');
  });
});
