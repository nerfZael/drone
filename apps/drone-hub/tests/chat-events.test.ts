import { afterEach, describe, expect, test } from 'bun:test';

import { subscribeDroneChatEvents } from '../src/droneHub/app/chat-events';
import { subscribeDesktopEvents } from '../src/droneHub/app/desktop-events';

class FakeEventSource {
  static latest: FakeEventSource | null = null;
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.latest = this;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  closed = false;

  close(): void {
    this.closed = true;
  }
}

afterEach(() => {
  delete (globalThis as any).window;
  FakeEventSource.latest = null;
  FakeEventSource.instances = [];
});

describe('Drone chat events', () => {
  test('invalidates chats from a full snapshot after reconnecting to a new Hub', () => {
    (globalThis as any).window = { EventSource: FakeEventSource };
    const received: any[] = [];
    const unsubscribe = subscribeDroneChatEvents({ onDelta: (event) => received.push(event) });

    expect(FakeEventSource.latest?.url).toBe('/api/desktop/events');
    FakeEventSource.latest?.emit('chat_snapshot', {
      ok: true,
      chats: [{ droneId: 'drone-1', chatName: 'default' }],
    });

    expect(received).toEqual([
      { ok: true, chats: [{ droneId: 'drone-1', chatName: 'default' }] },
    ]);
    unsubscribe();
  });

  test('shares one desktop transport across event domains until the last subscriber leaves', () => {
    (globalThis as any).window = { EventSource: FakeEventSource };
    const chatUnsubscribe = subscribeDroneChatEvents({ onDelta: () => {} });
    const registryUnsubscribe = subscribeDesktopEvents({ handlers: { registry_delta: () => {} } });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest?.closed).toBe(false);
    chatUnsubscribe();
    expect(FakeEventSource.latest?.closed).toBe(false);
    registryUnsubscribe();
    expect(FakeEventSource.latest?.closed).toBe(true);
  });
});
