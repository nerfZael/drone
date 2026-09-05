import { fetch as expoFetch } from 'expo/fetch';
import { DeviceHttpEventClient } from '@drone/device-protocol';
import * as Crypto from 'expo-crypto';
import {
  DeviceReadClientCache,
  capabilityRequestSigningText,
  DEVICE_HTTP_MAX_JSON_BYTES,
  socketAuthSigningText,
  socketServerAuthSigningText,
  type CapabilityResponse,
  type CapabilityEvent,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import type { MobileDeviceIdentity } from '../security/device-identity';
import { verifyP256Signature } from '../security/device-identity';
import type { MeshConnection } from './mesh-storage';
import type { MobileCapabilityRouter } from './mobile-capability-router';
import {
  meshSocketFrameIsTooLarge,
  type MobileCapabilityEventGuard,
} from './mobile-capability-event-guard';
import { validateCapabilityEvent } from './validate-capability-event';

type PendingRequest = {
  decode(value: unknown): unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  targetDeviceId: string;
  signal?: AbortSignal;
  onAbort?: () => void;
  capability: string;
  operation: string;
  payload: unknown;
};

const MESH_REQUEST_TIMEOUT_MS = 40_000;

export class MeshSession {
  private readonly readCache = new DeviceReadClientCache();
  private socket: DeviceHttpEventClient | null = null;
  private ready = false;
  private pending = new Map<string, PendingRequest>();
  private connectPromise: Promise<void> | null = null;
  private lastEventId = '';
  private readonly reverseRequests = new Map<
    string,
    { session: DeviceHttpEventClient; controller: AbortController }
  >();

  constructor(
    connection: MeshConnection,
    private readonly networkId: string,
    private readonly identity: MobileDeviceIdentity,
    private readonly peerPublicKey: JsonWebKey,
    private readonly devicePublicKeyFor: (deviceId: string) => JsonWebKey | undefined,
    private readonly onState: () => void,
    private readonly onTopologyChange: () => void,
    private readonly onCapabilityEvent: (event: CapabilityEvent) => void,
    private readonly capabilityRouter: Pick<MobileCapabilityRouter, 'handle'> &
      Partial<Pick<MobileCapabilityRouter, 'authorized'>>,
    private readonly capabilityEventGuard: MobileCapabilityEventGuard,
  ) {
    this.connection = connection;
  }

  connection: MeshConnection;

  updateConnection(connection: MeshConnection): void {
    if (connection.deviceId !== this.connection.deviceId) {
      throw new Error('Cannot move a mesh socket to another device');
    }
    this.connection = connection;
  }

  get connected(): boolean {
    return this.ready;
  }

  async connect(): Promise<void> {
    if (this.ready) return;
    if (this.connectPromise) return await this.connectPromise;
    const attempt = new Promise<void>((resolve, reject) => {
      const socket = new DeviceHttpEventClient(
        this.connection.endpoint,
        this.identity.id,
        expoFetch as unknown as typeof fetch,
        this.lastEventId,
      );
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Connection timed out'));
      }, 12_000);
      socket.onmessage = (event) => {
        void this.handleMessage(String(event.data), resolve, reject, timeout, socket).catch(
          (error) => {
            clearTimeout(timeout);
            socket.close();
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Could not reach ${this.connection.endpoint}`));
      };
      socket.onclose = () => {
        this.lastEventId = socket.lastEventId;
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
    if (socket) this.lastEventId = socket.lastEventId;
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
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) throw meshRequestCancelledError();
    const socket = this.socket;
    if (!this.ready || !socket || socket.readyState !== DeviceHttpEventClient.OPEN)
      throw new Error('No mesh connection is available');
    const read = this.readCache.prepare(targetDeviceId, capability, operation, payload);
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
      payload: read.payload,
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
    // Signing can yield to the native key store. Do not miss an abort that arrives before the
    // pending-request listener can be installed.
    if (signal?.aborted) throw meshRequestCancelledError();
    if (!this.ready || this.socket !== socket || socket.readyState !== DeviceHttpEventClient.OPEN) {
      throw new Error('Mesh connection changed while the request was being signed');
    }
    const serialized = JSON.stringify(request);
    const requestBytes =
      typeof TextEncoder === 'undefined'
        ? serialized.length * 3
        : new TextEncoder().encode(serialized).byteLength;
    if (requestBytes > DEVICE_HTTP_MAX_JSON_BYTES) throw new Error('Mesh request is too large');
    return await new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(meshRequestCancelledError());
        return;
      }
      const onAbort = () => {
        try {
          socket.send(
            JSON.stringify({
              type: 'capability.cancel',
              sourceDeviceId: this.identity.id,
              targetDeviceId,
              requestId: request.requestId,
            }),
          );
        } catch {
          /* Closed session. */
        }
        clearTimeout(timer);
        this.pending.delete(request.requestId);
        reject(meshRequestCancelledError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(request.requestId);
        reject(new Error('Target device did not respond in time.'));
      }, MESH_REQUEST_TIMEOUT_MS);
      this.pending.set(request.requestId, {
        decode: read.decode,
        resolve,
        reject,
        timer,
        targetDeviceId,
        signal,
        onAbort,
        capability,
        operation,
        payload,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        socket.send(serialized);
      } catch (error) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
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
    sourceSocket: DeviceHttpEventClient | null = this.socket,
  ): Promise<void> {
    if (!sourceSocket || this.socket !== sourceSocket) return;
    if (new TextEncoder().encode(raw).byteLength > DEVICE_HTTP_MAX_JSON_BYTES) {
      sourceSocket.close(1009, 'mesh message is too large');
      return;
    }
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
      const signature = await this.identity.sign(
        socketAuthSigningText(this.identity.id, String(message.nonce)),
      );
      if (this.socket !== sourceSocket || sourceSocket.readyState !== DeviceHttpEventClient.OPEN)
        return;
      sourceSocket.send(
        JSON.stringify({
          type: 'auth.response',
          deviceId: this.identity.id,
          signature,
        }),
      );
      return;
    }
    if (message.type === 'auth.ready') {
      clearTimeout(connectTimer);
      if (message.networkId !== this.networkId || message.deviceId !== this.connection.deviceId) {
        sourceSocket.close();
        rejectConnect(new Error('The remote device belongs to a different mesh'));
        return;
      }
      this.ready = true;
      this.onState();
      this.onTopologyChange();
      resolveConnect();
      return;
    }
    if (message.type === 'auth.error') {
      throw new Error(String(message.message ?? 'Device authentication failed'));
    }
    if (
      message.type === 'stream.reset' ||
      message.type === 'mesh.membership' ||
      message.type === 'mesh.route' ||
      message.type === 'mesh.revocation'
    ) {
      this.onTopologyChange();
      return;
    }
    if (message.type === 'capability.event') {
      const envelopeDecision = this.capabilityEventGuard.inspectEnvelope(
        this.connection.deviceId,
        message,
      );
      if (envelopeDecision === 'disconnect') {
        sourceSocket.close(4008, 'capability event rate limit reached');
        return;
      }
      if (envelopeDecision === 'drop') return;
      const event = validateCapabilityEvent(message, {
        targetDeviceId: this.identity.id,
        devicePublicKeyFor: this.devicePublicKeyFor,
      });
      if (!event) return;
      const eventDecision = this.capabilityEventGuard.acceptValidated(
        this.connection.deviceId,
        event,
      );
      if (eventDecision === 'disconnect') {
        sourceSocket.close(4008, 'capability event rate limit reached');
        return;
      }
      if (eventDecision === 'accept') this.onCapabilityEvent(event);
      return;
    }
    if (message.type === 'capability.cancel') {
      const pending = this.reverseRequests.get(`${message.sourceDeviceId}:${message.requestId}`);
      if (pending?.session === sourceSocket) pending.controller.abort();
      return;
    }
    if (message.type === 'capability.request') {
      const reverseKey = `${message.sourceDeviceId}:${message.requestId}`;
      if (this.reverseRequests.has(reverseKey)) return;
      if (this.reverseRequests.size >= 100) {
        sourceSocket.close(4008, 'Too many reverse requests');
        return;
      }
      const controller = new AbortController();
      this.reverseRequests.set(reverseKey, { session: sourceSocket, controller });
      const reverseSignal = sourceSocket.signal
        ? AbortSignal.any([sourceSocket.signal, controller.signal])
        : controller.signal;
      try {
        let response = await this.capabilityRouter.handle(message, reverseSignal);
        if (response?.ok && (response.result as any)?.localFileUri) {
          const result = response.result as any;
          const access = new AbortController();
          const check = () => {
            if (this.socket !== sourceSocket || !this.capabilityRouter.authorized?.(message))
              access.abort();
          };
          check();
          const policyTimer = setInterval(check, 250);
          try {
            access.signal.throwIfAborted();
            const tickets = await sourceSocket.prepareResultUpload(
              message.requestId,
              message.sourceDeviceId,
              result.preview.size,
              result.preview.revision,
            );
            const { uploadNativeFile } = await import('./native-http-upload');
            const uploaded = await uploadNativeFile(
              tickets.upload.url,
              result.localFileUri,
              {
                authorization: `Bearer ${tickets.upload.token}`,
                'content-type': 'application/octet-stream',
                'x-upload-offset': '0',
              },
              AbortSignal.any([
                access.signal,
                reverseSignal,
                AbortSignal.timeout(Math.max(1, Date.parse(message.expiresAt) - Date.now())),
              ]),
            );
            if (uploaded.offset !== result.preview.size)
              throw new Error('Phone preview upload is incomplete');
            response = {
              ...response,
              result: { preview: result.preview, transfer: tickets.download },
            };
          } catch (error: any) {
            response = {
              ...response,
              ok: false,
              error: {
                code: 'TRANSFER_FAILED',
                message: error?.message ?? 'Phone preview upload failed',
              },
            };
            delete (response as any).result;
          } finally {
            clearInterval(policyTimer);
          }
        }
        if (
          response &&
          this.socket === sourceSocket &&
          sourceSocket.readyState === DeviceHttpEventClient.OPEN
        ) {
          const serialized = JSON.stringify(response);
          const responseBytes =
            typeof TextEncoder === 'undefined'
              ? serialized.length * 3
              : new TextEncoder().encode(serialized).byteLength;
          if (responseBytes <= DEVICE_HTTP_MAX_JSON_BYTES) sourceSocket.send(serialized);
        }
      } finally {
        this.reverseRequests.delete(reverseKey);
      }
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
    pending.signal?.removeEventListener('abort', pending.onAbort!);
    this.pending.delete(response.requestId);
    if (response.ok) {
      try {
        pending.resolve(pending.decode(response.result));
      } catch (error: any) {
        this.readCache.clear();
        pending.reject(error);
      }
    } else
      pending.reject(
        Object.assign(new Error(response.error?.message ?? 'Operation failed'), {
          code: response.error?.code ?? 'OPERATION_FAILED',
        }),
      );
  }

  private rejectPending(message: string): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.signal?.removeEventListener('abort', request.onAbort!);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }
}

function meshRequestCancelledError(): Error {
  return Object.assign(new Error('Mesh request cancelled'), { name: 'AbortError' });
}
