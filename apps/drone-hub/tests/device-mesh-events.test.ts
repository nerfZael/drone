import { describe, expect, test } from 'bun:test';

import { dispatchDeviceMeshEventBlock } from '../src/droneHub/app/device-mesh-events';
import {
  createTrailingRefresh,
  remoteDroneRefreshPlan,
} from '../src/droneHub/app/remote-drone-refresh';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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

  test('coalesces noisy events into one active and one trailing refresh', async () => {
    const first = deferred();
    const calls: number[] = [];
    const refresh = createTrailingRefresh(async () => {
      calls.push(calls.length + 1);
      if (calls.length === 1) await first.promise;
    });

    const initial = refresh();
    const trailing = refresh();
    void refresh();
    expect(calls).toEqual([1]);
    first.resolve();
    await Promise.all([initial, trailing]);
    expect(calls).toEqual([1, 2]);
  });
});
