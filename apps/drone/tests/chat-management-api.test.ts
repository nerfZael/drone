import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import {
  upsertChatInStore,
  upsertPendingPromptInStore,
  upsertTranscriptTurnInStore,
} from '../src/hub/transcript-store';
import { upsertCanonicalDroneLifecycle } from '../src/hub/drone-lifecycle-service';
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

  const seedDrone = async (id: string, opts?: { runtime?: 'container' | 'host'; persistVolume?: boolean }) => {
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      const runtime = opts?.runtime ?? 'container';
      reg.drones[id] = {
        id,
        name: id,
        runtime,
        ...(runtime === 'container' && typeof opts?.persistVolume === 'boolean' ? { persistVolume: opts.persistVolume } : {}),
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

  test('marks a canonical chat read when the lifecycle projection has no chat aggregate', async () => {
    const droneId = 'canonical-chat-read';
    const now = new Date().toISOString();
    await upsertCanonicalDroneLifecycle('real', droneId, {
      id: droneId,
      name: droneId,
      runtime: 'host',
      repoPath: '',
      createdAt: now,
    });
    await upsertChatInStore({
      droneId,
      chatName: 'default',
      chatEntry: {
        id: 'canonical-chat-id',
        createdAt: now,
        agent: { kind: 'builtin', id: 'codex' },
        turns: [],
        pendingPrompts: [],
      },
    });

    const marked = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/read`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ latestAgentTurnId: null, latestAgentRevision: 0 }),
      },
    );

    expect(marked.r.status).toBe(200);
    expect(marked.data).toMatchObject({ ok: true, id: droneId, chat: 'default' });
  });

  test('shares exact read cursors and rejects cursorless acknowledgements', async () => {
    const droneId = 'drone-shared-unread';
    await seedDrone(droneId);
    await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    await upsertTranscriptTurnInStore({
      droneId,
      chatName: 'default',
      turn: {
        id: 'turn-1',
        at: '2026-07-16T10:00:00.000Z',
        completedAt: '2026-07-16T10:01:00.000Z',
        prompt: 'Review this',
        ok: true,
        output: 'Reviewed',
      },
    });

    const listed = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    expect(listed.data?.unreadChats).toEqual(['default']);
    expect(listed.data?.chatReadStates?.default).toMatchObject({
      unread: true,
      latestAgentTurnId: 'turn-1',
      latestAgentRevision: 1,
    });

    const cursorless = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/read`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    );
    expect(cursorless.r.status).toBe(400);

    const stale = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/read`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ latestAgentTurnId: null, latestAgentRevision: 0 }),
      },
    );
    expect(stale.r.status).toBe(200);
    expect(stale.data?.readState?.unread).toBe(true);

    const read = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/read`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          latestAgentTurnId: 'turn-1',
          latestAgentRevision: 1,
          updatedByDeviceId: 'browser-test',
        }),
      },
    );
    expect(read.r.status).toBe(200);
    expect(read.data?.readState?.unread).toBe(false);
  });

  test('offers auto-rename only for the first prompt in a generated chat name', async () => {
    const droneId = 'drone-chat-first-prompt-auto-rename';
    await seedDrone(droneId);

    const generated = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'chat-2' }),
    });
    expect(generated.r.status).toBe(201);

    const firstPrompt = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/chat-2/prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Fix the login redirect loop',
          autoRenameHandledByClient: true,
        }),
      },
    );
    expect(firstPrompt.r.status).toBe(202);
    expect(firstPrompt.data?.autoRenameChat).toBe(true);

    const secondPrompt = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/chat-2/prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Add a regression test too',
          autoRenameHandledByClient: true,
        }),
      },
    );
    expect(secondPrompt.r.status).toBe(202);
    expect(secondPrompt.data?.autoRenameChat).toBe(false);

    const customNamed = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'login-review' }),
    });
    expect(customNamed.r.status).toBe(201);
    const customPrompt = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/login-review/prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'This manually named chat must stay named' }),
      },
    );
    expect(customPrompt.r.status).toBe(202);
    expect(customPrompt.data?.autoRenameChat).toBe(false);

    const regAfterPrompts: any = await loadRegistry();
    expect(
      typeof regAfterPrompts?.drones?.[droneId]?.chats?.['chat-2']
        ?.firstMessageNameSuggestionAttemptedAt,
    ).toBe('string');

    const defaultPrompt = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'Keep this chat name' }),
      },
    );
    expect(defaultPrompt.r.status).toBe(202);
    expect(defaultPrompt.data?.autoRenameChat).toBe(false);
  });

  test('defaults docker snapshots off for no-volume container chats and preserves explicit choices', async () => {
    const droneId = 'drone-chat-snapshot-default';
    await seedDrone(droneId, { runtime: 'container', persistVolume: false });

    const initial = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(initial.r.status).toBe(200);
    expect(initial.data?.dockerSnapshotAfterAgentMessageEnabled).toBe(false);

    let regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.dockerSnapshotAfterAgentMessageEnabled).toBeUndefined();

    const enabled = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dockerSnapshotAfterAgentMessageEnabled: true }),
    });
    expect(enabled.r.status).toBe(200);
    expect(enabled.data?.dockerSnapshotAfterAgentMessageEnabled).toBe(true);

    const enabledAfter = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(enabledAfter.r.status).toBe(200);
    expect(enabledAfter.data?.dockerSnapshotAfterAgentMessageEnabled).toBe(true);

    regAny = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.dockerSnapshotAfterAgentMessageEnabled).toBe(true);
    expect(typeof regAny?.drones?.[droneId]?.chats?.default?.dockerSnapshotAfterAgentMessageEnabledAt).toBe('string');

    const disabled = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dockerSnapshotAfterAgentMessageEnabled: false }),
    });
    expect(disabled.r.status).toBe(200);
    expect(disabled.data?.dockerSnapshotAfterAgentMessageEnabled).toBe(false);

    const after = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(after.r.status).toBe(200);
    expect(after.data?.dockerSnapshotAfterAgentMessageEnabled).toBe(false);

    regAny = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.dockerSnapshotAfterAgentMessageEnabled).toBe(false);
    expect(regAny?.drones?.[droneId]?.chats?.default?.dockerSnapshotAfterAgentMessageEnabledAt).toBeUndefined();
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

  test('defaults child drones to codex when materializing chats', async () => {
    const droneId = 'drone-chat-fleet-default';
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
        fleet: {
          createdBy: 'parent-fleet-drone',
          createdAt: now,
          enabled: false,
          capabilities: [],
          readScopes: ['children'],
          assigned: [],
        },
      };
    });

    const created = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'review', copyFromChat: 'default' }),
    });
    expect(created.r.status).toBe(201);
    expect(created.data?.ok).toBe(true);

    const regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.agent).toEqual({ kind: 'builtin', id: 'codex' });
    expect(regAny?.drones?.[droneId]?.chats?.review?.agent).toEqual({ kind: 'builtin', id: 'codex' });
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

  test('stores and returns per-chat agent permission mode for supported agents', async () => {
    const droneId = 'drone-chat-agent-permission';
    await seedDrone(droneId);

    const initial = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(initial.r.status).toBe(200);
    expect(initial.data?.agentPermissionMode).toBe('full-access');

    const updated = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: { kind: 'builtin', id: 'codex' },
        agentPermissionMode: 'read-only',
      }),
    });
    expect(updated.r.status).toBe(200);
    expect(updated.data?.agentPermissionMode).toBe('read-only');

    const chatInfo = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(chatInfo.r.status).toBe(200);
    expect(chatInfo.data?.agentPermissionMode).toBe('read-only');

    let regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.agentPermissionMode).toBe('read-only');

    const disabled = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentPermissionMode: 'full-access' }),
    });
    expect(disabled.r.status).toBe(200);
    expect(disabled.data?.agentPermissionMode).toBe('full-access');

    regAny = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.agentPermissionMode).toBeUndefined();
  });

  test('locks every agent change after chat history exists', async () => {
    const droneId = 'drone-chat-agent-lock';
    await seedDrone(droneId);
    await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    const now = new Date().toISOString();
    await upsertTranscriptTurnInStore({
      droneId,
      chatName: 'default',
      turn: {
        id: 'history-turn',
        at: now,
        promptAt: now,
        completedAt: now,
        prompt: 'Keep this history',
        ok: true,
        output: 'Kept',
      },
    });

    const info = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(info.r.status).toBe(200);
    expect(info.data?.agentLocked).toBe(true);

    const rejected = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/config`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: { kind: 'native' } }),
      },
    );
    expect(rejected.r.status).toBe(409);
    expect(String(rejected.data?.error ?? '')).toContain('Create a new chat');

    const externalSwitch = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/config`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: { kind: 'builtin', id: 'claude' } }),
      },
    );
    expect(externalSwitch.r.status).toBe(409);
    expect(String(externalSwitch.data?.error ?? '')).toContain('Create a new chat');

    const unchangedAgent = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/config`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: { kind: 'builtin', id: 'cursor' } }),
      },
    );
    expect(unchangedAgent.r.status).toBe(200);
  });

  test('clones an empty Built-in chat before its native session has been opened', async () => {
    const droneId = 'drone-chat-empty-native-clone';
    await seedDrone(droneId);
    const configured = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/config`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: { kind: 'native' } }),
      },
    );
    expect(configured.r.status).toBe(200);

    const cloned = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'review', copyFrom: 'default' }),
    });
    expect(cloned.r.status).toBe(201);

    const opened = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/review/native?includeHistory=1`,
      { method: 'POST' },
    );
    expect(opened.r.status).toBe(200);
    expect(String(opened.data?.nativeChatId ?? '')).toMatch(/^[0-9a-f-]{36}$/i);
    expect(opened.data?.initialHistory).toEqual({
      version: 1,
      threadId: opened.data.nativeChatId,
      sessionId: null,
      entries: [],
      page: { limit: 80, beforeCursor: null, hasOlder: false },
    });
  });

  test('clears read-only agent permission mode when switching to an unsupported agent', async () => {
    const droneId = 'drone-chat-agent-permission-clear';
    await seedDrone(droneId);

    const readOnly = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: { kind: 'builtin', id: 'codex' },
        agentPermissionMode: 'read-only',
      }),
    });
    expect(readOnly.r.status).toBe(200);

    const switched = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { kind: 'builtin', id: 'cursor' } }),
    });
    expect(switched.r.status).toBe(200);

    const chatInfo = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(chatInfo.r.status).toBe(200);
    expect(chatInfo.data?.agent).toEqual({ kind: 'builtin', id: 'cursor' });
    expect(chatInfo.data?.agentPermissionMode).toBe('full-access');

    const regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.agentPermissionMode).toBeUndefined();
  });

  test('rejects read-only agent permission mode for unsupported agents', async () => {
    const droneId = 'drone-chat-agent-permission-unsupported';
    await seedDrone(droneId);

    const updated = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentPermissionMode: 'read-only' }),
    });
    expect(updated.r.status).toBe(400);
    expect(String(updated.data?.error ?? '')).toContain('Codex and Blip');
  });

  test('returns conditional transcript reads as 304 when unchanged', async () => {
    const droneId = 'drone-chat-transcript-etag';
    await seedDrone(droneId);

    const completedAt = new Date().toISOString();
    await updateRegistry((reg: any) => {
      const entry = reg?.drones?.[droneId]?.chats?.default;
      if (!entry) throw new Error('missing seeded chat entry');
      entry.turns = [
        {
          id: 'prompt-1',
          at: completedAt,
          promptAt: completedAt,
          completedAt,
          prompt: 'hello',
          ok: true,
          output: 'done',
        },
      ];
    });

    const first = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`);
    expect(first.r.status).toBe(200);
    const etag = first.r.headers.get('etag');
    expect(etag).toMatch(/^"transcript-/);

    const second = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`, {
      headers: { 'if-none-match': etag ?? '' },
    });
    expect(second.r.status).toBe(304);
    expect(second.data).toBeNull();
  });

  test('combined chat state matches transcript and pending reads', async () => {
    const droneId = 'drone-chat-combined-state';
    await seedDrone(droneId);

    const firstAt = new Date(Date.now() - 60_000).toISOString();
    const secondAt = new Date().toISOString();
    await updateRegistry((reg: any) => {
      const entry = reg?.drones?.[droneId]?.chats?.default;
      if (!entry) throw new Error('missing seeded chat entry');
      entry.model = 'configured-model';
      entry.turns = [
        {
          id: 'prompt-1',
          at: firstAt,
          promptAt: firstAt,
          completedAt: firstAt,
          prompt: 'first',
          ok: true,
          output: 'first done',
        },
        {
          id: 'prompt-2',
          at: secondAt,
          promptAt: secondAt,
          completedAt: secondAt,
          prompt: 'second',
          model: 'actual-turn-model',
          reasoning: 'high',
          ok: true,
          output: 'second done',
        },
      ];
      entry.pendingPrompts = [
        {
          id: 'queued-1',
          at: secondAt,
          updatedAt: secondAt,
          prompt: 'queued',
          state: 'queued',
        },
        {
          id: 'prompt-2',
          at: secondAt,
          updatedAt: secondAt,
          prompt: 'second',
          state: 'sent',
        },
      ];
    });

    const transcript = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all&tail=1`);
    expect(transcript.r.status).toBe(200);
    const pending = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    expect(pending.r.status).toBe(200);

    const state = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/state?turn=all&tail=1`);
    expect(state.r.status).toBe(200);
    expect(state.data?.ok).toBe(true);
    expect(state.data?.id).toBe(droneId);
    expect(state.data?.chat).toBe('default');
    expect(state.data?.selection).toBe('all');
    expect(state.data?.transcripts).toEqual(transcript.data?.transcripts);
    expect(state.data?.pending).toEqual(pending.data?.pending);
    expect(state.data?.agent).toEqual(transcript.data?.agent);
    expect(state.data?.model).toBe('configured-model');
    expect(state.data?.transcripts?.map((row: any) => row.id)).toEqual(['prompt-2']);
    expect(state.data?.transcripts?.[0]?.model).toBe('actual-turn-model');
    expect(state.data?.transcripts?.[0]?.reasoning).toBe('high');
    expect((state.data?.pending ?? []).map((row: any) => row.id)).toContain('queued-1');
    expect((state.data?.pending ?? []).map((row: any) => row.id)).toContain('prompt-2');

    const etag = state.r.headers.get('etag');
    expect(etag).toMatch(/^"sha256-/);
    const unchanged = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/state?turn=all&tail=1`, {
      headers: { 'if-none-match': etag ?? '' },
    });
    expect(unchanged.r.status).toBe(304);
    expect(unchanged.data).toBeNull();

    await updateRegistry((reg: any) => {
      const entry = reg?.drones?.[droneId]?.chats?.default;
      if (!entry) throw new Error('missing seeded chat entry');
      entry.pendingPrompts = [
        ...(Array.isArray(entry.pendingPrompts) ? entry.pendingPrompts : []),
        {
          id: 'queued-2',
          at: new Date().toISOString(),
          prompt: 'queued again',
          state: 'queued',
        },
      ];
    });

    const pendingChanged = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/state?turn=all&tail=1`, {
      headers: { 'if-none-match': etag ?? '' },
    });
    expect(pendingChanged.r.status).toBe(200);
    expect((pendingChanged.data?.pending ?? []).map((row: any) => row.id)).toContain('queued-2');
  });

  test('combined chat state includes store-only pending rows', async () => {
    const droneId = 'drone-chat-state-store-pending';
    await seedDrone(droneId);

    const now = new Date().toISOString();
    upsertPendingPromptInStore({
      droneId,
      chatName: 'default',
      pending: {
        id: 'store-only-queued',
        at: now,
        updatedAt: now,
        prompt: 'queued only in store',
        state: 'queued',
      },
    });

    const state = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/state?turn=all&tail=50`);
    expect(state.r.status).toBe(200);
    expect(state.data?.ok).toBe(true);
    expect(state.data?.pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'store-only-queued',
          prompt: 'queued only in store',
          state: 'queued',
        }),
      ]),
    );
  });

  test('combined chat state uses the same chronological transcript projection as transcript reads', async () => {
    const droneId = 'drone-chat-state-transcript-order';
    await seedDrone(droneId);

    const olderAt = new Date(Date.now() - 120_000).toISOString();
    const newerAt = new Date(Date.now() - 30_000).toISOString();
    await updateRegistry((reg: any) => {
      const entry = reg?.drones?.[droneId]?.chats?.default;
      if (!entry) throw new Error('missing seeded chat entry');
      entry.turns = [
        {
          id: 'prompt-newer',
          at: newerAt,
          promptAt: newerAt,
          completedAt: newerAt,
          prompt: 'newer prompt',
          ok: true,
          output: 'newer output',
        },
        {
          id: 'prompt-older',
          at: olderAt,
          promptAt: olderAt,
          completedAt: olderAt,
          prompt: 'older prompt',
          ok: true,
          output: 'older output',
        },
      ];
    });

    const transcript = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all&tail=1`);
    expect(transcript.r.status).toBe(200);
    expect(transcript.data?.transcripts?.map((row: any) => row.id)).toEqual(['prompt-newer']);

    const state = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/state?turn=all&tail=1`);
    expect(state.r.status).toBe(200);
    expect(state.data?.transcripts).toEqual(transcript.data?.transcripts);
  });

  test('combined chat state supports transcript and pending read modes', async () => {
    const droneId = 'drone-chat-state-read-modes';
    await seedDrone(droneId);

    const firstAt = new Date(Date.now() - 60_000).toISOString();
    const secondAt = new Date().toISOString();
    await updateRegistry((reg: any) => {
      const entry = reg?.drones?.[droneId]?.chats?.default;
      if (!entry) throw new Error('missing seeded chat entry');
      entry.turns = [
        {
          id: 'prompt-1',
          at: firstAt,
          promptAt: firstAt,
          completedAt: firstAt,
          prompt: 'first',
          ok: true,
          output: 'first done',
        },
        {
          id: 'prompt-2',
          at: secondAt,
          promptAt: secondAt,
          completedAt: secondAt,
          prompt: 'second',
          ok: true,
          output: 'second done',
        },
      ];
      entry.pendingPrompts = [
        {
          id: 'queued-1',
          at: secondAt,
          updatedAt: secondAt,
          prompt: 'queued',
          state: 'queued',
        },
      ];
    });

    const transcriptOnly = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/state?transcript=full&pending=none`,
    );
    expect(transcriptOnly.r.status).toBe(200);
    expect(transcriptOnly.data?.transcripts?.map((row: any) => row.id)).toEqual(['prompt-1', 'prompt-2']);
    expect(transcriptOnly.data?.pending).toEqual([]);
    expect(transcriptOnly.data?.transcript?.items).toEqual(transcriptOnly.data?.transcripts);
    expect(transcriptOnly.data?.transcript?.total).toBe(2);

    const pendingOnly = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/state?transcript=none`,
    );
    expect(pendingOnly.r.status).toBe(200);
    expect(pendingOnly.data?.transcripts).toEqual([]);
    expect(pendingOnly.data?.pending?.map((row: any) => row.id)).toContain('queued-1');
    expect(pendingOnly.data?.pendingPrompts?.items).toEqual(pendingOnly.data?.pending);
  });

  test('combined chat state rejects unknown transcript modes', async () => {
    const droneId = 'drone-chat-state-invalid-mode';
    await seedDrone(droneId);

    const state = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/state?transcript=surprise`);
    expect(state.r.status).toBe(400);
    expect(String(state.data?.error ?? '')).toContain('invalid transcript mode');
  });

  test('combined chat state rejects unknown pending modes', async () => {
    const droneId = 'drone-chat-state-invalid-pending-mode';
    await seedDrone(droneId);

    const state = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/state?pending=surprise`);
    expect(state.r.status).toBe(400);
    expect(String(state.data?.error ?? '')).toContain('invalid pending mode');
  });

  test('transcript reads do not create missing chats', async () => {
    const droneId = 'drone-chat-transcript-read-only';
    await seedDrone(droneId);

    const missing = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/review/transcript?turn=all`);
    expect(missing.r.status).toBe(404);

    const reg: any = await loadRegistry();
    expect(reg?.drones?.[droneId]?.chats?.review).toBeUndefined();
  });

  test('pending reads do not create missing chats', async () => {
    const droneId = 'drone-chat-pending-read-only';
    await seedDrone(droneId);

    const missing = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/review/pending`);
    expect(missing.r.status).toBe(404);

    const reg: any = await loadRegistry();
    expect(reg?.drones?.[droneId]?.chats?.review).toBeUndefined();
  });

  test('combined state reads do not create missing chats', async () => {
    const droneId = 'drone-chat-state-read-only';
    await seedDrone(droneId);

    const missing = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/review/state?turn=all`);
    expect(missing.r.status).toBe(404);

    const reg: any = await loadRegistry();
    expect(reg?.drones?.[droneId]?.chats?.review).toBeUndefined();
  });

  test('combined state route supports a chat named state', async () => {
    const droneId = 'drone-chat-state-name';
    await seedDrone(droneId);

    const created = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'state' }),
    });
    expect(created.r.status).toBe(201);

    const state = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/state/state?turn=all&tail=50`);
    expect(state.r.status).toBe(200);
    expect(state.data?.ok).toBe(true);
    expect(state.data?.chat).toBe('state');
    expect(state.data?.transcripts).toEqual([]);
    expect(state.data?.pending).toEqual([]);
  });

  test('combined state preserves custom-agent transcript error shape', async () => {
    const droneId = 'drone-chat-state-custom-agent';
    await seedDrone(droneId);
    await updateRegistry((reg: any) => {
      const entry = reg?.drones?.[droneId]?.chats?.default;
      if (!entry) throw new Error('missing seeded chat entry');
      entry.agent = { kind: 'custom', id: 'custom-test', label: 'Custom Test', command: 'custom-agent' };
    });

    const transcript = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`);
    expect(transcript.r.status).toBe(410);

    const state = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/state?turn=all&tail=50`);
    expect(state.r.status).toBe(410);
    expect(state.data?.ok).toBe(false);
    expect(state.data?.error).toBe(transcript.data?.error);
    expect(state.data?.agent).toEqual(transcript.data?.agent);
  });

  test('archives chats when delete mode is archive and supports restore/delete-now', async () => {
    const droneId = 'drone-chat-archive';
    await seedDrone(droneId);

    const settings = await apiFetch('/api/settings/delete-action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'archive',
        archiveRetention: '1d',
        archiveRuntimePolicy: 'keep-running',
      }),
    });
    expect(settings.r.status).toBe(200);

    const created = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'review' }),
    });
    expect(created.r.status).toBe(201);
    await updateRegistry((reg: any) => {
      reg.drones[droneId].chats.review.turns = [{
        id: 'archived-turn',
        at: '2026-01-01T00:01:00.000Z',
        prompt: 'Review this',
        ok: true,
        output: 'Reviewed',
      }];
    });

    const archived = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/review`, {
      method: 'DELETE',
    });
    expect(archived.r.status).toBe(200);
    expect(archived.data?.archivedChat).toBe('review');

    const listedAfterArchive = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    expect(listedAfterArchive.r.status).toBe(200);
    expect((listedAfterArchive.data?.chats ?? []).includes('review')).toBe(false);

    const archivedChats = await apiFetch('/api/archive/chats');
    expect(archivedChats.r.status).toBe(200);
    expect(
      (archivedChats.data?.archived ?? []).some(
        (row: any) => row?.droneId === droneId && row?.chatName === 'review',
      ),
    ).toBe(true);

    const restored = await apiFetch(`/api/archive/drones/${encodeURIComponent(droneId)}/chats/review/restore`, {
      method: 'POST',
    });
    expect(restored.r.status).toBe(200);
    expect(restored.data?.chat).toBe('review');

    const listedAfterRestore = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    expect(listedAfterRestore.r.status).toBe(200);
    expect((listedAfterRestore.data?.chats ?? []).includes('review')).toBe(true);
    const registryAfterRestore: any = await loadRegistry();
    expect(registryAfterRestore?.drones?.[droneId]?.chats?.review?.turns?.[0]?.id).toBe('archived-turn');

    const archivedAgain = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/review`, {
      method: 'DELETE',
    });
    expect(archivedAgain.r.status).toBe(200);

    const deletedArchived = await apiFetch(`/api/archive/drones/${encodeURIComponent(droneId)}/chats/review`, {
      method: 'DELETE',
    });
    expect(deletedArchived.r.status).toBe(200);
    expect(deletedArchived.data?.deletedChat).toBe('review');

    const archivedChatsAfterDelete = await apiFetch('/api/archive/chats');
    expect(archivedChatsAfterDelete.r.status).toBe(200);
    expect(
      (archivedChatsAfterDelete.data?.archived ?? []).some(
        (row: any) => row?.droneId === droneId && row?.chatName === 'review',
      ),
    ).toBe(false);
    const registryAfterDelete: any = await loadRegistry();
    expect(registryAfterDelete?.drones?.[droneId]?.archivedChats?.review).toBeUndefined();

    await apiFetch('/api/settings/delete-action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'permanent',
        archiveRetention: '1d',
        archiveRuntimePolicy: 'keep-running',
      }),
    });
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

  test('combined chat state returns startup pending prompts for pending drones', async () => {
    const droneId = 'pending-chat-state-read';
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
        startupQueuedPrompts: [
          {
            id: 'startup-default',
            chatName: 'default',
            at: now,
            prompt: 'default startup prompt',
            state: 'queued',
            updatedAt: now,
          },
          {
            id: 'startup-review',
            chatName: 'review',
            at: now,
            prompt: 'review startup prompt',
            state: 'queued',
            updatedAt: now,
          },
        ],
      };
    });

    const chats = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    expect(chats.r.status).toBe(200);
    expect(chats.data?.ok).toBe(true);
    expect(chats.data?.chats).toEqual(['default', 'review']);

    const state = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/state?turn=all&tail=50`);
    expect(state.r.status).toBe(200);
    expect(state.data?.ok).toBe(true);
    expect(state.data?.transcripts).toEqual([]);
    expect(state.data?.selection).toBe('all');
    expect(state.data?.pending).toEqual([
      {
        id: 'startup-default',
        at: now,
        prompt: 'default startup prompt',
        state: 'queued',
        updatedAt: now,
      },
    ]);

    const pending = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    expect(pending.r.status).toBe(200);
    expect(state.data?.pending).toEqual(pending.data?.pending);
  });

  test('does not surface completed transcript prompts as pending', async () => {
    const droneId = 'completed-prompt-hidden';
    await seedDrone(droneId);

    const oldIso = new Date(Date.now() - 15 * 60_000).toISOString();
    await updateRegistry((reg: any) => {
      const entry = reg?.drones?.[droneId]?.chats?.default;
      if (!entry) throw new Error('missing seeded chat entry');
      entry.turns = [
        {
          id: 'prompt-1',
          at: oldIso,
          promptAt: oldIso,
          completedAt: oldIso,
          prompt: 'hello',
          ok: true,
          output: 'done',
        },
      ];
      entry.pendingPrompts = [
        {
          id: 'prompt-1',
          at: oldIso,
          updatedAt: oldIso,
          prompt: 'hello',
          state: 'sent',
        },
      ];
    });

    const pending = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    expect(pending.r.status).toBe(200);
    expect(pending.data?.ok).toBe(true);
    expect(pending.data?.pending).toEqual([]);

  });

  test('renames pending drones before startup completes', async () => {
    const droneId = 'pending-rename';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.pending = reg.pending ?? {};
      reg.pending[droneId] = {
        id: droneId,
        name: 'Untitled 1',
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

    const renamed = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newName: 'auth-bugfix', source: 'draft-auto-rename' }),
    });
    expect(renamed.r.status).toBe(200);
    expect(renamed.data?.ok).toBe(true);
    expect(renamed.data?.newName).toBe('auth-bugfix');

    const regAny: any = await loadRegistry();
    expect(String(regAny?.pending?.[droneId]?.name ?? '')).toBe('auth-bugfix');

    const oldRef = await apiFetch(`/api/drones/${encodeURIComponent('Untitled 1')}/chats/default/pending`);
    expect(oldRef.r.status).toBe(404);

    const newRef = await apiFetch(`/api/drones/${encodeURIComponent('auth-bugfix')}/chats/default/pending`);
    expect(newRef.r.status).toBe(200);
    expect(newRef.data?.ok).toBe(true);
    expect(newRef.data?.pending).toEqual([]);
  });

  test('renames both real and pending lifecycle entries when provisioning overlaps auto-rename', async () => {
    const droneId = 'split-rename';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.pending = reg.pending ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: 'Untitled 25',
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
      reg.pending[droneId] = {
        id: droneId,
        name: 'Untitled 25',
        runtime: 'host',
        repoPath: '',
        containerPort: 7777,
        build: false,
        createdAt: now,
        updatedAt: now,
        phase: 'creating',
        message: 'Creating...',
      };
    });

    const renamed = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newName: 'task-delete-cli', source: 'draft-auto-rename' }),
    });
    expect(renamed.r.status).toBe(200);
    expect(renamed.data?.ok).toBe(true);
    expect(renamed.data?.newName).toBe('task-delete-cli');

    const regAny: any = await loadRegistry();
    expect(String(regAny?.drones?.[droneId]?.name ?? '')).toBe('task-delete-cli');
    expect(String(regAny?.pending?.[droneId]?.name ?? '')).toBe('task-delete-cli');

    const oldRef = await apiFetch(`/api/drones/${encodeURIComponent('Untitled 25')}/chats/default/pending`);
    expect(oldRef.r.status).toBe(404);

    const newRef = await apiFetch(`/api/drones/${encodeURIComponent('task-delete-cli')}/chats/default/pending`);
    expect(newRef.r.status).toBe(200);
    expect(newRef.data?.ok).toBe(true);
  });
});
