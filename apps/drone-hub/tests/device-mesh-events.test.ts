import { describe, expect, test } from 'bun:test';

import {
  DeviceMeshEventParser,
  dispatchDeviceMeshEventBlock,
  subscribeDeviceMeshChanges,
  type DeviceMeshEventRuntime,
} from '../src/droneHub/app/device-mesh-events';
import { remoteDroneRefreshPlan } from '../src/droneHub/app/remote-drone-refresh';

describe('desktop device mesh events', () => {
  test('parses capability events for the remote workspace', () => {
    const events: any[] = [];
    dispatchDeviceMeshEventBlock(
      'event: capability\ndata: {"sourceDeviceId":"remote","capability":"drone-control","event":"chat.changed","payload":{"droneId":"drone","chatName":"default","reason":"runtime_tool_call_progress"}}',
      { onChange: () => undefined, onCapabilityEvent: (event) => events.push(event) },
    );
    expect(events).toHaveLength(1);
    expect(remoteDroneRefreshPlan(events[0], { droneId: 'drone', chatName: 'default' })).toEqual({
      refreshChat: true,
      refreshDrones: false,
    });
  });

  test('uses drone refreshes for inactive chat state and registry events', () => {
    const base = {
      sourceDeviceId: 'remote',
      capability: 'drone-control',
      event: 'chat.changed',
      payload: { droneId: 'other', chatName: 'default', reason: 'canonical_history_changed' },
    };
    expect(remoteDroneRefreshPlan(base, { droneId: 'drone', chatName: 'default' })).toEqual({
      refreshChat: false,
      refreshDrones: true,
    });
    expect(
      remoteDroneRefreshPlan(
        { ...base, event: 'drones.changed', payload: { reason: 'registry_write' } },
        { droneId: 'drone', chatName: 'default' },
      ),
    ).toEqual({ refreshChat: false, refreshDrones: true });
  });

  test('parses CRLF framing split at every chunk boundary', () => {
    const source = 'event: change\r\ndata: {"revision":1}\r\n\r\n';
    for (let split = 1; split < source.length; split += 1) {
      let changes = 0;
      const parser = new DeviceMeshEventParser({ onChange: () => (changes += 1) });
      parser.push(source.slice(0, split));
      parser.push(source.slice(split));
      expect(changes).toBe(1);
    }
  });

  test('parses multiple mixed-newline events from one chunk', () => {
    let changes = 0;
    const capabilities: any[] = [];
    const parser = new DeviceMeshEventParser({
      onChange: () => (changes += 1),
      onCapabilityEvent: (event) => capabilities.push(event),
    });
    parser.push(
      'event: change\ndata: {}\n\nevent: capability\r\ndata: {"sourceDeviceId":"remote","capability":"drone-control","event":"drones.changed","payload":{}}\r\n\r\n',
    );
    expect(changes).toBe(1);
    expect(capabilities).toHaveLength(1);
  });

  test('retries an unauthorized response and cleans up the connected stream on abort', async () => {
    const encoded = new TextEncoder().encode('event: change\r\ndata: {}\r\n\r\n');
    let fetches = 0;
    let cancelled = false;
    const connections: boolean[] = [];
    const runtime: DeviceMeshEventRuntime = {
      fetch: (async () => {
        fetches += 1;
        if (fetches === 1) return new Response(null, { status: 401 });
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoded);
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200 },
        );
      }) as typeof window.fetch,
      setTimeout: ((callback: TimerHandler) => {
        queueMicrotask(() => (callback as () => void)());
        return 1;
      }) as typeof window.setTimeout,
      clearTimeout: (() => undefined) as typeof window.clearTimeout,
    };
    let unsubscribe = () => {};
    await new Promise<void>((resolve) => {
      unsubscribe = subscribeDeviceMeshChanges(
        () => {
          unsubscribe();
          resolve();
        },
        { onConnectionChange: (connected) => connections.push(connected) },
        runtime,
      );
    });
    await Promise.resolve();
    expect(fetches).toBe(2);
    expect(cancelled).toBe(true);
    expect(connections).toEqual([true, false]);
  });
});
