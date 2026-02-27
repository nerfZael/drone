import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startDroneHubApiServer } from '../src/hub/server';
import { updateRegistry } from '../src/host/registry';

type ApiResponse = {
  r: Response;
  data: any;
};

describe('prompt automation api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-prompt-automation-api-'));
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  const prevXdg = process.env.XDG_DATA_HOME;
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';
  let mockDaemon:
    | {
        port: number;
        stop: () => void;
      }
    | null = null;

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

  const pollUntil = async (
    fn: () => Promise<boolean>,
    timeoutMs: number = 10_000,
    intervalMs: number = 150,
    label: string = 'condition',
  ): Promise<void> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await fn()) return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`timed out after ${timeoutMs}ms (${label})`);
  };

  const setPendingPromptState = async (opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    state: string;
  }) => {
    await updateRegistry((reg: any) => {
      const chat = reg?.drones?.[opts.droneId]?.chats?.[opts.chatName];
      if (!chat) return;
      const pending = Array.isArray(chat.pendingPrompts) ? chat.pendingPrompts : [];
      const idx = pending.findIndex((p: any) => String(p?.id ?? '').trim() === opts.promptId);
      if (idx < 0) return;
      pending[idx] = {
        ...pending[idx],
        state: opts.state,
        updatedAt: new Date().toISOString(),
      };
      chat.pendingPrompts = pending;
    });
  };

  beforeAll(async () => {
    fs.mkdirSync(path.join(xdgDataHome, 'drone'), { recursive: true });
    process.env.XDG_DATA_HOME = xdgDataHome;
    const jobs = new Map<string, any>();
    const daemon = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === '/v1/status') {
          return Response.json({ ok: true, status: 'ok' });
        }
        if (u.pathname === '/v1/health') {
          return Response.json({ ok: true });
        }
        if (u.pathname === '/v1/prompts/enqueue' && req.method === 'POST') {
          return req.json().then((body: any) => {
            const id = String(body?.id ?? '').trim();
            const now = new Date().toISOString();
            jobs.set(id, {
              id,
              state: 'done',
              startedAt: now,
              finishedAt: now,
              stdout: `mock-response:${id}`,
              stderr: '',
            });
            return Response.json({ ok: true, accepted: true, id });
          });
        }
        const promptMatch = /^\/v1\/prompts\/([^/]+)$/.exec(u.pathname);
        if (promptMatch && req.method === 'GET') {
          const id = decodeURIComponent(promptMatch[1] ?? '');
          const job = jobs.get(id);
          if (!job) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
          return Response.json({ ok: true, job });
        }
        return Response.json({ ok: false, error: 'not found' }, { status: 404 });
      },
    });
    mockDaemon = { port: daemon.port, stop: () => daemon.stop(true) };
    server = await startDroneHubApiServer({ port: 0, apiToken: token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (mockDaemon) mockDaemon.stop();
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('generates a unique automation jobKey for each run execution', async () => {
    const droneId = 'drone-automation-unique-job-key';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        // Keep hostPort set so we never attempt port discovery via dvm in test.
        hostPort: 1,
        // Empty token intentionally makes prompt enqueue fail fast, which keeps the test deterministic.
        token: '',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
      };
    });

    const startOnce = async () => {
      const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          automationId: 'sync-pass',
          automationLabel: 'Sync Pass',
          prompt: 'run checks',
          runs: 1,
        }),
      });
      expect(started.r.status).toBe(202);
      expect(started.data?.ok).toBe(true);

      await pollUntil(async () => {
        const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
        return status.data?.job?.running === false;
      });
    };

    await startOnce();
    const pendingAfterFirst = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    expect(pendingAfterFirst.r.status).toBe(200);
    const firstPromptLoop = (pendingAfterFirst.data?.pending ?? []).filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'sync-pass',
    );
    expect(firstPromptLoop.length).toBeGreaterThan(0);
    const firstJobKey = String(firstPromptLoop[firstPromptLoop.length - 1]?.automation?.jobKey ?? '');
    expect(firstJobKey.length).toBeGreaterThan(0);

    await startOnce();
    const pendingAfterSecond = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    expect(pendingAfterSecond.r.status).toBe(200);
    const secondPromptLoop = (pendingAfterSecond.data?.pending ?? []).filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'sync-pass',
    );
    expect(secondPromptLoop.length).toBeGreaterThan(1);
    const secondJobKey = String(secondPromptLoop[secondPromptLoop.length - 1]?.automation?.jobKey ?? '');
    expect(secondJobKey.length).toBeGreaterThan(0);
    expect(secondJobKey).not.toBe(firstJobKey);
  });

  test('queues restart while a stop is still in progress', async () => {
    const droneId = 'drone-automation-stop-restart';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: 1,
        token: '',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            // Keep the chat non-idle so the automation loop remains in its wait phase.
            pendingPrompts: [
              {
                id: 'blocking-prompt',
                at: now,
                updatedAt: now,
                prompt: 'still running',
                state: 'sending',
              },
            ],
          },
        },
      };
    });

    const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-1',
        automationLabel: 'Loop 1',
        prompt: 'repeat',
        runs: 2,
      }),
    });
    expect(started.r.status).toBe(202);

    const stopped = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/stop`, {
      method: 'POST',
    });
    expect(stopped.r.status).toBe(200);
    expect(stopped.data?.job?.status).toBe('stopped');

    const restarted = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-2',
        automationLabel: 'Loop 2',
        prompt: 'repeat again',
        runs: 2,
      }),
    });
    expect(restarted.r.status).toBe(202);
    expect(restarted.data?.job?.running).toBe(false);
    expect(Number(restarted.data?.job?.queuedCount ?? 0)).toBeGreaterThan(0);
    const queuedItems = Array.isArray(restarted.data?.job?.queued) ? restarted.data.job.queued : [];
    const queuedAutomationIds = queuedItems.map((item: any) => String(item?.automationId ?? '').trim());
    expect(queuedAutomationIds).toContain('loop-2');
  });

  test('queues additional automation starts while one is running', async () => {
    const droneId = 'drone-automation-queue-while-running';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: 1,
        token: '',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [
              {
                id: 'blocking-prompt',
                at: now,
                updatedAt: now,
                prompt: 'still running',
                state: 'sending',
              },
            ],
          },
        },
      };
    });

    const first = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-1',
        automationLabel: 'Loop 1',
        prompt: 'repeat',
        runs: 2,
      }),
    });
    expect(first.r.status).toBe(202);
    expect(first.data?.job?.running).toBe(true);

    const second = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-2',
        automationLabel: 'Loop 2',
        prompt: 'repeat again',
        runs: 2,
      }),
    });
    expect(second.r.status).toBe(202);
    expect(second.data?.job?.running).toBe(true);
    expect(Number(second.data?.job?.queuedCount ?? 0)).toBeGreaterThan(0);
    const queuedItems = Array.isArray(second.data?.job?.queued) ? second.data.job.queued : [];
    const queuedAutomationIds = queuedItems.map((item: any) => String(item?.automationId ?? '').trim());
    expect(queuedAutomationIds).toContain('loop-2');
  });

  test('persists sleepBetweenRunsSeconds for running and queued automation jobs', async () => {
    const droneId = 'drone-automation-sleep-between-runs';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: 1,
        token: '',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [
              {
                id: 'blocking-prompt',
                at: now,
                updatedAt: now,
                prompt: 'still running',
                state: 'sending',
              },
            ],
          },
        },
      };
    });

    const first = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-1',
        automationLabel: 'Loop 1',
        prompt: 'repeat',
        runs: 2,
        sleepBetweenRunsSeconds: 90,
      }),
    });
    expect(first.r.status).toBe(202);
    expect(Number(first.data?.job?.sleepBetweenRunsSeconds ?? -1)).toBe(90);

    const second = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-2',
        automationLabel: 'Loop 2',
        prompt: 'repeat again',
        runs: 2,
        sleepBetweenRunsSeconds: 180,
      }),
    });
    expect(second.r.status).toBe(202);
    const queuedSleep = Number(second.data?.job?.queued?.[0]?.sleepBetweenRunsSeconds ?? -1);
    expect(queuedSleep).toBe(180);
  });

  test('queues manual prompts behind active automation for the same chat', async () => {
    const droneId = 'drone-automation-queue-manual-prompts';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: 1,
        token: '',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [
              {
                id: 'blocking-prompt',
                at: now,
                updatedAt: now,
                prompt: 'still running',
                state: 'sending',
              },
            ],
          },
        },
      };
    });

    const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-1',
        automationLabel: 'Loop 1',
        prompt: 'repeat',
        runs: 2,
      }),
    });
    expect(started.r.status).toBe(202);
    expect(started.data?.job?.running).toBe(true);

    const sent = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'manual message while automation is active' }),
    });
    expect(sent.r.status).toBe(202);
    const queuedPromptId = String(sent.data?.promptId ?? '').trim();
    expect(queuedPromptId.length).toBeGreaterThan(0);

    const pendingAfterSend = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const rows = Array.isArray(pendingAfterSend.data?.pending) ? pendingAfterSend.data.pending : [];
    const queuedManual = rows.find((p: any) => String(p?.id ?? '').trim() === queuedPromptId) ?? null;
    expect(queuedManual).not.toBeNull();
    expect(String(queuedManual?.state ?? '')).toBe('queued');
    expect(Boolean(queuedManual?.blockedByAutomation)).toBe(true);
  });

  test('cancels queued manual prompts before they are submitted', async () => {
    const droneId = 'drone-automation-cancel-queued-manual';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: 1,
        token: '',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [
              {
                id: 'blocking-prompt',
                at: now,
                updatedAt: now,
                prompt: 'still running',
                state: 'sending',
              },
            ],
          },
        },
      };
    });

    const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-1',
        automationLabel: 'Loop 1',
        prompt: 'repeat',
        runs: 2,
      }),
    });
    expect(started.r.status).toBe(202);

    const sent = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'manual message queued behind automation' }),
    });
    expect(sent.r.status).toBe(202);
    const queuedPromptId = String(sent.data?.promptId ?? '').trim();
    expect(queuedPromptId.length).toBeGreaterThan(0);

    const cancelled = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/pending/${encodeURIComponent(queuedPromptId)}`,
      { method: 'DELETE' },
    );
    expect(cancelled.r.status).toBe(200);
    expect(Boolean(cancelled.data?.cancelled)).toBe(true);
    expect(Boolean(cancelled.data?.alreadySubmitted)).toBe(false);

    const pendingAfter = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const rows = Array.isArray(pendingAfter.data?.pending) ? pendingAfter.data.pending : [];
    expect(rows.some((p: any) => String(p?.id ?? '').trim() === queuedPromptId)).toBe(false);
  });

  test('reports already submitted when queued prompt cancellation loses the race', async () => {
    const droneId = 'drone-automation-cancel-queued-race';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: 1,
        token: '',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [
              {
                id: 'in-flight-prompt',
                at: now,
                updatedAt: now,
                prompt: 'already sending',
                state: 'sending',
              },
            ],
          },
        },
      };
    });

    const cancelled = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending/in-flight-prompt`, {
      method: 'DELETE',
    });
    expect(cancelled.r.status).toBe(200);
    expect(Boolean(cancelled.data?.cancelled)).toBe(false);
    expect(Boolean(cancelled.data?.alreadySubmitted)).toBe(true);
    expect(String(cancelled.data?.pendingState ?? '')).toBe('sending');
  });

  test('cancels queued automation runs before they start', async () => {
    const droneId = 'drone-automation-cancel-queued-run';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: 1,
        token: '',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [
              {
                id: 'blocking-prompt',
                at: now,
                updatedAt: now,
                prompt: 'still running',
                state: 'sending',
              },
            ],
          },
        },
      };
    });

    const first = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-1',
        automationLabel: 'Loop 1',
        prompt: 'repeat',
        runs: 2,
      }),
    });
    expect(first.r.status).toBe(202);
    expect(first.data?.job?.running).toBe(true);

    const second = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-2',
        automationLabel: 'Loop 2',
        prompt: 'repeat again',
        runs: 2,
      }),
    });
    expect(second.r.status).toBe(202);
    const queueId = String(second.data?.job?.queued?.[0]?.queueId ?? '').trim();
    expect(queueId.length).toBeGreaterThan(0);

    const cancelled = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/queued/${encodeURIComponent(queueId)}`,
      { method: 'DELETE' },
    );
    expect(cancelled.r.status).toBe(200);
    expect(Boolean(cancelled.data?.cancelled)).toBe(true);
    expect(Boolean(cancelled.data?.alreadySubmitted)).toBe(false);
    expect(Number(cancelled.data?.job?.queuedCount ?? 0)).toBe(0);
  });

  test('reports already submitted when queued automation cancellation loses the race', async () => {
    if (!mockDaemon) throw new Error('mock daemon not initialized');
    const droneId = 'drone-automation-cancel-queued-automation-race';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon.port,
        token: 'daemon-token',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [
              {
                id: 'blocking-prompt',
                at: now,
                updatedAt: now,
                prompt: 'still running',
                state: 'sending',
              },
            ],
          },
        },
      };
    });

    const first = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-1',
        automationLabel: 'Loop 1',
        prompt: 'repeat',
        runs: 1,
      }),
    });
    expect(first.r.status).toBe(202);

    const second = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-2',
        automationLabel: 'Loop 2',
        prompt: 'repeat again',
        runs: 1,
      }),
    });
    expect(second.r.status).toBe(202);
    const queueId = String(second.data?.job?.queued?.[0]?.queueId ?? '').trim();
    expect(queueId.length).toBeGreaterThan(0);

    await updateRegistry((reg: any) => {
      const chat = reg?.drones?.[droneId]?.chats?.default;
      if (!chat) return;
      chat.pendingPrompts = [];
    });

    await pollUntil(
      async () => {
        const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
        return String(status.data?.job?.automationId ?? '').trim() === 'loop-2' && status.data?.job?.running === false;
      },
      20_000,
      150,
    );

    const cancelled = await apiFetch(
      `/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/queued/${encodeURIComponent(queueId)}`,
      { method: 'DELETE' },
    );
    expect(cancelled.r.status).toBe(200);
    expect(Boolean(cancelled.data?.cancelled)).toBe(false);
    expect(Boolean(cancelled.data?.alreadySubmitted)).toBe(true);
  });

  test('flushes manual prompts queued behind automation in FIFO order once lane is idle', async () => {
    if (!mockDaemon) throw new Error('mock daemon not initialized');
    const droneId = 'drone-automation-release-blocked-manual-fifo';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon.port,
        token: 'daemon-token',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [
              {
                id: 'blocking-prompt',
                at: now,
                updatedAt: now,
                prompt: 'still running',
                state: 'sending',
              },
            ],
          },
        },
      };
    });
    const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-1',
        automationLabel: 'Loop 1',
        prompt: 'automation run one',
        runs: 1,
      }),
    });
    expect(started.r.status).toBe(202);
    expect(started.data?.job?.running).toBe(true);

    const manualA = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'manual A queued behind automation' }),
    });
    expect(manualA.r.status).toBe(202);
    const manualAId = String(manualA.data?.promptId ?? '').trim();
    expect(manualAId.length).toBeGreaterThan(0);

    const manualB = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'manual B queued behind automation' }),
    });
    expect(manualB.r.status).toBe(202);
    const manualBId = String(manualB.data?.promptId ?? '').trim();
    expect(manualBId.length).toBeGreaterThan(0);

    const pendingWhileBlocked = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const blockedRows = Array.isArray(pendingWhileBlocked.data?.pending) ? pendingWhileBlocked.data.pending : [];
    const blockedA = blockedRows.find((p: any) => String(p?.id ?? '').trim() === manualAId);
    const blockedB = blockedRows.find((p: any) => String(p?.id ?? '').trim() === manualBId);
    expect(String(blockedA?.state ?? '')).toBe('queued');
    expect(String(blockedB?.state ?? '')).toBe('queued');
    expect(Boolean(blockedA?.blockedByAutomation)).toBe(true);
    expect(Boolean(blockedB?.blockedByAutomation)).toBe(true);

    await setPendingPromptState({ droneId, chatName: 'default', promptId: 'blocking-prompt', state: 'failed' });

    await pollUntil(
      async () => {
        const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
        return status.data?.job?.running === false && Number(status.data?.job?.queuedCount ?? 0) === 0;
      },
      20_000,
      120,
      'automation status idle',
    );

    await pollUntil(
      async () => {
        const pending = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
        const rows = Array.isArray(pending.data?.pending) ? pending.data.pending : [];
        const rowA = rows.find((p: any) => String(p?.id ?? '').trim() === manualAId);
        const rowB = rows.find((p: any) => String(p?.id ?? '').trim() === manualBId);
        const stateA = String(rowA?.state ?? '');
        const stateB = String(rowB?.state ?? '');
        return stateA !== 'queued' && stateB !== 'queued';
      },
      20_000,
      120,
      'manual prompts released',
    );

    const pendingFinal = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const finalRows = Array.isArray(pendingFinal.data?.pending) ? pendingFinal.data.pending : [];
    const finalA = finalRows.find((p: any) => String(p?.id ?? '').trim() === manualAId);
    const finalB = finalRows.find((p: any) => String(p?.id ?? '').trim() === manualBId);
    const stateA = String(finalA?.state ?? '');
    const stateB = String(finalB?.state ?? '');
    expect(stateA !== 'queued').toBe(true);
    expect(stateB !== 'queued').toBe(true);
    const updatedA = String(finalA?.updatedAt ?? finalA?.at ?? '');
    const updatedB = String(finalB?.updatedAt ?? finalB?.at ?? '');
    expect(updatedA.length).toBeGreaterThan(0);
    expect(updatedB.length).toBeGreaterThan(0);
    expect(updatedA <= updatedB).toBe(true);
  }, 30_000);

  test('keeps manual prompts blocked until queued automations are fully drained', async () => {
    if (!mockDaemon) throw new Error('mock daemon not initialized');
    const droneId = 'drone-automation-release-after-queued-drain';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon.port,
        token: 'daemon-token',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            turns: [],
            pendingPrompts: [
              {
                id: 'blocking-prompt',
                at: now,
                updatedAt: now,
                prompt: 'still running',
                state: 'sending',
              },
            ],
          },
        },
      };
    });
    const first = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-1',
        automationLabel: 'Loop 1',
        prompt: 'automation run one',
        runs: 1,
      }),
    });
    expect(first.r.status).toBe(202);
    expect(first.data?.job?.running).toBe(true);

    const second = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'loop-2',
        automationLabel: 'Loop 2',
        prompt: 'automation run two',
        runs: 1,
      }),
    });
    expect(second.r.status).toBe(202);
    expect(Number(second.data?.job?.queuedCount ?? 0)).toBeGreaterThan(0);

    const manual = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'manual after queued automations' }),
    });
    expect(manual.r.status).toBe(202);
    const manualId = String(manual.data?.promptId ?? '').trim();
    expect(manualId.length).toBeGreaterThan(0);
    const pendingBlocked = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const pendingBlockedRows = Array.isArray(pendingBlocked.data?.pending) ? pendingBlocked.data.pending : [];
    const blockedManual = pendingBlockedRows.find((p: any) => String(p?.id ?? '').trim() === manualId);
    expect(String(blockedManual?.state ?? '')).toBe('queued');
    expect(Boolean(blockedManual?.blockedByAutomation)).toBe(true);

    await setPendingPromptState({ droneId, chatName: 'default', promptId: 'blocking-prompt', state: 'failed' });

    await pollUntil(
      async () => {
        const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
        return status.data?.job?.running === false && Number(status.data?.job?.queuedCount ?? 0) === 0;
      },
      20_000,
      120,
      'automation queue drained',
    );

    await pollUntil(
      async () => {
        const pending = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
        const rows = Array.isArray(pending.data?.pending) ? pending.data.pending : [];
        const manual = rows.find((p: any) => String(p?.id ?? '').trim() === manualId);
        return String(manual?.state ?? '') !== 'queued';
      },
      20_000,
      120,
      'manual released after queued automations',
    );

    const pendingFinal = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const rows = Array.isArray(pendingFinal.data?.pending) ? pendingFinal.data.pending : [];
    const loop2 = rows.find(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.stage ?? '') === 'run' &&
        String(p?.automation?.automationId ?? '') === 'loop-2',
    );
    const manualFinal = rows.find((p: any) => String(p?.id ?? '').trim() === manualId);
    expect(loop2).toBeTruthy();
    expect(manualFinal).toBeTruthy();
    const manualState = String(manualFinal?.state ?? '');
    expect(manualState !== 'queued').toBe(true);
    const loop2UpdatedAt = String(loop2?.updatedAt ?? loop2?.at ?? '');
    const manualUpdatedAt = String(manualFinal?.updatedAt ?? manualFinal?.at ?? '');
    expect(loop2UpdatedAt.length).toBeGreaterThan(0);
    expect(manualUpdatedAt.length).toBeGreaterThan(0);
    expect(manualUpdatedAt >= loop2UpdatedAt).toBe(true);
  }, 30_000);

  test('finishes early when stop phrase is matched (case-insensitive) and still sends final message', async () => {
    if (!mockDaemon) throw new Error('mock daemon not initialized');
    const droneId = 'drone-automation-stop-phrase-match';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon.port,
        token: 'mock-token',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'claude' },
            turns: [],
            pendingPrompts: [],
          },
        },
      };
    });

    const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'stopper',
        automationLabel: 'Stopper',
        prompt: 'do work',
        onFailurePrompt: 'summarize the changes',
        runs: 5,
        stopPhrase: 'MOCK-RESPONSE',
        stopPhraseCaseSensitive: false,
      }),
    });
    expect(started.r.status).toBe(202);

    await pollUntil(async () => {
      const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
      return status.data?.job?.running === false;
    }, 15_000);

    const statusAfter = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
    expect(Boolean(statusAfter.data?.job?.finishedEarly)).toBe(true);
    expect(Number(statusAfter.data?.job?.runsCompleted ?? 0)).toBe(1);
    expect(Number(statusAfter.data?.job?.runsTotal ?? 0)).toBe(1);

    const pendingFinal = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const rows = Array.isArray(pendingFinal.data?.pending) ? pendingFinal.data.pending : [];
    const runRows = rows.filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'stopper' &&
        String(p?.automation?.stage ?? '') !== 'final-message',
    );
    const finalRows = rows.filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'stopper' &&
        String(p?.automation?.stage ?? '') === 'final-message',
    );
    expect(runRows.length).toBe(1);
    expect(finalRows.length).toBeGreaterThan(0);
    const finalMatchedRun = Number(finalRows[finalRows.length - 1]?.automation?.stopMatchedRunIndex ?? 0);
    expect(finalMatchedRun).toBe(1);
  });

  test('does not finish early when stop phrase case does not match in case-sensitive mode', async () => {
    if (!mockDaemon) throw new Error('mock daemon not initialized');
    const droneId = 'drone-automation-stop-phrase-case-sensitive';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon.port,
        token: 'mock-token',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'claude' },
            turns: [],
            pendingPrompts: [],
          },
        },
      };
    });

    const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'strict-stopper',
        automationLabel: 'Strict Stopper',
        prompt: 'do work',
        runs: 2,
        stopPhrase: 'MOCK-RESPONSE',
        stopPhraseCaseSensitive: true,
      }),
    });
    expect(started.r.status).toBe(202);

    await pollUntil(async () => {
      const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
      return status.data?.job?.running === false;
    }, 15_000);

    const statusAfter = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
    expect(Boolean(statusAfter.data?.job?.finishedEarly)).toBe(false);

    const pendingFinal = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const rows = Array.isArray(pendingFinal.data?.pending) ? pendingFinal.data.pending : [];
    const runRows = rows.filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'strict-stopper' &&
        String(p?.automation?.stage ?? '') !== 'final-message',
    );
    expect(runRows.length).toBeGreaterThanOrEqual(2);
  });

  test('stop runs-only still sends final message when at least one run completed', async () => {
    if (!mockDaemon) throw new Error('mock daemon not initialized');
    const droneId = 'drone-automation-stop-runs-only-final-message';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon.port,
        token: 'mock-token',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'claude' },
            turns: [],
            pendingPrompts: [],
          },
        },
      };
    });

    const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'runs-only-stopper',
        automationLabel: 'Runs Only Stopper',
        prompt: 'do work',
        onFailurePrompt: 'summarize what happened',
        runs: 3,
        sleepBetweenRunsSeconds: 120,
      }),
    });
    expect(started.r.status).toBe(202);

    await pollUntil(
      async () => {
        const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
        return status.data?.job?.running === true && Number(status.data?.job?.runsCompleted ?? 0) >= 1;
      },
      15_000,
      120,
      'first automation run completed',
    );

    const stopped = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stopMode: 'runs-only', clearQueued: false }),
    });
    expect(stopped.r.status).toBe(200);

    await pollUntil(
      async () => {
        const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
        return status.data?.job?.running === false;
      },
      15_000,
      120,
      'automation stopped',
    );

    await pollUntil(
      async () => {
        const pending = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
        const rows = Array.isArray(pending.data?.pending) ? pending.data.pending : [];
        return rows.some(
          (p: any) =>
            String(p?.automation?.kind ?? '') === 'prompt-loop' &&
            String(p?.automation?.automationId ?? '') === 'runs-only-stopper' &&
            String(p?.automation?.stage ?? '') === 'final-message',
        );
      },
      15_000,
      120,
      'final message enqueued',
    );

    const pendingFinal = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const rows = Array.isArray(pendingFinal.data?.pending) ? pendingFinal.data.pending : [];
    const runRows = rows.filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'runs-only-stopper' &&
        String(p?.automation?.stage ?? '') !== 'final-message',
    );
    const finalRows = rows.filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'runs-only-stopper' &&
        String(p?.automation?.stage ?? '') === 'final-message',
    );
    expect(runRows.length).toBeGreaterThanOrEqual(1);
    expect(finalRows.length).toBeGreaterThan(0);
    const runJobKey = String(runRows[runRows.length - 1]?.automation?.jobKey ?? '');
    const finalJobKey = String(finalRows[finalRows.length - 1]?.automation?.jobKey ?? '');
    expect(runJobKey.length).toBeGreaterThan(0);
    expect(finalJobKey).toBe(runJobKey);
  }, 30_000);

  test('does not send final message when no automation run succeeds', async () => {
    const droneId = 'drone-automation-final-message';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: 1,
        token: '',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
      };
    });

    const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'lint-fixes',
        automationLabel: 'Lint Fixes',
        prompt: 'fix lint errors',
        onFailurePrompt: 'Summarize what failed and what to try next.',
        runs: 1,
      }),
    });
    expect(started.r.status).toBe(202);

    await pollUntil(async () => {
      const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
      return status.data?.job?.running === false;
    });

    const pendingFinal = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const rows = Array.isArray(pendingFinal.data?.pending) ? pendingFinal.data.pending : [];
    const mainRows = rows.filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'lint-fixes' &&
        String(p?.automation?.stage ?? '') !== 'final-message',
    );
    const finalRows = rows.filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'lint-fixes' &&
        String(p?.automation?.stage ?? '') === 'final-message',
    );
    expect(mainRows.length).toBeGreaterThan(0);
    expect(finalRows.length).toBe(0);
  });

  test('sends final message after runs finish when at least one run succeeds', async () => {
    if (!mockDaemon) throw new Error('mock daemon not initialized');
    const droneId = 'drone-automation-final-message-success';
    const now = new Date().toISOString();
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon?.port,
        token: 'mock-token',
        containerPort: 7777,
        repoPath: '',
        createdAt: now,
        chats: {
          default: {
            createdAt: now,
            agent: { kind: 'builtin', id: 'claude' },
            turns: [],
            pendingPrompts: [],
          },
        },
      };
    });

    const started = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'review-fixes',
        automationLabel: 'Review Fixes',
        prompt: 'find issues and fix them',
        onFailurePrompt: 'can you give me a summary of what was fixed?',
        runs: 2,
      }),
    });
    expect(started.r.status).toBe(202);

    await pollUntil(async () => {
      const status = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/automations/status`);
      return status.data?.job?.running === false;
    }, 15_000);

    await pollUntil(async () => {
      const pending = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
      const rows = Array.isArray(pending.data?.pending) ? pending.data.pending : [];
      return rows.some(
        (p: any) =>
          String(p?.automation?.kind ?? '') === 'prompt-loop' &&
          String(p?.automation?.automationId ?? '') === 'review-fixes' &&
          String(p?.automation?.stage ?? '') === 'final-message',
      );
    }, 15_000);

    const pendingFinal = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/pending`);
    const rows = Array.isArray(pendingFinal.data?.pending) ? pendingFinal.data.pending : [];
    const mainRows = rows.filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'review-fixes' &&
        String(p?.automation?.stage ?? '') !== 'final-message',
    );
    const finalRows = rows.filter(
      (p: any) =>
        String(p?.automation?.kind ?? '') === 'prompt-loop' &&
        String(p?.automation?.automationId ?? '') === 'review-fixes' &&
        String(p?.automation?.stage ?? '') === 'final-message',
    );
    expect(mainRows.length).toBeGreaterThanOrEqual(2);
    expect(finalRows.length).toBeGreaterThan(0);
    const mainJobKey = String(mainRows[mainRows.length - 1]?.automation?.jobKey ?? '');
    const finalJobKey = String(finalRows[finalRows.length - 1]?.automation?.jobKey ?? '');
    expect(mainJobKey.length).toBeGreaterThan(0);
    expect(finalJobKey).toBe(mainJobKey);
  });
});
