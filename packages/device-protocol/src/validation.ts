import type { PairingPayload, SignedCapabilityRequest } from './types';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${label} is invalid`);
  return value.trim();
}

export function parsePairingPayload(value: unknown): PairingPayload {
  const input = object(value, 'pairing payload');
  if (input.version !== 1) throw new Error('unsupported pairing version');
  const endpoint = text(input.endpoint, 'pairing endpoint', 2048).replace(/\/+$/, '');
  const parsed = new URL(endpoint);
  const loopbackHttp =
    parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('pairing endpoint must use HTTPS');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== '/')
  ) {
    throw new Error('pairing endpoint must be an origin without credentials or a path');
  }
  return {
    version: 1,
    endpoint,
    token: text(input.token, 'pairing token', 300),
    inviterDeviceId: text(input.inviterDeviceId, 'inviter device id', 100),
    expiresAt: text(input.expiresAt, 'pairing expiry', 100),
  };
}

export function parseSignedCapabilityRequest(value: unknown): SignedCapabilityRequest {
  const input = object(value, 'capability request');
  if (input.type !== 'capability.request' || input.version !== 1)
    throw new Error('unsupported capability request');
  if (input.maxHops !== 1) throw new Error('maxHops must be 1');
  return {
    type: 'capability.request',
    version: 1,
    requestId: text(input.requestId, 'request id', 100),
    sourceDeviceId: text(input.sourceDeviceId, 'source device id', 100),
    targetDeviceId: text(input.targetDeviceId, 'target device id', 100),
    capability: text(input.capability, 'capability', 100),
    capabilityVersion: Number(input.capabilityVersion),
    operation: text(input.operation, 'operation', 150),
    payload: input.payload,
    issuedAt: text(input.issuedAt, 'issued at', 100),
    expiresAt: text(input.expiresAt, 'expires at', 100),
    nonce: text(input.nonce, 'nonce', 200),
    maxHops: 1,
    signature: text(input.signature, 'signature', 1000),
  };
}
