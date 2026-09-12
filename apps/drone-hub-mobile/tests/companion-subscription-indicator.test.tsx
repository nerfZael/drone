import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';
import { normalizeMobileChatSubscriptions } from '../src/drones/chat-subscriptions';

mock.module('react-native', () => ({
  Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
}));
mock.module('lucide-react-native/icons/bell', () => ({ default: 'Bell' }));
mock.module('lucide-react-native/icons/x', () => ({ default: 'X' }));
mock.module('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { ChatSubscriptionIndicator } = await import('../src/drones/ChatSubscriptionIndicator');

test('mobile companion count and open details follow subscription updates, including zero', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReturnType<typeof create>;
  const rows = normalizeMobileChatSubscriptions([{ id: 'watch', provider: 'github', resourceType: 'pull_request',
    resourceId: 'acme/repo#1', status: 'active', events: ['pull_request.merged'] }]);
  try {
    await act(async () => { root = create(<ChatSubscriptionIndicator companion subscriptions={[]} />); });
    const trigger = () => root.root.findAllByType('Pressable' as any)[0];
    expect(trigger().findByType('Text' as any).props.children).toBe(0);
    await act(async () => { root.update(<ChatSubscriptionIndicator companion subscriptions={rows} />); });
    expect(trigger().findByType('Text' as any).props.children).toBe(1);
    await act(async () => { trigger().props.onPress(); });
    expect(root.root.findByType('Modal' as any).props.visible).toBe(true);
    expect(JSON.stringify(root.toJSON())).toContain('acme/repo#1');
    expect(JSON.stringify(root.toJSON())).toContain('Companion subscriptions');
    await act(async () => { root.update(<ChatSubscriptionIndicator companion subscriptions={[]} />); });
    expect(trigger().findByType('Text' as any).props.children).toBe(0);
    expect(root.root.findByType('Modal' as any).props.visible).toBe(true);
    expect(JSON.stringify(root.toJSON())).toContain('Companion has no active subscriptions.');
  } finally {
    await act(async () => { root?.unmount(); });
    if (original) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', original);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
