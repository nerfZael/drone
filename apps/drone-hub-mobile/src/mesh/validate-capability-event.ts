import {
  capabilityEventPolicy,
  capabilityEventSigningText,
  type CapabilityEvent,
} from '@drone/device-protocol';

import { verifyP256Signature } from '../security/p256-signature';

export function validateCapabilityEvent(
  value: unknown,
  input: {
    targetDeviceId: string;
    devicePublicKeyFor(deviceId: string): JsonWebKey | undefined;
    now?: number;
  },
): CapabilityEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as CapabilityEvent;
  const policy = capabilityEventPolicy(String(event.capability ?? ''), String(event.event ?? ''));
  let payloadBytes = Number.POSITIVE_INFINITY;
  let eventBytes = Number.POSITIVE_INFINITY;
  try {
    payloadBytes = new TextEncoder().encode(JSON.stringify(event.payload)).length;
    eventBytes = new TextEncoder().encode(JSON.stringify(event)).length;
  } catch {
    return null;
  }
  const now = input.now ?? Date.now();
  const issuedAt = Date.parse(String(event.issuedAt ?? ''));
  const expiresAt = Date.parse(String(event.expiresAt ?? ''));
  const sourcePublicKey = input.devicePublicKeyFor(String(event.sourceDeviceId ?? ''));
  if (
    !policy ||
    event.type !== 'capability.event' ||
    event.version !== 1 ||
    event.capabilityVersion !== 1 ||
    typeof event.eventId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.eventId) ||
    event.targetDeviceId !== input.targetDeviceId ||
    event.maxHops !== 1 ||
    !sourcePublicKey ||
    !event.payload ||
    typeof event.payload !== 'object' ||
    Array.isArray(event.payload) ||
    payloadBytes > policy.maxPayloadBytes ||
    eventBytes > policy.maxPayloadBytes + 4 * 1024 ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now + 30_000 ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > 60_000
  ) {
    return null;
  }
  const { signature, ...unsigned } = event;
  return verifyP256Signature(
    sourcePublicKey,
    capabilityEventSigningText(unsigned),
    String(signature ?? ''),
  )
    ? event
    : null;
}
