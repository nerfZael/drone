import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { resetDroneRootDirForTests } from '../src/host/paths';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { getSocketListenSupport } from './socket-listen-support';

type ApiResponse = {
  r: Response;
  data: any;
};

const listenSupport = getSocketListenSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`playbook api tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping playbook api tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('playbook api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-playbook-api-'));
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const droneDataDir = path.join(tempRoot, 'data', 'drone');
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';

  const apiFetch = async (p: string, init?: RequestInit): Promise<ApiResponse> => {
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

  afterEach(async () => {
    await updateRegistry((reg: any) => {
      reg.playbooks = {};
      reg.pending = {};
      reg.drones = {};
      reg.archived = {};
    });
  });

  test('creates, lists, and updates playbooks with follow-up actions', async () => {
    const created = await apiFetch('/api/playbooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Bug sweep',
        messages: ['Find the biggest bug in this repo.', 'Summarize the bug in one sentence.'],
        artifacts: ['reports/bug.md', 'reports/bug.json'],
        actions: [
          { label: 'Fix bug', message: 'Fix the bug you just found.' },
          { label: 'Write test', message: 'Add a regression test for the bug.' },
        ],
      }),
    });
    expect(created.r.status).toBe(201);
    expect(created.data?.playbook?.label).toBe('Bug sweep');
    expect(created.data?.playbook?.messages).toEqual([
      'Find the biggest bug in this repo.',
      'Summarize the bug in one sentence.',
    ]);
    expect(created.data?.playbook?.artifacts).toEqual(['reports/bug.md', 'reports/bug.json']);
    expect(created.data?.playbook?.actions).toHaveLength(2);
    expect(created.data?.playbook?.actions?.[0]?.label).toBe('Fix bug');

    const playbookId = String(created.data?.playbook?.id ?? '');
    expect(playbookId).toBeTruthy();

    const listed = await apiFetch('/api/playbooks');
    expect(listed.r.status).toBe(200);
    expect(Array.isArray(listed.data?.playbooks)).toBe(true);
    expect(listed.data?.playbooks).toHaveLength(1);
    expect(listed.data?.playbooks?.[0]?.id).toBe(playbookId);

    const updated = await apiFetch(`/api/playbooks/${encodeURIComponent(playbookId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Bug sweep v2',
        messages: ['Find the most severe bug in the current codebase.'],
        artifacts: ['reports/severity.md'],
        actions: [{ label: 'Fix now', message: 'Implement the fix now.' }],
      }),
    });
    expect(updated.r.status).toBe(200);
    expect(updated.data?.playbook?.label).toBe('Bug sweep v2');
    expect(updated.data?.playbook?.messages).toEqual(['Find the most severe bug in the current codebase.']);
    expect(updated.data?.playbook?.artifacts).toEqual(['reports/severity.md']);
    expect(updated.data?.playbook?.actions).toHaveLength(1);
    expect(updated.data?.playbook?.actions?.[0]?.label).toBe('Fix now');

    const reg = await loadRegistry();
    expect(reg.playbooks?.[playbookId]?.label).toBe('Bug sweep v2');
    expect(reg.playbooks?.[playbookId]?.messages).toEqual(['Find the most severe bug in the current codebase.']);
    expect(reg.playbooks?.[playbookId]?.artifacts).toEqual(['reports/severity.md']);
    expect(reg.playbooks?.[playbookId]?.actions).toHaveLength(1);
  });

  test('launches a hidden playbook run and exposes it through runs and drone summaries', async () => {
    const repoPath = path.join(tempRoot, 'repo-under-test');
    fs.mkdirSync(repoPath, { recursive: true });

    const created = await apiFetch('/api/playbooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Bug finder',
        messages: ['Find the biggest issue in this repo.', 'Summarize the issue in one sentence.'],
        artifacts: ['reports/finding.md'],
        actions: [{ label: 'Fix issue', message: 'Fix the issue you found.' }],
      }),
    });
    expect(created.r.status).toBe(201);
    const playbookId = String(created.data?.playbook?.id ?? '');
    expect(playbookId).toBeTruthy();

    const launched = await apiFetch(`/api/playbooks/${encodeURIComponent(playbookId)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repoPath,
        pullHostBranchBeforeCreate: false,
      }),
    });
    expect(launched.r.status).toBe(202);
    expect(launched.data?.playbookId).toBe(playbookId);
    expect(launched.data?.repoPath).toBe(repoPath);

    const droneId = String(launched.data?.droneId ?? '');
    expect(droneId).toBeTruthy();

    const runs = await apiFetch(`/api/playbook-runs?repoPath=${encodeURIComponent(repoPath)}`);
    expect(runs.r.status).toBe(200);
    expect(Array.isArray(runs.data?.runs)).toBe(true);
    expect(runs.data?.runs).toHaveLength(1);
    expect(runs.data?.runs?.[0]).toMatchObject({
      id: droneId,
      droneId,
      playbookId,
      playbookLabel: 'Bug finder',
      chatName: 'default',
      repoPath,
      kind: 'playbook-run',
      visibility: 'hidden',
      status: 'starting',
      artifacts: ['reports/finding.md'],
      actions: [{ label: 'Fix issue', message: 'Fix the issue you found.' }],
      pendingCount: 2,
    });

    const updated = await apiFetch(`/api/playbooks/${encodeURIComponent(playbookId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Bug finder v2',
        messages: ['Find a different issue.'],
        artifacts: ['reports/new-finding.md'],
        actions: [{ label: 'Fix different issue', message: 'Fix the different issue you found.' }],
      }),
    });
    expect(updated.r.status).toBe(200);

    const runsAfterEdit = await apiFetch(`/api/playbook-runs?repoPath=${encodeURIComponent(repoPath)}`);
    expect(runsAfterEdit.r.status).toBe(200);
    expect(runsAfterEdit.data?.runs?.[0]).toMatchObject({
      id: droneId,
      playbookLabel: 'Bug finder',
      artifacts: ['reports/finding.md'],
      actions: [{ label: 'Fix issue', message: 'Fix the issue you found.' }],
    });

    const drones = await apiFetch('/api/drones');
    expect(drones.r.status).toBe(200);
    const pendingRun = Array.isArray(drones.data?.drones)
      ? drones.data.drones.find((item: any) => String(item?.id ?? '') === droneId)
      : null;
    expect(pendingRun).toBeTruthy();
    expect(pendingRun).toMatchObject({
      id: droneId,
      kind: 'playbook-run',
      visibility: 'hidden',
      repoPath,
      playbook: {
        id: playbookId,
        label: 'Bug finder',
        messageCount: 2,
        chatName: 'default',
        artifacts: ['reports/finding.md'],
        actions: [{ label: 'Fix issue', message: 'Fix the issue you found.' }],
      },
    });

    const reg = await loadRegistry();
    expect(reg.pending?.[droneId]?.kind).toBe('playbook-run');
    expect(reg.pending?.[droneId]?.visibility).toBe('hidden');
    expect(reg.pending?.[droneId]?.playbook).toMatchObject({
      id: playbookId,
      label: 'Bug finder',
      messageCount: 2,
      chatName: 'default',
      artifacts: ['reports/finding.md'],
      actions: [{ label: 'Fix issue', message: 'Fix the issue you found.' }],
    });
    expect(reg.pending?.[droneId]?.startupQueuedPrompts).toHaveLength(2);
    expect(reg.pending?.[droneId]?.startupQueuedPrompts?.map((item: any) => item.prompt)).toEqual([
      'Find the biggest issue in this repo.',
      'Summarize the issue in one sentence.',
    ]);
  });
});
