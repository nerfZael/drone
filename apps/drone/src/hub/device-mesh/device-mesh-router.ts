import crypto from 'node:crypto';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import {
  capabilityEventPolicy,
  capabilityEventSigningText,
  capabilityRequestSigningText,
  isGranted,
  MESH_MAX_MESSAGE_BYTES,
  MESH_SAFE_MESSAGE_BYTES,
  parseSignedCapabilityRequest,
  socketAuthSigningText,
  socketServerAuthSigningText,
  WORKSPACE_CAPABILITY,
  type CapabilityEvent,
  type CapabilityResponse,
  type MeshDevice,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { CapabilityRegistry } from './capability-registry';
import { DeviceMembershipSynchronizer } from './device-membership-synchronizer';
import { DeviceMeshAuditStore } from './device-mesh-audit-store';
import { DeviceMeshRequestClient } from './device-mesh-request-client';
import { DeviceMeshResponseCache } from './device-mesh-response-cache';
import {
  signDeviceText,
  signSocketChallenge,
  type LocalDeviceIdentity,
  verifyDeviceText,
} from './device-identity';
import { DeviceMeshStore } from './device-mesh-store';
import { DeviceRouteManager } from './device-route-manager';

type AuthenticatedSocket = { ws: WebSocket; peerDeviceId: string; outbound: boolean };
type ValidatedRequest = {
  state: Awaited<ReturnType<DeviceMeshStore['read']>>;
  source: MeshDevice;
  expires: number;
  replayKey: string;
};

const CAPABILITY_EVENT_LIFETIME_MS = 60_000;
const CAPABILITY_EVENT_MAX_PER_SOURCE_PER_MINUTE = 600;
const CAPABILITY_EVENT_MAX_PER_RELAY_SOURCE_PER_MINUTE = 600;
const CAPABILITY_EVENT_MAX_INVALID_PER_RELAY_PER_MINUTE = 120;
const CAPABILITY_EVENT_MAX_RELAY_VALIDATIONS = 8;
const CAPABILITY_EVENT_MAX_RELAY_SENDS_PER_BROADCAST = 100;
const CAPABILITY_EVENT_MAX_RELAYS_PER_TARGET = 3;
const CAPABILITY_EVENT_ROUTE_TTL_MS = 5 * 60_000;
const MAX_MESH_CONNECTIONS = 100;
const MESH_MAX_BUFFERED_BYTES = MESH_SAFE_MESSAGE_BYTES * 2;

function send(ws: WebSocket, payload: unknown): boolean {
  try {
    return sendSerialized(ws, JSON.stringify(payload));
  } catch {
    return false;
  }
}

function sendSerialized(ws: WebSocket, serialized: string): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  const bytes = Buffer.byteLength(serialized);
  if (bytes > MESH_SAFE_MESSAGE_BYTES) return false;
  const bufferedBytes = Number(ws.bufferedAmount) || 0;
  if (bufferedBytes + bytes > MESH_MAX_BUFFERED_BYTES) {
    closeSocket(ws, 1013, 'mesh connection is backpressured');
    return false;
  }
  try {
    ws.send(serialized, (error) => {
      if (error && ws.readyState === WebSocket.OPEN) {
        closeSocket(ws, 1011, 'mesh send failed');
      }
    });
    return true;
  } catch {
    closeSocket(ws, 1011, 'mesh send failed');
    return false;
  }
}

function closeSocket(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // The socket is already unusable; callers will fall back to polling or another route.
  }
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function socketUrl(endpoint: string, deviceId: string): string {
  const url = new URL(endpoint);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/device-mesh/ws';
  url.search = `deviceId=${encodeURIComponent(deviceId)}`;
  url.hash = '';
  return url.toString();
}

function isBulkTransferRequest(request: SignedCapabilityRequest): boolean {
  if (
    request.capability === WORKSPACE_CAPABILITY.id &&
    (request.operation === 'files.transfer.read' || request.operation === 'files.transfer.write')
  )
    return true;
  if (
    request.capability === 'drone-control' &&
    (request.operation === 'files.list' ||
      request.operation === 'file.preview' ||
      request.operation === 'file.write' ||
      request.operation === 'file.action')
  )
    return true;
  return (
    request.capability === 'drone-control' &&
    request.operation === 'chat.prompt' &&
    String((request.payload as any)?.attachmentTransfer?.action ?? '') === 'write'
  );
}

function isSnapshotChunkResponse(response: CapabilityResponse): boolean {
  const result =
    response.ok && response.result && typeof response.result === 'object'
      ? (response.result as Record<string, any>)
      : null;
  return Boolean(result?.contentChunk?.dataBase64 || result?.mediaChunk?.dataBase64);
}

export class DeviceMeshRouter {
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: MESH_MAX_MESSAGE_BYTES,
  });
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
  private readonly responses = new DeviceMeshResponseCache();
  private readonly requestTimes = new Map<string, number[]>();
  private readonly bulkRequestTimes = new Map<string, number[]>();
  private readonly capabilityEventDirectPeerTimes = new Map<string, number[]>();
  private readonly capabilityEventRelaySourceTimes = new Map<string, number[]>();
  private readonly capabilityEventInvalidRelayTimes = new Map<string, number[]>();
  private readonly capabilityEventRelayValidations = new Map<string, number>();
  private readonly capabilityEventSourceTimes = new Map<string, number[]>();
  private readonly capabilityEventTypeTimes = new Map<string, number[]>();
  private readonly seenCapabilityEvents = new Map<string, number>();
  private readonly capabilityEventRoutes = new Map<
    string,
    { relayDeviceId: string; expiresAt: number }
  >();
  private capabilityEventPruneTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly connecting = new Set<string>();
  private readonly connectionListeners = new Set<() => void>();
  private readonly capabilityEventListeners = new Set<(event: Record<string, any>) => void>();
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
    this.responses.clear();
    this.capabilityEventDirectPeerTimes.clear();
    this.capabilityEventRelaySourceTimes.clear();
    this.capabilityEventInvalidRelayTimes.clear();
    this.capabilityEventRelayValidations.clear();
    this.capabilityEventSourceTimes.clear();
    this.capabilityEventTypeTimes.clear();
    this.seenCapabilityEvents.clear();
    this.capabilityEventRoutes.clear();
    if (this.capabilityEventPruneTimer) clearTimeout(this.capabilityEventPruneTimer);
    this.capabilityEventPruneTimer = null;
    this.requestClient.close();
    this.server.close();
  }

  connectedDeviceIds(): string[] {
    return [...this.connections.keys()];
  }

  subscribeConnections(listener: () => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  subscribeCapabilityEvents(listener: (event: Record<string, any>) => void): () => void {
    this.capabilityEventListeners.add(listener);
    return () => this.capabilityEventListeners.delete(listener);
  }

  private notifyConnectionsChanged(): void {
    for (const listener of this.connectionListeners) {
      try {
        listener();
      } catch {
        // Connection observers are advisory and cannot interrupt mesh routing.
      }
    }
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
    this.responses.deleteDevice(deviceId);
    this.clearCapabilityEventPeer(deviceId);
    void this.capabilities.disconnectDevice(deviceId);
    this.connections.get(deviceId)?.ws.close(4003, 'device revoked');
  }

  async accessChanged(deviceId: string): Promise<void> {
    this.responses.deleteDevice(deviceId);
    await this.capabilities.accessChanged(deviceId);
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
    signal?: AbortSignal,
  ): Promise<unknown> {
    return await this.requestClient.request(targetDeviceId, capability, operation, payload, signal);
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
    targetDeviceIds?: Iterable<string>,
  ): Promise<void> {
    const state = await this.store.read();
    const targets = targetDeviceIds ? new Set(targetDeviceIds) : null;
    const policy = capabilityEventPolicy(capability, event);
    if (!policy || policy.requiredOperation !== requiredOperation) {
      throw new Error(`unsupported capability event: ${capability}@1/${event}`);
    }
    if (serializedBytes(payload) > policy.maxPayloadBytes) {
      return;
    }
    const issuedAt = new Date();
    const relayWork: Array<{
      targetDeviceId: string;
      serialized: string;
      attemptedRelays: Set<string>;
      relayAttempts: number;
    }> = [];
    let relaySends = 0;
    let unknownRelayTargetsPrepared = 0;
    for (const peer of Object.values(state.devices)) {
      if (
        peer.id === state.selfDeviceId ||
        peer.revokedAt ||
        (targets && !targets.has(peer.id)) ||
        !isGranted(peer.grants, capability, 1, requiredOperation)
      ) {
        continue;
      }
      const direct = this.connections.get(peer.id);
      const knownRoute = direct ? null : this.capabilityEventRouteFor(peer.id);
      if (
        !direct &&
        ((!knownRoute &&
          unknownRelayTargetsPrepared >= CAPABILITY_EVENT_MAX_RELAY_SENDS_PER_BROADCAST) ||
          (knownRoute && relaySends >= CAPABILITY_EVENT_MAX_RELAY_SENDS_PER_BROADCAST))
      ) {
        continue;
      }
      const unsigned: Omit<CapabilityEvent, 'signature'> = {
        type: 'capability.event',
        version: 1,
        eventId: crypto.randomUUID(),
        sourceDeviceId: this.identity.id,
        targetDeviceId: peer.id,
        capability,
        capabilityVersion: 1,
        event,
        payload,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + CAPABILITY_EVENT_LIFETIME_MS).toISOString(),
        maxHops: 1,
      };
      const signed = {
        ...unsigned,
        signature: signDeviceText(this.identity, capabilityEventSigningText(unsigned)),
      } satisfies CapabilityEvent;
      const serialized = JSON.stringify(signed);
      if (direct) {
        if (sendSerialized(direct.ws, serialized)) continue;
      }
      const attemptedRelays = new Set<string>();
      if (direct) attemptedRelays.add(direct.peerDeviceId);
      let relayAttempts = 0;
      if (knownRoute && relaySends < CAPABILITY_EVENT_MAX_RELAY_SENDS_PER_BROADCAST) {
        attemptedRelays.add(knownRoute.peerDeviceId);
        relayAttempts += 1;
        relaySends += 1;
        if (sendSerialized(knownRoute.ws, serialized)) continue;
        this.capabilityEventRoutes.delete(peer.id);
      }
      if (unknownRelayTargetsPrepared >= CAPABILITY_EVENT_MAX_RELAY_SENDS_PER_BROADCAST) continue;
      unknownRelayTargetsPrepared += 1;
      relayWork.push({ targetDeviceId: peer.id, serialized, attemptedRelays, relayAttempts });
    }

    // Unknown routes get bounded round-robin probes. Every target gets one chance before
    // another target gets a second, and the total work cannot exceed 100 frames regardless
    // of targets × connections. Missed advisory pushes are reconciled by client fallback polls.
    const relays = [...this.connections.values()];
    for (
      let pass = 0;
      pass < CAPABILITY_EVENT_MAX_RELAYS_PER_TARGET &&
      relaySends < CAPABILITY_EVENT_MAX_RELAY_SENDS_PER_BROADCAST;
      pass += 1
    ) {
      for (const work of relayWork) {
        if (relaySends >= CAPABILITY_EVENT_MAX_RELAY_SENDS_PER_BROADCAST) break;
        if (work.relayAttempts >= CAPABILITY_EVENT_MAX_RELAYS_PER_TARGET) continue;
        const relay = relayForTarget(relays, work.targetDeviceId, pass, work.attemptedRelays);
        if (!relay) continue;
        work.attemptedRelays.add(relay.peerDeviceId);
        work.relayAttempts += 1;
        relaySends += 1;
        sendSerialized(relay.ws, work.serialized);
      }
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
    if (!this.connections.has(requestedDeviceId) && this.connections.size >= MAX_MESH_CONNECTIONS) {
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
    if (!existing && this.connections.size >= MAX_MESH_CONNECTIONS) {
      connection.ws.close(4008, 'connection limit reached');
      return;
    }
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
    this.notifyConnectionsChanged();
    connection.ws.on('message', (raw) => {
      void this.onMessage(connection, raw).catch(() =>
        connection.ws.close(1011, 'mesh processing failed'),
      );
    });
    connection.ws.on('close', () => {
      if (this.connections.get(connection.peerDeviceId)?.ws === connection.ws) {
        this.connections.delete(connection.peerDeviceId);
        this.responses.deleteDevice(connection.peerDeviceId);
        this.capabilityEventRelayValidations.delete(connection.peerDeviceId);
        for (const [targetDeviceId, route] of this.capabilityEventRoutes) {
          if (route.relayDeviceId === connection.peerDeviceId) {
            this.capabilityEventRoutes.delete(targetDeviceId);
          }
        }
        void this.capabilities.disconnectDevice(connection.peerDeviceId);
        this.notifyConnectionsChanged();
      }
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
      if (new Set([...this.connections.keys(), ...this.connecting]).size >= MAX_MESH_CONNECTIONS) {
        break;
      }
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
        await this.capabilities.revokeDevice(revokedDeviceId);
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
    if (message?.type === 'capability.event') {
      const claimedSourceDeviceId = String(message?.sourceDeviceId ?? '');
      const forwarding = String(message?.targetDeviceId ?? '') !== this.identity.id;
      // A relay hop is owned by the authenticated source connection. Reject a copied
      // third-party envelope before it can consume the real source's replay/rate state.
      if (forwarding && claimedSourceDeviceId !== connection.peerDeviceId) return;

      const relayed = claimedSourceDeviceId !== connection.peerDeviceId;
      if (relayed && !this.beginCapabilityEventRelayValidation(connection.peerDeviceId)) return;
      if (
        !relayed &&
        !recordEventWithinLimit(
          this.capabilityEventDirectPeerTimes,
          connection.peerDeviceId,
          CAPABILITY_EVENT_MAX_PER_SOURCE_PER_MINUTE,
          Date.now(),
        )
      ) {
        connection.ws.close(4008, 'capability event rate limit reached');
        return;
      }

      let authenticated: CapabilityEvent | null = null;
      try {
        authenticated = await this.authenticateCapabilityEvent(message);
      } finally {
        if (relayed) this.finishCapabilityEventRelayValidation(connection.peerDeviceId);
      }
      if (!authenticated) {
        if (relayed && !this.recordInvalidCapabilityEventRelay(connection.peerDeviceId)) {
          connection.ws.close(4008, 'invalid capability event rate limit reached');
        }
        return;
      }
      if (
        relayed &&
        !recordEventWithinLimit(
          this.capabilityEventRelaySourceTimes,
          `${connection.peerDeviceId}\0${authenticated.sourceDeviceId}`,
          CAPABILITY_EVENT_MAX_PER_RELAY_SOURCE_PER_MINUTE,
          Date.now(),
        )
      ) {
        return;
      }
      const event = this.admitCapabilityEvent(authenticated);
      if (!event) return;
      if (event.targetDeviceId !== this.identity.id) {
        const target = this.connections.get(event.targetDeviceId);
        if (target && target.ws !== connection.ws) send(target.ws, event);
        return;
      }
      if (relayed) this.rememberCapabilityEventRoute(event.sourceDeviceId, connection.peerDeviceId);
      for (const listener of this.capabilityEventListeners) {
        try {
          listener(event);
        } catch {
          // Event observers are advisory and cannot interrupt mesh routing.
        }
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
        if (!send(route.sourceWs, message)) {
          send(
            route.sourceWs,
            this.errorResponse(
              {
                requestId: route.requestId,
                sourceDeviceId: route.sourceDeviceId,
                targetDeviceId: route.targetDeviceId,
              },
              'RESPONSE_TOO_LARGE',
              'mesh response is too large; request a smaller page or chunk',
            ),
          );
        }
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
    const bulkTransfer = isBulkTransferRequest(request);
    const rateLimit = bulkTransfer ? 600 : 120;
    const rateMap = bulkTransfer ? this.bulkRequestTimes : this.requestTimes;
    const rateKey = connection.peerDeviceId;
    const recent = (rateMap.get(rateKey) ?? []).filter((time) => time > Date.now() - 60_000);
    if (recent.length >= rateLimit) {
      send(
        connection.ws,
        this.errorResponse(request, 'RATE_LIMITED', 'too many mesh requests from this peer'),
      );
      return;
    }
    recent.push(Date.now());
    rateMap.set(rateKey, recent);
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
      if (!send(target.ws, request)) {
        clearTimeout(timer);
        this.routes.delete(routeKey);
        send(
          connection.ws,
          this.errorResponse(request, 'REQUEST_TOO_LARGE', 'mesh request is too large to forward'),
        );
      }
      return;
    }
    const responseKey = `${request.sourceDeviceId}:${request.requestId}`;
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const cached = this.responses.get(responseKey);
    if (cached) {
      const validation = await this.validateRequest(request, false);
      if (!('state' in validation)) {
        send(connection.ws, validation);
        return;
      }
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
    if (response.ok && request.sourceDeviceId !== connection.peerDeviceId) {
      this.rememberCapabilityEventRoute(request.sourceDeviceId, connection.peerDeviceId);
    }
    if (
      request.capability !== WORKSPACE_CAPABILITY.id &&
      !bulkTransfer &&
      !isSnapshotChunkResponse(response)
    ) {
      this.responses.set({
        key: responseKey,
        deviceId: request.sourceDeviceId,
        requestExpiresAt: Date.parse(request.expiresAt),
        fingerprint,
        response,
      });
    }
    send(connection.ws, response);
  }

  private async authenticateCapabilityEvent(value: any): Promise<CapabilityEvent | null> {
    const policy = capabilityEventPolicy(
      String(value?.capability ?? ''),
      String(value?.event ?? ''),
    );
    if (
      !policy ||
      value?.version !== 1 ||
      value?.capabilityVersion !== 1 ||
      value?.maxHops !== 1 ||
      typeof value?.eventId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.eventId) ||
      typeof value?.sourceDeviceId !== 'string' ||
      typeof value?.targetDeviceId !== 'string' ||
      !value?.payload ||
      typeof value.payload !== 'object' ||
      Array.isArray(value.payload) ||
      serializedBytes(value.payload) > policy.maxPayloadBytes ||
      serializedBytes(value) > policy.maxPayloadBytes + 4 * 1024
    ) {
      return null;
    }
    const now = Date.now();
    const issuedAt = Date.parse(String(value.issuedAt ?? ''));
    const expiresAt = Date.parse(String(value.expiresAt ?? ''));
    if (
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      issuedAt > now + 30_000 ||
      expiresAt <= now ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > CAPABILITY_EVENT_LIFETIME_MS
    ) {
      return null;
    }
    const state = await this.store.read();
    const source = state.devices[value.sourceDeviceId];
    const target = state.devices[value.targetDeviceId];
    if (!source || source.revokedAt || !target || target.revokedAt) return null;
    const { signature, ...unsigned } = value as CapabilityEvent;
    if (
      !verifyDeviceText(
        source.publicKey,
        capabilityEventSigningText(unsigned),
        String(signature ?? ''),
      )
    ) {
      return null;
    }
    return value as CapabilityEvent;
  }

  private admitCapabilityEvent(event: CapabilityEvent): CapabilityEvent | null {
    const policy = capabilityEventPolicy(event.capability, event.event);
    if (!policy) return null;
    const now = Date.now();
    const expiresAt = Date.parse(event.expiresAt);
    const replayKey = `${event.sourceDeviceId}:${event.eventId}`;
    const replayExpiry = this.seenCapabilityEvents.get(replayKey) ?? 0;
    if (replayExpiry > now) return null;
    if (
      !recordEventWithinLimit(
        this.capabilityEventSourceTimes,
        event.sourceDeviceId,
        CAPABILITY_EVENT_MAX_PER_SOURCE_PER_MINUTE,
        now,
      )
    ) {
      return null;
    }
    const eventRateKey = `${event.sourceDeviceId}\0${event.capability}\0${event.event}`;
    if (
      !recordEventWithinLimit(
        this.capabilityEventTypeTimes,
        eventRateKey,
        policy.maxEventsPerMinute,
        now,
      )
    ) {
      return null;
    }
    this.seenCapabilityEvents.set(replayKey, expiresAt);
    this.scheduleCapabilityEventPrune();
    return event;
  }

  private beginCapabilityEventRelayValidation(peerDeviceId: string): boolean {
    const active = this.capabilityEventRelayValidations.get(peerDeviceId) ?? 0;
    if (active >= CAPABILITY_EVENT_MAX_RELAY_VALIDATIONS) return false;
    this.capabilityEventRelayValidations.set(peerDeviceId, active + 1);
    return true;
  }

  private finishCapabilityEventRelayValidation(peerDeviceId: string): void {
    const active = (this.capabilityEventRelayValidations.get(peerDeviceId) ?? 1) - 1;
    if (active > 0) this.capabilityEventRelayValidations.set(peerDeviceId, active);
    else this.capabilityEventRelayValidations.delete(peerDeviceId);
  }

  private recordInvalidCapabilityEventRelay(peerDeviceId: string): boolean {
    const now = Date.now();
    return recordEventWithinLimit(
      this.capabilityEventInvalidRelayTimes,
      peerDeviceId,
      CAPABILITY_EVENT_MAX_INVALID_PER_RELAY_PER_MINUTE,
      now,
    );
  }

  private rememberCapabilityEventRoute(targetDeviceId: string, relayDeviceId: string): void {
    if (targetDeviceId === relayDeviceId || !this.connections.has(relayDeviceId)) return;
    this.capabilityEventRoutes.set(targetDeviceId, {
      relayDeviceId,
      expiresAt: Date.now() + CAPABILITY_EVENT_ROUTE_TTL_MS,
    });
  }

  private capabilityEventRouteFor(targetDeviceId: string): AuthenticatedSocket | null {
    const route = this.capabilityEventRoutes.get(targetDeviceId);
    if (!route) return null;
    const connection = this.connections.get(route.relayDeviceId);
    if (!connection || route.expiresAt <= Date.now()) {
      this.capabilityEventRoutes.delete(targetDeviceId);
      return null;
    }
    return connection;
  }

  private clearCapabilityEventPeer(deviceId: string): void {
    this.capabilityEventDirectPeerTimes.delete(deviceId);
    this.capabilityEventInvalidRelayTimes.delete(deviceId);
    this.capabilityEventRelayValidations.delete(deviceId);
    this.capabilityEventSourceTimes.delete(deviceId);
    for (const key of this.capabilityEventRelaySourceTimes.keys()) {
      if (key.startsWith(`${deviceId}\0`) || key.endsWith(`\0${deviceId}`)) {
        this.capabilityEventRelaySourceTimes.delete(key);
      }
    }
    for (const key of this.capabilityEventTypeTimes.keys()) {
      if (key.startsWith(`${deviceId}\0`)) this.capabilityEventTypeTimes.delete(key);
    }
    for (const key of this.seenCapabilityEvents.keys()) {
      if (key.startsWith(`${deviceId}:`)) this.seenCapabilityEvents.delete(key);
    }
    for (const [targetDeviceId, route] of this.capabilityEventRoutes) {
      if (targetDeviceId === deviceId || route.relayDeviceId === deviceId) {
        this.capabilityEventRoutes.delete(targetDeviceId);
      }
    }
  }

  private scheduleCapabilityEventPrune(): void {
    if (this.capabilityEventPruneTimer || this.seenCapabilityEvents.size === 0) return;
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const expiry of this.seenCapabilityEvents.values())
      nextExpiry = Math.min(nextExpiry, expiry);
    this.capabilityEventPruneTimer = setTimeout(
      () => {
        this.capabilityEventPruneTimer = null;
        const now = Date.now();
        for (const [key, expiry] of this.seenCapabilityEvents) {
          if (expiry <= now) this.seenCapabilityEvents.delete(key);
        }
        this.scheduleCapabilityEventPrune();
      },
      Math.max(0, nextExpiry - Date.now()),
    );
    this.capabilityEventPruneTimer.unref?.();
  }

  private async execute(request: SignedCapabilityRequest): Promise<CapabilityResponse> {
    for (const [key, expiry] of this.replay) if (expiry <= Date.now()) this.replay.delete(key);
    const validation = await this.validateRequest(request, true);
    if (!('state' in validation)) return validation;
    const { state, source, expires, replayKey } = validation;
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
      const response: CapabilityResponse = {
        type: 'capability.response',
        version: 1,
        requestId: request.requestId,
        sourceDeviceId: state.selfDeviceId,
        targetDeviceId: source.id,
        ok: true,
        result,
      };
      if (Buffer.byteLength(JSON.stringify(response)) > MESH_SAFE_MESSAGE_BYTES) {
        return this.errorResponse(
          request,
          'RESPONSE_TOO_LARGE',
          'mesh response is too large; request a smaller page or chunk',
        );
      }
      return response;
    } catch (error: any) {
      await this.recordAudit(request, 'failed', String(error?.code ?? 'OPERATION_FAILED'));
      return this.errorResponse(
        request,
        String(error?.code ?? 'OPERATION_FAILED'),
        error?.message ?? String(error),
      );
    }
  }

  private async validateRequest(
    request: SignedCapabilityRequest,
    enforceReplay: boolean,
  ): Promise<ValidatedRequest | CapabilityResponse> {
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
    if (enforceReplay && (this.replay.get(replayKey) ?? 0) > Date.now())
      return await this.denied(request, 'REPLAYED_REQUEST', 'request nonce was already used');
    const { signature, ...unsigned } = request;
    if (!verifyDeviceText(source.publicKey, capabilityRequestSigningText(unsigned), signature)) {
      return await this.denied(request, 'INVALID_SIGNATURE', 'request signature is invalid');
    }
    if (
      // Workspace access is scoped by source device and workspace root inside its handler.
      request.capability !== WORKSPACE_CAPABILITY.id &&
      !isGranted(source.grants, request.capability, request.capabilityVersion, request.operation)
    ) {
      return await this.denied(
        request,
        'PERMISSION_DENIED',
        'this device has not granted that operation',
      );
    }
    return { state, source, expires, replayKey };
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

function relayForTarget(
  relays: AuthenticatedSocket[],
  targetDeviceId: string,
  pass: number,
  attempted: Set<string>,
): AuthenticatedSocket | null {
  if (relays.length === 0) return null;
  let hash = 0;
  for (let index = 0; index < targetDeviceId.length; index += 1) {
    hash = (hash * 31 + targetDeviceId.charCodeAt(index)) >>> 0;
  }
  for (let offset = 0; offset < relays.length; offset += 1) {
    const relay = relays[(hash + pass + offset) % relays.length];
    if (!attempted.has(relay.peerDeviceId)) return relay;
  }
  return null;
}

function recordEventWithinLimit(
  entries: Map<string, number[]>,
  key: string,
  limit: number,
  now: number,
): boolean {
  const recent = (entries.get(key) ?? []).filter((time) => time > now - 60_000);
  if (recent.length >= limit) {
    entries.set(key, recent);
    return false;
  }
  recent.push(now);
  entries.set(key, recent);
  return true;
}
