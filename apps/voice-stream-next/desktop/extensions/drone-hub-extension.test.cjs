const { afterEach, describe, expect, test } = require('bun:test');

const extension = require('./drone-hub-extension.cjs');

const originalFetch = globalThis.fetch;

function createApi() {
  const tools = new Map();
  const state = new Map();
  return {
    config: {
      baseUrl: 'http://hub.local',
      token: 'test-token',
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
});
