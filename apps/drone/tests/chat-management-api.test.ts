import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { loadRegistry, updateRegistry } from '../src/host/registry';
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

  test('applies the auto-continue default to newly created builtin chats', async () => {
    const droneId = 'drone-chat-create-auto-continue-default';
    await seedDrone(droneId);

    const settingsUpdated = await apiFetch('/api/settings/agent-message-auto-continue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabledByDefault: true }),
    });
    expect(settingsUpdated.r.status).toBe(200);
    expect(settingsUpdated.data?.agentMessageAutoContinue?.enabledByDefault).toBe(true);

    const created = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'review' }),
    });
    expect(created.r.status).toBe(201);

    const reviewChat = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/review`);
    expect(reviewChat.r.status).toBe(200);
    expect(reviewChat.data?.agentMessageAutoContinueEnabled).toBe(true);

    const regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.review?.agentMessageAutoContinueEnabled).toBe(true);
    expect(typeof regAny?.drones?.[droneId]?.chats?.review?.agentMessageAutoContinueEnabledAt).toBe('string');

    const settingsReset = await apiFetch('/api/settings/agent-message-auto-continue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabledByDefault: false }),
    });
    expect(settingsReset.r.status).toBe(200);
  });

  test('applies the assistant suggestion default to newly created builtin chats', async () => {
    const droneId = 'drone-chat-create-assistant-suggestion-default';
    await seedDrone(droneId);

    const settingsUpdated = await apiFetch('/api/settings/agent-suggestion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabledByDefault: true }),
    });
    expect(settingsUpdated.r.status).toBe(200);
    expect(settingsUpdated.data?.agentSuggestion?.enabledByDefault).toBe(true);

    const created = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'review' }),
    });
    expect(created.r.status).toBe(201);

    const reviewChat = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/review`);
    expect(reviewChat.r.status).toBe(200);
    expect(reviewChat.data?.agentSuggestionEnabled).toBe(true);

    const regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.review?.agentSuggestionEnabled).toBe(true);
    expect(typeof regAny?.drones?.[droneId]?.chats?.review?.agentSuggestionEnabledAt).toBe('string');

    const settingsReset = await apiFetch('/api/settings/agent-suggestion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabledByDefault: false }),
    });
    expect(settingsReset.r.status).toBe(200);
  });

  test('defaults docker snapshots on for no-volume container chats and preserves explicit off', async () => {
    const droneId = 'drone-chat-snapshot-default';
    await seedDrone(droneId, { runtime: 'container', persistVolume: false });

    const initial = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(initial.r.status).toBe(200);
    expect(initial.data?.dockerSnapshotAfterAgentMessageEnabled).toBe(true);

    let regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.dockerSnapshotAfterAgentMessageEnabled).toBeUndefined();

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

  test('defaults fleet-created drones to codex when materializing chats', async () => {
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

  test('stores and returns per-chat auto-continue toggle state', async () => {
    const droneId = 'drone-chat-auto-continue';
    await seedDrone(droneId);

    const initial = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(initial.r.status).toBe(200);
    expect(initial.data?.agentMessageAutoContinueEnabled).toBe(false);

    const updated = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentMessageAutoContinueEnabled: true }),
    });
    expect(updated.r.status).toBe(200);
    expect(updated.data?.agentMessageAutoContinueEnabled).toBe(true);

    const chatInfo = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(chatInfo.r.status).toBe(200);
    expect(chatInfo.data?.agentMessageAutoContinueEnabled).toBe(true);

    const regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.agentMessageAutoContinueEnabled).toBe(true);
    expect(typeof regAny?.drones?.[droneId]?.chats?.default?.agentMessageAutoContinueEnabledAt).toBe('string');
  });

  test('rejects enabling auto-continue for custom-agent chats', async () => {
    const droneId = 'drone-chat-auto-continue-custom';
    await seedDrone(droneId);

    const setCustom = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: {
          kind: 'custom',
          id: 'custom-shell',
          label: 'Custom Shell',
          command: 'custom-shell',
        },
      }),
    });
    expect(setCustom.r.status).toBe(200);

    const updated = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentMessageAutoContinueEnabled: true }),
    });
    expect(updated.r.status).toBe(400);
    expect(String(updated.data?.error ?? '')).toContain('builtin transcript chats');
  });

  test('stores and returns per-chat assistant suggestion toggle state', async () => {
    const droneId = 'drone-chat-assistant-suggestion';
    await seedDrone(droneId);

    const initial = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(initial.r.status).toBe(200);
    expect(initial.data?.agentSuggestionEnabled).toBe(false);

    const updated = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentSuggestionEnabled: true }),
    });
    expect(updated.r.status).toBe(200);
    expect(updated.data?.agentSuggestionEnabled).toBe(true);

    const chatInfo = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default`);
    expect(chatInfo.r.status).toBe(200);
    expect(chatInfo.data?.agentSuggestionEnabled).toBe(true);

    const regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.default?.agentSuggestionEnabled).toBe(true);
    expect(typeof regAny?.drones?.[droneId]?.chats?.default?.agentSuggestionEnabledAt).toBe('string');
  });

  test('rejects enabling assistant suggestion for custom-agent chats', async () => {
    const droneId = 'drone-chat-assistant-suggestion-custom';
    await seedDrone(droneId);

    const setCustom = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: {
          kind: 'custom',
          id: 'custom-shell',
          label: 'Custom Shell',
          command: 'custom-shell',
        },
      }),
    });
    expect(setCustom.r.status).toBe(200);

    const updated = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentSuggestionEnabled: true }),
    });
    expect(updated.r.status).toBe(400);
    expect(String(updated.data?.error ?? '')).toContain('builtin transcript chats');
  });

  test('records assistant suggestions as used only through the direct-use endpoint', async () => {
    const droneId = 'drone-chat-assistant-suggestion-used-direct';
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
          prompt: 'show me the diff',
          ok: true,
          output: 'I restored the feature and changed the button behavior.',
        },
      ];
    });

    const before = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`);
    expect(before.r.status).toBe(200);
    expect(before.data?.transcripts?.[0]?.agentSuggestion).toBeUndefined();

    const marked = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript/prompt-1/agent-suggestion/used-direct`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          suggestion: 'Continue',
          policyFingerprint: 'abc123def456',
        }),
      },
    );
    expect(marked.r.status).toBe(200);
    expect(marked.data?.promptId).toBe('prompt-1');

    const after = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`);
    expect(after.r.status).toBe(200);
    expect(after.data?.transcripts?.[0]?.agentSuggestion?.usedDirectAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(after.data?.transcripts?.[0]?.agentSuggestion?.policyFingerprint).toBe('abc123def456');
    expect(String(after.data?.transcripts?.[0]?.agentSuggestion?.suggestionHash ?? '')).toHaveLength(24);
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
    expect(state.data?.transcripts?.map((row: any) => row.id)).toEqual(['prompt-2']);
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

  test('does not surface completed transcript prompts as pending or fleet work', async () => {
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

    const fleetWork = await apiFetch('/api/fleet/work');
    expect(fleetWork.r.status).toBe(200);
    expect(fleetWork.data?.ok).toBe(true);
    expect(Array.isArray(fleetWork.data?.items)).toBe(true);
    expect((fleetWork.data?.items ?? []).some((item: any) => item?.droneId === droneId && item?.promptId === 'prompt-1')).toBe(false);
    expect(Number(fleetWork.data?.counts?.stuck ?? 0)).toBe(0);
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
