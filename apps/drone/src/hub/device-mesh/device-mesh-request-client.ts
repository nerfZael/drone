import crypto from 'node:crypto';
import { capabilityRequestSigningText, type SignedCapabilityRequest } from '@drone/device-protocol';
import { WebSocket } from 'ws';
import { signDeviceText, type LocalDeviceIdentity } from './device-identity';

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  responseWs: WebSocket;
  targetDeviceId: string;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const MAX_REQUEST_BYTES = 240 * 1024;

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

export class DeviceMeshRequestClient {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly identity: LocalDeviceIdentity,
    private readonly connectionFor: (targetDeviceId: string) => WebSocket | undefined,
  ) {}

  async request(
    targetDeviceId: string,
    capability: string,
    operation: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted)
      throw Object.assign(new Error('mesh request cancelled'), { name: 'AbortError' });
    const connection = this.connectionFor(targetDeviceId);
    if (!connection)
      throw Object.assign(new Error('no mesh route is connected'), { code: 'TARGET_OFFLINE' });

    const issuedAt = new Date();
    const unsigned: Omit<SignedCapabilityRequest, 'signature'> = {
      type: 'capability.request',
      version: 1,
      requestId: crypto.randomUUID(),
      sourceDeviceId: this.identity.id,
      targetDeviceId,
      capability,
      capabilityVersion: 1,
      operation,
      payload,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
      nonce: crypto.randomBytes(18).toString('base64url'),
      maxHops: 1,
    };
    const request: SignedCapabilityRequest = {
      ...unsigned,
      signature: signDeviceText(this.identity, capabilityRequestSigningText(unsigned)),
    };
    if (Buffer.byteLength(JSON.stringify(request)) > MAX_REQUEST_BYTES)
      throw Object.assign(new Error('mesh request is too large'), { code: 'REQUEST_TOO_LARGE' });

    return await new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        this.pending.delete(request.requestId);
        reject(Object.assign(new Error('mesh request cancelled'), { name: 'AbortError' }));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(request.requestId);
        reject(
          Object.assign(new Error('target device did not respond'), { code: 'TARGET_TIMEOUT' }),
        );
      }, 35_000);
      timer.unref?.();
      this.pending.set(request.requestId, {
        resolve,
        reject,
        timer,
        responseWs: connection,
        targetDeviceId,
        signal,
        onAbort,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      send(connection, request);
    });
  }

  acceptResponse(message: any, responseWs: WebSocket): boolean {
    const requestId = String(message?.requestId ?? '');
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    if (
      pending.responseWs !== responseWs ||
      message.sourceDeviceId !== pending.targetDeviceId ||
      message.targetDeviceId !== this.identity.id
    )
      return true;

    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.onAbort!);
    if (message.ok) pending.resolve(message.result);
    else {
      pending.reject(
        Object.assign(new Error(message.error?.message ?? 'mesh operation failed'), {
          code: message.error?.code ?? 'OPERATION_FAILED',
        }),
      );
    }
    return true;
  }

  connectionClosed(ws: WebSocket): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.responseWs !== ws) continue;
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener('abort', pending.onAbort!);
      this.pending.delete(requestId);
      pending.reject(new Error('mesh route disconnected'));
    }
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener('abort', pending.onAbort!);
      pending.reject(new Error('device mesh stopped'));
    }
    this.pending.clear();
  }
}
