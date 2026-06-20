const { afterEach, describe, expect, test } = require('bun:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const extension = require('./drone-hub-extension.cjs');

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

function createApi(config = {}) {
  const tools = new Map();
  const state = new Map();
  return {
    config: {
      baseUrl: 'http://hub.local',
      token: 'test-token',
      ...config,
    },
    state: {
      async get(key, fallback) {
        return state.has(key) ? state.get(key) : fallback;
      },
      async set(key, value) {
        state.set(key, value);
      },
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    log() {},
    assistant: {
      async promptThread() {},
    },
    tools,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

describe('drone hub desktop extension', () => {
  test('exposes create drone branch controls and defaults tool', async () => {
    const api = createApi();
    await extension.activate(api);

    const defaultsTool = api.tools.get('get_create_drone_defaults');
    const createTool = api.tools.get('create_drone');

    expect(defaultsTool).toBeTruthy();
    expect(createTool.inputSchema.properties.repoBranchSource.enum).toEqual(['host', 'remote']);
    expect(createTool.inputSchema.properties.remoteBranch.type).toBe('string');
    expect(createTool.inputSchema.properties.pullHostBranchBeforeCreate.type).toBe('boolean');
  });

  test('uses remembered branch defaults when creating a drone', async () => {
    const api = createApi();
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/settings/ui-preferences')) {
        return jsonResponse({
          ok: true,
          updatedAt: new Date(0).toISOString(),
          uiPreferences: {
            spawnAgentKey: 'builtin:codex',
            spawnModel: 'gpt-5.5',
            repoBranchSource: 'remote',
            repoCreateRemoteBranch: 'origin/voice-default',
            pullHostBranchBeforeCreate: false,
          },
        });
      }
      if (String(url).endsWith('/api/drones')) {
        return jsonResponse({
          ok: true,
          id: 'drone-1',
          name: 'voice-default',
          phase: 'starting',
        }, 202);
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    const result = await api.tools.get('create_drone').execute({
      name: 'voice-default',
      repoPath: '/work/repo',
    });

    const createRequest = requests.find((request) => String(request.url).endsWith('/api/drones'));
    const body = JSON.parse(createRequest.init.body);

    expect(body).toMatchObject({
      name: 'voice-default',
      runtime: 'container',
      repoPath: '/work/repo',
      repoBranchSource: 'remote',
      remoteBranch: 'origin/voice-default',
      seedAgent: { kind: 'builtin', id: 'codex' },
      seedModel: 'gpt-5.5',
    });
    expect(body.pullHostBranchBeforeCreate).toBeUndefined();
    expect(result.branch).toEqual({
      repoBranchSource: 'remote',
      remoteBranch: 'origin/voice-default',
      pullHostBranchBeforeCreate: null,
    });
  });

  test('discovers hub api port from profile state when only token is configured', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-extension-repo-'));
    const dataDir = path.join(repoRoot, 'data', 'profiles', 'default', 'drone');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'data', 'profiles'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'data', 'profiles', 'manifest.json'),
      JSON.stringify({ version: 1, activeProfile: 'default' }),
    );
    fs.writeFileSync(
      path.join(dataDir, 'hub.json'),
      JSON.stringify({ version: 1, apiHost: '127.0.0.1', apiPort: 8787, uiPort: 5174 }),
    );
    fs.writeFileSync(path.join(dataDir, 'hub.token'), 'discovered-token');
    const api = createApi({ baseUrl: '', token: 'configured-token', repoRoot });
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return jsonResponse({ ok: true, drones: [] });
    };

    await extension.activate(api);
    const result = await api.tools.get('status').execute({});

    expect(requests[0].url).toBe('http://127.0.0.1:8787/api/health');
    expect(requests[0].init.headers.authorization).toBe('Bearer discovered-token');
    expect(result.baseUrl).toBe('http://127.0.0.1:8787');
    expect(result.source).toBe(dataDir);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  test('lists drones through the lightweight summary endpoint', async () => {
    const api = createApi();
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      return jsonResponse({
        ok: true,
        drones: [
          { id: 'drone-1', name: 'Alpha', group: 'Review', runtime: 'container', repoPath: '/repo', status: 'ready' },
        ],
      });
    };

    await extension.activate(api);
    const result = await api.tools.get('list_drones').execute({});

    expect(requests).toEqual(['http://hub.local/api/drones/summary']);
    expect(result.count).toBe(1);
    expect(result.drones[0]).toMatchObject({ id: 'drone-1', name: 'Alpha', group: 'Review', status: 'ready' });
  });

  test('falls back to full drone list when summary endpoint is unavailable', async () => {
    const api = createApi();
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      if (String(url).endsWith('/api/drones/summary')) return jsonResponse({ ok: false, error: 'not found' }, 404);
      return jsonResponse({
        ok: true,
        drones: [
          { id: 'drone-1', name: 'Alpha', group: 'Review', runtime: 'container', repoPath: '/repo', statusOk: true },
        ],
      });
    };

    await extension.activate(api);
    const result = await api.tools.get('list_drones').execute({});

    expect(requests).toEqual(['http://hub.local/api/drones/summary', 'http://hub.local/api/drones']);
    expect(result.count).toBe(1);
    expect(result.drones[0]).toMatchObject({ id: 'drone-1', name: 'Alpha', status: 'ready' });
  });

  test('reports request context on hub http failures', async () => {
    const api = createApi();
    globalThis.fetch = async () => jsonResponse({ ok: false, error: 'boom' }, 503);

    await extension.activate(api);
    await expect(api.tools.get('status').execute({})).rejects.toThrow(
      'Drone Hub request failed: GET /api/health via http://hub.local (source: config) returned 503: boom',
    );
  });

  test('reports request context on hub timeouts', async () => {
    const api = createApi();
    globalThis.setTimeout = (fn) => {
      fn();
      return 1;
    };
    globalThis.clearTimeout = () => {};
    globalThis.fetch = async (_url, init) => {
      if (init.signal.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return jsonResponse({ ok: true });
    };

    await extension.activate(api);
    await expect(api.tools.get('status').execute({})).rejects.toThrow(
      'Drone Hub request timed out after 10000ms: GET /api/health via http://hub.local (source: config)',
    );
  });
});
