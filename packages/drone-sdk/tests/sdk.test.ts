import { describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createDroneSDK } from '../src';
import { hubTransport } from '../src/hub';
import { createMockTransport } from '../src/testing';

describe('drone-sdk core', () => {
  test('creates a drone and dispatches queued chat messages sequentially', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ prompt }) => `done:${prompt}`,
      }),
    });

    const drone = await sdk.drones.create('drone-1');
    const run = await drone
      .chat('planner')
      .queue('alpha')
      .queue('beta')
      .queue('gamma')
      .dispatch();

    const result = await run.wait();
    const messages = await run.messages({ order: 'asc' });

    expect(drone.runtime).toBe('container');
    expect(result.status).toBe('done');
    expect(messages.map((message) => message.content)).toEqual([
      'alpha',
      'done:alpha',
      'beta',
      'done:beta',
      'gamma',
      'done:gamma',
    ]);
  });

  test('accepts simplified agent/model on create', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ prompt }) => `done:${prompt}`,
      }),
    });

    const drone = await sdk.drones.create('drone-seeded', {
      agent: 'codex',
      model: 'gpt-5-mini',
    });
    const run = await drone.chat('default').send('hello');
    const text = await run.lastMessageText();

    expect(drone.runtime).toBe('container');
    expect(text).toBe('done:hello');
  });

  test('supports multiple chats on one drone', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ chatName, prompt }) => `${chatName}:${prompt}`,
      }),
    });

    const drone = await sdk.drones.create('drone-2');
    const planner = drone.chat('planner');
    const coder = drone.chat('coder');

    const [plannerRun, coderRun] = await Promise.all([
      planner.queue('p1').queue('p2').queue('p3').dispatch(),
      coder.queue('c1').queue('c2').queue('c3').dispatch(),
    ]);

    await Promise.all([plannerRun.wait(), coderRun.wait()]);
    const [plannerLast, coderLast] = await Promise.all([plannerRun.lastMessageText(), coderRun.lastMessageText()]);

    expect(plannerLast).toBe('planner:p3');
    expect(coderLast).toBe('coder:c3');
  });

  test('broadcasts to multiple chats on one drone', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ chatName, prompt }) => `${chatName}:${prompt}`,
      }),
    });

    const drone = await sdk.drones.create('drone-3');
    const runs = await drone.broadcast(['planner', 'coder']).send('status');
    const results = await Promise.all(runs.map(async (run) => await run.lastMessageText()));

    expect(results).toEqual(['planner:status', 'coder:status']);
  });

  test('broadcasts to multiple drones on the same chat', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ drone, prompt }) => `${drone.name}:${prompt}`,
      }),
    });

    const [a, b] = await Promise.all([
      sdk.drones.create('drone-a'),
      sdk.drones.create('drone-b'),
    ]);

    const runs = await sdk.broadcast.drones([a, b]).chat('default').send('ping');
    const results = await Promise.all(runs.map(async (run) => await run.lastMessageText()));

    expect(results).toEqual(['drone-a:ping', 'drone-b:ping']);
  });

  test('supports sendAndWait for broadcast chat runs', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({
        responder: ({ drone, prompt }) => `${drone.name}:${prompt}`,
      }),
    });

    const [a, b] = await Promise.all([sdk.drones.create('drone-a'), sdk.drones.create('drone-b')]);
    const responses = await sdk.broadcast.drones([a, b]).chat('default').sendAndWait('ping');

    expect(
      responses.map((response) => ({
        droneName: response.droneName,
        status: response.status,
        text: response.text,
      })),
    ).toEqual([
      { droneName: 'drone-a', status: 'done', text: 'drone-a:ping' },
      { droneName: 'drone-b', status: 'done', text: 'drone-b:ping' },
    ]);
  });

  test('removes chats explicitly', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport(),
    });

    const drone = await sdk.drones.create('drone-4');
    await drone.chat('planner').ensure();
    await drone.chat('planner').remove();

    const chats = await drone.chats.list();
    expect(chats.map((chat) => chat.name)).toEqual(['default']);
  });

  test('archives drones on remove when archive mode is enabled', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport({ deleteMode: 'archive' }),
    });

    const drone = await sdk.drones.create('drone-5');
    await drone.remove();

    const found = await sdk.drones.get(drone.id);
    expect(found).toBeNull();
  });

  test('lists groups via group-scoped creates', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport(),
    });

    const exp = sdk.groups.create('experimental');
    await exp.createMany([
      { name: 'a' },
      { name: 'b' },
    ]);

    const groups = await sdk.groups.list();
    expect(groups).toEqual([{ name: 'experimental', count: 2 }]);
  });

  test('supports object create and createManyDrones on groups', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport(),
    });

    const exp = sdk.groups.create('experimental');
    const [a, b] = await exp.createManyDrones([{ name: 'a' }, { name: 'b' }]);
    const c = await exp.create({ name: 'c' });
    const listed = await exp.list();

    expect([a.group, b.group, c.group]).toEqual(['experimental', 'experimental', 'experimental']);
    expect(listed.map((drone) => drone.name).sort()).toEqual(['a', 'b', 'c']);
  });

  test('moves one or more drones between groups', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport(),
    });

    const alpha = await sdk.drones.create('alpha', { group: 'triage' });
    const beta = await sdk.drones.create('beta');
    const moved = await sdk.drones.setGroup([alpha, beta.id], 'builders');
    const listed = await sdk.groups.get('builders').list();

    expect(moved.group).toBe('builders');
    expect(moved.moved.map((drone) => drone.name).sort()).toEqual(['alpha', 'beta']);
    expect(listed.map((drone) => drone.name).sort()).toEqual(['alpha', 'beta']);

    await alpha.setGroup(null);
    await alpha.refresh();

    expect(alpha.group).toBeUndefined();
    expect((await sdk.groups.get('builders').list()).map((drone) => drone.name)).toEqual(['beta']);
  });

  test('sends group fields through hub transport create and group-set requests', async () => {
    const requests: Array<{ pathname: string; body: any }> = [];
    const transport = hubTransport({
      baseUrl: 'http://127.0.0.1:8787',
      token: 'test-token',
      fetch: (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        requests.push({
          pathname: new URL(String(input)).pathname,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        const pathname = new URL(String(input)).pathname;
        if (pathname === '/api/drones/batch') {
          return new Response(JSON.stringify({
            ok: true,
            accepted: [{ id: 'drone-1', name: 'alpha', phase: 'starting' }],
            rejected: [],
            total: 1,
          }), { status: 202, headers: { 'content-type': 'application/json' } });
        }
        if (pathname === '/api/drones/group-set') {
          return new Response(JSON.stringify({
            ok: true,
            group: 'builders',
            moved: [{ id: 'drone-1', name: 'alpha', previousGroup: 'triage', group: 'builders' }],
            rejected: [],
            total: 1,
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });

    const created = await transport.createDrones([{ name: 'alpha', group: 'triage' }]);
    const moved = await transport.setDroneGroup(['drone-1'], 'builders');

    expect(created.accepted[0]?.group).toBe('triage');
    expect(moved.group).toBe('builders');
    expect(requests).toEqual([
      {
        pathname: '/api/drones/batch',
        body: { drones: [{ name: 'alpha', runtime: 'container', group: 'triage' }] },
      },
      {
        pathname: '/api/drones/group-set',
        body: { droneIds: ['drone-1'], group: 'builders' },
      },
    ]);
  });

  test('supports cloning one or many drones', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport(),
    });

    const source = await sdk.drones.create('source-drone', { group: 'source' });
    const single = await sdk.drones.clone(source, 'source-drone-copy', { group: 'target' });
    const many = await sdk.drones.cloneMany([
      { source, name: 'source-drone-copy-2', group: 'target' },
      { source: source.id, name: 'source-drone-copy-3', group: 'target' },
    ]);

    expect(single.name).toBe('source-drone-copy');
    expect(single.group).toBe('target');
    expect(many.accepted.map((drone) => drone.name).sort()).toEqual([
      'source-drone-copy-2',
      'source-drone-copy-3',
    ]);
  });

  test('supports cloning a full group to another group', async () => {
    const sdk = createDroneSDK({
      transport: createMockTransport(),
    });

    const source = sdk.groups.create('source-group');
    await source.createManyDrones([{ name: 'a' }, { name: 'b' }]);
    const cloned = await source.cloneTo('target-group', { nameSuffix: '-copy' });
    const target = await sdk.groups.get('target-group').list();

    expect(cloned.accepted.map((drone) => drone.name).sort()).toEqual(['a-copy', 'b-copy']);
    expect(target.map((drone) => drone.name).sort()).toEqual(['a-copy', 'b-copy']);
  });

  test('auto-discovers hub token and baseUrl from DRONE_DATA_DIR', async () => {
    const previousDataDir = process.env.DRONE_DATA_DIR;
    const previousToken = process.env.DRONE_TOKEN;
    const previousHubToken = process.env.DRONE_HUB_API_TOKEN;
    const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
    const previousFetch = globalThis.fetch;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'drone-sdk-'));

    const observed: Array<{ url: string; auth: string }> = [];
    try {
      await writeFile(path.join(tempDir, 'hub.token'), 'token-from-file\n', 'utf8');
      await writeFile(
        path.join(tempDir, 'hub.json'),
        JSON.stringify(
          {
            version: 1,
            pid: process.pid,
            apiHost: '127.0.0.1',
            apiPort: 9988,
            uiPort: 5174,
            startedAt: new Date().toISOString(),
            logPath: path.join(tempDir, 'hub.log'),
          },
          null,
          2,
        ),
        'utf8',
      );

      process.env.DRONE_DATA_DIR = tempDir;
      delete process.env.DRONE_TOKEN;
      delete process.env.DRONE_HUB_API_TOKEN;
      delete process.env.DRONE_HUB_BASE_URL;

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const observedUrl = String(input);
        const headers = new Headers(init?.headers as HeadersInit | undefined);
        observed.push({ url: observedUrl, auth: String(headers.get('authorization') ?? '') });
        const pathname = new URL(observedUrl).pathname;
        if (pathname.endsWith('/api/tldr/from-message')) {
          return new Response(JSON.stringify({ ok: true, tldr: 'auto-summary' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ id: 'drone-1', name: 'auto-drone' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;

      const sdk = createDroneSDK();
      const drone = await sdk.drones.create('auto-drone');
      expect(sdk.ai).toBeTruthy();
      const aiSummary = await sdk.ai!.ask('summarize this');

      expect(drone.id).toBe('drone-1');
      expect(aiSummary).toBe('auto-summary');
      expect(observed.some((entry) => entry.url === 'http://127.0.0.1:9988/api/drones')).toBe(true);
      expect(observed.some((entry) => entry.url === 'http://127.0.0.1:9988/api/tldr/from-message')).toBe(true);
      expect(observed.every((entry) => entry.auth === 'Bearer token-from-file')).toBe(true);
    } finally {
      if (previousDataDir === undefined) delete process.env.DRONE_DATA_DIR;
      else process.env.DRONE_DATA_DIR = previousDataDir;
      if (previousToken === undefined) delete process.env.DRONE_TOKEN;
      else process.env.DRONE_TOKEN = previousToken;
      if (previousHubToken === undefined) delete process.env.DRONE_HUB_API_TOKEN;
      else process.env.DRONE_HUB_API_TOKEN = previousHubToken;
      if (previousBaseUrl === undefined) delete process.env.DRONE_HUB_BASE_URL;
      else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
      globalThis.fetch = previousFetch;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('auto-discovers hub token and baseUrl from the active profile manifest', async () => {
    const previousDataDir = process.env.DRONE_DATA_DIR;
    const previousToken = process.env.DRONE_TOKEN;
    const previousHubToken = process.env.DRONE_HUB_API_TOKEN;
    const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
    const previousFetch = globalThis.fetch;
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const profilesRoot = path.join(repoRoot, 'data', 'profiles');
    const manifestPath = path.join(profilesRoot, 'manifest.json');
    const profileName = 'sdk-manifest-test';
    const profileDroneDir = path.join(profilesRoot, profileName, 'drone');
    let manifestBackup: string | null = null;

    const observed: Array<{ url: string; auth: string }> = [];
    try {
      try {
        manifestBackup = await readFile(manifestPath, 'utf8');
      } catch {
        manifestBackup = null;
      }

      await rm(path.join(profilesRoot, profileName), { recursive: true, force: true });
      await mkdir(profileDroneDir, { recursive: true });
      await writeFile(
        manifestPath,
        JSON.stringify({ version: 1, activeProfile: profileName }, null, 2),
        'utf8',
      );
      await writeFile(path.join(profileDroneDir, 'hub.token'), 'token-from-profile\n', 'utf8');
      await writeFile(
        path.join(profileDroneDir, 'hub.json'),
        JSON.stringify(
          {
            version: 1,
            pid: process.pid,
            apiHost: '127.0.0.1',
            apiPort: 9991,
            uiPort: 5174,
            startedAt: new Date().toISOString(),
            logPath: path.join(profileDroneDir, 'hub.log'),
          },
          null,
          2,
        ),
        'utf8',
      );

      delete process.env.DRONE_DATA_DIR;
      delete process.env.DRONE_TOKEN;
      delete process.env.DRONE_HUB_API_TOKEN;
      delete process.env.DRONE_HUB_BASE_URL;

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const observedUrl = String(input);
        const headers = new Headers(init?.headers as HeadersInit | undefined);
        observed.push({ url: observedUrl, auth: String(headers.get('authorization') ?? '') });
        return new Response(JSON.stringify({ id: 'drone-profile', name: 'from-profile' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;

      const sdk = createDroneSDK();
      const drone = await sdk.drones.create('from-profile');

      expect(drone.id).toBe('drone-profile');
      expect(observed.some((entry) => entry.url === 'http://127.0.0.1:9991/api/drones')).toBe(true);
      expect(observed.every((entry) => entry.auth === 'Bearer token-from-profile')).toBe(true);
    } finally {
      if (previousDataDir === undefined) delete process.env.DRONE_DATA_DIR;
      else process.env.DRONE_DATA_DIR = previousDataDir;
      if (previousToken === undefined) delete process.env.DRONE_TOKEN;
      else process.env.DRONE_TOKEN = previousToken;
      if (previousHubToken === undefined) delete process.env.DRONE_HUB_API_TOKEN;
      else process.env.DRONE_HUB_API_TOKEN = previousHubToken;
      if (previousBaseUrl === undefined) delete process.env.DRONE_HUB_BASE_URL;
      else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
      globalThis.fetch = previousFetch;
      await rm(path.join(profilesRoot, profileName), { recursive: true, force: true });
      if (manifestBackup == null) await rm(manifestPath, { force: true });
      else await writeFile(manifestPath, manifestBackup, 'utf8');
    }
  });

  test('requires token when no transport is provided', async () => {
    const previousDataDir = process.env.DRONE_DATA_DIR;
    const previous = process.env.DRONE_TOKEN;
    const previousHubToken = process.env.DRONE_HUB_API_TOKEN;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'drone-sdk-empty-'));
    try {
      process.env.DRONE_DATA_DIR = tempDir;
      delete process.env.DRONE_TOKEN;
      delete process.env.DRONE_HUB_API_TOKEN;
      expect(() => createDroneSDK()).toThrow(/DRONE_TOKEN/);
    } finally {
      if (previousDataDir === undefined) delete process.env.DRONE_DATA_DIR;
      else process.env.DRONE_DATA_DIR = previousDataDir;
      if (previous === undefined) delete process.env.DRONE_TOKEN;
      else process.env.DRONE_TOKEN = previous;
      if (previousHubToken === undefined) delete process.env.DRONE_HUB_API_TOKEN;
      else process.env.DRONE_HUB_API_TOKEN = previousHubToken;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
