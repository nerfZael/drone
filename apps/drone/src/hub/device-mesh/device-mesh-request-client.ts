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
};

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
  ): Promise<unknown> {
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

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
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
      });
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
      this.pending.delete(requestId);
      pending.reject(new Error('mesh route disconnected'));
    }
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('device mesh stopped'));
    }
    this.pending.clear();
  }
}
