import crypto from 'node:crypto';
import type http from 'node:http';
import QRCode from 'qrcode';
import {
  canonicalJson,
  readBoundedHttpText,
  pairingClaimSigningText,
  parsePairingPayload,
  WORKSPACE_CAPABILITY,
  type CapabilityGrant,
  type DevicePublicIdentity,
  type MeshDevice,
  type PairingApproval,
  type PairingClaim,
  type PairingPayload,
} from '@drone/device-protocol';
import { CapabilityRegistry } from './capability-registry';
import { DeviceMeshAuditStore } from './device-mesh-audit-store';
import { signDeviceText, type LocalDeviceIdentity, verifyDeviceText } from './device-identity';
import { DeviceMeshRouter } from './device-mesh-router';
import { DeviceMeshStore } from './device-mesh-store';
import type { PendingDevice } from './device-mesh-types';
import { deviceMeshJson, readDeviceMeshBody } from './device-mesh-http-helpers';

export { deviceMeshJson, readDeviceMeshBody } from './device-mesh-http-helpers';

export type DeviceMeshHttpExtension = {
  handle(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<boolean>;
  handlePublic?(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean>;
};

const json = deviceMeshJson;
const readBody = readDeviceMeshBody;

function secretHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicEndpoint(value: unknown): string {
  const endpoint = String(value ?? '')
    .trim()
    .replace(/\/+$/, '');
  const parsed = new URL(endpoint);
  const loopbackHttp =
    parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('public endpoint must use HTTPS');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== '/')
  ) {
    throw new Error('public endpoint must be an origin without credentials or a path');
  }
  return endpoint;
}

function publicIdentity(value: unknown): DevicePublicIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('device is required');
  const input = value as Record<string, any>;
  const id = String(input.id ?? '').trim();
  const name = String(input.name ?? '')
    .trim()
    .slice(0, 80);
  const platform =
    input.platform === 'android' || input.platform === 'desktop' || input.platform === 'server'
      ? input.platform
      : 'unknown';
  const key = input.publicKey as JsonWebKey;
  if (!id || !name || !key || key.kty !== 'EC' || key.crv !== 'P-256' || !key.x || !key.y)
    throw new Error('device identity is invalid');
  const expectedId = `device_${crypto
    .createHash('sha256')
    .update(JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }))
    .digest('base64url')
    .slice(0, 24)}`;
  if (id !== expectedId) throw new Error('device id does not match its public key');
  return {
    id,
    name,
    platform,
    publicKey: { crv: key.crv, ext: true, key_ops: ['verify'], kty: 'EC', x: key.x, y: key.y },
  };
}

function normalizeGrants(value: unknown, capabilities: CapabilityRegistry): CapabilityGrant[] {
  if (!Array.isArray(value)) return [];
  const descriptors = new Map(capabilities.list().map((descriptor) => [descriptor.id, descriptor]));
  const grants: CapabilityGrant[] = [];
  for (const raw of value) {
    const capability = String(raw?.capability ?? '').trim();
    const descriptor = descriptors.get(capability);
    if (
      !descriptor ||
      descriptor.id === WORKSPACE_CAPABILITY.id ||
      Number(raw?.version) !== descriptor.version ||
      !Array.isArray(raw?.operations)
    )
      continue;
    const operations = [
      ...new Set<string>(
        raw.operations
          .map(String)
          .filter((operation: string) => descriptor.operations.includes(operation)),
      ),
    ];
    if (operations.length > 0) grants.push({ capability, version: descriptor.version, operations });
  }
  return grants;
}

function deviceForPeer(device: MeshDevice, peerId: string): MeshDevice {
  return device.id === peerId ? device : { ...device, grants: [] };
}

export class DeviceMeshHttp {
  private readonly joins = new Map<
    string,
    { status: 'pending' | 'approved' | 'failed'; error?: string }
  >();
  private readonly eventClients = new Map<http.ServerResponse, ReturnType<typeof setInterval>>();
  private eventRevision = 0;
  private readonly unsubscribeStoreChanges: () => void;
  private readonly unsubscribeConnectionChanges: () => void;
  private readonly unsubscribeCapabilityEvents: () => void;

  constructor(
    private readonly identity: LocalDeviceIdentity,
    private readonly store: DeviceMeshStore,
    private readonly capabilities: CapabilityRegistry,
    private readonly router: DeviceMeshRouter,
    private readonly audit: DeviceMeshAuditStore,
    private readonly apiToken: string,
    private readonly extensions: DeviceMeshHttpExtension[] = [],
    private readonly invitationEndpoint: () => string | null = () => null,
  ) {
    this.unsubscribeStoreChanges = this.store.subscribe(() => this.publishChange('state'));
    this.unsubscribeConnectionChanges = this.router.subscribeConnections(() =>
      this.publishChange('connections'),
    );
    this.unsubscribeCapabilityEvents = this.router.subscribeCapabilityEvents((event) =>
      this.publishCapabilityEvent(event),
    );
  }

  close(): void {
    this.unsubscribeStoreChanges();
    this.unsubscribeConnectionChanges();
    this.unsubscribeCapabilityEvents();
    for (const [response, keepAlive] of this.eventClients) {
      clearInterval(keepAlive);
      if (!response.destroyed) response.end();
    }
    this.eventClients.clear();
  }

  private publishChange(reason: 'state' | 'connections'): void {
    this.publishEvent('change', (revision) => ({ revision, reason }));
  }

  private publishCapabilityEvent(event: Record<string, any>): void {
    this.publishEvent('capability', (revision) => ({ ...event, revision }));
  }

  private publishEvent(
    eventName: 'change' | 'capability',
    dataForRevision: (revision: number) => Record<string, any>,
  ): void {
    this.eventRevision += 1;
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(dataForRevision(this.eventRevision))}\n\n`;
    for (const response of this.eventClients.keys()) {
      this.writeEventClient(response, payload);
    }
  }

  private writeEventClient(response: http.ServerResponse, payload: string): boolean {
    try {
      if (response.write(payload)) return true;
    } catch {
      // The stream is removed below.
    }
    this.removeEventClient(response);
    try {
      if (!response.destroyed) response.destroy();
    } catch {
      // The stream has already been removed from the tracked client set.
    }
    return false;
  }

  private removeEventClient(response: http.ServerResponse): void {
    const keepAlive = this.eventClients.get(response);
    if (keepAlive) clearInterval(keepAlive);
    this.eventClients.delete(response);
  }

  private openEvents(response: http.ServerResponse): void {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/event-stream; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');
    response.flushHeaders?.();
    if (
      !this.writeEventClient(
        response,
        `event: ready\ndata: ${JSON.stringify({ revision: this.eventRevision })}\n\n`,
      )
    ) {
      return;
    }
    const keepAlive = setInterval(() => {
      this.writeEventClient(response, ': keepalive\n\n');
    }, 25_000);
    keepAlive.unref?.();
    this.eventClients.set(response, keepAlive);
    response.once('close', () => {
      this.removeEventClient(response);
    });
  }

  async handlePublic(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (await this.router.handleHttp(request, response, url)) return true;
    if (request.method === 'GET' && url.pathname === '/.well-known/dronehub') {
      const nonce = String(url.searchParams.get('nonce') ?? '');
      if (!/^[a-zA-Z0-9_-]{20,128}$/.test(nonce)) {
        json(response, 400, { ok: false, error: 'discovery nonce is required' });
        return true;
      }
      const state = await this.store.read();
      const descriptor = {
        protocol: 'dronehub-device-mesh',
        protocolVersion: 2,
        nonce,
        device: publicIdentity(state.devices[state.selfDeviceId]),
        endpoint: this.invitationEndpoint(),
        route: state.routes[state.selfDeviceId] ?? null,
      };
      json(response, 200, {
        ...descriptor,
        signature: signDeviceText(this.identity, canonicalJson(descriptor)),
      });
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/device-mesh/pairing/request') {
      const body = await readBody(request);
      const device = publicIdentity(body.device);
      const endpoint = this.invitationEndpoint();
      const expires = Date.parse(String(body.expiresAt));
      if (
        !endpoint ||
        body.endpoint !== endpoint ||
        body.inviterDeviceId !== this.identity.id ||
        !Number.isFinite(expires) ||
        expires <= Date.now() ||
        expires > Date.now() + 10 * 60_000 ||
        typeof body.token !== 'string' ||
        !/^[a-zA-Z0-9_-]{32,128}$/.test(body.token) ||
        !verifyDeviceText(
          device.publicKey,
          pairingClaimSigningText({
            token: body.token,
            claimSecret: body.claimSecret,
            inviterDeviceId: body.inviterDeviceId,
            endpoint: body.endpoint,
            expiresAt: body.expiresAt,
            device,
          }),
          String(body.signature ?? ''),
        )
      )
        throw new Error('invalid pairing request proof');
      await this.store.update((state) => {
        if (!state.devices[state.selfDeviceId]?.administrator)
          throw new Error('this Hub cannot enroll devices');
        if (state.devices[device.id]?.revokedAt) throw new Error('device is revoked');
        if (
          Object.values(state.invitations).some((item) => item.tokenHash === secretHash(body.token))
        )
          throw new Error('pairing request already used');
        if (
          Object.values(state.pending).filter((item) => !item.approval && !item.rejectedAt)
            .length >= 50
        )
          throw new Error('too many pending pairing requests');
        const id = crypto.randomUUID();
        state.invitations[id] = {
          id,
          tokenHash: secretHash(body.token),
          endpoint,
          createdAt: new Date().toISOString(),
          expiresAt: body.expiresAt,
          claimedAt: null,
        };
      });
      await this.claim(request, response, body);
      return true;
    }
    const method = String(request.method ?? 'GET').toUpperCase();
    const parts = url.pathname.split('/').filter(Boolean);
    for (const extension of this.extensions) {
      if (extension.handlePublic && (await extension.handlePublic(request, response, url)))
        return true;
    }
    const isClaim = method === 'POST' && url.pathname === '/api/device-mesh/invitations/claim';
    const isClaimStatus =
      method === 'GET' &&
      parts.length === 5 &&
      parts[0] === 'api' &&
      parts[1] === 'device-mesh' &&
      parts[2] === 'invitations' &&
      parts[4] === 'status';
    if (!isClaim && !isClaimStatus) return false;
    try {
      if (isClaim) {
        await this.claim(request, response);
      } else {
        await this.claimStatus(
          response,
          parts[3],
          String(url.searchParams.get('claimSecret') ?? ''),
        );
      }
    } catch (error: any) {
      json(response, 400, { ok: false, error: error?.message ?? String(error) });
    }
    return true;
  }

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/device-mesh')) return false;
    if (await this.handlePublic(request, response, url)) return true;
    try {
      const method = String(request.method ?? 'GET').toUpperCase();
      const parts = url.pathname.split('/').filter(Boolean);
      if (!this.adminAuthorized(request)) {
        response.setHeader('www-authenticate', 'Bearer realm="drone-device-mesh"');
        json(response, 401, { ok: false, error: 'unauthorized' });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/device-mesh/events') {
        this.openEvents(response);
        return true;
      }
      for (const extension of this.extensions) {
        if (await extension.handle(request, response, url)) return true;
      }
      if (method === 'GET' && url.pathname === '/api/device-mesh') {
        const state = await this.store.read();
        json(response, 200, {
          ok: true,
          networkId: state.networkId,
          selfDeviceId: state.selfDeviceId,
          devices: Object.values(state.devices),
          pending: Object.values(state.pending)
            .filter((item) => !item.approval && !item.rejectedAt)
            .map(({ claimSecretHash: _secret, approval: _approval, ...item }) => item),
          connectedDeviceIds: this.router.connectedDeviceIds(),
          connectionErrors: this.router.connectionErrors?.() ?? {},
          capabilities: this.capabilities.list(),
          routes: Object.values(state.routes),
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/device-mesh/diagnostics') {
        const state = await this.store.read();
        json(response, 200, {
          ok: true,
          routes: Object.values(state.routes),
          audit: await this.audit.list(Number(url.searchParams.get('limit') ?? 50)),
          forwardingSecurity: 'tls-only',
          forwardingNotice:
            'A bridge can read forwarded payloads in this prototype. Device signatures still protect identity and target permissions.',
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/device-mesh/invitations') {
        await this.invite(request, response);
        return true;
      }
      if (method === 'GET' && parts.length === 4 && parts[2] === 'invitations') {
        await this.invitationStatus(response, parts[3]);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/device-mesh/joins') {
        await this.join(request, response);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/device-mesh/joins-discovered') {
        const body = await readBody(request);
        const endpoint = publicEndpoint(body.endpoint);
        const nonce = crypto.randomBytes(24).toString('base64url');
        const discoveryResponse = await fetch(`${endpoint}/.well-known/dronehub?nonce=${nonce}`, {
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        if (!discoveryResponse.ok) throw new Error('could not verify discovered Hub');
        const descriptor = JSON.parse(await readBoundedHttpText(discoveryResponse, 16 * 1024));
        const { signature, ...unsigned } = descriptor;
        const peer = publicIdentity(descriptor.device);
        if (
          descriptor.protocolVersion !== 2 ||
          descriptor.nonce !== nonce ||
          peer.id !== body.deviceId ||
          descriptor.endpoint !== endpoint ||
          !verifyDeviceText(peer.publicKey, canonicalJson(unsigned), String(signature))
        )
          throw new Error('discovered Hub identity changed');
        const payload: PairingPayload = {
          version: 1,
          endpoint,
          inviterDeviceId: peer.id,
          token: crypto.randomBytes(32).toString('base64url'),
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        };
        const id = crypto.randomUUID();
        this.joins.set(id, { status: 'pending' });
        void this.runJoin(id, payload, true).catch((error: any) => {
          this.joins.set(id, { status: 'failed', error: error?.message ?? String(error) });
        });
        json(response, 202, { ok: true, joinId: id });
        return true;
      }
      if (method === 'GET' && parts.length === 4 && parts[2] === 'joins') {
        const join = this.joins.get(parts[3]);
        json(
          response,
          join ? 200 : 404,
          join ? { ok: true, ...join } : { ok: false, error: 'join request not found' },
        );
        return true;
      }
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[2] === 'pending' &&
        parts[4] === 'approve'
      ) {
        await this.approve(request, response, parts[3]);
        return true;
      }
      if (method === 'DELETE' && parts.length === 4 && parts[2] === 'pending') {
        await this.reject(response, parts[3]);
        return true;
      }
      if (method === 'PUT' && parts.length === 4 && parts[2] === 'devices') {
        await this.updateDevice(request, response, parts[3]);
        return true;
      }
      if (method === 'DELETE' && parts.length === 4 && parts[2] === 'devices') {
        await this.revoke(response, parts[3]);
        return true;
      }
      json(response, 404, { ok: false, error: 'not found' });
    } catch (error: any) {
      json(response, 400, { ok: false, error: error?.message ?? String(error) });
    }
    return true;
  }

  private adminAuthorized(request: http.IncomingMessage): boolean {
    const header = String(request.headers.authorization ?? '');
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    return token.length > 0 && safeEqual(token, this.apiToken);
  }

  private async invite(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    await readBody(request);
    const configuredEndpoint = this.invitationEndpoint();
    if (!configuredEndpoint) throw new Error('configure secure mesh ingress before inviting');
    const endpoint = publicEndpoint(configuredEndpoint);
    await this.router.announceEndpoint(endpoint);
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60_000).toISOString();
    const state = await this.store.update((current) => {
      if (!current.devices[current.selfDeviceId]?.administrator)
        throw new Error('this device is not allowed to invite new devices');
      current.invitations[id] = {
        id,
        tokenHash: secretHash(token),
        endpoint,
        createdAt: createdAt.toISOString(),
        expiresAt,
        claimedAt: null,
      };
      return current;
    });
    const payload: PairingPayload = {
      version: 1,
      endpoint,
      token,
      inviterDeviceId: state.selfDeviceId,
      expiresAt,
    };
    parsePairingPayload(payload);
    json(response, 201, {
      ok: true,
      invitationId: id,
      payload,
      qrSvg: await QRCode.toString(JSON.stringify(payload), { type: 'svg', margin: 1 }),
      expiresAt,
    });
  }

  private async invitationStatus(
    response: http.ServerResponse,
    invitationId: string,
  ): Promise<void> {
    const state = await this.store.read();
    const invitation = state.invitations[invitationId];
    if (!invitation) {
      json(response, 404, { ok: false, error: 'pairing invitation not found' });
      return;
    }
    json(response, 200, {
      ok: true,
      invitationId: invitation.id,
      endpoint: invitation.endpoint,
      expiresAt: invitation.expiresAt,
      claimed: invitation.claimedAt !== null,
    });
  }

  private async claim(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    suppliedBody?: any,
  ): Promise<void> {
    const body = suppliedBody ?? (await readBody(request));
    const token = String(body.token ?? '');
    const claimSecret = String(body.claimSecret ?? '');
    const signature = String(body.signature ?? '');
    if (token.length < 20 || claimSecret.length < 20)
      throw new Error('pairing credentials are invalid');
    const device = publicIdentity(body.device);
    let verifiedClaim: Omit<PairingClaim, 'signature'> | null = null;
    if (signature) {
      verifiedClaim = {
        token,
        claimSecret,
        inviterDeviceId: String(body.inviterDeviceId ?? ''),
        endpoint: publicEndpoint(body.endpoint),
        expiresAt: String(body.expiresAt ?? ''),
        device,
      };
      if (!verifyDeviceText(device.publicKey, pairingClaimSigningText(verifiedClaim), signature))
        throw new Error('pairing identity proof is invalid');
    }
    const pendingId = await this.store.update((state) => {
      const invitation = Object.values(state.invitations).find((item) =>
        safeEqual(item.tokenHash, secretHash(token)),
      );
      if (!invitation || invitation.claimedAt || Date.parse(invitation.expiresAt) <= Date.now())
        throw new Error('pairing invitation is invalid or expired');
      if (
        verifiedClaim &&
        (verifiedClaim.inviterDeviceId !== state.selfDeviceId ||
          verifiedClaim.endpoint !== invitation.endpoint ||
          verifiedClaim.expiresAt !== invitation.expiresAt)
      )
        throw new Error('pairing claim does not match its invitation');
      const existing = state.devices[device.id];
      if (existing?.revokedAt) throw new Error('this device has been revoked');
      invitation.claimedAt = new Date().toISOString();
      const id = crypto.randomUUID();
      const pending: PendingDevice = {
        id,
        invitationId: invitation.id,
        claimSecretHash: secretHash(claimSecret),
        device,
        requestedAt: new Date().toISOString(),
        approval: null,
        rejectedAt: null,
        resolvedAt: null,
      };
      state.pending[id] = pending;
      if (existing && verifiedClaim) {
        pending.approval = {
          networkId: state.networkId,
          device: existing,
          devices: Object.values(state.devices).map((item) => deviceForPeer(item, existing.id)),
          capabilities: this.capabilities.list(),
          endpoint: invitation.endpoint,
        };
        pending.resolvedAt = new Date().toISOString();
      }
      return id;
    });
    json(response, 202, { ok: true, pendingId });
  }

  private async join(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const body = await readBody(request);
    const payload = parsePairingPayload(
      typeof body.payload === 'string' ? JSON.parse(body.payload) : body.payload,
    );
    const id = crypto.randomUUID();
    this.joins.set(id, { status: 'pending' });
    void this.runJoin(id, payload).catch((error: any) => {
      this.joins.set(id, { status: 'failed', error: error?.message ?? String(error) });
    });
    json(response, 202, { ok: true, joinId: id });
  }

  private async runJoin(
    joinId: string,
    payload: PairingPayload,
    discovered = false,
  ): Promise<void> {
    const state = await this.store.read();
    const self = state.devices[state.selfDeviceId];
    const established = Object.keys(state.devices).some(
      (deviceId) => deviceId !== state.selfDeviceId,
    );
    const inviter = state.devices[payload.inviterDeviceId];
    if (established && (!inviter || inviter.revokedAt)) {
      throw new Error(
        'this pairing code is not from a device in the current mesh; leave the current mesh before joining another one',
      );
    }
    const claimSecret = crypto.randomBytes(32).toString('base64url');
    const unsignedClaim: Omit<PairingClaim, 'signature'> = {
      token: payload.token,
      claimSecret,
      inviterDeviceId: payload.inviterDeviceId,
      endpoint: payload.endpoint,
      expiresAt: payload.expiresAt,
      device: self,
    };
    const claimedResponse = await fetch(
      `${payload.endpoint}/api/device-mesh/${discovered ? 'pairing/request' : 'invitations/claim'}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...unsignedClaim,
          signature: signDeviceText(this.identity, pairingClaimSigningText(unsignedClaim)),
        }),
      },
    );
    const claimed = (await claimedResponse.json().catch(() => ({}))) as any;
    if (!claimedResponse.ok)
      throw new Error(String(claimed?.error ?? 'destination Hub rejected the pairing code'));
    const pendingId = String(claimed.pendingId ?? '');
    while (Date.now() < Date.parse(payload.expiresAt) + 60_000) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const statusResponse = await fetch(
        `${payload.endpoint}/api/device-mesh/invitations/${encodeURIComponent(pendingId)}/status?claimSecret=${encodeURIComponent(claimSecret)}`,
      );
      const status = (await statusResponse.json().catch(() => ({}))) as any;
      if (!statusResponse.ok)
        throw new Error(String(status?.error ?? 'could not read pairing approval'));
      if (status.status === 'rejected') throw new Error('the destination Hub rejected this device');
      if (status.status !== 'approved') continue;
      const approval = status.approval as PairingApproval;
      await this.store.update((current) => {
        const currentEstablished = Object.keys(current.devices).some(
          (deviceId) => deviceId !== current.selfDeviceId,
        );
        if (currentEstablished && current.networkId !== approval.networkId)
          throw new Error('this Hub already belongs to a different device mesh');
        current.networkId = approval.networkId;
        for (const incoming of approval.devices) {
          const existing = current.devices[incoming.id];
          current.devices[incoming.id] = existing
            ? {
                ...incoming,
                name: existing.name,
                grants: existing.grants,
                endpoints: existing.endpoints.length ? existing.endpoints : incoming.endpoints,
              }
            : { ...incoming, grants: [] };
        }
        const inviter = current.devices[payload.inviterDeviceId];
        if (inviter && !inviter.endpoints.includes(approval.endpoint))
          inviter.endpoints.unshift(approval.endpoint);
      });
      this.joins.set(joinId, { status: 'approved' });
      await this.router.broadcastMembership();
      return;
    }
    throw new Error('pairing approval timed out');
  }

  private async claimStatus(
    response: http.ServerResponse,
    pendingId: string,
    claimSecret: string,
  ): Promise<void> {
    const state = await this.store.read();
    const pending = state.pending[pendingId];
    if (!pending || !claimSecret || !safeEqual(pending.claimSecretHash, secretHash(claimSecret))) {
      json(response, 404, { ok: false, error: 'pairing request not found' });
      return;
    }
    if (pending.rejectedAt) {
      json(response, 200, { ok: true, status: 'rejected' });
      return;
    }
    if (!pending.approval) {
      json(response, 200, { ok: true, status: 'pending' });
      return;
    }
    json(response, 200, { ok: true, status: 'approved', approval: pending.approval });
  }

  private async approve(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    pendingId: string,
  ): Promise<void> {
    const body = await readBody(request);
    const approval = await this.store.update<PairingApproval>((state) => {
      const pending = state.pending[pendingId];
      if (!pending || pending.rejectedAt) throw new Error('pending device not found');
      const at = new Date().toISOString();
      const existing = state.devices[pending.device.id];
      if (existing?.revokedAt) throw new Error('this device has been revoked');
      const invitation = state.invitations[pending.invitationId];
      if (!invitation) throw new Error('pairing invitation not found');
      if (
        !existing &&
        Object.values(state.devices).some(
          (item) =>
            item.id !== pending.device.id &&
            !item.revokedAt &&
            item.name.trim().toLowerCase() === pending.device.name.trim().toLowerCase(),
        )
      )
        throw new Error('device names must be unique; rename the joining device and try again');
      const device: MeshDevice = existing
        ? { ...existing, revokedAt: null }
        : {
            ...pending.device,
            administrator: body.administrator === true,
            grants: normalizeGrants(body.grants, this.capabilities),
            endpoints: [],
            revokedAt: null,
            addedAt: at,
            updatedAt: at,
          };
      state.devices[device.id] = device;
      pending.approval = {
        networkId: state.networkId,
        device,
        devices: Object.values(state.devices).map((item) => deviceForPeer(item, device.id)),
        capabilities: this.capabilities.list(),
        endpoint: invitation.endpoint,
      };
      pending.resolvedAt = at;
      return pending.approval;
    });
    await this.router.broadcastMembership();
    json(response, 200, { ok: true, approval });
  }

  private async reject(response: http.ServerResponse, pendingId: string): Promise<void> {
    await this.store.update((state) => {
      const pending = state.pending[pendingId];
      if (!pending) throw new Error('pending device not found');
      pending.rejectedAt = new Date().toISOString();
      pending.resolvedAt = pending.rejectedAt;
    });
    json(response, 200, { ok: true });
  }

  private async updateDevice(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    deviceId: string,
  ): Promise<void> {
    const body = await readBody(request);
    const device = await this.store.update((state) => {
      const current = state.devices[deviceId];
      if (!current || current.revokedAt) throw new Error('device not found');
      if (deviceId === state.selfDeviceId && Array.isArray(body.endpoints)) {
        throw new Error('configure this device endpoint through secure mesh ingress');
      }
      if (typeof body.name === 'string' && body.name.trim()) {
        const name = body.name.trim().slice(0, 80);
        if (
          Object.values(state.devices).some(
            (item) =>
              item.id !== current.id &&
              !item.revokedAt &&
              item.name.trim().toLowerCase() === name.toLowerCase(),
          )
        )
          throw new Error('device names must be unique in this network');
        current.name = name;
      }
      if (typeof body.administrator === 'boolean') current.administrator = body.administrator;
      if (Array.isArray(body.grants))
        current.grants = normalizeGrants(body.grants, this.capabilities);
      if (Array.isArray(body.endpoints))
        current.endpoints = body.endpoints.map(publicEndpoint).slice(0, 4);
      current.updatedAt = new Date().toISOString();
      return current;
    });
    if (Array.isArray(body.grants)) {
      await this.router.accessChanged(deviceId).catch(() => undefined);
    }
    await this.router.broadcastMembership();
    json(response, 200, { ok: true, device });
  }

  private async revoke(response: http.ServerResponse, deviceId: string): Promise<void> {
    await this.store.update((state) => {
      if (deviceId === state.selfDeviceId) throw new Error('cannot revoke the current device');
      const device = state.devices[deviceId];
      if (!device) throw new Error('device not found');
      device.revokedAt = new Date().toISOString();
      device.grants = [];
      device.updatedAt = device.revokedAt;
    });
    this.router.disconnect(deviceId);
    await this.capabilities.revokeDevice(deviceId);
    await this.router.broadcastRevocation(deviceId);
    json(response, 200, { ok: true });
  }
}
