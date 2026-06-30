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
  test('exposes create drone branch controls without preflight tools', async () => {
    const api = createApi();
    await extension.activate(api);

    const createTool = api.tools.get('create_drone');

    expect(api.tools.has('status')).toBe(false);
    expect(api.tools.has('get_create_drone_defaults')).toBe(false);
    expect(createTool.inputSchema.properties.repoRef.type).toBe('string');
    expect(createTool.inputSchema.properties.repoLabel.type).toBe('string');
    expect(createTool.inputSchema.properties.repoBranchSource.enum).toEqual(['host', 'remote']);
    expect(createTool.inputSchema.properties.remoteBranch.type).toBe('string');
    expect(createTool.inputSchema.properties.pullHostBranchBeforeCreate.type).toBe('boolean');
  });

  test('uses repo-scoped remembered branch defaults when creating a drone', async () => {
    const api = createApi();
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-extension-repo-'));
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/repos')) {
        return jsonResponse({
          ok: true,
          repos: [{ path: repoPath, addedAt: new Date(0).toISOString(), remoteUrl: 'git@example.com:repo.git' }],
        });
      }
      if (String(url).endsWith('/api/settings/ui-preferences')) {
        return jsonResponse({
          ok: true,
          updatedAt: new Date(0).toISOString(),
          uiPreferences: {
            spawnAgentKey: 'builtin:codex',
            spawnModel: 'gpt-5.5',
            repoBranchSource: 'remote',
            repoCreateRemoteBranch: 'origin/global-default',
            pullHostBranchBeforeCreate: false,
            spawnContextByRepoKey: {
              [repoPath]: {
                spawnAgentKey: 'builtin:codex',
                spawnModel: 'gpt-5.5',
                repoBranchSource: 'remote',
                repoCreateRemoteBranch: 'origin/voice-default',
                pullHostBranchBeforeCreate: false,
              },
            },
          },
        });
      }
      if (String(url).startsWith('http://hub.local/api/repos/branches')) {
        return jsonResponse({
          ok: true,
          repoRoot: repoPath,
          hostBranch: 'main',
          remoteBranches: [{ name: 'origin/voice-default', remote: 'origin', branch: 'voice-default', headSha: null }],
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
      repoPath,
    });

    const createRequest = requests.find((request) => String(request.url).endsWith('/api/drones'));
    const body = JSON.parse(createRequest.init.body);

    expect(body).toMatchObject({
      name: 'voice-default',
      runtime: 'container',
      repoPath,
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
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  test('does not reuse a stale remote branch default from another repo', async () => {
    const api = createApi();
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-extension-repo-'));
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/repos')) {
        return jsonResponse({
          ok: true,
          repos: [{ path: repoPath, addedAt: new Date(0).toISOString() }],
        });
      }
      if (String(url).endsWith('/api/settings/ui-preferences')) {
        return jsonResponse({
          ok: true,
          updatedAt: new Date(0).toISOString(),
          uiPreferences: {
            spawnAgentKey: 'builtin:codex',
            spawnModel: 'gpt-5.5',
            repoBranchSource: 'remote',
            repoCreateRemoteBranch: 'origin/release/dev',
            pullHostBranchBeforeCreate: false,
          },
        });
      }
      if (String(url).endsWith('/api/drones')) {
        return jsonResponse({
          ok: true,
          id: 'drone-1',
          name: 'drone-repo',
          phase: 'starting',
        }, 202);
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    const result = await api.tools.get('create_drone').execute({
      name: 'drone-repo',
      repoPath,
    });

    const createRequest = requests.find((request) => String(request.url).endsWith('/api/drones'));
    expect(createRequest).toBeTruthy();
    const body = JSON.parse(createRequest.init.body);
    expect(body).toMatchObject({
      name: 'drone-repo',
      runtime: 'container',
      repoPath,
      repoBranchSource: 'host',
      pullHostBranchBeforeCreate: false,
    });
    expect(body.remoteBranch).toBeUndefined();
    expect(result.branch).toEqual({
      repoBranchSource: 'host',
      remoteBranch: null,
      pullHostBranchBeforeCreate: false,
    });
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  test('requires repo-scoped remote branch defaults to exist in the selected repo', async () => {
    const api = createApi();
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-extension-repo-'));
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/repos')) {
        return jsonResponse({
          ok: true,
          repos: [{ path: repoPath, addedAt: new Date(0).toISOString() }],
        });
      }
      if (String(url).endsWith('/api/settings/ui-preferences')) {
        return jsonResponse({
          ok: true,
          updatedAt: new Date(0).toISOString(),
          uiPreferences: {
            spawnContextByRepoKey: {
              [repoPath]: {
                repoBranchSource: 'remote',
                repoCreateRemoteBranch: 'origin/release/dev',
              },
            },
          },
        });
      }
      if (String(url).startsWith('http://hub.local/api/repos/branches')) {
        return jsonResponse({
          ok: true,
          repoRoot: repoPath,
          hostBranch: 'main',
          remoteBranches: [{ name: 'origin/main', remote: 'origin', branch: 'main', headSha: null }],
        });
      }
      if (String(url).endsWith('/api/drones')) {
        return jsonResponse({ ok: false, error: 'should not create' }, 500);
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    await expect(api.tools.get('create_drone').execute({
      name: 'voice-default',
      repoPath,
    })).rejects.toThrow(`Saved default remote branch "origin/release/dev" is not available for repo ${repoPath}`);

    expect(requests.some((request) => String(request.url).endsWith('/api/drones'))).toBe(false);
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  test('returns initial message run state when creating a seeded drone', async () => {
    const api = createApi();
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/settings/ui-preferences')) {
        return jsonResponse({ ok: true, uiPreferences: {} });
      }
      if (String(url).endsWith('/api/drones')) {
        return jsonResponse({
          ok: true,
          id: 'drone-seeded',
          name: 'seeded',
          phase: 'starting',
          initialMessage: {
            chat: 'default',
            promptId: 'seed-prompt-1',
            pendingState: 'queued',
            status: 'queued',
          },
        }, 202);
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    const result = await api.tools.get('create_drone').execute({
      name: 'seeded',
      initialMessage: 'Start this work',
    });

    const createRequest = requests.find((request) => String(request.url).endsWith('/api/drones'));
    const body = JSON.parse(createRequest.init.body);

    expect(body.seedPrompt).toBe('Start this work');
    expect(body.seedSubmittedAt).toEqual(expect.any(String));
    expect(result.drone.status).toBe('starting');
    expect(result.inProgress).toBe(true);
    expect(result.initialMessage).toEqual({
      chat: 'default',
      runId: 'seed-prompt-1',
      promptId: 'seed-prompt-1',
      pendingState: 'queued',
      status: 'queued',
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
    const result = await api.tools.get('list_drones').execute({});

    expect(requests[0].url).toBe('http://127.0.0.1:8787/api/drones/summary');
    expect(requests[0].init.headers.authorization).toBe('Bearer discovered-token');
    expect(result).toMatchObject({ ok: true, count: 0, drones: [] });
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

  test('lists registered repos with opaque refs and labels', async () => {
    const api = createApi();
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'StorySpark-'));
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/repos')) {
        return jsonResponse({
          ok: true,
          repos: [{ path: repoRoot, addedAt: new Date(0).toISOString(), remoteUrl: 'git@example.com:StorySpark.git' }],
        });
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    const result = await api.tools.get('list_repos').execute({});

    expect(result.count).toBe(1);
    expect(result.repos[0]).toMatchObject({
      repoRef: `repo:${Buffer.from(repoRoot, 'utf8').toString('base64url')}`,
      label: path.basename(repoRoot),
      path: repoRoot,
      exists: true,
    });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  test('creates a repo-attached drone from a unique repo label', async () => {
    const api = createApi();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-extension-repos-'));
    const repoRoot = path.join(parent, 'StorySpark');
    fs.mkdirSync(repoRoot);
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/repos')) {
        return jsonResponse({ ok: true, repos: [{ path: repoRoot, addedAt: new Date(0).toISOString() }] });
      }
      if (String(url).endsWith('/api/settings/ui-preferences')) {
        return jsonResponse({ ok: true, uiPreferences: {} });
      }
      if (String(url).endsWith('/api/drones')) {
        return jsonResponse({ ok: true, id: 'drone-1', name: 'label-create', phase: 'starting' }, 202);
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    const result = await api.tools.get('create_drone').execute({
      name: 'label-create',
      repoLabel: 'StorySpark',
    });

    const createRequest = requests.find((request) => String(request.url).endsWith('/api/drones'));
    expect(JSON.parse(createRequest.init.body)).toMatchObject({
      name: 'label-create',
      repoPath: repoRoot,
      repoBranchSource: 'host',
    });
    expect(result.repo).toMatchObject({ label: 'StorySpark', path: repoRoot, exists: true });
    fs.rmSync(parent, { recursive: true, force: true });
  });

  test('rejects unregistered repo paths before creating a drone', async () => {
    const api = createApi();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-extension-repos-'));
    const repoRoot = path.join(parent, 'StorySpark');
    fs.mkdirSync(repoRoot);
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/repos')) {
        return jsonResponse({ ok: true, repos: [{ path: repoRoot, addedAt: new Date(0).toISOString() }] });
      }
      if (String(url).endsWith('/api/drones')) {
        return jsonResponse({ ok: false, error: 'should not create' }, 500);
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    await expect(api.tools.get('create_drone').execute({
      name: 'bad-path',
      repoPath: path.join('/home/zael/dev/me/drone', 'StorySpark'),
    })).rejects.toThrow('Unregistered repoPath: /home/zael/dev/me/drone/StorySpark');

    expect(requests.some((request) => String(request.url).endsWith('/api/drones'))).toBe(false);
    fs.rmSync(parent, { recursive: true, force: true });
  });

  test('rejects ambiguous repo labels before creating a drone', async () => {
    const api = createApi();
    const parentA = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-extension-a-'));
    const parentB = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-extension-b-'));
    const repoA = path.join(parentA, 'StorySpark');
    const repoB = path.join(parentB, 'StorySpark');
    fs.mkdirSync(repoA);
    fs.mkdirSync(repoB);
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/repos')) {
        return jsonResponse({ ok: true, repos: [{ path: repoA }, { path: repoB }] });
      }
      if (String(url).endsWith('/api/drones')) {
        return jsonResponse({ ok: false, error: 'should not create' }, 500);
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    await expect(api.tools.get('create_drone').execute({
      name: 'ambiguous-label',
      repoLabel: 'StorySpark',
    })).rejects.toThrow('Repo label "StorySpark" is ambiguous');

    expect(requests.some((request) => String(request.url).endsWith('/api/drones'))).toBe(false);
    fs.rmSync(parentA, { recursive: true, force: true });
    fs.rmSync(parentB, { recursive: true, force: true });
  });

  test('renames multiple drones through resolved ids', async () => {
    const api = createApi();
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/drones/summary')) {
        return jsonResponse({
          ok: true,
          drones: [
            { id: 'drone-a', name: 'Alpha', group: 'Review' },
            { id: 'drone-b', name: 'Beta', group: 'Review' },
          ],
        });
      }
      if (String(url).endsWith('/api/drones/drone-a/rename')) {
        const body = JSON.parse(init.body);
        return jsonResponse({
          ok: true,
          id: 'drone-a',
          oldName: 'Alpha',
          newName: body.newName,
          renamed: true,
        });
      }
      if (String(url).endsWith('/api/drones/drone-b/rename')) {
        const body = JSON.parse(init.body);
        return jsonResponse({
          ok: true,
          id: 'drone-b',
          oldName: 'Beta',
          newName: body.newName,
          renamed: true,
        });
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    const result = await api.tools.get('rename_drones').execute({
      renames: [
        { drone: 'Alpha', newName: 'Auth fix' },
        { droneId: 'drone-b', newName: 'Billing review' },
      ],
    });

    const renameRequests = requests.filter((request) => String(request.url).endsWith('/rename'));
    expect(renameRequests.map((request) => request.url)).toEqual([
      'http://hub.local/api/drones/drone-a/rename',
      'http://hub.local/api/drones/drone-b/rename',
    ]);
    expect(renameRequests.map((request) => JSON.parse(request.init.body).newName)).toEqual([
      'Auth fix',
      'Billing review',
    ]);
    expect(result).toMatchObject({
      ok: true,
      total: 2,
      renamed: [
        { id: 'drone-a', oldName: 'Alpha', newName: 'Auth fix', renamed: true },
        { id: 'drone-b', oldName: 'Beta', newName: 'Billing review', renamed: true },
      ],
      rejected: [],
    });
  });

  test('exposes a drone reorder tool that updates sidebar preferences for a group', async () => {
    const api = createApi();
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/drones/summary')) {
        return jsonResponse({
          ok: true,
          drones: [
            { id: 'drone-a', name: 'Alpha', group: 'Review' },
            { id: 'drone-b', name: 'Beta', group: 'Review' },
            { id: 'drone-c', name: 'Gamma', group: 'Review' },
          ],
        });
      }
      if (String(url).endsWith('/api/settings/ui-preferences') && init.method === 'GET') {
        return jsonResponse({
          ok: true,
          uiPreferences: {
            sidebarGroupOrder: ['group:Review'],
            sidebarDroneOrderByGroup: { 'group:Review': ['drone-b', 'drone-a', 'hidden-drone'] },
            sidebarNodeOrderByParent: { 'folder:Review': ['drone:drone-b', 'drone:drone-a', 'drone:hidden-drone'] },
          },
        });
      }
      if (String(url).endsWith('/api/settings/ui-preferences') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        return jsonResponse({ ok: true, uiPreferences: body.uiPreferences, updatedAt: new Date(0).toISOString() });
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    const result = await api.tools.get('reorder_drones').execute({
      group: 'Review',
      drones: ['Gamma', 'Alpha'],
      beforeDrone: 'Beta',
    });

    const saveRequest = requests.find((request) => request.init.method === 'POST' && request.url.endsWith('/api/settings/ui-preferences'));
    const saved = JSON.parse(saveRequest.init.body).uiPreferences;

    expect(result.sidebarDroneOrder).toEqual(['drone-c', 'drone-a', 'drone-b', 'hidden-drone']);
    expect(saved.sidebarDroneOrderByGroup['group:Review']).toEqual(['drone-c', 'drone-a', 'drone-b', 'hidden-drone']);
    expect(saved.sidebarNodeOrderByParent['folder:Review']).toEqual([
      'drone:drone-c',
      'drone:drone-a',
      'drone:drone-b',
      'drone:hidden-drone',
    ]);
  });

  test('moves a newly created group to the top of its parent when setting drone group', async () => {
    const api = createApi();
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/groups') && init.method !== 'POST') {
        return jsonResponse({
          ok: true,
          groups: [
            { name: 'Parent/Alpha' },
            { name: 'Other' },
          ],
        });
      }
      if (String(url).endsWith('/api/drones/summary')) {
        return jsonResponse({
          ok: true,
          drones: [{ id: 'drone-a', name: 'Alpha', group: null }],
        });
      }
      if (String(url).endsWith('/api/drones/group-set')) {
        return jsonResponse({
          ok: true,
          group: 'Parent/New',
          moved: [{ id: 'drone-a', name: 'Alpha', previousGroup: null, group: 'Parent/New' }],
          rejected: [],
          total: 1,
        });
      }
      if (String(url).endsWith('/api/settings/ui-preferences') && init.method === 'GET') {
        return jsonResponse({
          ok: true,
          uiPreferences: {
            sidebarGroupOrder: ['group:Parent/Alpha', 'group:Other'],
          },
        });
      }
      if (String(url).endsWith('/api/settings/ui-preferences') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        return jsonResponse({ ok: true, uiPreferences: body.uiPreferences, updatedAt: new Date(0).toISOString() });
      }
      return jsonResponse({ ok: false, error: 'not found' }, 404);
    };

    await extension.activate(api);
    const result = await api.tools.get('set_drone_group').execute({
      drone: 'Alpha',
      group: 'Parent/New',
    });

    const saveRequest = requests.find((request) => request.init.method === 'POST' && request.url.endsWith('/api/settings/ui-preferences'));
    const saved = JSON.parse(saveRequest.init.body).uiPreferences;

    expect(result.groupOrder.updated).toBe(true);
    expect(saved.sidebarGroupOrder).toEqual(['group:Parent', 'group:Parent/New', 'group:Parent/Alpha', 'group:Other']);
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
    await expect(api.tools.get('list_drones').execute({})).rejects.toThrow(
      'Drone Hub request failed: GET /api/drones/summary via http://hub.local (source: config) returned 503: boom',
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
    await expect(api.tools.get('list_drones').execute({})).rejects.toThrow(
      'Drone Hub request timed out after 10000ms: GET /api/drones/summary via http://hub.local (source: config)',
    );
  });
});
