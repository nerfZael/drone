import { describe, expect, test } from 'bun:test';

import { DeviceMeshResponseCache } from '../src/hub/device-mesh/device-mesh-response-cache';

const response = (requestId: string, value: string) =>
  ({
    type: 'capability.response',
    version: 1,
    requestId,
    sourceDeviceId: 'desktop',
    targetDeviceId: 'phone-a',
    ok: true,
    result: { value },
  }) as any;

describe('device mesh response cache', () => {
  test('is byte-bounded and duplicate keys do not amplify retained responses', () => {
    let now = 1_000;
    const cache = new DeviceMeshResponseCache({
      maxBytes: 700,
      maxEntryBytes: 400,
      ttlMs: 60_000,
      now: () => now,
    });
    const first = response('one', 'x'.repeat(180));
    expect(
      cache.set({
        key: 'phone-a:one',
        deviceId: 'phone-a',
        requestExpiresAt: now + 120_000,
        fingerprint: 'first',
        response: first,
      }),
    ).toBe(true);
    const retainedBytes = cache.byteSize;
    for (let index = 0; index < 50; index += 1) {
      expect(
        cache.set({
          key: 'phone-a:one',
          deviceId: 'phone-a',
          requestExpiresAt: now + 120_000,
          fingerprint: `repeat-${index}`,
          response: first,
        }),
      ).toBe(true);
    }
    expect(cache.size).toBe(1);
    expect(cache.byteSize).toBe(retainedBytes);

    expect(
      cache.set({
        key: 'phone-a:bulk',
        deviceId: 'phone-a',
        requestExpiresAt: now + 120_000,
        fingerprint: 'bulk',
        response: response('bulk', 'z'.repeat(500)),
      }),
    ).toBe(false);
    expect(cache.byteSize).toBeLessThanOrEqual(700);
    now += 60_001;
    expect(cache.size).toBe(0);
    cache.clear();
  });

  test('expires no later than the request and purges every response for a device', () => {
    let now = 5_000;
    const cache = new DeviceMeshResponseCache({ now: () => now });
    for (const [deviceId, requestId] of [
      ['phone-a', 'one'],
      ['phone-a', 'two'],
      ['phone-b', 'three'],
    ] as const) {
      cache.set({
        key: `${deviceId}:${requestId}`,
        deviceId,
        requestExpiresAt: now + (requestId === 'one' ? 20 : 120_000),
        fingerprint: requestId,
        response: response(requestId, requestId),
      });
    }
    now += 21;
    expect(cache.get('phone-a:one')).toBeUndefined();
    cache.deleteDevice('phone-a');
    expect(cache.get('phone-a:two')).toBeUndefined();
    expect(cache.get('phone-b:three')).toBeDefined();
    cache.clear();
  });
});
