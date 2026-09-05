import {
  canonicalJson,
  capabilityRequestSigningText,
  isGranted,
  DEVICE_HTTP_MAX_JSON_BYTES,
  parseSignedCapabilityRequest,
  type CapabilityDescriptor,
  type CapabilityResponse,
  type MeshDevice,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { sha256 } from '@noble/hashes/sha2.js';
import type { MobileDeviceIdentity } from '../security/device-identity';
import { verifyP256Signature } from '../security/p256-signature';

export type MobileCapabilityHandler = (
  operation: string,
  payload: unknown,
  context: { sourceDevice: MeshDevice; requestId: string; signal?: AbortSignal },
) => Promise<unknown>;

export type RegisteredMobileCapability = {
  descriptor: CapabilityDescriptor;
  invoke: MobileCapabilityHandler;
};

const RESPONSE_CACHE_MS = 5 * 60_000;
const encoder = new TextEncoder();

function serializedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function requestFingerprint(request: SignedCapabilityRequest): string {
  return [...sha256(encoder.encode(canonicalJson(request)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function errorResponse(
  identity: MobileDeviceIdentity,
  request: Partial<SignedCapabilityRequest>,
  code: string,
  message: string,
): CapabilityResponse {
  return {
    type: 'capability.response',
    version: 1,
    requestId: String(request.requestId ?? ''),
    sourceDeviceId: identity.id,
    targetDeviceId: String(request.sourceDeviceId ?? ''),
    ok: false,
    error: { code, message },
  };
}

/**
 * Phone-local capabilities are controlled by the devices the phone has paired as administrators.
 * Explicit grants still work for non-administrator devices and remain the server-side policy.
 */
export function mobileCapabilityGranted(
  source: MeshDevice,
  request: Pick<SignedCapabilityRequest, 'capability' | 'capabilityVersion' | 'operation'>,
): boolean {
  return (
    isGranted(source.grants, request.capability, request.capabilityVersion, request.operation) ||
    (source.administrator && request.capability === 'drone-control')
  );
}

export class MobileCapabilityRouter {
  authorized(
    request: Pick<
      SignedCapabilityRequest,
      'sourceDeviceId' | 'capability' | 'capabilityVersion' | 'operation'
    >,
  ): boolean {
    const source = this.devices().find((device) => device.id === request.sourceDeviceId);
    return Boolean(source && !source.revokedAt && mobileCapabilityGranted(source, request));
  }
  private readonly replay = new Map<string, number>();
  private readonly responses = new Map<
    string,
    { expires: number; fingerprint: string; response: CapabilityResponse }
  >();

  constructor(
    private readonly identity: MobileDeviceIdentity,
    private readonly devices: () => readonly MeshDevice[],
    private readonly capability: (id: string) => RegisteredMobileCapability | undefined,
    private readonly acceptRequest?: (request: SignedCapabilityRequest) => Promise<boolean>,
  ) {}

  async handle(value: unknown, signal?: AbortSignal): Promise<CapabilityResponse | null> {
    if (!value || typeof value !== 'object' || (value as any).type !== 'capability.request') {
      return null;
    }

    let request: SignedCapabilityRequest;
    try {
      request = parseSignedCapabilityRequest(value);
    } catch (error: any) {
      return errorResponse(
        this.identity,
        value as Partial<SignedCapabilityRequest>,
        'INVALID_REQUEST',
        error?.message ?? 'invalid request',
      );
    }

    const now = Date.now();
    for (const [key, expiry] of this.replay) if (expiry <= now) this.replay.delete(key);
    for (const [key, cached] of this.responses)
      if (cached.expires <= now) this.responses.delete(key);

    if (request.targetDeviceId !== this.identity.id) {
      return errorResponse(
        this.identity,
        request,
        'INVALID_TARGET',
        'request targets another device',
      );
    }

    const responseKey = `${request.sourceDeviceId}:${request.requestId}`;
    const fingerprint = requestFingerprint(request);

    const source = this.devices().find((device) => device.id === request.sourceDeviceId);
    if (!source || source.revokedAt) {
      return errorResponse(this.identity, request, 'DEVICE_REVOKED', 'source device is not active');
    }
    const issued = Date.parse(request.issuedAt);
    const expires = Date.parse(request.expiresAt);
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      issued > now + 30_000 ||
      expires < now ||
      expires - issued > 120_000
    ) {
      return errorResponse(
        this.identity,
        request,
        'REQUEST_EXPIRED',
        'request timestamp is outside the allowed window',
      );
    }
    const replayKey = `${source.id}:${request.nonce}`;

    const { signature, ...unsigned } = request;
    if (!verifyP256Signature(source.publicKey, capabilityRequestSigningText(unsigned), signature)) {
      return errorResponse(
        this.identity,
        request,
        'INVALID_SIGNATURE',
        'request signature is invalid',
      );
    }

    const registered = this.capability(request.capability);
    if (
      !registered ||
      registered.descriptor.version !== request.capabilityVersion ||
      !registered.descriptor.operations.includes(request.operation)
    ) {
      return errorResponse(
        this.identity,
        request,
        'CAPABILITY_UNAVAILABLE',
        'this capability is not available on the phone',
      );
    }
    if (!mobileCapabilityGranted(source, request)) {
      return errorResponse(
        this.identity,
        request,
        'PERMISSION_DENIED',
        'this device is not allowed to use that phone capability',
      );
    }

    const cached = this.responses.get(responseKey);
    if (cached) {
      return cached.fingerprint === fingerprint
        ? cached.response
        : errorResponse(
            this.identity,
            request,
            'DUPLICATE_REQUEST_ID',
            'request id was already used with different request data',
          );
    }

    if ((this.replay.get(replayKey) ?? 0) > now) {
      return errorResponse(
        this.identity,
        request,
        'REPLAYED_REQUEST',
        'request nonce was already used',
      );
    }
    this.replay.set(replayKey, expires);
    let response: CapabilityResponse;
    try {
      signal?.throwIfAborted();
      if (
        !/\.(list|read|stat|search|preview|models|status|poll)$/.test(request.operation) &&
        this.acceptRequest &&
        !(await this.acceptRequest(request))
      ) {
        return errorResponse(
          this.identity,
          request,
          'REQUEST_OUTCOME_UNKNOWN',
          'This request was already accepted. Refresh its result; it will not be executed again.',
        );
      }
      const result = await registered.invoke(request.operation, request.payload, {
        sourceDevice: source,
        requestId: request.requestId,
        signal,
      });
      signal?.throwIfAborted();
      if (!this.authorized(request))
        return errorResponse(
          this.identity,
          request,
          'PERMISSION_DENIED',
          'Phone access changed while the request was running',
        );
      response = {
        type: 'capability.response',
        version: 1,
        requestId: request.requestId,
        sourceDeviceId: this.identity.id,
        targetDeviceId: source.id,
        ok: true,
        result,
      };
      if (serializedBytes(response) > DEVICE_HTTP_MAX_JSON_BYTES) {
        response = errorResponse(
          this.identity,
          request,
          'RESPONSE_TOO_LARGE',
          'phone response is too large; request a smaller page',
        );
      }
    } catch (error: any) {
      response = errorResponse(
        this.identity,
        request,
        String(error?.code ?? 'OPERATION_FAILED'),
        error?.message ?? String(error),
      );
    }

    if (this.responses.size >= 1_000) {
      this.responses.delete(this.responses.keys().next().value as string);
    }
    this.responses.set(responseKey, {
      expires: now + RESPONSE_CACHE_MS,
      fingerprint,
      response,
    });
    return response;
  }
}
