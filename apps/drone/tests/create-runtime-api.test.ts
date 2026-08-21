import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { getPromptQueueRepository } from '../src/host/prompt-queue-repository';
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

  test('lists startup and draft drones with detailed snapshot timing', async () => {
    const createdAt = '2026-08-21T10:00:00.000Z';
    await updateRegistry((registry: any) => {
      registry.pending = {
        ...(registry.pending ?? {}),
        'list-starting-drone': {
          id: 'list-starting-drone',
          name: 'List Starting Drone',
          runtime: 'container',
          phase: 'starting',
          createdAt,
        },
        'list-draft-drone': {
          id: 'list-draft-drone',
          name: 'List Draft Drone',
          runtime: 'container',
          phase: 'draft',
          draft: true,
          createdAt,
        },
      };
    });

    try {
      const response = await apiFetch('/api/drones');
      expect(response.r.status).toBe(200);
      expect(
        response.data?.drones?.find((drone: any) => drone.id === 'list-starting-drone'),
      ).toMatchObject({
        hubPhase: 'starting',
        statusChecking: false,
      });
      expect(
        response.data?.drones?.find((drone: any) => drone.id === 'list-draft-drone'),
      ).toMatchObject({
        draft: true,
        hubPhase: 'draft',
        statusChecking: false,
      });
      const serverTiming = response.r.headers.get('server-timing') ?? '';
      expect(serverTiming).toContain('snapshotSources;dur=');
      expect(serverTiming).toContain('serialize;dur=');
    } finally {
      await updateRegistry((registry: any) => {
        delete registry.pending?.['list-starting-drone'];
        delete registry.pending?.['list-draft-drone'];
      });
    }
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
    const serverTiming = String(resp.r.headers.get('server-timing') ?? '');
    expect(serverTiming).toContain('loadLifecycle;dur=');
    expect(serverTiming).toContain('persistPending;dur=');
    expect(serverTiming).toContain('reservePrompt;dur=');
    expect(serverTiming).toContain('total;dur=');
    expect(promptId).not.toBe('');

    const queue = getPromptQueueRepository();
    if (queue) {
      const reserved = queue.get({
        droneId,
        chatName: 'default',
        promptId,
      });
      expect(reserved).not.toBeNull();
      if (!reserved) throw new Error('initial prompt queue reservation is missing');
      expect(reserved).toMatchObject({
        id: promptId,
        at: '2026-06-21T12:00:00.000Z',
        prompt: 'Start this work',
        state: 'queued',
      });
      expect(Number(reserved.sequence)).toBeGreaterThan(0);
    }

    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.seed).toMatchObject({
      chatName: 'default',
      prompt: 'Start this work',
      promptId,
      submittedAt: '2026-06-21T12:00:00.000Z',
    });
  });

  test('single create accepts attached initial messages for immediate and draft drones', async () => {
    const attachment = {
      name: 'screen.png',
      mime: 'image/png',
      size: 3,
      dataBase64: 'YWJj',
    };
    const immediate = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'attached-immediate-state',
        runtime: 'container',
        seedPrompt: 'Review this image now',
        seedAttachments: [attachment],
        seedSubmittedAt: '2026-06-21T12:00:30.000Z',
      }),
    });
    expect(immediate.r.status).toBe(202);
    expect(immediate.data?.initialMessage?.promptId).toBeTruthy();

    const draft = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'attached-draft-state',
        runtime: 'container',
        draft: true,
        seedPrompt: 'Review this image later',
        seedAttachments: [attachment],
        seedSubmittedAt: '2026-06-21T12:00:45.000Z',
      }),
    });
    expect(draft.r.status).toBe(201);

    const registry: any = await loadRegistry();
    const draftPrompt = registry?.pending?.[draft.data?.id]?.startupQueuedPrompts?.[0];
    expect(draftPrompt).toMatchObject({
      id: draft.data?.initialMessage?.promptId,
      prompt: 'Review this image later',
      at: '2026-06-21T12:00:45.000Z',
      attachments: [
        expect.objectContaining({
          name: 'screen.png',
          mime: 'image/png',
          size: 3,
          dataBase64: 'YWJj',
        }),
      ],
    });
  });

  test('single draft keeps one stable initial prompt identity for publication', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-draft-state',
        runtime: 'container',
        draft: true,
        seedPrompt: 'Start after publication',
        seedSubmittedAt: '2026-06-21T12:01:00.000Z',
      }),
    });
    expect(resp.r.status).toBe(201);
    const droneId = String(resp.data?.id ?? '').trim();
    const promptId = String(resp.data?.initialMessage?.promptId ?? '').trim();
    expect(droneId).not.toBe('');
    expect(promptId).not.toBe('');

    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.startupQueuedPrompts).toEqual([
      expect.objectContaining({
        id: promptId,
        chatName: 'default',
        prompt: 'Start after publication',
        state: 'queued',
      }),
    ]);

    const queue = getPromptQueueRepository();
    if (queue) {
      const reserved = queue.get({ droneId, chatName: 'default', promptId });
      expect(reserved).not.toBeNull();
      if (!reserved) throw new Error('draft initial prompt queue reservation is missing');
      expect(reserved.state).toBe('queued');
    }
  });

  test('batch creation keeps stable initial prompt identities for drafts and immediate starts', async () => {
    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pullHostBranchBeforeCreate: true,
        drones: [
          {
            name: 'seeded-batch-draft-state',
            runtime: 'container',
            draft: true,
            seedPrompt: 'Batch initial task',
            seedSubmittedAt: '2026-06-21T12:02:00.000Z',
          },
          {
            name: 'seeded-batch-start-state',
            runtime: 'container',
            seedPrompt: 'Batch immediate task',
            seedSubmittedAt: '2026-06-21T12:03:00.000Z',
          },
        ],
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.accepted).toHaveLength(2);
    const draftAccepted = resp.data?.accepted?.find(
      (item: any) => item?.name === 'seeded-batch-draft-state',
    );
    const startingAccepted = resp.data?.accepted?.find(
      (item: any) => item?.name === 'seeded-batch-start-state',
    );
    const draftDroneId = String(draftAccepted?.id ?? '').trim();
    const startingDroneId = String(startingAccepted?.id ?? '').trim();
    const draftPromptId = String(draftAccepted?.initialMessage?.promptId ?? '').trim();
    const startingPromptId = String(startingAccepted?.initialMessage?.promptId ?? '').trim();
    expect(draftDroneId).not.toBe('');
    expect(startingDroneId).not.toBe('');
    expect(draftPromptId).not.toBe('');
    expect(startingPromptId).not.toBe('');

    const regAny: any = await loadRegistry();
    const startup = regAny?.pending?.[draftDroneId]?.startupQueuedPrompts?.[0];
    expect(startup).toMatchObject({
      id: draftPromptId,
      chatName: 'default',
      prompt: 'Batch initial task',
      state: 'queued',
    });
    if (regAny?.pending?.[startingDroneId]) {
      expect(regAny.pending[startingDroneId].seed).toMatchObject({
        chatName: 'default',
        promptId: startingPromptId,
        prompt: 'Batch immediate task',
      });
    }

    const queue = getPromptQueueRepository();
    if (queue) {
      for (const [droneId, promptId] of [
        [draftDroneId, draftPromptId],
        [startingDroneId, startingPromptId],
      ]) {
        const reserved = queue.get({ droneId, chatName: 'default', promptId });
        expect(reserved).not.toBeNull();
        if (!reserved) throw new Error('batch initial prompt queue reservation is missing');
        expect(reserved.state).toBe('queued');
      }
    }
  });

  test('batch creation includes attached seed content in startup prompts', async () => {
    const attachment = {
      name: 'batch-screen.png',
      mime: 'image/png',
      size: 3,
      dataBase64: 'YWJj',
    };
    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pullHostBranchBeforeCreate: true,
        drones: [
          {
            name: 'attached-batch-draft-state',
            runtime: 'container',
            draft: true,
            seedAttachments: [attachment],
            seedSubmittedAt: '2026-06-21T12:04:00.000Z',
          },
        ],
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.accepted).toHaveLength(1);
    const accepted = resp.data?.accepted?.[0];
    const droneId = String(accepted?.id ?? '').trim();
    const promptId = String(accepted?.initialMessage?.promptId ?? '').trim();
    expect(droneId).not.toBe('');
    expect(promptId).not.toBe('');

    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.startupQueuedPrompts).toEqual([
      expect.objectContaining({
        id: promptId,
        chatName: 'default',
        prompt: 'Attached 1 attachment',
        attachments: [expect.objectContaining(attachment)],
        deliveryMode: 'asap',
        state: 'queued',
      }),
    ]);

    const queue = getPromptQueueRepository();
    if (queue) {
      expect(queue.get({ droneId, chatName: 'default', promptId })).toBeNull();
    }
  });

  test('single create persists supported read-only seed agent permission mode', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'seeded-read-only-agent',
        runtime: 'container',
        seedAgent: { kind: 'builtin', id: 'codex' },
        seedAgentPermissionMode: 'read',
      }),
    });
    expect(resp.r.status).toBe(202);
    expect(resp.data?.ok).toBe(true);

    const droneId = String(resp.data?.id ?? '').trim();
    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.seed).toMatchObject({
      chatName: 'default',
      agent: { kind: 'builtin', id: 'codex' },
      agentPermissionMode: 'read',
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

  test('ignores the removed host pull flag from legacy clients', async () => {
    const resp = await apiFetch('/api/drones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'legacy-pull-flag',
        runtime: 'container',
        repoPath: '/tmp/legacy-pull-flag',
        repoBranchSource: 'host',
        pullHostBranchBeforeCreate: true,
        draft: true,
      }),
    });

    expect(resp.r.status).toBe(201);
    expect(resp.data?.ok).toBe(true);
  });

  test('batch create accepts an empty AGENTS.md override and rejects it without a repo', async () => {
    const resp = await apiFetch('/api/drones/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pullHostBranchBeforeCreate: true,
        drones: [
          {
            name: 'agents-override-empty',
            runtime: 'container',
            repoPath: '/tmp/agents-override-empty',
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
        seedAgentPermissionMode: 'read',
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
            seedAgentPermissionMode: 'read',
          },
          {
            name: 'batch-read-only-agent-invalid',
            runtime: 'container',
            seedAgent: { kind: 'builtin', id: 'cursor' },
            seedAgentPermissionMode: 'read',
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
      agentPermissionMode: 'read',
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
        seedAgentPermissionMode: 'write',
        seedApprovalPolicy: 'auto',
      }),
    });
    expect(resp.r.status).toBe(202);

    const droneId = String(resp.data?.id ?? '').trim();
    const regAny: any = await loadRegistry();
    expect(regAny?.pending?.[droneId]?.seed).toMatchObject({
      chatName: 'default',
      agent: { kind: 'builtin', id: 'codex' },
      agentPermissionMode: 'write',
      approvalPolicy: 'auto',
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
        seedApprovalPolicy: 'auto',
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
        seedApprovalPolicy: 'none',
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
