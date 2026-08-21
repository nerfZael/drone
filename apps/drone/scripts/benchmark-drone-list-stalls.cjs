#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');

const DIST_ROOT = process.env.DRONE_BENCH_DIST_ROOT
  ? path.resolve(process.env.DRONE_BENCH_DIST_ROOT)
  : path.resolve(__dirname, '..', 'dist');
const SERVER_PATH = path.join(DIST_ROOT, 'hub', 'server.js');

function integerOption(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${prefix}<value> must be a positive integer`);
  }
  return parsed;
}

const options = {
  fleetSize: integerOption('fleet', 144),
  chatsPerDrone: integerOption('chats', 4),
  turnsPerChat: integerOption('turns', 60),
  outputBytes: integerOption('output-bytes', 2_000),
  trials: integerOption('trials', 5),
  settleMs: integerOption('settle-ms', 1_100),
};

function requireBuilt(relativePath) {
  if (!fs.existsSync(SERVER_PATH)) {
    throw new Error('Drone build output is missing. Run `bun run build` from the repository root.');
  }
  return require(path.join(DIST_ROOT, relativePath));
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function summarize(values) {
  return {
    minMs: round(Math.min(...values)),
    medianMs: round(percentile(values, 0.5)),
    p95Ms: round(percentile(values, 0.95)),
    maxMs: round(Math.max(...values)),
  };
}

function parseServerTiming(raw) {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(',').flatMap((item) => {
      const match = item.trim().match(/^([^;]+);dur=([\d.]+)$/);
      return match ? [[match[1], Number(match[2])]] : [];
    }),
  );
}

function createCheapRequestClient() {
  const worker = new Worker(
    `
      const { parentPort } = require('node:worker_threads');
      const { performance } = require('node:perf_hooks');
      parentPort.on('message', ({ id, baseUrl, token, delayMs }) => {
        setTimeout(async () => {
          const startedAt = performance.now();
          try {
            const response = await fetch(baseUrl + '/api/mcp-servers', {
              headers: { authorization: 'Bearer ' + token },
            });
            await response.arrayBuffer();
            if (!response.ok) throw new Error('cheap endpoint returned ' + response.status);
            parentPort.postMessage({ id, durationMs: performance.now() - startedAt });
          } catch (error) {
            parentPort.postMessage({ id, error: error?.message ?? String(error) });
          }
        }, delayMs);
      });
    `,
    { eval: true },
  );
  const pending = new Map();
  let nextId = 1;
  worker.on('message', (message) => {
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error));
    else operation.resolve(message.durationMs);
  });
  worker.on('error', (error) => {
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  });
  return {
    request(baseUrl, token, delayMs) {
      const id = nextId;
      nextId += 1;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      worker.postMessage({ id, baseUrl, token, delayMs });
      return result;
    },
    close: async () => await worker.terminate(),
  };
}

async function seedFleet(database, fixture) {
  const startedAt = performance.now();
  await database.writeTransaction('drone list stall benchmark fixture', (connection) => {
    connection.exec(`
      DELETE FROM canonical_chat_turns;
      DELETE FROM canonical_chats;
      DELETE FROM hub_canonical_pending_drones;
      DELETE FROM hub_canonical_drones;
    `);
    const insertDrone = connection.prepare(`
      INSERT INTO hub_canonical_drones (
        drone_id, name, container_name, runtime_kind, phase, lifecycle_json, version, updated_at
      ) VALUES (?, ?, NULL, 'host', NULL, ?, 1, ?)
    `);
    const insertChat = connection.prepare(`
      INSERT INTO canonical_chats (
        drone_id, chat_name, created_at, updated_at, metadata_json, source_hash,
        transcript_version, turns_source_hash
      ) VALUES (?, ?, ?, ?, ?, 'benchmark', 0, 'benchmark')
    `);
    const insertTurn = connection.prepare(`
      INSERT INTO canonical_chat_turns (
        drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const baseTime = Date.parse('2026-08-21T00:00:00.000Z');
    for (let droneIndex = 0; droneIndex < fixture.fleetSize; droneIndex += 1) {
      const droneId = `benchmark-drone-${droneIndex}`;
      const createdAt = new Date(baseTime + droneIndex * 1_000).toISOString();
      insertDrone.run(
        droneId,
        `Benchmark Drone ${droneIndex}`,
        JSON.stringify({
          id: droneId,
          name: `Benchmark Drone ${droneIndex}`,
          runtime: 'host',
          repoPath: `/benchmark/repo-${droneIndex}`,
          createdAt,
        }),
        createdAt,
      );
      for (let chatIndex = 0; chatIndex < fixture.chatsPerDrone; chatIndex += 1) {
        const chatName = `chat-${chatIndex}`;
        insertChat.run(
          droneId,
          chatName,
          createdAt,
          createdAt,
          JSON.stringify({
            id: `benchmark-thread-${droneIndex}-${chatIndex}`,
            agent: { kind: 'builtin', id: 'codex' },
          }),
        );
        for (let turnIndex = 0; turnIndex < fixture.turnsPerChat; turnIndex += 1) {
          const turnId = `turn-${turnIndex}`;
          const at = new Date(
            baseTime +
              (droneIndex * fixture.chatsPerDrone * fixture.turnsPerChat +
                chatIndex * fixture.turnsPerChat +
                turnIndex) *
                1_000,
          ).toISOString();
          insertTurn.run(
            droneId,
            chatName,
            turnId,
            turnIndex,
            at,
            at,
            at,
            JSON.stringify({
              id: turnId,
              at,
              prompt: `Prompt ${turnIndex}`,
              ok: true,
              output: fixture.output,
              activity: { updatedAt: at },
            }),
          );
        }
      }
    }
  });
  return performance.now() - startedAt;
}

async function timedFetch(baseUrl, token, pathname) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(
      `${pathname} returned ${response.status}: ${Buffer.from(body).toString('utf8')}`,
    );
  }
  return {
    durationMs: performance.now() - startedAt,
    bytes: body.byteLength,
    timing: parseServerTiming(response.headers.get('server-timing')),
  };
}

async function openRegistryEvents(baseUrl, token) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/drones/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    controller.abort();
    throw new Error(`drone registry event stream returned ${response.status}`);
  }
  const reader = response.body.getReader();
  let eventCount = 0;
  const consume = (async () => {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
        eventCount +=
          Buffer.from(result.value)
            .toString('utf8')
            .match(/event: /g)?.length ?? 0;
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();
  return {
    eventCount: () => eventCount,
    close: async () => {
      controller.abort();
      await consume.catch(() => {});
    },
  };
}

async function main() {
  process.env.DRONE_HUB_BUSY_DEBUG = '0';
  process.env.DRONE_HUB_PERF_DEBUG ??= '1';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-list-stall-benchmark-'));
  const previousDataDir = process.env.DRONE_DATA_DIR;
  process.env.DRONE_DATA_DIR = path.join(tempRoot, 'data');
  fs.mkdirSync(process.env.DRONE_DATA_DIR, { recursive: true });

  const paths = requireBuilt(path.join('host', 'paths.js'));
  const databaseModule = requireBuilt(path.join('host', 'hub-database.js'));
  paths.resetDroneRootDirForTests();
  let server = null;
  let events = null;
  let cheapRequestClient = null;
  try {
    const lifecycle = await requireBuilt(
      path.join('host', 'drone-lifecycle-repository.js'),
    ).getDroneLifecycleRepository();
    await lifecycle.upsert('real', 'benchmark-bootstrap', {
      id: 'benchmark-bootstrap',
      name: 'Benchmark Bootstrap',
      runtime: 'host',
    });
    await requireBuilt(path.join('hub', 'transcript-store.js')).upsertChatInStore({
      droneId: 'benchmark-bootstrap',
      chatName: 'default',
      chatEntry: {},
    });
    const database = databaseModule.requireHubDatabase();
    const fixture = { ...options, output: 'x'.repeat(options.outputBytes) };
    const seedMs = await seedFleet(database, fixture);
    const token = 'drone-list-stall-benchmark-token';
    server = await requireBuilt(path.join('hub', 'server.js')).startDroneHubApiServer({
      port: 0,
      apiToken: token,
    });
    const baseUrl = `http://${server.host}:${server.port}`;
    cheapRequestClient = createCheapRequestClient();
    events = await openRegistryEvents(baseUrl, token);
    await timedFetch(baseUrl, token, '/api/mcp-servers');
    await cheapRequestClient.request(baseUrl, token, 0);

    const samples = [];
    for (let trial = 1; trial <= options.trials; trial += 1) {
      if (trial > 1) await new Promise((resolve) => setTimeout(resolve, options.settleMs));
      const cheapRequest = cheapRequestClient.request(baseUrl, token, 5);
      const droneList = timedFetch(baseUrl, token, '/api/drones');
      const [drones, cheap] = await Promise.all([droneList, cheapRequest]);
      const sample = {
        trial,
        droneListMs: round(drones.durationMs),
        cheapRequestMs: round(cheap),
        responseKiB: round(drones.bytes / 1_024),
        serverTiming: drones.timing,
      };
      samples.push(sample);
      console.log(JSON.stringify({ type: 'sample', ...sample }));
    }

    console.log(
      JSON.stringify({
        type: 'summary',
        fixture: options,
        seedMs: round(seedMs),
        databaseMiB: round(fs.statSync(database.path).size / 1_048_576),
        sseEventChunks: events.eventCount(),
        droneList: summarize(samples.map((sample) => sample.droneListMs)),
        unrelatedCheapRequest: summarize(samples.map((sample) => sample.cheapRequestMs)),
      }),
    );
  } finally {
    await events?.close();
    await cheapRequestClient?.close();
    await server?.close();
    await databaseModule.resetHubDatabaseForTests();
    if (previousDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDataDir;
    paths.resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
