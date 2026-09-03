import { describe, expect, test } from 'bun:test';
import {
  MESH_SAFE_MESSAGE_BYTES,
  type CapabilityEvent,
  type MeshDevice,
} from '@drone/device-protocol';

import {
  activeDevicePublicKey,
  meshSocketFrameIsTooLarge,
  MobileCapabilityEventGuard,
} from '../src/mesh/mobile-capability-event-guard';

function event(eventId: string, input: Partial<CapabilityEvent> = {}): CapabilityEvent {
  return {
    type: 'capability.event',
    version: 1,
    eventId,
    sourceDeviceId: 'source',
    targetDeviceId: 'phone',
    capability: 'drone-control',
    capabilityVersion: 1,
    event: 'drones.changed',
    payload: { reason: 'registry_write' },
    issuedAt: new Date(1_000).toISOString(),
    expiresAt: new Date(61_000).toISOString(),
    maxHops: 1,
    signature: 'validated-by-caller',
    ...input,
  };
}

describe('mobile capability event ingress guard', () => {
  test('suppresses replay across direct and relayed sockets until expiry', () => {
    let now = 1_000;
    const guard = new MobileCapabilityEventGuard({ now: () => now });
    const message = event('00000000-0000-4000-8000-000000000001');

    expect(guard.inspectEnvelope('source', message)).toBe('accept');
    expect(guard.acceptValidated('source', message)).toBe('accept');
    expect(guard.inspectEnvelope('relay', message)).toBe('accept');
    expect(guard.acceptValidated('relay', message)).toBe('drop');

    now = Date.parse(message.expiresAt);
    expect(
      guard.acceptValidated('relay', {
        ...message,
        expiresAt: new Date(now + 60_000).toISOString(),
      }),
    ).toBe('accept');
  });

  test('disconnects an abusive direct peer without blaming a shared relay', () => {
    const guard = new MobileCapabilityEventGuard({
      maxDirectEventsPerMinute: 2,
      maxRelayEventsPerMinute: 3,
      maxSourceEventsPerMinute: 2,
      now: () => 1_000,
    });
    expect(guard.inspectEnvelope('source', event('1'))).toBe('accept');
    expect(guard.inspectEnvelope('source', event('2'))).toBe('accept');
    expect(guard.inspectEnvelope('source', event('3'))).toBe('disconnect');

    const relayed = new MobileCapabilityEventGuard({
      maxRelayEventsPerMinute: 2,
      maxSourceEventsPerMinute: 1,
      now: () => 1_000,
    });
    const first = event('4', { sourceDeviceId: 'source-a' });
    const second = event('5', { sourceDeviceId: 'source-a' });
    expect(relayed.inspectEnvelope('relay', first)).toBe('accept');
    expect(relayed.acceptValidated('relay', first)).toBe('accept');
    expect(relayed.inspectEnvelope('relay', second)).toBe('accept');
    expect(relayed.acceptValidated('relay', second)).toBe('drop');
    expect(relayed.inspectEnvelope('relay', event('6', { sourceDeviceId: 'source-b' }))).toBe(
      'drop',
    );
  });

  test('keeps per-event limits independent and resets bounded state explicitly', () => {
    const guard = new MobileCapabilityEventGuard({
      maxDirectEventsPerMinute: 200,
      maxSourceEventsPerMinute: 200,
      now: () => 1_000,
    });
    const first = event('7', { sourceDeviceId: 'source-a', event: 'drones.changed' });
    let accepted = 0;
    for (let index = 0; index < 121; index += 1) {
      if (
        guard.acceptValidated(
          'source-a',
          event(`drones-${index}`, { sourceDeviceId: 'source-a', event: 'drones.changed' }),
        ) === 'accept'
      ) {
        accepted += 1;
      }
    }
    expect(accepted).toBe(120);
    const companion = event('8', {
      sourceDeviceId: 'source-a',
      capability: 'companion',
      event: 'run.event',
      payload: { runId: 'run' },
    });
    expect(guard.acceptValidated('source-a', companion)).toBe('accept');
    expect(guard.acceptValidated('source-a', first)).toBe('drop');
    guard.clear();
    expect(guard.acceptValidated('source-a', first)).toBe('accept');
  });

  test('keeps the production aggregate rate below live replay capacity', () => {
    let now = 1_000;
    const guard = new MobileCapabilityEventGuard({ now: () => now });
    const makeEvent = (index: number, wave: number) =>
      event(`00000000-0000-4000-8000-${String(wave * 2_000 + index).padStart(12, '0')}`, {
        sourceDeviceId: `source-${index % 200}`,
        event: 'chat.changed',
        payload: { droneId: 'drone', chatName: 'default' },
        issuedAt: new Date(now + 30_000).toISOString(),
        expiresAt: new Date(now + 90_000).toISOString(),
      });
    const first = makeEvent(0, 0);
    for (let index = 0; index < 2_000; index += 1) {
      expect(guard.acceptValidated('relay', makeEvent(index, 0))).toBe('accept');
    }
    expect(guard.acceptValidated('relay', makeEvent(2_000, 0))).toBe('drop');

    now += 60_001;
    for (let index = 0; index < 2_000; index += 1) {
      expect(guard.acceptValidated('relay', makeEvent(index, 1))).toBe('accept');
    }
    expect((guard as any).seen.size).toBe(4_000);
    expect(guard.acceptValidated('relay', first)).toBe('drop');
  });

  test('rejects revoked keys and oversized frames at exact byte boundaries', () => {
    const key = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' };
    const base = {
      id: 'source',
      name: 'source',
      platform: 'desktop',
      publicKey: key,
      administrator: false,
      grants: [],
      endpoints: [],
      addedAt: '',
      updatedAt: '',
    } satisfies Omit<MeshDevice, 'revokedAt'>;
    expect(activeDevicePublicKey([{ ...base, revokedAt: null }], 'source')).toBe(key);
    expect(activeDevicePublicKey([{ ...base, revokedAt: 'now' }], 'source')).toBeUndefined();
    expect(activeDevicePublicKey([{ ...base, revokedAt: null }], 'unknown')).toBeUndefined();

    expect(meshSocketFrameIsTooLarge('x'.repeat(MESH_SAFE_MESSAGE_BYTES))).toBe(false);
    expect(meshSocketFrameIsTooLarge('x'.repeat(MESH_SAFE_MESSAGE_BYTES + 1))).toBe(true);
  });
});
