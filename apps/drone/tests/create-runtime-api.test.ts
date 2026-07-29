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
  throw new Error(`create runtime api tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping create runtime api tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('create runtime api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-create-runtime-api-'));
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

  test('rejects invalid runtime in single create request', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'runtime-invalid-one', runtime: 'invalid-runtime' }),
    });
    expect(resp.r.status).toBe(400);
    expect(String(resp.data?.error ?? '')).toContain('invalid runtime');
  });

  test('rejects invalid runtime item in batch create request', async () => {
    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        drones: [{ name: 'runtime-invalid-batch', runtime: 'vm' }],
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);
    expect(Array.isArray(resp.data?.accepted)).toBe(true);
    expect((resp.data?.accepted ?? []).length).toBe(0);
    expect(Array.isArray(resp.data?.rejected)).toBe(true);
    expect((resp.data?.rejected ?? []).length).toBe(1);
    expect(String(resp.data?.rejected?.[0]?.error ?? '')).toContain('invalid runtime');
  });

  test('single create returns and persists initial message run state', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-create-state',
        runtime: 'container',
        seedPrompt: 'Start this work',
        seedSubmittedAt: '2026-06-21T12:00:00.000Z',
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);
    const droneId = String(resp.data?.id ?? '').trim();
    const promptId = String(resp.data?.initialMessage?.promptId ?? '').trim();
    expect(droneId).not.toBe('');
    expect(resp.data?.initialMessage).toMatchObject({
      chat: 'default',
      pendingState: 'queued',
      status: 'queued',
    });
    expect(promptId).not.toBe('');

    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.seed).toMatchObject({
      chatName: 'default',
      prompt: 'Start this work',
      promptId,
      submittedAt: '2026-06-21T12:00:00.000Z',
    });
  });

  test('single create persists supported read-only seed agent permission mode', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-read-only-agent',
        runtime: 'container',
        seedAgent: { kind: 'builtin', id: 'codex' },
        seedAgentPermissionMode: 'read-only',
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);

    const droneId = String(resp.data?.id ?? '').trim();
    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.seed).toMatchObject({
      chatName: 'default',
      agent: { kind: 'builtin', id: 'codex' },
      agentPermissionMode: 'read-only',
    });
  });

  test('single create persists a normalized per-drone AGENTS.md override', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'agents-override-single',
        runtime: 'container',
        repoPath: '/tmp/agents-override-single',
        pullHostBranchBeforeCreate: false,
        draft: true,
        agentsMd: '# Drone instructions\r\n\r\nUse the local workflow.',
      }),
    });
    expect(resp.r.status).toBe(201);
    expect(resp.data?.ok).toBe(true);

    const droneId = String(resp.data?.id ?? '').trim();
    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.agentsMdOverride).toBe(
      '# Drone instructions\n\nUse the local workflow.\n',
    );
  });

  test('batch create accepts an empty AGENTS.md override and rejects it without a repo', async () => {
    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        drones: [
          {
            name: 'agents-override-empty',
            runtime: 'container',
            repoPath: '/tmp/agents-override-empty',
            pullHostBranchBeforeCreate: false,
            draft: true,
            agentsMd: '',
          },
          {
            name: 'agents-override-no-repo',
            runtime: 'container',
            draft: true,
            agentsMd: '# Invalid without a repo',
          },
        ],
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.accepted).toHaveLength(1);
    expect(resp.data?.rejected).toHaveLength(1);
    expect(String(resp.data?.rejected?.[0]?.error ?? '')).toContain(
      'repo-attached container drones',
    );

    const droneId = String(resp.data?.accepted?.[0]?.id ?? '').trim();
    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]).toHaveProperty('agentsMdOverride', '');
  });

  test('single create rejects read-only seed permission without a supported seed agent', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-read-only-agent-invalid',
        runtime: 'container',
        seedAgentPermissionMode: 'read-only',
      }),
    });
    expect(resp.r.status).toBe(400);
    expect(String(resp.data?.error ?? '')).toContain(
      'require a native, Codex, or Blip seed agent',
    );
  });

  test('batch create persists and rejects read-only seed agent permission mode per item', async () => {
    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        drones: [
          {
            name: 'batch-read-only-agent',
            runtime: 'container',
            seedAgent: { kind: 'builtin', id: 'blip' },
            seedAgentPermissionMode: 'read-only',
          },
          {
            name: 'batch-read-only-agent-invalid',
            runtime: 'container',
            seedAgent: { kind: 'builtin', id: 'cursor' },
            seedAgentPermissionMode: 'read-only',
          },
        ],
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);
    expect(resp.data?.accepted).toHaveLength(1);
    expect(resp.data?.rejected).toHaveLength(1);
    expect(String(resp.data?.rejected?.[0]?.error ?? '')).toContain(
      'native, Codex, and Blip',
    );

    const droneId = String(resp.data?.accepted?.[0]?.id ?? '').trim();
    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.seed).toMatchObject({
      chatName: 'default',
      agent: { kind: 'builtin', id: 'blip' },
      agentPermissionMode: 'read-only',
    });
  });

  test('single create persists supported access and approval seed settings', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-codex-auto-review',
        runtime: 'container',
        seedAgent: { kind: 'builtin', id: 'codex' },
        seedAgentPermissionMode: 'workspace-write',
        seedApprovalPolicy: 'agent-decides',
      }),
    });
    expect(resp.r.status).toBe(202);

    const droneId = String(resp.data?.id ?? '').trim();
    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.seed).toMatchObject({
      chatName: 'default',
      agent: { kind: 'builtin', id: 'codex' },
      agentPermissionMode: 'workspace-write',
      approvalPolicy: 'agent-decides',
    });
  });

  test('single create rejects unsupported seed approval settings', async () => {
    const nativeAutoReview = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-native-auto-review-invalid',
        runtime: 'container',
        seedAgent: { kind: 'native' },
        seedApprovalPolicy: 'agent-decides',
      }),
    });
    expect(nativeAutoReview.r.status).toBe(400);
    expect(String(nativeAutoReview.data?.error ?? '')).toContain('only available for Codex');

    const cursorAllowAll = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-cursor-allow-all-invalid',
        runtime: 'container',
        seedAgent: { kind: 'builtin', id: 'cursor' },
        seedApprovalPolicy: 'never',
      }),
    });
    expect(cursorAllowAll.r.status).toBe(400);
    expect(String(cursorAllowAll.data?.error ?? '')).toContain('native and Codex');
  });

  test('single create honors and validates supplied seed prompt ids', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-create-supplied-id',
        runtime: 'container',
        seedPrompt: 'Use this id',
        seedPromptId: 'voice-seed-1',
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.initialMessage?.promptId).toBe('voice-seed-1');

    const invalid = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-create-invalid-id',
        runtime: 'container',
        seedPrompt: 'Bad id',
        seedPromptId: '../bad',
      }),
    });
    expect(invalid.r.status).toBe(400);
    expect(String(invalid.data?.error ?? '')).toContain('invalid seedPromptId');
  });

  test('batch create persists requested fleet parent lineage', async () => {
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = {
        'task-parent': {
          id: 'task-parent',
          name: 'task-parent',
          runtime: 'container',
          containerPort: 7777,
          repoPath: '',
          createdAt: now,
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
        },
      };
    });

    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        drones: [{ name: 'task-child', runtime: 'container', fleetParentId: 'task-parent' }],
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);
    expect((resp.data?.accepted ?? []).length).toBe(1);
    const childId = String(resp.data?.accepted?.[0]?.id ?? '').trim();
    expect(childId).not.toBe('');

    const regAny: any = await loadRegistry();
    expect(String(regAny?.pending?.[childId]?.fleet?.createdBy ?? '')).toBe('task-parent');

    const listResp = await apiFetch('/api/drones');
    expect(listResp.r.status).toBe(200);
    const child = Array.isArray(listResp.data?.drones)
      ? listResp.data.drones.find((item: any) => String(item?.id ?? '').trim() === childId)
      : null;
    expect(String(child?.fleetParentId ?? '')).toBe('task-parent');
  });

  test('batch create rejects unknown fleet parent references', async () => {
    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        drones: [{ name: 'missing-parent-child', runtime: 'container', fleetParentId: 'missing-parent' }],
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);
    expect((resp.data?.accepted ?? []).length).toBe(0);
    expect((resp.data?.rejected ?? []).length).toBe(1);
    expect(resp.data?.rejected?.[0]?.status).toBe(404);
    expect(String(resp.data?.rejected?.[0]?.error ?? '')).toContain('unknown fleet parent drone');
  });

  test('batch create persists no-volume container option', async () => {
    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        drones: [{ name: 'no-volume-batch', runtime: 'container', persistVolume: false }],
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);
    expect((resp.data?.accepted ?? []).length).toBe(1);
    const droneId = String(resp.data?.accepted?.[0]?.id ?? '').trim();
    expect(droneId).not.toBe('');

    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.persistVolume).toBe(false);

    const listResp = await apiFetch('/api/drones');
    expect(listResp.r.status).toBe(200);
    const pending = Array.isArray(listResp.data?.drones)
      ? listResp.data.drones.find((item: any) => String(item?.id ?? '').trim() === droneId)
      : null;
    expect(pending?.persistVolume).toBe(false);
  });

  test('single create persists repo seed source drone references', async () => {
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = {
        ...(reg.drones ?? {}),
        'seed-parent': {
          id: 'seed-parent',
          name: 'seed-parent',
          runtime: 'container',
          containerName: 'seed-parent',
          containerPort: 7777,
          repoPath: '/work/repo',
          repo: { dest: '/work/repo', branch: 'dvm/work' },
          createdAt: now,
          chats: { default: { createdAt: now, turns: [], pendingPrompts: [] } },
        },
      };
    });

    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seed-child',
        runtime: 'container',
        repoPath: '/work/repo',
        pullHostBranchBeforeCreate: false,
        fleetParentId: 'seed-parent',
        repoSeedFromDroneId: 'seed-parent',
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);
    const childId = String(resp.data?.id ?? '').trim();
    expect(childId).not.toBe('');

    const regAny: any = await loadRegistry();
    expect(String(regAny?.pending?.[childId]?.repoSeedFromDroneId ?? '')).toBe('seed-parent');
    expect(String(regAny?.pending?.[childId]?.fleet?.createdBy ?? '')).toBe('seed-parent');
  });
});
