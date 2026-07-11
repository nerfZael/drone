import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`fleet api tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping fleet api tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

type StubDaemon = Awaited<ReturnType<typeof startStubDaemon>>;

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function json(res: http.ServerResponse, status: number, body: any) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function startStubDaemon(token: string, opts?: { failClaims?: boolean }) {
  const requests = new Map<string, any>();
  const order: string[] = [];
  const promptEnqueues: any[] = [];
  const promptCancels: string[] = [];
  const pendingTaskCreates: any[] = [];
  const pendingTaskDeletes: any[] = [];
  let policy: any = null;

  const server = http.createServer(async (req, res) => {
    const auth = String(req.headers.authorization ?? '');
    if (auth !== `Bearer ${token}`) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = u.pathname;
    const method = String(req.method ?? 'GET').toUpperCase();

    if (method === 'GET' && pathname === '/v1/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && pathname === '/v1/status') {
      json(res, 200, { ok: true, process: null });
      return;
    }
    if (method === 'POST' && pathname === '/v1/prompts/enqueue') {
      const body = await readJson(req);
      promptEnqueues.push(body);
      json(res, 202, { ok: true, id: String(body?.id ?? ''), state: 'queued' });
      return;
    }
    const cancelMatch = pathname.match(/^\/v1\/prompts\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      const id = decodeURIComponent(cancelMatch[1] ?? '');
      promptCancels.push(id);
      json(res, 200, { ok: true, id, state: 'canceled' });
      return;
    }
    if (method === 'POST' && pathname === '/v1/fleet/policy') {
      policy = await readJson(req);
      json(res, 200, { ok: true, snapshot: policy });
      return;
    }
    if (method === 'POST' && pathname === '/v1/tasks/state') {
      json(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && pathname === '/v1/tasks/pending-creates') {
      json(res, 200, { ok: true, requests: pendingTaskCreates });
      return;
    }
    const pendingCreateAckMatch = pathname.match(/^\/v1\/tasks\/pending-creates\/([^/]+)\/ack$/);
    if (method === 'POST' && pendingCreateAckMatch) {
      const id = decodeURIComponent(pendingCreateAckMatch[1] ?? '');
      const index = pendingTaskCreates.findIndex((request) => request.id === id);
      if (index >= 0) pendingTaskCreates.splice(index, 1);
      json(res, 200, { ok: true, id });
      return;
    }
    if (method === 'GET' && pathname === '/v1/tasks/pending-deletes') {
      json(res, 200, { ok: true, requests: pendingTaskDeletes });
      return;
    }
    const pendingDeleteAckMatch = pathname.match(/^\/v1\/tasks\/pending-deletes\/([^/]+)\/ack$/);
    if (method === 'POST' && pendingDeleteAckMatch) {
      const id = decodeURIComponent(pendingDeleteAckMatch[1] ?? '');
      const index = pendingTaskDeletes.findIndex((request) => request.id === id);
      if (index >= 0) pendingTaskDeletes.splice(index, 1);
      json(res, 200, { ok: true, id });
      return;
    }
    if (method === 'GET' && pathname === '/v1/fleet/requests') {
      const state = String(u.searchParams.get('state') ?? '').trim();
      const items = order
        .map((id) => requests.get(id))
        .filter(Boolean)
        .filter((item) => !state || String(item?.state ?? '') === state);
      json(res, 200, { ok: true, requests: items });
      return;
    }
    if (method === 'POST' && pathname === '/v1/fleet/requests') {
      const body = await readJson(req);
      const id = `req-${order.length + 1}`;
      const request = {
        id,
        idempotencyKey: typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
        type: String(body?.type ?? ''),
        payload: body?.payload ?? {},
        state: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      requests.set(id, request);
      order.push(id);
      json(res, 202, { ok: true, request });
      return;
    }
    const getMatch = pathname.match(/^\/v1\/fleet\/requests\/([^/]+)$/);
    if (method === 'GET' && getMatch) {
      const request = requests.get(decodeURIComponent(getMatch[1] ?? ''));
      if (!request) {
        json(res, 404, { error: 'not found' });
        return;
      }
      json(res, 200, { ok: true, request });
      return;
    }
    const claimMatch = pathname.match(/^\/v1\/fleet\/requests\/([^/]+)\/claim$/);
    if (method === 'POST' && claimMatch) {
      if (opts?.failClaims) {
        json(res, 500, { error: 'claim failed' });
        return;
      }
      const id = decodeURIComponent(claimMatch[1] ?? '');
      const request = requests.get(id);
      if (!request) {
        json(res, 404, { error: 'not found' });
        return;
      }
      request.state = 'running';
      request.updatedAt = new Date().toISOString();
      requests.set(id, request);
      json(res, 200, { ok: true, request });
      return;
    }
    const resolveMatch = pathname.match(/^\/v1\/fleet\/requests\/([^/]+)\/resolve$/);
    if (method === 'POST' && resolveMatch) {
      const id = decodeURIComponent(resolveMatch[1] ?? '');
      const request = requests.get(id);
      if (!request) {
        json(res, 404, { error: 'not found' });
        return;
      }
      const body = await readJson(req);
      request.state = String(body?.state ?? 'failed');
      request.updatedAt = new Date().toISOString();
      if (request.state === 'done') request.result = body?.result;
      if (request.state === 'failed') request.error = String(body?.error ?? 'failed');
      requests.set(id, request);
      json(res, 200, { ok: true, request });
      return;
    }
    json(res, 404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to start stub daemon');
  return {
    port: addr.port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    get policy() {
      return policy;
    },
    get promptEnqueues() {
      return promptEnqueues;
    },
    get promptCancels() {
      return promptCancels;
    },
    queuePendingTaskCreate(request: any) {
      pendingTaskCreates.push(request);
    },
    queuePendingTaskDelete(request: any) {
      pendingTaskDeletes.push(request);
    },
  };
}

async function waitForRequest(daemon: StubDaemon, token: string, requestId: string) {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/fleet/requests/${encodeURIComponent(requestId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data: any = await response.json();
    const request = data?.request ?? null;
    if (request?.state === 'done' || request?.state === 'failed') return request;
    if (Date.now() - startedAt > 10_000) throw new Error(`timed out waiting for fleet request ${requestId}`);
    await Bun.sleep(100);
  }
}

describeSocketSuite('fleet api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-fleet-api-'));
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const droneDataDir = path.join(tempRoot, 'data', 'drone');
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';

  const apiFetch = async (p: string, init?: RequestInit) => {
    const r = await fetch(`${baseUrl}${p}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });
    const text = await r.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    return { r, data };
  };

  beforeAll(async () => {
    fs.mkdirSync(path.join(xdgDataHome, 'drone'), { recursive: true });
    fs.mkdirSync(droneDataDir, { recursive: true });
    process.env.XDG_DATA_HOME = xdgDataHome;
    process.env.DRONE_DATA_DIR = droneDataDir;
    resetDroneRootDirForTests();
    server = await startDroneHubApiServer({ port: 0, apiToken: token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('normalizes fleet relationship refs to stable drone ids in drone summaries', async () => {
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = {
        'fleet-chat-manager': {
          id: 'owner-id',
          name: 'fleet-chat-manager',
          hostPort: null,
          token: 'owner-token',
          runtime: 'host',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
          fleet: {
            createdBy: null,
            assigned: ['worker-a', 'worker-b'],
          },
        },
        'worker-a': {
          id: 'worker-a-id',
          name: 'worker-a',
          hostPort: null,
          token: 'worker-a-token',
          runtime: 'host',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
          fleet: {
            createdBy: 'fleet-chat-manager',
            assigned: [],
          },
        },
        'worker-b': {
          id: 'worker-b-id',
          name: 'worker-b',
          hostPort: null,
          token: 'worker-b-token',
          runtime: 'host',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
          fleet: {
            createdBy: null,
            assigned: [],
          },
        },
      };
      reg.pending = {};
    });

    const dronesResp = await apiFetch('/api/drones');
    expect(dronesResp.r.status).toBe(200);
    const droneById = Object.fromEntries((dronesResp.data?.drones ?? []).map((item: any) => [String(item?.id ?? ''), item]));
    expect(droneById['owner-id']?.fleetAssignedIds).toEqual(['worker-a-id', 'worker-b-id']);
    expect(droneById['worker-a-id']?.fleetParentId).toBe('owner-id');

    const actorResp = await apiFetch('/api/fleet/actors/owner-id');
    expect(actorResp.r.status).toBe(200);
  });

  test('persists fleet config and assignment and syncs policy to the daemon', async () => {
    const parentDaemon = await startStubDaemon('parent-token');
    const childDaemon = await startStubDaemon('child-token');
    try {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          parent: {
            id: 'parent',
            name: 'parent',
            hostPort: parentDaemon.port,
            token: 'parent-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
          child: {
            id: 'child',
            name: 'child',
            hostPort: childDaemon.port,
            token: 'child-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
        };
      });

      const config = await apiFetch('/api/fleet/actors/parent/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          capabilities: ['drone:create', 'drone:message:send', 'drone:message:read'],
          readScopes: ['children', 'assigned'],
          quotas: { maxChildren: 3, maxMessagesPerMinute: 9 },
        }),
      });
      expect(config.r.status).toBe(200);
      expect(config.data?.config?.enabled).toBe(true);

      const assigned = await apiFetch('/api/fleet/actors/parent/assigned', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'child' }),
      });
      expect(assigned.r.status).toBe(200);
      expect((assigned.data?.relationships?.assigned ?? []).map((item: any) => item.id)).toContain('child');

      const actor = await apiFetch('/api/fleet/actors/parent');
      expect(actor.r.status).toBe(200);
      expect(actor.data?.usage?.assignedCount).toBe(1);

      await Bun.sleep(250);
      expect(parentDaemon.policy?.enabled).toBe(true);
      expect(parentDaemon.policy?.capabilities).toContain('drone:create');
      expect(parentDaemon.policy?.readScopes).toContain('assigned');
    } finally {
      await parentDaemon.close();
      await childDaemon.close();
    }
  });

  test('daemon task create and delete requests persist through the canonical Kanban command', async () => {
    const daemon = await startStubDaemon('task-drone-token');
    const at = '2026-06-01T00:00:00.000Z';
    const readCards = async () => {
      const response = await apiFetch('/api/settings/kanban-board');
      return response.data?.kanbanBoard?.lanes?.flatMap((lane: any) => lane.cards ?? []) ?? [];
    };
    const waitForCards = async (predicate: (cards: any[]) => boolean) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const cards = await readCards();
        if (predicate(cards)) return cards;
        await Bun.sleep(100);
      }
      throw new Error('timed out waiting for canonical Kanban board');
    };

    try {
      const boardResponse = await apiFetch('/api/settings/kanban-board', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kanbanBoard: {
            taskTypes: [{ id: 'task', label: 'Task', active: true }],
            lanes: [{
              id: 'todo',
              title: 'Todo',
              cards: [{ id: 'keep', title: 'Keep', description: '', typeId: 'task', createdAt: at, updatedAt: at }],
            }],
          },
        }),
      });
      expect(boardResponse.r.status).toBe(200);
      await updateRegistry((reg: any) => {
        reg.drones ??= {};
        reg.drones['task-drone'] = {
          id: 'task-drone',
          name: 'task-drone',
          runtime: 'host',
          hostPort: daemon.port,
          token: 'task-drone-token',
          containerPort: 7777,
          repoPath: '',
          createdAt: at,
          chats: {},
        };
      });

      daemon.queuePendingTaskCreate({
        id: 'create-request',
        title: 'Created by daemon',
        description: 'Canonical task',
        typeId: 'task',
        createdAt: at,
      });
      const afterCreate = await waitForCards((cards) => cards.some((card) => card.title === 'Created by daemon'));
      const created = afterCreate.find((card) => card.title === 'Created by daemon');
      expect(created?.droneId).toBe('task-drone');
      expect(afterCreate.some((card) => card.id === 'keep')).toBe(true);

      daemon.queuePendingTaskDelete({ id: 'delete-request', taskId: created.id });
      const afterDelete = await waitForCards((cards) => !cards.some((card) => card.id === created.id));
      expect(afterDelete.map((card) => card.id)).toEqual(['keep']);
    } finally {
      await updateRegistry((reg: any) => {
        if (reg?.drones?.['task-drone']) delete reg.drones['task-drone'];
      });
      await daemon.close();
    }
  });

  test('auto-enables assigned fleet access when adding a target', async () => {
    const parentDaemon = await startStubDaemon('parent-auto-token');
    const childDaemon = await startStubDaemon('child-auto-token');
    try {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          parent: {
            id: 'parent',
            name: 'parent',
            hostPort: parentDaemon.port,
            token: 'parent-auto-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
          child: {
            id: 'child',
            name: 'child',
            hostPort: childDaemon.port,
            token: 'child-auto-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
        };
      });

      const assigned = await apiFetch('/api/fleet/actors/parent/assigned', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'child' }),
      });
      expect(assigned.r.status).toBe(200);
      expect(assigned.data?.config?.enabled).toBe(true);
      expect(assigned.data?.config?.capabilities).toContain('drone:message:send');
      expect(assigned.data?.config?.capabilities).toContain('drone:message:read');
      expect(assigned.data?.config?.readScopes).toContain('assigned');
      expect((assigned.data?.relationships?.assigned ?? []).map((item: any) => item.id)).toContain('child');

      await Bun.sleep(250);
      expect(parentDaemon.policy?.enabled).toBe(true);
      expect(parentDaemon.policy?.capabilities).toContain('drone:message:send');
      expect(parentDaemon.policy?.capabilities).toContain('drone:message:read');
      expect(parentDaemon.policy?.readScopes).toContain('assigned');
      expect(parentDaemon.policy?.relationships?.assigned).toEqual([{ id: 'child', name: 'child' }]);
    } finally {
      await parentDaemon.close();
      await childDaemon.close();
    }
  });

  test('reparents a drone and syncs affected fleet parent policies', async () => {
    const oldParentDaemon = await startStubDaemon('old-parent-token');
    const newParentDaemon = await startStubDaemon('new-parent-token');
    try {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          'old-parent': {
            id: 'old-parent',
            name: 'old-parent',
            hostPort: oldParentDaemon.port,
            token: 'old-parent-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
          'new-parent': {
            id: 'new-parent',
            name: 'new-parent',
            hostPort: newParentDaemon.port,
            token: 'new-parent-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
          child: {
            id: 'child',
            name: 'child',
            hostPort: null,
            token: '',
            runtime: 'host',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            fleet: {
              createdBy: 'old-parent',
              assigned: [],
            },
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
        };
      });

      const reparented = await apiFetch('/api/fleet/actors/child/parent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parent: 'new-parent' }),
      });
      expect(reparented.r.status).toBe(200);
      expect(reparented.data?.parentId).toBe('new-parent');

      const reg = await loadRegistry();
      expect(reg?.drones?.child?.fleet?.createdBy).toBe('new-parent');

      await Bun.sleep(250);
      expect(oldParentDaemon.policy?.relationships?.children ?? []).toEqual([]);
      expect(newParentDaemon.policy?.relationships?.children ?? []).toEqual([{ id: 'child', name: 'child' }]);
    } finally {
      await oldParentDaemon.close();
      await newParentDaemon.close();
    }
  });

  test('rejects reparenting a drone beneath its descendant', async () => {
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = {
        parent: {
          id: 'parent',
          name: 'parent',
          hostPort: null,
          token: '',
          runtime: 'host',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
        },
        child: {
          id: 'child',
          name: 'child',
          hostPort: null,
          token: '',
          runtime: 'host',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          fleet: {
            createdBy: 'parent',
            assigned: [],
          },
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
        },
      };
    });

    const rejected = await apiFetch('/api/fleet/actors/parent/parent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent: 'child' }),
    });
    expect(rejected.r.status).toBe(400);
    expect(String(rejected.data?.error ?? '')).toMatch(/descendants/i);

    const reg = await loadRegistry();
    expect(reg?.drones?.parent?.fleet?.createdBy ?? null).toBeNull();
    expect(reg?.drones?.child?.fleet?.createdBy).toBe('parent');
  });

  test('deleting a parent drone cascades to descendant drones', async () => {
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = {
        parent: {
          id: 'parent',
          name: 'parent',
          hostPort: null,
          token: '',
          runtime: 'host',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
        },
        child: {
          id: 'child',
          name: 'child',
          hostPort: null,
          token: '',
          runtime: 'host',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          fleet: {
            createdBy: 'parent',
            assigned: [],
          },
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
        },
        grandchild: {
          id: 'grandchild',
          name: 'grandchild',
          hostPort: null,
          token: '',
          runtime: 'host',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          fleet: {
            createdBy: 'child',
            assigned: [],
          },
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
        },
        sibling: {
          id: 'sibling',
          name: 'sibling',
          hostPort: null,
          token: '',
          runtime: 'host',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
        },
      };
      reg.pending = {
        pendingChild: {
          id: 'pendingChild',
          name: 'pendingChild',
          runtime: 'host',
          createdAt: now,
          phase: 'starting',
          fleet: {
            createdBy: 'parent',
            assigned: [],
          },
        },
      };
    });

    const deleted = await apiFetch('/api/drones/parent?keepVolume=1', {
      method: 'DELETE',
    });
    expect(deleted.r.status).toBe(200);
    expect(deleted.data?.removedDescendants).toEqual(['pendingChild', 'grandchild', 'child']);

    const reg = await loadRegistry();
    expect(reg?.drones?.parent).toBeUndefined();
    expect(reg?.drones?.child).toBeUndefined();
    expect(reg?.drones?.grandchild).toBeUndefined();
    expect(reg?.pending?.pendingChild).toBeUndefined();
    expect(reg?.drones?.sibling).toBeTruthy();
  });

  test('reconciles send and read fleet requests for a child drone', async () => {
    const parentDaemon = await startStubDaemon('parent-send-token');
    const childDaemon = await startStubDaemon('child-send-token');
    try {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          'parent-send': {
            id: 'parent-send',
            name: 'parent-send',
            hostPort: parentDaemon.port,
            token: 'parent-send-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            fleet: {
              enabled: true,
              capabilities: ['drone:message:send', 'drone:message:read'],
              readScopes: ['children'],
              assigned: [],
            },
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
          'child-send': {
            id: 'child-send',
            name: 'child-send',
            hostPort: childDaemon.port,
            token: 'child-send-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            fleet: {
              createdBy: 'parent-send',
              createdAt: now,
              enabled: false,
              capabilities: [],
              readScopes: ['children'],
              assigned: [],
            },
            chats: {
              default: {
                createdAt: now,
                agent: { kind: 'builtin', id: 'codex' },
                pendingPrompts: [],
                turns: [
                  {
                    id: 'turn-1',
                    at: now,
                    promptAt: now,
                    completedAt: now,
                    prompt: 'child status?',
                    ok: true,
                    output: 'all green',
                  },
                ],
              },
            },
          },
        };
      });

      const sendResp = await fetch(`http://127.0.0.1:${parentDaemon.port}/v1/fleet/requests`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer parent-send-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'send_message',
          payload: { to: 'child-send', chat: 'default', message: 'ping child' },
        }),
      });
      const sendData: any = await sendResp.json();
      const sendRequest = await waitForRequest(parentDaemon, 'parent-send-token', String(sendData?.request?.id ?? ''));
      expect(sendRequest.state).toBe('done');
      expect(sendRequest.result?.target?.id).toBe('child-send');
      expect(childDaemon.promptEnqueues).toHaveLength(1);
      expect(String(childDaemon.promptEnqueues[0]?.id ?? '')).toBe(String(sendData?.request?.id ?? ''));

      const readResp = await fetch(`http://127.0.0.1:${parentDaemon.port}/v1/fleet/requests`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer parent-send-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'read_messages',
          payload: { from: 'child-send', chat: 'default', order: 'asc', limit: 5 },
        }),
      });
      const readData: any = await readResp.json();
      const readRequest = await waitForRequest(parentDaemon, 'parent-send-token', String(readData?.request?.id ?? ''));
      expect(readRequest.state).toBe('done');
      expect(readRequest.result?.items?.map((item: any) => item.content)).toEqual(['child status?', 'all green']);

      const audit = await apiFetch('/api/fleet/audit?actor=parent-send');
      expect(audit.r.status).toBe(200);
      expect((audit.data?.items ?? []).some((item: any) => item.action === 'send_message' && item.status === 'accepted')).toBe(true);
      expect((audit.data?.items ?? []).some((item: any) => item.action === 'read_messages' && item.status === 'accepted')).toBe(true);
    } finally {
      await parentDaemon.close();
      await childDaemon.close();
    }
  });

  test('rejects fleet send requests that would be queued behind an unanswered message', async () => {
    const parentDaemon = await startStubDaemon('parent-send-blocked-token');
    const childDaemon = await startStubDaemon('child-send-blocked-token');
    try {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          'parent-send-blocked': {
            id: 'parent-send-blocked',
            name: 'parent-send-blocked',
            hostPort: parentDaemon.port,
            token: 'parent-send-blocked-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            fleet: {
              enabled: true,
              capabilities: ['drone:message:send'],
              readScopes: ['children'],
              assigned: [],
            },
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
          'child-send-blocked': {
            id: 'child-send-blocked',
            name: 'child-send-blocked',
            hostPort: childDaemon.port,
            token: 'child-send-blocked-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            fleet: {
              createdBy: 'parent-send-blocked',
              createdAt: now,
              enabled: false,
              capabilities: [],
              readScopes: ['children'],
              assigned: [],
            },
            chats: {
              default: {
                createdAt: now,
                agent: { kind: 'builtin', id: 'cursor' },
                turns: [],
                pendingPrompts: [
                  {
                    id: 'pending-turn-1',
                    at: now,
                    updatedAt: now,
                    prompt: 'first message',
                    state: 'sent',
                  },
                ],
              },
            },
          },
        };
      });

      const sendResp = await fetch(`http://127.0.0.1:${parentDaemon.port}/v1/fleet/requests`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer parent-send-blocked-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'send_message',
          payload: { to: 'child-send-blocked', chat: 'default', message: 'follow-up message' },
        }),
      });
      const sendData: any = await sendResp.json();
      const sendRequest = await waitForRequest(parentDaemon, 'parent-send-blocked-token', String(sendData?.request?.id ?? ''));
      expect(sendRequest.state).toBe('failed');
      expect(String(sendRequest.error ?? '')).toContain('pending message awaiting a response');
      expect(String(sendRequest.error ?? '')).toContain('immediate delivery');
      expect(childDaemon.promptEnqueues).toHaveLength(0);

      const audit = await apiFetch('/api/fleet/audit?actor=parent-send-blocked');
      expect(audit.r.status).toBe(200);
      expect(
        (audit.data?.items ?? []).some(
          (item: any) =>
            item.action === 'send_message' &&
            item.status === 'rejected' &&
            String(item.reason ?? '').includes('pending message awaiting a response'),
        ),
      ).toBe(true);
    } finally {
      await parentDaemon.close();
      await childDaemon.close();
    }
  });

  test('reconciles stop requests for a child drone chat', async () => {
    const parentDaemon = await startStubDaemon('parent-stop-token');
    const childDaemon = await startStubDaemon('child-stop-token');
    try {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          'parent-stop': {
            id: 'parent-stop',
            name: 'parent-stop',
            hostPort: parentDaemon.port,
            token: 'parent-stop-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            fleet: {
              enabled: true,
              capabilities: ['drone:message:send'],
              readScopes: ['children'],
              assigned: [],
            },
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
          'child-stop': {
            id: 'child-stop',
            name: 'child-stop',
            hostPort: childDaemon.port,
            token: 'child-stop-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            fleet: {
              createdBy: 'parent-stop',
              createdAt: now,
              enabled: false,
              capabilities: [],
              readScopes: ['children'],
              assigned: [],
            },
            chats: {
              default: {
                createdAt: now,
                agent: { kind: 'builtin', id: 'cursor' },
                turns: [],
                pendingPrompts: [{ id: 'prompt-stop-1', at: now, prompt: 'still running', state: 'sent', updatedAt: now }],
              },
            },
          },
        };
      });

      const stopResp = await fetch(`http://127.0.0.1:${parentDaemon.port}/v1/fleet/requests`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer parent-stop-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'stop_chat',
          payload: { to: 'child-stop', chat: 'default' },
        }),
      });
      const stopData: any = await stopResp.json();
      const stopRequest = await waitForRequest(parentDaemon, 'parent-stop-token', String(stopData?.request?.id ?? ''));
      expect(stopRequest.state).toBe('done');
      expect(stopRequest.result?.target?.id).toBe('child-stop');
      expect(stopRequest.result?.chat).toBe('default');
      expect(stopRequest.result?.stopped).toBe(true);
      expect(stopRequest.result?.stoppedPromptIds).toEqual(['prompt-stop-1']);
      expect(childDaemon.promptCancels).toEqual(['prompt-stop-1']);

      const regAny: any = await loadRegistry();
      const pending = regAny?.drones?.['child-stop']?.chats?.default?.pendingPrompts ?? [];
      expect(pending).toHaveLength(1);
      expect(pending[0]?.id).toBe('prompt-stop-1');
      expect(pending[0]?.state).toBe('failed');
      expect(String(pending[0]?.error ?? '')).toContain('Stopped by user');

      const audit = await apiFetch('/api/fleet/audit?actor=parent-stop');
      expect(audit.r.status).toBe(200);
      expect((audit.data?.items ?? []).some((item: any) => item.action === 'stop_chat' && item.status === 'accepted')).toBe(true);
    } finally {
      await parentDaemon.close();
      await childDaemon.close();
    }
  });

  test('queues child creation requests with lineage metadata', async () => {
    const parentDaemon = await startStubDaemon('parent-create-token');
    try {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          'parent-create': {
            id: 'parent-create',
            name: 'parent-create',
            hostPort: parentDaemon.port,
            token: 'parent-create-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            fleet: {
              enabled: true,
              capabilities: ['drone:create'],
              readScopes: ['children'],
              assigned: [],
              quotas: { maxChildren: 2 },
            },
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
        };
      });

      const createResp = await fetch(`http://127.0.0.1:${parentDaemon.port}/v1/fleet/requests`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer parent-create-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'create_child',
          payload: { name: 'fleet-child-1' },
        }),
      });
      const createData: any = await createResp.json();
      const createRequest = await waitForRequest(parentDaemon, 'parent-create-token', String(createData?.request?.id ?? ''));
      expect(createRequest.state).toBe('done');
      const childId = String(createRequest.result?.child?.id ?? '');
      expect(childId).not.toBe('');

      const regAny: any = await loadRegistry();
      expect(String(regAny?.pending?.[childId]?.fleet?.createdBy ?? '')).toBe('parent-create');

      const actor = await apiFetch('/api/fleet/actors/parent-create');
      expect(actor.r.status).toBe(200);
      expect((actor.data?.relationships?.children ?? []).some((item: any) => item.id === childId)).toBe(true);
    } finally {
      await parentDaemon.close();
    }
  });

  test('queues child clone requests that clone the parent with a fresh chat', async () => {
    const parentDaemon = await startStubDaemon('parent-clone-token');
    try {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          'parent-clone': {
            id: 'parent-clone',
            name: 'parent-clone',
            hostPort: parentDaemon.port,
            token: 'parent-clone-token',
            runtime: 'container',
            containerPort: 7777,
            repoPath: '/work/repo',
            createdAt: now,
            environment: {
              vars: { FOO: 'bar', EMPTY: '' },
              useRepoVars: true,
              disabledRepoKeys: ['SECRET_TOKEN'],
              updatedAt: now,
            },
            fleet: {
              enabled: true,
              capabilities: ['drone:create'],
              readScopes: ['children'],
              assigned: [],
              quotas: { maxChildren: 2 },
            },
            chats: {
              default: {
                createdAt: now,
                agent: { kind: 'builtin', id: 'claude' },
                model: 'claude-3-5-haiku',
                turns: [{ at: now, prompt: 'status?', ok: true, output: 'ready' }],
                pendingPrompts: [{ id: 'queued', at: now, prompt: 'later', state: 'queued' }],
              },
            },
          },
        };
      });

      const createResp = await fetch(`http://127.0.0.1:${parentDaemon.port}/v1/fleet/requests`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer parent-clone-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'create_child',
          payload: { name: 'fleet-child-clone', cloneParent: true },
        }),
      });
      const createData: any = await createResp.json();
      const createRequest = await waitForRequest(parentDaemon, 'parent-clone-token', String(createData?.request?.id ?? ''));
      expect(createRequest.state).toBe('done');
      expect(createRequest.result?.child?.cloneParent).toBe(true);
      const childId = String(createRequest.result?.child?.id ?? '');
      expect(childId).not.toBe('');

      const regAny: any = await loadRegistry();
      const pendingChild = regAny?.pending?.[childId] ?? null;
      expect(String(pendingChild?.cloneFrom ?? '')).toBe('parent-clone');
      expect(pendingChild?.cloneChats).toBe(false);
      expect(pendingChild?.environment).toEqual({
        vars: { FOO: 'bar', EMPTY: '' },
        useRepoVars: true,
        disabledRepoKeys: ['SECRET_TOKEN'],
        updatedAt: now,
      });
      expect(pendingChild?.seed).toEqual({
        chatName: 'default',
        agent: { kind: 'builtin', id: 'claude' },
        model: 'claude-3-5-haiku',
      });
    } finally {
      await parentDaemon.close();
    }
  });

  test('does not execute fleet work when the daemon claim step fails', async () => {
    const parentDaemon = await startStubDaemon('parent-claim-token', { failClaims: true });
    try {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          'parent-claim': {
            id: 'parent-claim',
            name: 'parent-claim',
            hostPort: parentDaemon.port,
            token: 'parent-claim-token',
            containerPort: 7777,
            repoPath: '',
            createdAt: now,
            fleet: {
              enabled: true,
              capabilities: ['drone:create'],
              readScopes: ['children'],
              assigned: [],
              quotas: {},
            },
            chats: { default: { createdAt: now, agent: { kind: 'builtin', id: 'cursor' }, turns: [], pendingPrompts: [] } },
          },
        };
        reg.pending = {};
      });

      const createResp = await fetch(`http://127.0.0.1:${parentDaemon.port}/v1/fleet/requests`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer parent-claim-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'create_child',
          payload: { name: 'should-not-run' },
        }),
      });
      const createData: any = await createResp.json();
      const requestId = String(createData?.request?.id ?? '');
      expect(requestId).not.toBe('');

      await Bun.sleep(2200);

      const requestResp = await fetch(`http://127.0.0.1:${parentDaemon.port}/v1/fleet/requests/${encodeURIComponent(requestId)}`, {
        headers: { authorization: 'Bearer parent-claim-token' },
      });
      const requestData: any = await requestResp.json();
      expect(requestData?.request?.state).toBe('queued');

      const regAny: any = await loadRegistry();
      expect(Object.values(regAny?.pending ?? {}).some((item: any) => String(item?.name ?? '') === 'should-not-run')).toBe(false);
    } finally {
      await parentDaemon.close();
    }
  });
});
