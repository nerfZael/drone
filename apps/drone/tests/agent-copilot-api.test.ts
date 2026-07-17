import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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
  throw new Error(`agent copilot api tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping agent copilot api tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;
const AGENT_COPILOT_API_TEST_TIMEOUT_MS = 20_000;

describeSocketSuite('agent copilot api', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-agent-copilot-api-'));
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const droneDataDir = path.join(tempRoot, 'data', 'drone');
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';
  let mockDaemon:
    | {
        port: number;
        stop: () => void;
      }
    | null = null;
  let mockPromptOutputOverride:
    | ((opts: {
        body: any;
        id: string;
      }) => { state?: string; stdout?: string; stderr?: string } | null)
    | null = null;
  const mockPromptJobs = new Map<string, any>();
  const enqueuedPrompts: Array<{ id: string; prompt: string }> = [];

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
    intervalMs: number = 100,
    label: string = 'condition',
  ): Promise<void> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await fn()) return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`timed out after ${timeoutMs}ms (${label})`);
  };

  beforeAll(async () => {
    fs.mkdirSync(path.join(xdgDataHome, 'drone'), { recursive: true });
    fs.mkdirSync(droneDataDir, { recursive: true });
    process.env.XDG_DATA_HOME = xdgDataHome;
    process.env.DRONE_DATA_DIR = droneDataDir;
    resetDroneRootDirForTests();
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
            enqueuedPrompts.push({ id, prompt: String(body?.prompt ?? '') });
            const now = new Date().toISOString();
            const override = mockPromptOutputOverride?.({ body, id }) ?? null;
            const stdout = String(override?.stdout ?? `mock-response:${id}`);
            mockPromptJobs.set(id, {
              id,
              state: String(override?.state ?? 'done') || 'done',
              startedAt: now,
              finishedAt: now,
              stdout,
              stderr: String(override?.stderr ?? ''),
              transcript: { kind: 'cursor', message: stdout, terminalStatus: 'completed' },
            });
            return Response.json({ ok: true, accepted: true, id });
          });
        }
        const promptMatch = /^\/v1\/prompts\/([^/]+)$/.exec(u.pathname);
        if (promptMatch && req.method === 'GET') {
          const id = decodeURIComponent(promptMatch[1] ?? '');
          const job = mockPromptJobs.get(id);
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
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    mockPromptOutputOverride = null;
    mockPromptJobs.clear();
    enqueuedPrompts.length = 0;
    await updateRegistry((reg: any) => {
      reg.pending = {};
      reg.drones = {};
      reg.archived = {};
    });
  });

  const agentCopilotPromptId = (sourceMessageId: string, stage: 'copilot' | 'source-result' | 'source-error' | 'source-parse-error') =>
    `agent-copilot-${stage}-${crypto.createHash('sha1').update(sourceMessageId).digest('hex').slice(0, 24)}`;

  test(
    'runs copilot orchestration in the backend after transcript reconciliation',
    async () => {
    const droneId = 'drone-agent-copilot';
    const sourcePromptId = 'source-prompt';
    const now = new Date().toISOString();
    const sourceResponse = [
      'Need a second opinion.',
      '',
      '```json',
      '{',
      '  "type": "agent-copilot",',
      '  "name": "docs-review",',
      '  "message": "Review the new API copy for gaps."',
      '}',
      '```',
      '',
      'Continue after it responds.',
    ].join('\n');
    mockPromptJobs.set(sourcePromptId, {
      id: sourcePromptId,
      state: 'done',
      startedAt: now,
      finishedAt: now,
      stdout: sourceResponse,
      stderr: '',
      transcript: { kind: 'cursor', message: sourceResponse, terminalStatus: 'completed' },
    });
    mockPromptOutputOverride = ({ body }) => {
      const prompt = String(body?.prompt ?? '').trim();
      if (prompt === 'Review the new API copy for gaps.') {
        return { stdout: 'Copilot says the API copy is missing edge-case guidance.' };
      }
      return { stdout: 'ack' };
    };
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon?.port ?? 1,
        token: 'mock-token',
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
                id: sourcePromptId,
                at: now,
                updatedAt: now,
                prompt: 'Draft the API copy.',
                state: 'sent',
              },
            ],
          },
        },
      };
    });

    const transcript = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`);
    expect(transcript.r.status).toBe(200);
    expect(transcript.data?.ok).toBe(true);

    await pollUntil(async () => {
      const regAny: any = await loadRegistry();
      const copilotChat = regAny?.drones?.[droneId]?.chats?.['docs-review'] ?? null;
      const sourceChat = regAny?.drones?.[droneId]?.chats?.default ?? null;
      const handled = Array.isArray(sourceChat?.agentCopilotHandledSourceMessageIds)
        ? sourceChat.agentCopilotHandledSourceMessageIds
        : [];
      const sourcePending = Array.isArray(sourceChat?.pendingPrompts) ? sourceChat.pendingPrompts : [];
      return Boolean(
        copilotChat &&
          Array.isArray(copilotChat.turns) &&
          copilotChat.turns.some((turn: any) => String(turn?.output ?? '').includes('missing edge-case guidance')) &&
          sourcePending.some((row: any) =>
            String(row?.prompt ?? '').includes("This is what copilot 'docs-review' responded with:"),
          ) &&
          handled.includes(`${droneId}:${sourcePromptId}`),
      );
    }, 10_000, 100, 'backend agent copilot orchestration');

    const regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.['docs-review']?.agent).toEqual({ kind: 'builtin', id: 'cursor' });
    },
    { timeout: AGENT_COPILOT_API_TEST_TIMEOUT_MS }
  );

  test(
    'reuses a persisted copilot pending prompt instead of enqueuing it again',
    async () => {
    const droneId = 'drone-agent-copilot-resume';
    const sourcePromptId = 'source-prompt-resume';
    const sourceMessageId = `${droneId}:${sourcePromptId}`;
    const copilotPromptId = agentCopilotPromptId(sourceMessageId, 'copilot');
    const now = new Date().toISOString();
    const sourceResponse = [
      'Need a second opinion.',
      '',
      '```json',
      '{',
      '  "type": "agent-copilot",',
      '  "name": "docs-review",',
      '  "message": "Review the new API copy for gaps."',
      '}',
      '```',
    ].join('\n');
    mockPromptJobs.set(sourcePromptId, {
      id: sourcePromptId,
      state: 'done',
      startedAt: now,
      finishedAt: now,
      stdout: sourceResponse,
      stderr: '',
      transcript: { kind: 'cursor', message: sourceResponse, terminalStatus: 'completed' },
    });
    mockPromptJobs.set(copilotPromptId, {
      id: copilotPromptId,
      state: 'done',
      startedAt: now,
      finishedAt: now,
      stdout: 'Copilot says the API copy is missing edge-case guidance.',
      stderr: '',
      transcript: {
        kind: 'cursor',
        message: 'Copilot says the API copy is missing edge-case guidance.',
        terminalStatus: 'completed',
      },
    });
    mockPromptOutputOverride = ({ body }) => {
      const prompt = String(body?.prompt ?? '').trim();
      if (prompt.includes("This is what copilot 'docs-review' responded with:")) return { stdout: 'ack' };
      return { stdout: 'unexpected' };
    };
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon?.port ?? 1,
        token: 'mock-token',
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
                id: sourcePromptId,
                at: now,
                updatedAt: now,
                prompt: 'Draft the API copy.',
                state: 'sent',
              },
            ],
          },
          'docs-review': {
            createdAt: now,
            agent: { kind: 'builtin', id: 'cursor' },
            pendingPrompts: [
              {
                id: copilotPromptId,
                at: now,
                updatedAt: now,
                prompt: 'Review the new API copy for gaps.',
                state: 'sent',
              },
            ],
          },
        },
      };
    });

    const transcript = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`);
    expect(transcript.r.status).toBe(200);

    await pollUntil(async () => {
      const regAny: any = await loadRegistry();
      const sourceChat = regAny?.drones?.[droneId]?.chats?.default ?? null;
      const handled = Array.isArray(sourceChat?.agentCopilotHandledSourceMessageIds)
        ? sourceChat.agentCopilotHandledSourceMessageIds
        : [];
      const sourcePending = Array.isArray(sourceChat?.pendingPrompts) ? sourceChat.pendingPrompts : [];
      return (
        handled.includes(sourceMessageId) &&
        sourcePending.some((row: any) => String(row?.prompt ?? '').includes("This is what copilot 'docs-review' responded with:"))
      );
    }, 10_000, 100, 'resumed copilot orchestration');

    expect(enqueuedPrompts.filter((entry) => entry.id === copilotPromptId)).toHaveLength(0);
    expect(enqueuedPrompts.filter((entry) => entry.prompt === 'Review the new API copy for gaps.')).toHaveLength(0);
    },
    { timeout: AGENT_COPILOT_API_TEST_TIMEOUT_MS }
  );

  test(
    'rejects invalid copilot chat names and reports an error back to the source chat',
    async () => {
    const droneId = 'drone-agent-copilot-invalid-name';
    const sourcePromptId = 'source-prompt-invalid-name';
    const now = new Date().toISOString();
    mockPromptJobs.set(sourcePromptId, {
      id: sourcePromptId,
      state: 'done',
      startedAt: now,
      finishedAt: now,
      stdout: '{"type":"agent-copilot","name":"bad/name","message":"Review this."}',
      stderr: '',
      transcript: {
        kind: 'cursor',
        message: '{"type":"agent-copilot","name":"bad/name","message":"Review this."}',
        terminalStatus: 'completed',
      },
    });
    mockPromptOutputOverride = ({ body }) => {
      const prompt = String(body?.prompt ?? '').trim();
      if (prompt.includes("Copilot 'bad/name' failed:")) return { stdout: 'ack' };
      return { stdout: 'unexpected' };
    };
    await updateRegistry((reg: any) => {
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = {
        id: droneId,
        name: droneId,
        hostPort: mockDaemon?.port ?? 1,
        token: 'mock-token',
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
                id: sourcePromptId,
                at: now,
                updatedAt: now,
                prompt: 'Draft the API copy.',
                state: 'sent',
              },
            ],
          },
        },
      };
    });

    const transcript = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/chats/default/transcript?turn=all`);
    expect(transcript.r.status).toBe(200);

    await pollUntil(async () => {
      const regAny: any = await loadRegistry();
      const sourceChat = regAny?.drones?.[droneId]?.chats?.default ?? null;
      const handled = Array.isArray(sourceChat?.agentCopilotHandledSourceMessageIds)
        ? sourceChat.agentCopilotHandledSourceMessageIds
        : [];
      const sourcePending = Array.isArray(sourceChat?.pendingPrompts) ? sourceChat.pendingPrompts : [];
      return (
        handled.includes(`${droneId}:${sourcePromptId}`) &&
        sourcePending.some((row: any) => String(row?.prompt ?? '').includes("Copilot 'bad/name' failed:"))
      );
    }, 10_000, 100, 'invalid copilot name error');

    const regAny: any = await loadRegistry();
    expect(regAny?.drones?.[droneId]?.chats?.['bad/name']).toBeUndefined();
    },
    { timeout: AGENT_COPILOT_API_TEST_TIMEOUT_MS }
  );
});
