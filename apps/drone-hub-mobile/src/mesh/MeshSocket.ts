import * as Crypto from 'expo-crypto';
import {
  capabilityRequestSigningText,
  socketAuthSigningText,
  socketServerAuthSigningText,
  type CapabilityResponse,
  type CapabilityEvent,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import type { MobileDeviceIdentity } from '../security/device-identity';
import { verifyP256Signature } from '../security/device-identity';
import type { MeshConnection } from './mesh-storage';

function websocketUrl(endpoint: string, deviceId: string): string {
  const url = new URL(endpoint);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/device-mesh/ws';
  url.search = `deviceId=${encodeURIComponent(deviceId)}`;
  return url.toString();
}

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  targetDeviceId: string;
};

export class MeshSocket {
  private socket: WebSocket | null = null;
  private ready = false;
  private pending = new Map<string, PendingRequest>();
  private connectPromise: Promise<void> | null = null;

  constructor(
    readonly connection: MeshConnection,
    private readonly networkId: string,
    private readonly identity: MobileDeviceIdentity,
    private readonly peerPublicKey: JsonWebKey,
    private readonly onState: () => void,
    private readonly onTopologyChange: () => void,
    private readonly onCapabilityEvent: (event: CapabilityEvent) => void,
  ) {}

  get connected(): boolean {
    return this.ready;
  }

  async connect(): Promise<void> {
    if (this.ready) return;
    if (this.connectPromise) return await this.connectPromise;
    const attempt = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(websocketUrl(this.connection.endpoint, this.identity.id));
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Connection timed out'));
      }, 12_000);
      socket.onmessage = (event) => {
        void this.handleMessage(String(event.data), resolve, reject, timeout).catch((error) => {
          clearTimeout(timeout);
          socket.close();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Could not reach ${this.connection.endpoint}`));
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (this.socket !== socket) {
          reject(new Error('Device connection was replaced'));
          return;
        }
        this.socket = null;
        const closedBeforeReady = !this.ready;
        this.ready = false;
        this.onState();
        this.rejectPending('Device connection closed');
        if (closedBeforeReady) reject(new Error('Device connection closed during authentication'));
      };
    });
    this.connectPromise = attempt;
    try {
      await attempt;
    } finally {
      if (this.connectPromise === attempt) this.connectPromise = null;
    }
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.rejectPending('Device connection closed');
    socket?.close();
  }

  async request(
    targetDeviceId: string,
    capability: string,
    operation: string,
    payload: unknown,
  ): Promise<unknown> {
    const socket = this.socket;
    if (!this.ready || !socket || socket.readyState !== WebSocket.OPEN)
      throw new Error('No mesh connection is available');
    const issuedAt = new Date();
    const unsigned: Omit<SignedCapabilityRequest, 'signature'> = {
      type: 'capability.request',
      version: 1,
      requestId: Crypto.randomUUID(),
      sourceDeviceId: this.identity.id,
      targetDeviceId,
      capability,
      capabilityVersion: 1,
      operation,
      payload,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
      nonce: Crypto.getRandomBytes(18).reduce(
        (text, byte) => `${text}${byte.toString(16).padStart(2, '0')}`,
        '',
      ),
      maxHops: 1,
    };
    const request: SignedCapabilityRequest = {
      ...unsigned,
      signature: await this.identity.sign(capabilityRequestSigningText(unsigned)),
    };
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId);
        reject(new Error('The target did not respond in time'));
      }, 30_000);
      this.pending.set(request.requestId, { resolve, reject, timer, targetDeviceId });
      try {
        socket.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(request.requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async handleMessage(
    raw: string,
    resolveConnect: () => void,
    rejectConnect: (error: Error) => void,
    connectTimer: ReturnType<typeof setTimeout>,
  ): Promise<void> {
    const message = JSON.parse(raw);
    if (message.type === 'auth.challenge') {
      if (
        message.deviceId !== this.connection.deviceId ||
        !verifyP256Signature(
          this.peerPublicKey,
          socketServerAuthSigningText(
            this.connection.deviceId,
            this.identity.id,
            String(message.nonce),
          ),
          String(message.signature ?? ''),
        )
      )
        throw new Error('Connected device identity changed');
      this.socket?.send(
        JSON.stringify({
          type: 'auth.response',
          deviceId: this.identity.id,
          signature: await this.identity.sign(
            socketAuthSigningText(this.identity.id, String(message.nonce)),
          ),
        }),
      );
      return;
    }
    if (message.type === 'auth.ready') {
      clearTimeout(connectTimer);
      if (message.networkId !== this.networkId || message.deviceId !== this.connection.deviceId) {
        this.socket?.close();
        rejectConnect(new Error('The remote device belongs to a different mesh'));
        return;
      }
      this.ready = true;
      this.onState();
      resolveConnect();
      return;
    }
    if (message.type === 'auth.error') {
      throw new Error(String(message.message ?? 'Device authentication failed'));
    }
    if (
      message.type === 'mesh.membership' ||
      message.type === 'mesh.route' ||
      message.type === 'mesh.revocation'
    ) {
      this.onTopologyChange();
      return;
    }
    if (message.type === 'capability.event') {
      if (
        message.version === 1 &&
        message.sourceDeviceId === this.connection.deviceId &&
        typeof message.capability === 'string' &&
        typeof message.event === 'string'
      )
        this.onCapabilityEvent(message as CapabilityEvent);
      return;
    }
    if (message.type !== 'capability.response') return;
    const response = message as CapabilityResponse;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    if (
      response.sourceDeviceId !== pending.targetDeviceId ||
      response.targetDeviceId !== this.identity.id
    )
      return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    if (response.ok) pending.resolve(response.result);
    else
      pending.reject(
        Object.assign(new Error(response.error?.message ?? 'Operation failed'), {
          code: response.error?.code ?? 'OPERATION_FAILED',
        }),
      );
  }

  private rejectPending(message: string): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }
}
