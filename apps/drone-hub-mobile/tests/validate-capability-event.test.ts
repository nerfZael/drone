import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';
import { fromByteArray } from 'base64-js';
import { capabilityEventSigningText, type CapabilityEvent } from '@drone/device-protocol';

import { validateCapabilityEvent } from '../src/mesh/validate-capability-event';

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
    expect(
      validateCapabilityEvent(event, { ...options, now: Date.parse(event.expiresAt) }),
    ).toBeNull();
  });
});
