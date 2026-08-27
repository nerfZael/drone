import { afterEach, describe, expect, test } from 'bun:test';

import { subscribeDroneChatEvents } from '../src/droneHub/app/chat-events';

class FakeEventSource {
  static latest: FakeEventSource | null = null;

  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.latest = this;
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

  close(): void {}
}

afterEach(() => {
  delete (globalThis as any).window;
  FakeEventSource.latest = null;
});

describe('Drone chat events', () => {
  test('invalidates chats from a full snapshot after reconnecting to a new Hub', () => {
    (globalThis as any).window = { EventSource: FakeEventSource };
    const received: any[] = [];
    const unsubscribe = subscribeDroneChatEvents({ onDelta: (event) => received.push(event) });

    expect(FakeEventSource.latest?.url).toBe('/api/drones/chat-events');
    FakeEventSource.latest?.emit('snapshot', {
      ok: true,
      chats: [{ droneId: 'drone-1', chatName: 'default' }],
    });

    expect(received).toEqual([
      { ok: true, chats: [{ droneId: 'drone-1', chatName: 'default' }] },
    ]);
    unsubscribe();
  });
});
