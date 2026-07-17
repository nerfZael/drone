import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { resetDroneRootDirForTests } from '../src/host/paths';
import { startDroneHubApiServer } from '../src/hub/server';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('routed Hub APIs', () => {
  const token = 'test-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-routed-api-'));
  const previousDataDir = process.env.DRONE_DATA_DIR;
  const previousXdg = process.env.XDG_DATA_HOME;
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';

  const apiFetch = async (route: string, init?: RequestInit) => {
    const response = await fetch(`${baseUrl}${route}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });
    const text = await response.text();
    return { response, data: text ? JSON.parse(text) : null };
  };

  const jsonRequest = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    process.env.DRONE_DATA_DIR = path.join(tempRoot, 'data');
    process.env.XDG_DATA_HOME = path.join(tempRoot, 'xdg');
    fs.mkdirSync(process.env.DRONE_DATA_DIR, { recursive: true });
    fs.mkdirSync(process.env.XDG_DATA_HOME, { recursive: true });
    resetDroneRootDirForTests();
    server = await startDroneHubApiServer({ port: 0, apiToken: token });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (previousDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDataDir;
    if (previousXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousXdg;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('does not expose standalone assistant thread routes', async () => {
    const createAttempt = await apiFetch(
      '/api/assistant/threads',
      jsonRequest('POST', { title: 'Router test' }),
    );
    expect(createAttempt.response.status).toBe(404);

    const listed = await apiFetch('/api/assistant/threads');
    expect(listed.response.status).toBe(404);

    const systemPrompt = await apiFetch('/api/assistant/system-prompt');
    expect(systemPrompt.response.status).toBe(200);
  });

  test('routes whiteboard CRUD and reports malformed JSON consistently', async () => {
    const malformed = await apiFetch('/api/whiteboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(malformed.response.status).toBe(400);
    expect(malformed.data.ok).toBe(false);

    const created = await apiFetch(
      '/api/whiteboards',
      jsonRequest('POST', { id: 'router-board', title: 'Router board' }),
    );
    if (created.response.status === 503) {
      expect(created.data.ok).toBe(false);
      expect(created.data.error).toContain('whiteboard store unavailable');
      return;
    }
    expect(created.response.status).toBe(201);
    expect(created.data.whiteboard.id).toBe('router-board');

    const updated = await apiFetch(
      '/api/whiteboards/router-board',
      jsonRequest('PATCH', {
        baseVersion: created.data.whiteboard.version,
        title: 'Updated board',
      }),
    );
    expect(updated.response.status).toBe(200);
    expect(updated.data.whiteboard.title).toBe('Updated board');

    const removed = await apiFetch('/api/whiteboards/router-board', { method: 'DELETE' });
    expect(removed.response.status).toBe(200);
    expect(removed.data.deleted).toBe(true);
  });

  test('routes skill CRUD through decoded resource parameters', async () => {
    const created = await apiFetch(
      '/api/skills',
      jsonRequest('POST', {
        name: 'Router Skill',
        description: 'Exercises the routed skill API.',
        content: 'Keep route behavior stable.',
      }),
    );
    expect(created.response.status).toBe(201);
    const skillId = created.data.skill.id;

    const read = await apiFetch(`/api/skills/${encodeURIComponent(skillId)}`);
    expect(read.response.status).toBe(200);
    expect(read.data.skill.name).toBe('Router Skill');

    const removed = await apiFetch(`/api/skills/${encodeURIComponent(skillId)}`, {
      method: 'DELETE',
    });
    expect(removed.response.status).toBe(200);
    expect(removed.data.id).toBe(skillId);
  });
});
