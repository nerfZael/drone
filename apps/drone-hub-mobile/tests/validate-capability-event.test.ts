import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';
import { fromByteArray } from 'base64-js';
import { capabilityEventSigningText, type CapabilityEvent } from '@drone/device-protocol';

import { validateCapabilityEvent } from '../src/mesh/validate-capability-event';
import {
  activeDevicePublicKey,
  MobileCapabilityEventGuard,
} from '../src/mesh/mobile-capability-event-guard';

function base64Url(bytes: Uint8Array): string {
  return fromByteArray(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('mobile capability event validation', () => {
  test('accepts a signed event from an indirect source and rejects tampering or expiry', () => {
    const privateKey = p256.utils.randomSecretKey(new Uint8Array(48).fill(7));
    const publicBytes = p256.getPublicKey(privateKey, false);
    const publicKey: JsonWebKey = {
      crv: 'P-256',
      kty: 'EC',
      x: base64Url(publicBytes.slice(1, 33)),
      y: base64Url(publicBytes.slice(33, 65)),
    };
    const now = Date.now();
    const unsigned: Omit<CapabilityEvent, 'signature'> = {
      type: 'capability.event',
      version: 1,
      eventId: '12345678-1234-1234-1234-123456789abc',
      sourceDeviceId: 'remote-source',
      targetDeviceId: 'phone',
      capability: 'drone-control',
      capabilityVersion: 1,
      event: 'chat.changed',
      payload: { droneId: 'drone', chatName: 'default' },
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      maxHops: 1,
    };
    const event: CapabilityEvent = {
      ...unsigned,
      signature: base64Url(
        p256.sign(new TextEncoder().encode(capabilityEventSigningText(unsigned)), privateKey),
      ),
    };
    const options = {
      targetDeviceId: 'phone',
      devicePublicKeyFor: (deviceId: string) =>
        deviceId === event.sourceDeviceId ? publicKey : undefined,
      now,
    };

    expect(validateCapabilityEvent(event, options)).toEqual(event);
    expect(validateCapabilityEvent({ ...event, payload: { changed: true } }, options)).toBeNull();
    const sign = (nextUnsigned: Omit<CapabilityEvent, 'signature'>): CapabilityEvent => ({
      ...nextUnsigned,
      signature: base64Url(
        p256.sign(new TextEncoder().encode(capabilityEventSigningText(nextUnsigned)), privateKey),
      ),
    });
    for (const [capability, eventName, payload] of [
      ['drone-control', 'drones.changed', { reason: 'registry_write' }],
      ['drone-control', 'file.changed', { droneId: 'drone', path: '/work/file.txt' }],
      ['companion', 'run.event', { runId: 'run', type: 'assistant_message' }],
    ] as const) {
      expect(
        validateCapabilityEvent(
          sign({ ...unsigned, capability, event: eventName, payload }),
          options,
        ),
      ).not.toBeNull();
    }
    expect(
      validateCapabilityEvent(
        sign({ ...unsigned, payload: { text: 'x'.repeat(9 * 1024) } }),
        options,
      ),
    ).toBeNull();
    expect(
      validateCapabilityEvent(
        sign({
          ...unsigned,
          issuedAt: new Date(now + 30_001).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
        }),
        options,
      ),
    ).toBeNull();
    expect(
      validateCapabilityEvent(event, { ...options, devicePublicKeyFor: () => undefined }),
    ).toBeNull();
    expect(
      validateCapabilityEvent(event, { ...options, now: Date.parse(event.expiresAt) }),
    ).toBeNull();
    expect(
      validateCapabilityEvent(event, {
        ...options,
        devicePublicKeyFor: (deviceId) =>
          activeDevicePublicKey(
            [
              {
                id: event.sourceDeviceId,
                name: 'revoked source',
                platform: 'desktop',
                publicKey,
                administrator: false,
                grants: [],
                endpoints: [],
                revokedAt: new Date(now).toISOString(),
                addedAt: new Date(now).toISOString(),
                updatedAt: new Date(now).toISOString(),
              },
            ],
            deviceId,
          ),
      }),
    ).toBeNull();
  });

  test('keeps live replay markers when more than 4,096 signed events arrive', () => {
    const privateKey = p256.utils.randomSecretKey(new Uint8Array(48).fill(11));
    const publicBytes = p256.getPublicKey(privateKey, false);
    const publicKey: JsonWebKey = {
      crv: 'P-256',
      kty: 'EC',
      x: base64Url(publicBytes.slice(1, 33)),
      y: base64Url(publicBytes.slice(33, 65)),
    };
    const issuedAt = 10_000;
    let receiverNow = issuedAt;
    const guard = new MobileCapabilityEventGuard({
      now: () => receiverNow,
      maxRelayEventsPerMinute: 5_000,
      maxSourceEventsPerMinute: 600,
      maxAcceptedEventsPerMinute: 5_000,
      maxReplayEntries: 4_096,
    });
    const signedEvents: CapabilityEvent[] = [];
    for (let index = 0; index < 4_097; index += 1) {
      const unsigned: Omit<CapabilityEvent, 'signature'> = {
        type: 'capability.event',
        version: 1,
        eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        sourceDeviceId: `source-${index % 200}`,
        targetDeviceId: 'phone',
        capability: 'drone-control',
        capabilityVersion: 1,
        event: 'chat.changed',
        payload: { droneId: 'drone', chatName: 'default' },
        issuedAt: new Date(issuedAt + 30_000).toISOString(),
        expiresAt: new Date(issuedAt + 90_000).toISOString(),
        maxHops: 1,
      };
      const signed = {
        ...unsigned,
        signature: base64Url(
          p256.sign(new TextEncoder().encode(capabilityEventSigningText(unsigned)), privateKey),
        ),
      } satisfies CapabilityEvent;
      const validated = validateCapabilityEvent(signed, {
        targetDeviceId: 'phone',
        devicePublicKeyFor: () => publicKey,
        now: receiverNow,
      });
      if (!validated) throw new Error(`signed event ${index} did not validate`);
      signedEvents.push(signed);
      if (guard.inspectEnvelope('relay', signed) !== 'accept') {
        throw new Error(`signed event ${index} failed transport admission`);
      }
      const decision = guard.acceptValidated('relay', validated);
      if (decision !== (index < 4_096 ? 'accept' : 'drop')) {
        throw new Error(`signed event ${index} had unexpected replay admission: ${decision}`);
      }
    }

    receiverNow = issuedAt + 60_001;
    const first = validateCapabilityEvent(signedEvents[0], {
      targetDeviceId: 'phone',
      devicePublicKeyFor: () => publicKey,
      now: receiverNow,
    });
    expect(first).not.toBeNull();
    expect(guard.inspectEnvelope('relay', first)).toBe('accept');
    expect(guard.acceptValidated('relay', first!)).toBe('drop');
    expect(guard.acceptValidated('source-0', first!)).toBe('drop');
  }, 15_000);
});
