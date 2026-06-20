const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_HUB_BASE_URL = 'http://127.0.0.1:5174';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_FOR_MS = 1000;
const DEFAULT_IDLE_POLL_INTERVAL_MS = 1000;
const DEFAULT_IDLE_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
const MAX_IDLE_FOR_MS = 60_000;
const MAX_IDLE_POLL_INTERVAL_MS = 30_000;
const MAX_IDLE_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
const MAX_IDLE_TARGETS = 20;
const CREATED_DRONES_STATE_KEY = 'createdDrones';
const MAX_TRACKED_CREATED_DRONES = 500;
const DEFAULT_CREATE_DRONE_PREFERENCES = {
  spawnAgentKey: 'builtin:cursor',
  spawnModel: '',
  repoBranchSource: 'host',
  repoCreateRemoteBranch: '',
  pullHostBranchBeforeCreate: true,
};

const idleSubscriptions = new Map();
let idleSubscriptionSequence = 0;

function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanPositiveInt(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function cleanIsoTimestamp(value) {
  const text = cleanString(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function truncateString(value, maxChars) {
  const text = String(value ?? '');
  if (text.length <= maxChars) return { value: text, truncated: false, originalLength: text.length };
  return { value: text.slice(0, maxChars), truncated: true, originalLength: text.length };
}

function uniquePaths(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanString(value);
    if (!text) continue;
    const resolved = path.resolve(text);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function extensionRepoRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

function normalizeProfileName(value) {
  const text = cleanString(value).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(text)) return '';
  return text;
}

function readActiveProfileName(repoRoot) {
  const manifest = readJson(path.join(repoRoot, 'data', 'profiles', 'manifest.json'));
  if (Number(manifest?.version) !== 1) return '';
  return normalizeProfileName(manifest?.activeProfile);
}

function candidateRepoRoots(config) {
  return uniquePaths([
    config.repoRoot,
    process.env.DRONE_REPO_ROOT,
    extensionRepoRoot(),
    process.cwd(),
  ]);
}

function candidateDataDirs(config) {
  const explicit = cleanString(config.dataDir || process.env.DRONE_DATA_DIR);
  if (explicit) return uniquePaths([explicit]);

  const repoDataDirs = [];
  for (const repoRoot of candidateRepoRoots(config)) {
    const activeProfile = readActiveProfileName(repoRoot);
    if (activeProfile) repoDataDirs.push(path.join(repoRoot, 'data', 'profiles', activeProfile, 'drone'));
    repoDataDirs.push(path.join(repoRoot, 'data', 'drone'));
  }

  if (process.platform === 'win32') {
    const appData = cleanString(process.env.APPDATA, path.join(os.homedir(), 'AppData', 'Roaming'));
    return uniquePaths([...repoDataDirs, path.join(appData, 'drone')]);
  }
  if (process.platform === 'darwin') {
    return uniquePaths([...repoDataDirs, path.join(os.homedir(), 'Library', 'Application Support', 'drone')]);
  }
  const xdgDataHome = cleanString(process.env.XDG_DATA_HOME, path.join(os.homedir(), '.local', 'share'));
  return uniquePaths([...repoDataDirs, path.join(xdgDataHome, 'drone'), path.join(os.homedir(), '.drone')]);
}

function readHubStateSnapshot(filePath) {
  const state = readJson(filePath);
  const rawHost = cleanString(state?.apiHost, '127.0.0.1');
  const apiHost = rawHost === '0.0.0.0' || rawHost === '::' ? '127.0.0.1' : rawHost;
  const apiPort = Number(state?.apiPort);
  if (!apiHost || !Number.isFinite(apiPort) || apiPort <= 0) return null;
  return {
    apiHost,
    apiPort: Math.floor(apiPort),
    apiToken: cleanString(state?.apiToken),
  };
}

function discoverHubConnection(config, configuredBaseUrl = '') {
  for (const dir of candidateDataDirs(config)) {
    const state = readHubStateSnapshot(path.join(dir, 'hub.json'));
    const token = readText(path.join(dir, 'hub.token')) || cleanString(state?.apiToken);
    if (!token) continue;
    return {
      baseUrl: state ? `http://${state.apiHost}:${state.apiPort}` : configuredBaseUrl || DEFAULT_HUB_BASE_URL,
      token,
      source: dir,
    };
  }
  return null;
}

function resolveHubConnection(config) {
  const configuredBaseUrl = cleanString(config.baseUrl || process.env.DRONE_HUB_BASE_URL);
  const configuredToken = cleanString(config.token || process.env.DRONE_TOKEN || process.env.DRONE_HUB_API_TOKEN);
  const discovered = discoverHubConnection(config, configuredBaseUrl);
  if (discovered && !configuredBaseUrl) return discovered;
  if (configuredToken) {
    return {
      baseUrl: configuredBaseUrl || DEFAULT_HUB_BASE_URL,
      token: configuredToken,
      source: configuredBaseUrl ? 'config' : 'token',
    };
  }

  if (discovered) return discovered;

  throw new Error('Drone Hub connection not found. Start Drone Hub, or set config.baseUrl and config.token.');
}

function joinUrl(baseUrl, pathname) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ''), base).toString();
}

async function requestJson(connection, pathname, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (typeof fetch !== 'function') throw new Error('fetch is not available in this desktop runtime');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const method = cleanString(init.method, 'GET').toUpperCase();
  const url = joinUrl(connection.baseUrl, pathname);
  const requestLabel = `${method} ${pathname}`;
  const connectionLabel = `${connection.baseUrl}${connection.source ? ` (source: ${connection.source})` : ''}`;
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail = cleanString(data?.error || text, `HTTP ${response.status}`);
      const error = new Error(`Drone Hub request failed: ${requestLabel} via ${connectionLabel} returned ${response.status}: ${detail}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Drone Hub request timed out after ${timeoutMs}ms: ${requestLabel} via ${connectionLabel}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAgent(value) {
  const id = cleanString(value).toLowerCase();
  if (!id) return null;
  if (!['cursor', 'codex', 'claude', 'opencode', 'pi'].includes(id)) {
    throw new Error(`Unsupported built-in agent: ${value}`);
  }
  return { kind: 'builtin', id };
}

function normalizeRepoBranchSource(value, fallback = 'host') {
  const source = cleanString(value).toLowerCase();
  if (source === 'remote' || source === 'host') return source;
  return fallback === 'remote' ? 'remote' : 'host';
}

function normalizeSpawnAgentKey(value, fallback = DEFAULT_CREATE_DRONE_PREFERENCES.spawnAgentKey) {
  const key = cleanString(value, fallback);
  const builtin = key.startsWith('builtin:') ? key.slice('builtin:'.length) : key;
  try {
    return normalizeAgent(builtin) ? `builtin:${builtin.toLowerCase()}` : fallback;
  } catch {
    return fallback;
  }
}

async function createDronePreferences(hub) {
  try {
    const response = await requestJson(hub, '/api/settings/ui-preferences', { method: 'GET' });
    const prefs = response?.uiPreferences && typeof response.uiPreferences === 'object' ? response.uiPreferences : {};
    const repoBranchSource = normalizeRepoBranchSource(
      prefs.repoBranchSource,
      DEFAULT_CREATE_DRONE_PREFERENCES.repoBranchSource,
    );
    return {
      ...DEFAULT_CREATE_DRONE_PREFERENCES,
      spawnAgentKey: normalizeSpawnAgentKey(prefs.spawnAgentKey),
      spawnModel: cleanString(prefs.spawnModel),
      repoBranchSource,
      repoCreateRemoteBranch: cleanString(prefs.repoCreateRemoteBranch),
      pullHostBranchBeforeCreate:
        typeof prefs.pullHostBranchBeforeCreate === 'boolean'
          ? prefs.pullHostBranchBeforeCreate
          : DEFAULT_CREATE_DRONE_PREFERENCES.pullHostBranchBeforeCreate,
      source: response?.updatedAt ? 'drone_hub_ui_preferences' : 'default',
      updatedAt: cleanIsoTimestamp(response?.updatedAt),
    };
  } catch (error) {
    return {
      ...DEFAULT_CREATE_DRONE_PREFERENCES,
      source: 'default',
      updatedAt: null,
      warning: error?.message || String(error),
    };
  }
}

function agentFromPreferenceKey(value) {
  return normalizeAgent(String(value || '').replace(/^builtin:/, ''));
}

function summarizeStatusObject(status) {
  if (!status || typeof status !== 'object') return null;

  const phase = cleanString(status.phase || status.state || status.status);
  if (phase) return phase;

  const process = status.process && typeof status.process === 'object' ? status.process : null;
  if (process) {
    const running = process.running === true ? 'running' : process.running === false ? 'stopped' : '';
    const cmd = cleanString(process.cmd);
    if (running && cmd) return `process ${running}: ${cmd}`;
    if (running) return `process ${running}`;
    if (cmd) return `process: ${cmd}`;
    return 'process';
  }

  if (typeof status.ok === 'boolean') return status.ok ? 'ready' : 'not ready';
  return null;
}

function droneStatusSummary(drone) {
  const hubPhase = cleanString(drone?.hubPhase);
  const hubMessage = cleanString(drone?.hubMessage);
  if (hubPhase) return hubMessage ? `${hubPhase}: ${hubMessage}` : hubPhase;

  const statusError = cleanString(drone?.statusError);
  if (statusError) return `offline: ${statusError}`;

  if (drone?.busy === true || (Array.isArray(drone?.busyChats) && drone.busyChats.length > 0)) return 'busy';

  if (typeof drone?.status === 'string') return cleanString(drone.status) || null;
  if (drone?.status && typeof drone.status === 'object') return summarizeStatusObject(drone.status);
  if (drone?.statusOk === true) return 'ready';
  if (drone?.statusOk === false) return 'offline';
  return null;
}

function droneSummary(drone) {
  return {
    id: cleanString(drone?.id),
    name: cleanString(drone?.name),
    group: cleanString(drone?.group) || null,
    runtime: cleanString(drone?.runtime, 'container'),
    repoPath: cleanString(drone?.repoPath) || null,
    cwd: cleanString(drone?.cwd) || null,
    status: droneStatusSummary(drone),
    createdAt: cleanIsoTimestamp(drone?.createdAt),
    lastActivityAt: cleanIsoTimestamp(drone?.lastActivityAt),
    lastMessageAt: cleanIsoTimestamp(drone?.lastMessageAt),
    lastActivityChat: cleanString(drone?.lastActivityChat) || null,
  };
}

function compareDronesByRecentActivity(a, b) {
  const aMs = Date.parse(a.lastActivityAt || a.lastMessageAt || a.createdAt || '');
  const bMs = Date.parse(b.lastActivityAt || b.lastMessageAt || b.createdAt || '');
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);
  if (aValid && bValid && aMs !== bMs) return bMs - aMs;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function droneAliases(value) {
  const aliases = [];
  if (typeof value === 'string') {
    const text = cleanString(value);
    if (text) aliases.push(text);
  } else if (value && typeof value === 'object') {
    for (const item of [value.id, value.name]) {
      const text = cleanString(item);
      if (text) aliases.push(text);
    }
  }
  return [...new Set(aliases)];
}

async function requestDroneSummaries(hub) {
  try {
    return await requestJson(hub, '/api/drones/summary', { method: 'GET' });
  } catch (error) {
    if (error?.status !== 404) throw error;
    return await requestJson(hub, '/api/drones', { method: 'GET' });
  }
}

async function resolveDroneIdsForGroupSet(hub, refs) {
  const response = await requestDroneSummaries(hub);
  const drones = Array.isArray(response?.drones) ? response.drones.map(droneSummary) : [];
  return refs.map((ref) => {
    const match = drones.find((drone) => drone.id === ref || drone.name === ref);
    return match?.id || ref;
  });
}

async function createdDroneRecords(api) {
  const records = await api.state.get(CREATED_DRONES_STATE_KEY, []);
  return Array.isArray(records) ? records.filter((record) => record && typeof record === 'object') : [];
}

async function rememberCreatedDrone(api, drone, sourceTool) {
  const aliases = droneAliases(drone);
  if (aliases.length === 0) return;
  const now = new Date().toISOString();
  const records = await createdDroneRecords(api);
  const nextRecords = records.filter((record) => {
    const recordAliases = Array.isArray(record.aliases) ? record.aliases.map((item) => cleanString(item)).filter(Boolean) : [];
    return !recordAliases.some((alias) => aliases.includes(alias));
  });
  nextRecords.unshift({
    id: cleanString(drone?.id) || aliases[0],
    name: cleanString(drone?.name) || null,
    aliases,
    sourceTool,
    createdAt: now,
  });
  await api.state.set(CREATED_DRONES_STATE_KEY, nextRecords.slice(0, MAX_TRACKED_CREATED_DRONES));
}

async function wasCreatedByExtension(api, drone) {
  const aliases = droneAliases(drone);
  if (aliases.length === 0) return false;
  const records = await createdDroneRecords(api);
  return records.some((record) => {
    const recordAliases = Array.isArray(record.aliases) ? record.aliases.map((item) => cleanString(item)).filter(Boolean) : [];
    return recordAliases.some((alias) => aliases.includes(alias));
  });
}

function chatName(value) {
  return cleanString(value, 'default');
}

function boundedTranscriptTurn(turn, maxCharsPerField) {
  const result = { ...turn };
  for (const key of ['prompt', 'output', 'error']) {
    if (typeof result[key] !== 'string') continue;
    const next = truncateString(result[key], maxCharsPerField);
    result[key] = next.value;
    result[`${key}OriginalLength`] = next.originalLength;
    if (next.truncated) {
      result[`${key}Truncated`] = true;
      result.truncated = true;
    }
  }
  return result;
}

function registerTool(api, tool) {
  api.registerTool({
    supportedTargets: ['device', 'any_device'],
    defaultTarget: 'device',
    ...tool,
  });
}

function makeIdleSubscriptionId() {
  idleSubscriptionSequence += 1;
  return `drone_hub_idle_${Date.now().toString(36)}_${idleSubscriptionSequence.toString(36)}`;
}

function normalizeIdleTargets(args) {
  const rawTargets = Array.isArray(args?.targets) ? args.targets : [];
  const fallbackDrone = cleanString(args?.drone || args?.droneId);
  const targets = rawTargets.length > 0 ? rawTargets : fallbackDrone ? [{ drone: fallbackDrone, chat: args?.chat || args?.chatName }] : [];
  const result = [];
  const seen = new Set();
  for (const rawTarget of targets.slice(0, MAX_IDLE_TARGETS)) {
    const drone = cleanString(rawTarget?.drone || rawTarget?.droneId || rawTarget?.id);
    const chat = chatName(rawTarget?.chat || rawTarget?.chatName);
    if (!drone) continue;
    const key = `${drone}\u0000${chat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ drone, chat });
  }
  return result;
}

async function idleStatus(hub, mode, targets) {
  return requestJson(
    hub,
    '/api/chats/idle/status',
    { method: 'POST', body: JSON.stringify({ mode, targets }) },
  );
}

function idleSubscriptionPrompt(subscription, result) {
  return [
    `Drone Hub idle subscription ${subscription.id} fired.`,
    `Mode: ${subscription.mode}.`,
    'The idle status is below. Continue from where you left off. If you need the drone response text, use read_chat on the relevant drone chat.',
    JSON.stringify(result, null, 2),
  ].join('\n\n');
}

function stopIdleSubscription(subscription, status) {
  if (subscription.timer) clearInterval(subscription.timer);
  subscription.timer = null;
  subscription.status = status;
  idleSubscriptions.delete(subscription.id);
}

async function runIdleSubscriptionTick(subscription) {
  if (subscription.inFlight || subscription.status !== 'active') return;
  const now = Date.now();
  if (now >= subscription.expiresAtMs) {
    stopIdleSubscription(subscription, 'expired');
    subscription.api.log('Drone Hub idle subscription expired', { subscriptionId: subscription.id });
    return;
  }

  subscription.inFlight = true;
  try {
    const result = await idleStatus(subscription.hub, subscription.mode, subscription.targets);
    if (subscription.status !== 'active') return;
    subscription.lastStatus = result;
    subscription.lastError = null;
    if (result?.matched) {
      subscription.idleSince ??= now;
      if (now - subscription.idleSince >= subscription.idleForMs) {
        stopIdleSubscription(subscription, 'fired');
        await subscription.api.assistant.promptThread(subscription.threadId, idleSubscriptionPrompt(subscription, result));
      }
    } else {
      subscription.idleSince = null;
    }
  } catch (error) {
    subscription.lastError = error?.message || String(error);
    subscription.api.log('Drone Hub idle subscription poll failed', {
      subscriptionId: subscription.id,
      error: subscription.lastError,
    });
  } finally {
    subscription.inFlight = false;
  }
}

function startIdleSubscription(api, mode, args, context) {
  if (!api.assistant || typeof api.assistant.promptThread !== 'function') {
    throw new Error('desktop assistant callbacks are not available in this Voice Stream Next version');
  }
  const threadId = cleanString(context?.threadId);
  if (!threadId) throw new Error('threadId is required for chat idle subscriptions');
  const hub = resolveHubConnection(api.config || {});
  const targets = normalizeIdleTargets(args);
  if (targets.length === 0) throw new Error('targets are required');

  const now = Date.now();
  const expiresInMs = cleanPositiveInt(args?.expiresInMs, DEFAULT_IDLE_EXPIRES_IN_MS, MAX_IDLE_EXPIRES_IN_MS);
  const subscription = {
    id: makeIdleSubscriptionId(),
    mode,
    targets,
    threadId,
    hub,
    api,
    status: 'active',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + expiresInMs).toISOString(),
    expiresAtMs: now + expiresInMs,
    idleForMs: cleanPositiveInt(args?.idleForMs, DEFAULT_IDLE_FOR_MS, MAX_IDLE_FOR_MS),
    pollIntervalMs: cleanPositiveInt(args?.pollIntervalMs, DEFAULT_IDLE_POLL_INTERVAL_MS, MAX_IDLE_POLL_INTERVAL_MS),
    idleSince: null,
    inFlight: false,
    timer: null,
    lastStatus: null,
    lastError: null,
  };
  subscription.timer = setInterval(() => {
    void runIdleSubscriptionTick(subscription);
  }, subscription.pollIntervalMs);
  subscription.timer.unref?.();
  idleSubscriptions.set(subscription.id, subscription);
  void runIdleSubscriptionTick(subscription);

  return {
    ok: true,
    subscription: {
      id: subscription.id,
      mode: subscription.mode,
      targets: subscription.targets,
      threadId: subscription.threadId,
      status: subscription.status,
      createdAt: subscription.createdAt,
      expiresAt: subscription.expiresAt,
      idleForMs: subscription.idleForMs,
      pollIntervalMs: subscription.pollIntervalMs,
    },
  };
}

function idleSubscriptionInputSchema() {
  return {
    type: 'object',
    properties: {
      targets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            drone: { type: 'string' },
            droneId: { type: 'string' },
            chat: { type: 'string' },
            chatName: { type: 'string' },
          },
          required: [],
          additionalProperties: false,
        },
      },
      drone: { type: 'string' },
      droneId: { type: 'string' },
      chat: { type: 'string' },
      chatName: { type: 'string' },
      idleForMs: { type: 'number' },
      pollIntervalMs: { type: 'number' },
      expiresInMs: { type: 'number' },
    },
    required: [],
    additionalProperties: false,
  };
}

exports.activate = async function activate(api) {
  const config = api.config || {};

  function connection() {
    return resolveHubConnection(config);
  }

  registerTool(api, {
    name: 'status',
    label: 'Drone Hub status',
    description: 'Check whether the local Drone Hub API is reachable from this desktop.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    async execute() {
      const hub = connection();
      const response = await requestJson(hub, '/api/health', { method: 'GET' });
      return {
        ok: true,
        baseUrl: hub.baseUrl,
        source: hub.source,
        health: response && typeof response === 'object' ? response : { ok: true },
      };
    },
  });

  registerTool(api, {
    name: 'list_drones',
    label: 'List drones',
    description: 'List local Drone Hub drones, optionally filtered by group or names.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string' },
        names: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number' },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args) {
      const response = await requestDroneSummaries(connection());
      const wantedNames = new Set(Array.isArray(args.names) ? args.names.map((item) => cleanString(item)).filter(Boolean) : []);
      const group = cleanString(args.group);
      const limit = cleanPositiveInt(args.limit, 50, 200);
      let drones = Array.isArray(response?.drones) ? response.drones.map(droneSummary) : [];
      if (group) drones = drones.filter((drone) => drone.group === group);
      if (wantedNames.size > 0) drones = drones.filter((drone) => wantedNames.has(drone.id) || wantedNames.has(drone.name));
      drones.sort(compareDronesByRecentActivity);
      return { ok: true, count: drones.length, drones: drones.slice(0, limit) };
    },
  });

  registerTool(api, {
    name: 'list_groups',
    label: 'List drone groups',
    description: 'List Drone Hub groups and their drone counts.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    async execute() {
      const response = await requestJson(connection(), '/api/groups', { method: 'GET' });
      return { ok: true, groups: Array.isArray(response?.groups) ? response.groups : [] };
    },
  });

  registerTool(api, {
    name: 'get_create_drone_defaults',
    label: 'Get create drone defaults',
    description:
      'Read the Drone Hub defaults normally used when manually creating a drone, including agent, model, branch source, remote branch, and whether the host branch is pulled before create.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    async execute() {
      const defaults = await createDronePreferences(connection());
      return { ok: true, defaults };
    },
  });

  registerTool(api, {
    name: 'set_drone_group',
    label: 'Set drone group',
    description: 'Move one or more Drone Hub drones into a group, or clear their group.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        drones: { type: 'array', items: { type: 'string' } },
        drone: { type: 'string' },
        group: { type: 'string' },
        clearGroup: { type: 'boolean' },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args) {
      const rawDrones = Array.isArray(args.drones) ? args.drones : [];
      const fallbackDrone = cleanString(args.drone);
      const drones = [...new Set([
        ...rawDrones.map((item) => cleanString(item)).filter(Boolean),
        ...(fallbackDrone ? [fallbackDrone] : []),
      ])];
      if (drones.length === 0) throw new Error('at least one drone is required');
      const group = args.clearGroup === true ? null : cleanString(args.group) || null;
      if (group == null && args.clearGroup !== true) throw new Error('group is required unless clearGroup is true');
      const hub = connection();
      const droneIds = await resolveDroneIdsForGroupSet(hub, drones);
      const response = await requestJson(
        hub,
        '/api/drones/group-set',
        { method: 'POST', body: JSON.stringify({ droneIds, group }) },
      );
      return {
        ok: true,
        group: cleanString(response?.group) || null,
        moved: Array.isArray(response?.moved) ? response.moved : [],
        rejected: Array.isArray(response?.rejected) ? response.rejected : [],
        total: Number.isFinite(Number(response?.total)) ? Number(response.total) : drones.length,
      };
    },
  });

  registerTool(api, {
    name: 'create_drone',
    label: 'Create drone',
    description:
      'Create a new Drone Hub container drone, optionally starting its default chat with an initial message. Omitted agent, model, branch source, remote branch, and pull-before-create values use the same defaults Drone Hub remembers from manual drone creation. Use repoBranchSource=host for the local/current host branch, optionally with pullHostBranchBeforeCreate. Use repoBranchSource=remote with remoteBranch to seed from a specific remote branch.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        group: { type: 'string' },
        agent: { type: 'string', enum: ['cursor', 'codex', 'claude', 'opencode', 'pi'] },
        model: { type: 'string' },
        cwd: { type: 'string' },
        repoPath: { type: 'string' },
        repoBranchSource: { type: 'string', enum: ['host', 'remote'] },
        remoteBranch: { type: 'string' },
        pullHostBranchBeforeCreate: { type: 'boolean' },
        initialMessage: { type: 'string', description: 'Optional first message to send to the new drone default chat.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    async execute(args) {
      const hub = connection();
      const defaults = await createDronePreferences(hub);
      const seedAgent = args.agent == null ? agentFromPreferenceKey(defaults.spawnAgentKey) : normalizeAgent(args.agent);
      const seedModel = args.model == null ? defaults.spawnModel : cleanString(args.model);
      const repoPath = cleanString(args.repoPath);
      const repoBranchSource = normalizeRepoBranchSource(args.repoBranchSource, defaults.repoBranchSource);
      const remoteBranch = args.remoteBranch == null ? defaults.repoCreateRemoteBranch : cleanString(args.remoteBranch);
      const pullHostBranchBeforeCreate =
        typeof args.pullHostBranchBeforeCreate === 'boolean'
          ? args.pullHostBranchBeforeCreate
          : defaults.pullHostBranchBeforeCreate;
      const initialMessage = cleanString(args.initialMessage);
      const body = {
        name: cleanString(args.name),
        runtime: 'container',
        ...(cleanString(args.group) ? { group: cleanString(args.group) } : {}),
        ...(seedAgent ? { seedAgent } : {}),
        ...(seedModel ? { seedModel } : {}),
        ...(cleanString(args.cwd) ? { cwd: cleanString(args.cwd) } : {}),
        ...(repoPath ? { repoPath } : {}),
        ...(repoPath ? { repoBranchSource } : {}),
        ...(repoPath && repoBranchSource === 'host' ? { pullHostBranchBeforeCreate } : {}),
        ...(repoPath && repoBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
        ...(initialMessage ? { seedPrompt: initialMessage, seedSubmittedAt: new Date().toISOString() } : {}),
      };
      if (!body.name) throw new Error('name is required');
      if (repoPath && repoBranchSource === 'remote' && !remoteBranch) {
        throw new Error('remoteBranch is required when repoBranchSource is remote');
      }
      const response = await requestJson(hub, '/api/drones', { method: 'POST', body: JSON.stringify(body) }, 30_000);
      const drone = droneSummary({ ...body, ...response });
      await rememberCreatedDrone(api, drone, 'create_drone');
      return {
        ok: true,
        drone,
        createdByExtension: true,
        createDefaults: defaults,
        branch: repoPath
          ? {
              repoBranchSource,
              remoteBranch: repoBranchSource === 'remote' ? remoteBranch : null,
              pullHostBranchBeforeCreate: repoBranchSource === 'host' ? pullHostBranchBeforeCreate : null,
            }
          : null,
      };
    },
  });

  registerTool(api, {
    name: 'clone_drone',
    label: 'Clone drone',
    description: 'Create a new drone cloned from an existing Drone Hub drone.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        name: { type: 'string' },
        group: { type: 'string' },
        cloneChats: { type: 'boolean' },
      },
      required: ['source', 'name'],
      additionalProperties: false,
    },
    async execute(args) {
      const source = cleanString(args.source);
      const name = cleanString(args.name);
      if (!source) throw new Error('source is required');
      if (!name) throw new Error('name is required');
      const body = {
        name,
        runtime: 'container',
        cloneFrom: source,
        cloneChats: args.cloneChats !== false,
        ...(cleanString(args.group) ? { group: cleanString(args.group) } : {}),
      };
      const response = await requestJson(connection(), '/api/drones', { method: 'POST', body: JSON.stringify(body) }, 30_000);
      const drone = droneSummary({ ...body, ...response });
      await rememberCreatedDrone(api, drone, 'clone_drone');
      return { ok: true, drone, createdByExtension: true };
    },
  });

  registerTool(api, {
    name: 'list_chats',
    label: 'List drone chats',
    description: 'List chats for a Drone Hub drone.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        drone: { type: 'string' },
      },
      required: ['drone'],
      additionalProperties: false,
    },
    async execute(args) {
      const drone = cleanString(args.drone);
      if (!drone) throw new Error('drone is required');
      const response = await requestJson(connection(), `/api/drones/${encodeURIComponent(drone)}/chats`, { method: 'GET' });
      return { ok: true, drone, chats: Array.isArray(response?.chats) ? response.chats.map((name) => ({ name: cleanString(name) })) : [] };
    },
  });

  registerTool(api, {
    name: 'create_chat',
    label: 'Create drone chat',
    description: 'Create a chat for a Drone Hub drone.',
    approval: 'always',
    inputSchema: {
      type: 'object',
      properties: {
        drone: { type: 'string' },
        chat: { type: 'string' },
      },
      required: ['drone', 'chat'],
      additionalProperties: false,
    },
    async execute(args) {
      const drone = cleanString(args.drone);
      const chat = cleanString(args.chat);
      if (!drone) throw new Error('drone is required');
      if (!chat) throw new Error('chat is required');
      let created = true;
      await requestJson(
        connection(),
        `/api/drones/${encodeURIComponent(drone)}/chats`,
        { method: 'POST', body: JSON.stringify({ name: chat }) },
      ).catch((error) => {
        if (error?.status !== 409) throw error;
        created = false;
      });
      return { ok: true, drone, chat, created };
    },
  });

  registerTool(api, {
    name: 'send_message',
    label: 'Send drone message',
    description: 'Send a message to a Drone Hub drone chat and return the queued run.',
    approval: async (args) => !(await wasCreatedByExtension(api, args?.drone)),
    inputSchema: {
      type: 'object',
      properties: {
        drone: { type: 'string' },
        chat: { type: 'string' },
        message: { type: 'string' },
        idempotencyKey: { type: 'string' },
        createChat: { type: 'boolean' },
      },
      required: ['drone', 'message'],
      additionalProperties: false,
    },
    async execute(args) {
      const drone = cleanString(args.drone);
      const chat = chatName(args.chat);
      const message = cleanString(args.message);
      if (!drone) throw new Error('drone is required');
      if (!message) throw new Error('message is required');
      const hub = connection();
      const createdByExtension = await wasCreatedByExtension(api, drone);
      if (args.createChat) {
        await requestJson(
          hub,
          `/api/drones/${encodeURIComponent(drone)}/chats`,
          { method: 'POST', body: JSON.stringify({ name: chat }) },
        ).catch((error) => {
          if (error?.status !== 409) throw error;
        });
      }
      const body = {
        prompt: message,
        ...(cleanString(args.idempotencyKey) ? { promptId: cleanString(args.idempotencyKey) } : {}),
      };
      const response = await requestJson(
        hub,
        `/api/drones/${encodeURIComponent(drone)}/chats/${encodeURIComponent(chat)}/prompt`,
        { method: 'POST', body: JSON.stringify(body) },
        30_000,
      );
      return {
        ok: true,
        drone: cleanString(response?.id, drone),
        chat: cleanString(response?.chat, chat),
        runId: cleanString(response?.promptId || body.promptId),
        status: cleanString(response?.pendingState, 'queued'),
        createdByExtension,
      };
    },
  });

  registerTool(api, {
    name: 'subscribe_to_any_chat_idle',
    label: 'Subscribe to any chat idle',
    description: 'Resume this Voice Stream thread when any target Drone Hub chat becomes idle. This returns immediately.',
    approval: 'never',
    inputSchema: idleSubscriptionInputSchema(),
    async execute(args, context) {
      return startIdleSubscription(api, 'any', args, context);
    },
  });

  registerTool(api, {
    name: 'subscribe_to_all_chats_idle',
    label: 'Subscribe to all chats idle',
    description: 'Resume this Voice Stream thread when all target Drone Hub chats become idle. This returns immediately.',
    approval: 'never',
    inputSchema: idleSubscriptionInputSchema(),
    async execute(args, context) {
      return startIdleSubscription(api, 'all', args, context);
    },
  });

  registerTool(api, {
    name: 'read_chat',
    label: 'Read drone chat',
    description: 'Read recent transcript turns for a Drone Hub drone chat.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        drone: { type: 'string' },
        chat: { type: 'string' },
        limit: { type: 'number' },
        maxCharsPerField: { type: 'number' },
      },
      required: ['drone'],
      additionalProperties: false,
    },
    async execute(args) {
      const drone = cleanString(args.drone);
      const chat = chatName(args.chat);
      if (!drone) throw new Error('drone is required');
      const limit = cleanPositiveInt(args.limit, 10, 20);
      const maxCharsPerField = cleanPositiveInt(args.maxCharsPerField, 4000, 8000);
      const hub = connection();
      try {
        const response = await requestJson(
          hub,
          `/api/drones/${encodeURIComponent(drone)}/chats/${encodeURIComponent(chat)}/transcript?turn=all`,
          { method: 'GET' },
        );
        const turns = Array.isArray(response?.transcripts)
          ? response.transcripts.slice(-limit).map((turn) => boundedTranscriptTurn(turn, maxCharsPerField))
          : [];
        return { ok: true, drone, chat, turns, limit, maxCharsPerField };
      } catch (error) {
        if (error?.status !== 410) throw error;
        const response = await requestJson(
          hub,
          `/api/drones/${encodeURIComponent(drone)}/chats/${encodeURIComponent(chat)}/output`,
          { method: 'GET' },
        );
        const output = truncateString(cleanString(response?.output), maxCharsPerField * 2);
        return {
          ok: true,
          drone,
          chat,
          output: output.value,
          outputOriginalLength: output.originalLength,
          outputTruncated: output.truncated,
          truncated: output.truncated,
        };
      }
    },
  });
};

exports.deactivate = async function deactivate() {
  for (const subscription of idleSubscriptions.values()) {
    stopIdleSubscription(subscription, 'deactivated');
  }
  idleSubscriptions.clear();
};
