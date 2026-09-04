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
  fleetSize: integerOption('fleet', 187),
  chatsPerDrone: integerOption('chats', 4),
  turnsPerChat: integerOption('turns', 60),
  outputBytes: integerOption('output-bytes', 2_000),
  activityBytes: integerOption('activity-bytes', 500_000),
  activityTurns: integerOption('activity-turns', 6),
  trials: integerOption('trials', 5),
  settleMs: integerOption('settle-ms', 1_100),
  maxDroneListP95Ms: integerOption('max-drone-list-p95-ms', 100),
  maxChatStateP95Ms: integerOption('max-chat-state-p95-ms', 1_000),
  maxChatStateKiB: integerOption('max-chat-state-kib', 512),
  maxActivityContentionP95Ms: integerOption('max-activity-contention-p95-ms', 100),
  maxStreamSnapshotMs: integerOption('max-stream-snapshot-ms', 250),
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

function createRequestClient() {
  const worker = new Worker(
    `
      const { parentPort } = require('node:worker_threads');
      const { performance } = require('node:perf_hooks');
      parentPort.on('message', ({ id, baseUrl, token, delayMs, pathname }) => {
        setTimeout(async () => {
          const startedAt = performance.now();
          try {
            const response = await fetch(baseUrl + pathname, {
              headers: { authorization: 'Bearer ' + token, connection: 'close' },
            });
            const body = await response.arrayBuffer();
            if (!response.ok) throw new Error(pathname + ' returned ' + response.status);
            parentPort.postMessage({
              id,
              durationMs: performance.now() - startedAt,
              bytes: body.byteLength,
              timingRaw: response.headers.get('server-timing'),
            });
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
    else operation.resolve(message);
  });
  worker.on('error', (error) => {
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  });
  return {
    request(baseUrl, token, delayMs, pathname = '/api/mcp-servers') {
      const id = nextId;
      nextId += 1;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      worker.postMessage({ id, baseUrl, token, delayMs, pathname });
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
              activity: {
                version: 1,
                source: 'codex',
                updatedAt: at,
                messages: [],
                ...(droneIndex === 0 &&
                chatIndex === 0 &&
                turnIndex >= fixture.turnsPerChat - fixture.activityTurns
                  ? {
                      messages: [{
                        id: `activity-${turnIndex}`,
                        role: 'toolResult',
                        toolCallId: `tool-${turnIndex}`,
                        content: fixture.activity,
                        createdAt: at,
                      }],
                    }
                  : {}),
              },
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

async function openEventStream(baseUrl, token, pathname, requiredEvents = ['snapshot']) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    controller.abort();
    throw new Error(`${pathname} event stream returned ${response.status}`);
  }
  const reader = response.body.getReader();
  let eventCount = 0;
  let buffered = '';
  const remainingEvents = new Set(requiredEvents);
  let ready = false;
  let resolveSnapshot;
  let rejectSnapshot;
  const snapshotReadyMs = new Promise((resolve, reject) => {
    resolveSnapshot = resolve;
    rejectSnapshot = reject;
  });
  const snapshotTimeout = setTimeout(
    () =>
      rejectSnapshot(
        new Error(
          `${pathname} did not publish initial events ${Array.from(remainingEvents).join(', ')} within 5s`,
        ),
      ),
    5_000,
  );
  const consume = (async () => {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
        eventCount +=
          Buffer.from(result.value)
            .toString('utf8')
            .match(/event: /g)?.length ?? 0;
        buffered = `${buffered}${Buffer.from(result.value).toString('utf8')}`;
        for (const eventName of Array.from(remainingEvents)) {
          if (buffered.includes(`event: ${eventName}\n`)) remainingEvents.delete(eventName);
        }
        if (!ready && remainingEvents.size === 0) {
          ready = true;
          clearTimeout(snapshotTimeout);
          resolveSnapshot(performance.now() - startedAt);
        }
        buffered = buffered.slice(-16_384);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        clearTimeout(snapshotTimeout);
        rejectSnapshot(error);
        throw error;
      }
    }
  })();
  return {
    eventCount: () => eventCount,
    snapshotReadyMs,
    close: async () => {
      clearTimeout(snapshotTimeout);
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
  let activityRequestClient = null;
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
    const fixture = {
      ...options,
      output: 'x'.repeat(options.outputBytes),
      activity: 'a'.repeat(options.activityBytes),
    };
    const seedMs = await seedFleet(database, fixture);
    const token = 'drone-list-stall-benchmark-token';
    server = await requireBuilt(path.join('hub', 'server.js')).startDroneHubApiServer({
      port: 0,
      apiToken: token,
    });
    const baseUrl = `http://${server.host}:${server.port}`;
    cheapRequestClient = createRequestClient();
    activityRequestClient = createRequestClient();
    events = [
      await openEventStream(baseUrl, token, '/api/desktop/events', [
        'registry_snapshot',
        'chat_snapshot',
      ]),
    ];
    const streamSnapshotMs = await Promise.all(events.map((stream) => stream.snapshotReadyMs));
    await timedFetch(baseUrl, token, '/api/mcp-servers');
    await cheapRequestClient.request(baseUrl, token, 0);

    const samples = [];
    for (let trial = 1; trial <= options.trials; trial += 1) {
      if (trial > 1) await new Promise((resolve) => setTimeout(resolve, options.settleMs));
      const cheapRequest = cheapRequestClient.request(baseUrl, token, 5);
      const droneList = timedFetch(baseUrl, token, '/api/drones');
      const chatState = timedFetch(
        baseUrl,
        token,
        '/api/drones/benchmark-drone-0/chats/chat-0/state?turn=all&tail=50&transcript=tail&subscriptions=true&readState=false&transcriptMeta=0&config=true&activity=summary',
      );
      const [drones, chat, cheap] = await Promise.all([droneList, chatState, cheapRequest]);
      const activityControlRequest = cheapRequestClient.request(baseUrl, token, 0);
      const activityRequest = activityRequestClient.request(
        baseUrl,
        token,
        0,
        `/api/drones/benchmark-drone-0/chats/chat-0/turns/turn-${options.turnsPerChat - 1}/activity`,
      );
      const [activity, activityControl] = await Promise.all([
        activityRequest,
        activityControlRequest,
      ]);
      const sample = {
        trial,
        droneListMs: round(drones.durationMs),
        chatStateMs: round(chat.durationMs),
        activityDetailMs: round(activity.durationMs),
        activityContentionMs: round(activityControl.durationMs),
        cheapRequestMs: round(cheap.durationMs),
        droneListResponseKiB: round(drones.bytes / 1_024),
        chatStateResponseKiB: round(chat.bytes / 1_024),
        activityDetailResponseKiB: round(activity.bytes / 1_024),
        activityDetailServerTiming: parseServerTiming(activity.timingRaw),
        droneListServerTiming: drones.timing,
        chatStateServerTiming: chat.timing,
      };
      samples.push(sample);
      console.log(JSON.stringify({ type: 'sample', ...sample }));
    }

    const summary = {
      type: 'summary',
      fixture: {
        fleetSize: options.fleetSize,
        chatsPerDrone: options.chatsPerDrone,
        turnsPerChat: options.turnsPerChat,
        outputBytes: options.outputBytes,
        activityBytes: options.activityBytes,
        activityTurns: options.activityTurns,
        trials: options.trials,
      },
      seedMs: round(seedMs),
      databaseMiB: round(fs.statSync(database.path).size / 1_048_576),
      sseEventChunks: events.reduce((total, stream) => total + stream.eventCount(), 0),
      streamSnapshots: summarize(streamSnapshotMs),
      droneList: summarize(samples.map((sample) => sample.droneListMs)),
      chatState: summarize(samples.map((sample) => sample.chatStateMs)),
      activityDetail: summarize(samples.map((sample) => sample.activityDetailMs)),
      activityContention: summarize(samples.map((sample) => sample.activityContentionMs)),
      chatStateResponseMaxKiB: round(
        Math.max(...samples.map((sample) => sample.chatStateResponseKiB)),
      ),
      unrelatedCheapRequest: summarize(samples.map((sample) => sample.cheapRequestMs)),
    };
    console.log(JSON.stringify(summary));
    const failures = [];
    if (summary.droneList.p95Ms > options.maxDroneListP95Ms) {
      failures.push(
        `drone list p95 ${summary.droneList.p95Ms}ms exceeded ${options.maxDroneListP95Ms}ms`,
      );
    }
    if (summary.chatState.p95Ms > options.maxChatStateP95Ms) {
      failures.push(
        `chat state p95 ${summary.chatState.p95Ms}ms exceeded ${options.maxChatStateP95Ms}ms`,
      );
    }
    if (summary.chatStateResponseMaxKiB > options.maxChatStateKiB) {
      failures.push(
        `chat state response ${summary.chatStateResponseMaxKiB}KiB exceeded ${options.maxChatStateKiB}KiB`,
      );
    }
    if (summary.activityContention.p95Ms > options.maxActivityContentionP95Ms) {
      failures.push(
        `activity contention p95 ${summary.activityContention.p95Ms}ms exceeded ${options.maxActivityContentionP95Ms}ms`,
      );
    }
    if (summary.streamSnapshots.maxMs > options.maxStreamSnapshotMs) {
      failures.push(
        `stream snapshot max ${summary.streamSnapshots.maxMs}ms exceeded ${options.maxStreamSnapshotMs}ms`,
      );
    }
    if (failures.length > 0) throw new Error(`benchmark SLO failed: ${failures.join('; ')}`);
  } finally {
    await Promise.all(events?.map((stream) => stream.close()) ?? []);
    await Promise.all([cheapRequestClient?.close(), activityRequestClient?.close()]);
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
