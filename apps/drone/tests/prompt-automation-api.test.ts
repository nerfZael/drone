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

  const pollUntil = async (fn: () => Promise<boolean>, timeoutMs: number = 10_000, intervalMs: number = 150): Promise<void> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await fn()) return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`timed out after ${timeoutMs}ms`);
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

  test('rejects restart while a stop is still in progress', async () => {
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
    expect(restarted.r.status).toBe(409);
    expect(String(restarted.data?.error ?? '')).toContain('stop is still in progress');
  });

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
