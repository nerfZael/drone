import crypto from 'node:crypto';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import {
  capabilityRequestSigningText,
  isGranted,
  parseSignedCapabilityRequest,
  socketAuthSigningText,
  socketServerAuthSigningText,
  type CapabilityResponse,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { CapabilityRegistry } from './capability-registry';
import { DeviceMembershipSynchronizer } from './device-membership-synchronizer';
import { DeviceMeshAuditStore } from './device-mesh-audit-store';
import { DeviceMeshRequestClient } from './device-mesh-request-client';
import {
  signDeviceText,
  signSocketChallenge,
  type LocalDeviceIdentity,
  verifyDeviceText,
} from './device-identity';
import { DeviceMeshStore } from './device-mesh-store';
import { DeviceRouteManager } from './device-route-manager';

type AuthenticatedSocket = { ws: WebSocket; peerDeviceId: string; outbound: boolean };

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function socketUrl(endpoint: string, deviceId: string): string {
  const url = new URL(endpoint);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/device-mesh/ws';
  url.search = `deviceId=${encodeURIComponent(deviceId)}`;
  url.hash = '';
  return url.toString();
}

export class DeviceMeshRouter {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  private readonly connections = new Map<string, AuthenticatedSocket>();
  private readonly routes = new Map<
    string,
    {
      sourceWs: WebSocket;
      sourceDeviceId: string;
      targetWs: WebSocket;
      targetDeviceId: string;
      requestId: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly replay = new Map<string, number>();
  private readonly responses = new Map<
    string,
    { expires: number; fingerprint: string; response: CapabilityResponse }
  >();
  private readonly requestTimes = new Map<string, number[]>();
  private readonly connecting = new Set<string>();
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private readonly membership: DeviceMembershipSynchronizer;
  private readonly requestClient: DeviceMeshRequestClient;

  constructor(
    private readonly identity: LocalDeviceIdentity,
    private readonly store: DeviceMeshStore,
    private readonly capabilities: CapabilityRegistry,
    private readonly routeManager: DeviceRouteManager,
    private readonly audit: DeviceMeshAuditStore,
  ) {
    this.membership = new DeviceMembershipSynchronizer(identity, store);
    this.requestClient = new DeviceMeshRequestClient(identity, (targetDeviceId) => {
      const direct = this.connections.get(targetDeviceId);
      return direct?.ws ?? this.connections.values().next().value?.ws;
    });
    this.server.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
      void this.authenticateInbound(ws, request).catch(() => ws.close(1011, 'mesh unavailable'));
    });
  }

  start(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(
      () => void this.connectToKnownPeers().catch(() => undefined),
      10_000,
    );
    this.reconnectTimer.unref?.();
    void this.connectToKnownPeers().catch(() => undefined);
  }

  close(): void {
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const connection of this.connections.values()) connection.ws.close();
    this.connections.clear();
    this.connecting.clear();
    for (const route of this.routes.values()) clearTimeout(route.timer);
    this.routes.clear();
    this.requestClient.close();
    this.server.close();
  }

  connectedDeviceIds(): string[] {
    return [...this.connections.keys()];
  }

  handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api/device-mesh/ws') return false;
    this.server.handleUpgrade(request, socket, head, (ws) =>
      this.server.emit('connection', ws, request),
    );
    return true;
  }

  disconnect(deviceId: string): void {
    this.connections.get(deviceId)?.ws.close(4003, 'device revoked');
  }

  async announceEndpoint(endpoint: string | null): Promise<void> {
    const route = await this.routeManager.announce(endpoint);
    for (const connection of this.connections.values()) send(connection.ws, route);
  }

  async request(
    targetDeviceId: string,
    capability: string,
    operation: string,
    payload: unknown,
  ): Promise<unknown> {
    return await this.requestClient.request(targetDeviceId, capability, operation, payload);
  }

  async broadcastMembership(): Promise<void> {
    const event = await this.membership.membershipEvent();
    for (const connection of this.connections.values()) send(connection.ws, event);
  }

  async broadcastRevocation(deviceId: string): Promise<void> {
    const event = await this.membership.revocationEvent(deviceId);
    for (const connection of this.connections.values()) send(connection.ws, event);
  }

  async broadcastCapabilityEvent(
    capability: string,
    event: string,
    payload: Record<string, any>,
    requiredOperation: string,
  ): Promise<void> {
    const state = await this.store.read();
    const message = {
      type: 'capability.event',
      version: 1,
      sourceDeviceId: this.identity.id,
      capability,
      capabilityVersion: 1,
      event,
      payload,
      issuedAt: new Date().toISOString(),
    } as const;
    for (const connection of this.connections.values()) {
      const peer = state.devices[connection.peerDeviceId];
      if (peer && !peer.revokedAt && isGranted(peer.grants, capability, 1, requiredOperation))
        send(connection.ws, message);
    }
  }

  private async authenticateInbound(ws: WebSocket, request: http.IncomingMessage): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const requestedDeviceId = String(url.searchParams.get('deviceId') ?? '').trim();
    const state = await this.store.read();
    const device = state.devices[requestedDeviceId];
    if (!device || device.revokedAt) {
      ws.close(4001, 'unknown device');
      return;
    }
    if (!this.connections.has(requestedDeviceId) && this.connections.size >= 100) {
      ws.close(4008, 'connection limit reached');
      return;
    }
    const nonce = crypto.randomBytes(24).toString('base64url');
    send(ws, {
      type: 'auth.challenge',
      nonce,
      deviceId: this.identity.id,
      signature: signDeviceText(
        this.identity,
        socketServerAuthSigningText(this.identity.id, requestedDeviceId, nonce),
      ),
    });
    const timeout = setTimeout(() => ws.close(4001, 'authentication timeout'), 10_000);
    ws.once('message', (raw) => {
      clearTimeout(timeout);
      try {
        const response = JSON.parse(raw.toString());
        const valid =
          response?.type === 'auth.response' &&
          response?.deviceId === requestedDeviceId &&
          verifyDeviceText(
            device.publicKey,
            socketAuthSigningText(requestedDeviceId, nonce),
            String(response?.signature ?? ''),
          );
        if (!valid) {
          ws.close(4001, 'authentication failed');
          return;
        }
        this.attach({ ws, peerDeviceId: requestedDeviceId, outbound: false });
        send(ws, {
          type: 'auth.ready',
          deviceId: this.identity.id,
          networkId: state.networkId,
          capabilities: this.capabilities.list(),
        });
      } catch {
        ws.close(4001, 'authentication failed');
      }
    });
  }

  private attach(connection: AuthenticatedSocket): void {
    const existing = this.connections.get(connection.peerDeviceId);
    const prefersOutbound = this.identity.id < connection.peerDeviceId;
    const preferred = connection.outbound === prefersOutbound;
    if (existing && existing.ws !== connection.ws) {
      const existingPreferred = existing.outbound === prefersOutbound;
      if (existingPreferred && !preferred) {
        connection.ws.close(4000, 'duplicate');
        return;
      }
      existing.ws.close(4000, 'replaced');
    }
    this.connections.set(connection.peerDeviceId, connection);
    connection.ws.on('message', (raw) => {
      void this.onMessage(connection, raw).catch(() =>
        connection.ws.close(1011, 'mesh processing failed'),
      );
    });
    connection.ws.on('close', () => {
      if (this.connections.get(connection.peerDeviceId)?.ws === connection.ws)
        this.connections.delete(connection.peerDeviceId);
      for (const [requestId, route] of this.routes) {
        if (route.sourceWs !== connection.ws && route.targetWs !== connection.ws) continue;
        clearTimeout(route.timer);
        this.routes.delete(requestId);
        if (route.targetWs === connection.ws && route.sourceWs !== connection.ws) {
          send(
            route.sourceWs,
            this.errorResponse(
              {
                requestId: route.requestId,
                sourceDeviceId: route.sourceDeviceId,
                targetDeviceId: route.targetDeviceId,
              },
              'TARGET_OFFLINE',
              'target device disconnected',
            ),
          );
        }
      }
      this.requestClient.connectionClosed(connection.ws);
    });
    void this.broadcastMembership();
    void this.routeManager
      .list()
      .then((routes) => routes.forEach((route) => send(connection.ws, route)));
  }

  private async connectToKnownPeers(): Promise<void> {
    const state = await this.store.read();
    for (const device of Object.values(state.devices)) {
      if (
        device.id === state.selfDeviceId ||
        device.revokedAt ||
        this.connections.has(device.id) ||
        this.connecting.has(device.id) ||
        device.endpoints.length === 0
      )
        continue;
      const endpoint = device.endpoints[0];
      this.connecting.add(device.id);
      try {
        const ws = new WebSocket(socketUrl(endpoint, state.selfDeviceId));
        const authTimeout = setTimeout(() => ws.close(4001, 'authentication timeout'), 12_000);
        authTimeout.unref?.();
        ws.once('close', () => {
          clearTimeout(authTimeout);
          this.connecting.delete(device.id);
        });
        ws.once('message', (raw) => {
          try {
            const challenge = JSON.parse(raw.toString());
            if (
              challenge?.type !== 'auth.challenge' ||
              challenge?.deviceId !== device.id ||
              !verifyDeviceText(
                device.publicKey,
                socketServerAuthSigningText(device.id, state.selfDeviceId, challenge.nonce),
                String(challenge.signature ?? ''),
              )
            )
              throw new Error('invalid challenge');
            send(ws, {
              type: 'auth.response',
              deviceId: state.selfDeviceId,
              signature: signSocketChallenge(this.identity, challenge.nonce),
            });
            ws.once('message', (readyRaw) => {
              try {
                const ready = JSON.parse(readyRaw.toString());
                if (ready?.type !== 'auth.ready' || ready?.networkId !== state.networkId)
                  throw new Error('network mismatch');
                clearTimeout(authTimeout);
                this.attach({ ws, peerDeviceId: device.id, outbound: true });
              } catch {
                ws.close();
              }
            });
          } catch {
            ws.close();
          }
        });
        ws.on('error', () => ws.close());
      } catch {
        this.connecting.delete(device.id);
        // Reconnect loop will try the next time the app is reachable.
      }
    }
  }

  private async onMessage(connection: AuthenticatedSocket, raw: RawData): Promise<void> {
    let message: any;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message?.type === 'mesh.membership') {
      if (await this.membership.acceptMembership(message)) {
        for (const peer of this.connections.values()) {
          if (peer.ws !== connection.ws) send(peer.ws, message);
        }
      }
      return;
    }
    if (message?.type === 'mesh.revocation') {
      const revokedDeviceId = await this.membership.acceptRevocation(message);
      if (revokedDeviceId) {
        this.disconnect(revokedDeviceId);
        for (const peer of this.connections.values()) {
          if (peer.ws !== connection.ws) send(peer.ws, message);
        }
      }
      return;
    }
    if (message?.type === 'mesh.route') {
      try {
        if (await this.routeManager.accept(message)) {
          for (const peer of this.connections.values()) {
            if (peer.ws !== connection.ws) send(peer.ws, message);
          }
        }
      } catch {
        // Invalid route hints are ignored; the authenticated connection remains usable.
      }
      return;
    }
    if (message?.type === 'capability.response') {
      if (this.requestClient.acceptResponse(message, connection.ws)) return;
      const routeKey = `${String(message.targetDeviceId ?? '')}:${String(message.requestId ?? '')}`;
      const route = this.routes.get(routeKey);
      if (
        route &&
        route.targetWs === connection.ws &&
        message.sourceDeviceId === route.targetDeviceId &&
        message.targetDeviceId === route.sourceDeviceId
      ) {
        this.routes.delete(routeKey);
        clearTimeout(route.timer);
        send(route.sourceWs, message);
      }
      return;
    }
    if (message?.type !== 'capability.request') return;
    let request: SignedCapabilityRequest;
    try {
      request = parseSignedCapabilityRequest(message);
    } catch (error: any) {
      send(
        connection.ws,
        this.errorResponse(message, 'INVALID_REQUEST', error?.message ?? 'invalid request'),
      );
      return;
    }
    const recent = (this.requestTimes.get(connection.peerDeviceId) ?? []).filter(
      (time) => time > Date.now() - 60_000,
    );
    if (recent.length >= 120) {
      send(
        connection.ws,
        this.errorResponse(request, 'RATE_LIMITED', 'too many mesh requests from this peer'),
      );
      return;
    }
    recent.push(Date.now());
    this.requestTimes.set(connection.peerDeviceId, recent);
    const state = await this.store.read();
    if (request.targetDeviceId !== state.selfDeviceId) {
      if (request.sourceDeviceId !== connection.peerDeviceId) {
        send(
          connection.ws,
          this.errorResponse(request, 'HOP_LIMIT', 'request already used its relay hop'),
        );
        return;
      }
      const target = this.connections.get(request.targetDeviceId);
      if (!target) {
        send(
          connection.ws,
          this.errorResponse(request, 'TARGET_OFFLINE', 'target device is not connected'),
        );
        return;
      }
      if (this.routes.size >= 1_000) {
        send(
          connection.ws,
          this.errorResponse(request, 'ROUTER_BUSY', 'the forwarding table is full'),
        );
        return;
      }
      const routeKey = `${request.sourceDeviceId}:${request.requestId}`;
      if (this.routes.has(routeKey)) {
        send(
          connection.ws,
          this.errorResponse(
            request,
            'DUPLICATE_REQUEST_ID',
            'request id is already active for this source device',
          ),
        );
        return;
      }
      const timer = setTimeout(() => {
        this.routes.delete(routeKey);
        send(
          connection.ws,
          this.errorResponse(request, 'TARGET_TIMEOUT', 'target device did not respond'),
        );
      }, 35_000);
      timer.unref?.();
      this.routes.set(routeKey, {
        sourceWs: connection.ws,
        sourceDeviceId: request.sourceDeviceId,
        targetWs: target.ws,
        targetDeviceId: request.targetDeviceId,
        requestId: request.requestId,
        timer,
      });
      send(target.ws, request);
      return;
    }
    const responseKey = `${request.sourceDeviceId}:${request.requestId}`;
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const cached = this.responses.get(responseKey);
    if (cached && cached.expires > Date.now()) {
      send(
        connection.ws,
        cached.fingerprint === fingerprint
          ? cached.response
          : this.errorResponse(
              request,
              'DUPLICATE_REQUEST_ID',
              'request id was already used with different request data',
            ),
      );
      return;
    }
    const response = await this.execute(request);
    if (this.responses.size >= 10_000)
      this.responses.delete(this.responses.keys().next().value as string);
    this.responses.set(responseKey, {
      expires: Date.now() + 5 * 60_000,
      fingerprint,
      response,
    });
    send(connection.ws, response);
  }

  private async execute(request: SignedCapabilityRequest): Promise<CapabilityResponse> {
    for (const [key, expiry] of this.replay) if (expiry <= Date.now()) this.replay.delete(key);
    for (const [key, cached] of this.responses)
      if (cached.expires <= Date.now()) this.responses.delete(key);
    const state = await this.store.read();
    const source = state.devices[request.sourceDeviceId];
    if (!source || source.revokedAt)
      return await this.denied(request, 'DEVICE_REVOKED', 'source device is not active');
    const issued = Date.parse(request.issuedAt);
    const expires = Date.parse(request.expiresAt);
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      issued > Date.now() + 30_000 ||
      expires < Date.now() ||
      expires - issued > 120_000
    ) {
      return await this.denied(
        request,
        'REQUEST_EXPIRED',
        'request timestamp is outside the allowed window',
      );
    }
    const replayKey = `${source.id}:${request.nonce}`;
    if ((this.replay.get(replayKey) ?? 0) > Date.now())
      return await this.denied(request, 'REPLAYED_REQUEST', 'request nonce was already used');
    const { signature, ...unsigned } = request;
    if (!verifyDeviceText(source.publicKey, capabilityRequestSigningText(unsigned), signature)) {
      return await this.denied(request, 'INVALID_SIGNATURE', 'request signature is invalid');
    }
    if (
      !isGranted(source.grants, request.capability, request.capabilityVersion, request.operation)
    ) {
      return await this.denied(
        request,
        'PERMISSION_DENIED',
        'this device has not granted that operation',
      );
    }
    this.replay.set(replayKey, expires);
    try {
      const result = await this.capabilities.invoke(
        request.capability,
        request.capabilityVersion,
        request.operation,
        request.payload,
        {
          sourceDevice: source,
          requestId: request.requestId,
        },
      );
      await this.recordAudit(request, 'allowed');
      return {
        type: 'capability.response',
        version: 1,
        requestId: request.requestId,
        sourceDeviceId: state.selfDeviceId,
        targetDeviceId: source.id,
        ok: true,
        result,
      };
    } catch (error: any) {
      await this.recordAudit(request, 'failed', String(error?.code ?? 'OPERATION_FAILED'));
      return this.errorResponse(
        request,
        String(error?.code ?? 'OPERATION_FAILED'),
        error?.message ?? String(error),
      );
    }
  }

  private async denied(
    request: SignedCapabilityRequest,
    code: string,
    message: string,
  ): Promise<CapabilityResponse> {
    await this.recordAudit(request, 'denied', code);
    return this.errorResponse(request, code, message);
  }

  private async recordAudit(
    request: SignedCapabilityRequest,
    outcome: 'allowed' | 'denied' | 'failed',
    errorCode: string | null = null,
  ): Promise<void> {
    await this.audit.record(request, outcome, errorCode).catch(() => undefined);
  }

  private errorResponse(
    request: Partial<SignedCapabilityRequest>,
    code: string,
    message: string,
  ): CapabilityResponse {
    return {
      type: 'capability.response',
      version: 1,
      requestId: String(request.requestId ?? ''),
      sourceDeviceId: String(request.targetDeviceId ?? this.identity.id),
      targetDeviceId: String(request.sourceDeviceId ?? ''),
      ok: false,
      error: { code, message },
    };
  }
}
