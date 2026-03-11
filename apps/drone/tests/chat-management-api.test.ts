import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { updateRegistry } from '../src/host/registry';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`chat management api tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping chat management api tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('chat management api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-chat-management-api-'));
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

  const seedDrone = async (id: string) => {
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[id] = {
        id,
        name: id,
        hostPort: 1,
        token: 'mock-token',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [],
          },
        },
      };
    });
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

  test('creates and lists chats for a drone', async () => {
    const droneId = 'drone-chat-create';
    await seedDrone(droneId);

    const created = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'review' }),
    });
    expect(created.r.status).toBe(201);
    expect(created.data?.ok).toBe(true);
    expect(created.data?.chat).toBe('review');

    const listed = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    expect(listed.r.status).toBe(200);
    expect(Array.isArray(listed.data?.chats)).toBe(true);
    expect((listed.data?.chats ?? []).includes('default')).toBe(true);
    expect((listed.data?.chats ?? []).includes('review')).toBe(true);
  });

  test('creates a chat from the implicit default on legacy drones without chats', async () => {
    const droneId = 'drone-chat-legacy-default';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: 1,
        token: 'mock-token',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
      };
    });

    const created = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'review', copyFromChat: 'default' }),
    });
    expect(created.r.status).toBe(201);
    expect(created.data?.ok).toBe(true);
    expect(created.data?.chat).toBe('review');

    const listed = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    expect(listed.r.status).toBe(200);
    expect((listed.data?.chats ?? []).includes('default')).toBe(true);
    expect((listed.data?.chats ?? []).includes('review')).toBe(true);
  });

  test('renames and deletes chats with default protections', async () => {
    const droneId = 'drone-chat-rename-delete';
    await seedDrone(droneId);

    const created = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'review' }),
    });
    expect(created.r.status).toBe(201);

    const renamed = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/review/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newName: 'qa' }),
    });
    expect(renamed.r.status).toBe(200);
    expect(renamed.data?.chat).toBe('qa');

    const oldMissing = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/review`);
    expect(oldMissing.r.status).toBe(404);

    const renamedInfo = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/qa`);
    expect(renamedInfo.r.status).toBe(200);
    expect(renamedInfo.data?.chat).toBe('qa');

    const deleteDefault = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`, {
      method: 'DELETE',
    });
    expect(deleteDefault.r.status).toBe(400);
    expect(String(deleteDefault.data?.error ?? '')).toContain('default');

    const deleted = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/qa`, {
      method: 'DELETE',
    });
    expect(deleted.r.status).toBe(200);
    expect(deleted.data?.deletedChat).toBe('qa');

    const listed = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    expect(listed.r.status).toBe(200);
    expect((listed.data?.chats ?? []).includes('default')).toBe(true);
    expect((listed.data?.chats ?? []).includes('qa')).toBe(false);
  });

  test('returns empty chat reads for pending drones instead of still-starting errors', async () => {
    const droneId = 'pending-chat-read';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.pending = reg.pending ?? {};
      reg.pending[droneId] = {
        id: droneId,
        name: droneId,
        runtime: 'host',
        repoPath: '',
        containerPort: 7777,
        build: false,
        createdAt: now,
        updatedAt: now,
        phase: 'starting',
        message: 'Starting...',
      };
    });

    const pending = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    expect(pending.r.status).toBe(200);
    expect(pending.data?.ok).toBe(true);
    expect(pending.data?.pending).toEqual([]);

    const transcript = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`);
    expect(transcript.r.status).toBe(200);
    expect(transcript.data?.ok).toBe(true);
    expect(transcript.data?.transcripts).toEqual([]);

    const output = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/output`);
    expect(output.r.status).toBe(200);
    expect(output.data?.ok).toBe(true);
    expect(String(output.data?.text ?? '')).toBe('');
    expect(Number(output.data?.offsetBytes ?? 0)).toBe(0);
  });
});
