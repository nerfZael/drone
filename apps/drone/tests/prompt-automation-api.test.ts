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
    server = await startDroneHubApiServer({ port: 0, apiToken: token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
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
});
