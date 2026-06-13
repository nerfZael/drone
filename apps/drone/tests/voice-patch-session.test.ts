import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('voice patch sessions', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-voice-patch-session-'));
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
    const data = text ? JSON.parse(text) : null;
    return { r, data };
  };

  const postJson = async (p: string, body: unknown) =>
    await apiFetch(p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const seedDrone = async (id: string, chatName: string, pendingPrompts: any[] = []) => {
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
          [chatName]: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'codex' },
            turns: [],
            pendingPrompts,
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

  test('submits to the chat captured when that patch session started', async () => {
    await seedDrone('voice-patch-a', 'alpha', [
      {
        id: 'existing-prompt',
        at: '2026-05-20T00:00:00.000Z',
        prompt: 'existing prompt',
        state: 'sending',
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
    ]);
    await seedDrone('voice-patch-b', 'beta');

    const contextA = await postJson('/api/assistant/context', {
      activeDroneId: 'voice-patch-a',
      activeDroneName: 'Voice Patch A',
      activeChatName: 'alpha',
      appView: 'workspace',
    });
    expect(contextA.r.status).toBe(200);

    const patchA = await postJson('/api/assistant/voice/patch-state', {
      active: true,
      source: 'android',
      sessionId: 'session-a',
    });
    expect(patchA.r.status).toBe(200);
    expect(patchA.data?.droneId).toBe('voice-patch-a');
    expect(patchA.data?.chatName).toBe('alpha');

    const contextB = await postJson('/api/assistant/context', {
      activeDroneId: 'voice-patch-b',
      activeDroneName: 'Voice Patch B',
      activeChatName: 'beta',
      appView: 'workspace',
    });
    expect(contextB.r.status).toBe(200);

    const patchB = await postJson('/api/assistant/voice/patch-state', {
      active: true,
      source: 'desktop',
      sessionId: 'session-b',
    });
    expect(patchB.r.status).toBe(200);
    expect(patchB.data?.droneId).toBe('voice-patch-b');
    expect(patchB.data?.chatName).toBe('beta');

    const submitted = await postJson('/api/assistant/voice/patch-message', {
      prompt: 'send this to the first selected chat',
      source: 'android',
      sessionId: 'session-a',
    });
    expect(submitted.r.status).toBe(202);
    expect(submitted.data?.droneId).toBe('voice-patch-a');
    expect(submitted.data?.chatName).toBe('alpha');

    const reg: any = await loadRegistry();
    expect(reg.drones['voice-patch-a'].chats.alpha.pendingPrompts).toMatchObject([
      {
        prompt: 'existing prompt',
        state: 'sending',
      },
      {
        prompt: 'send this to the first selected chat',
        state: 'queued',
      },
    ]);
    expect(reg.drones['voice-patch-b'].chats.beta.pendingPrompts).toEqual([]);
  });
});
