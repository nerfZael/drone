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

function normalizeCreateDronePreferences(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const repoBranchSource = normalizeRepoBranchSource(
    raw.repoBranchSource,
    DEFAULT_CREATE_DRONE_PREFERENCES.repoBranchSource,
  );
  return {
    spawnAgentKey: normalizeSpawnAgentKey(raw.spawnAgentKey),
    spawnModel: cleanString(raw.spawnModel),
    repoBranchSource,
    repoCreateRemoteBranch: cleanString(raw.repoCreateRemoteBranch),
  };
}

function normalizeSpawnContextByRepoKey(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [keyRaw, entryRaw] of Object.entries(value)) {
    const key = cleanString(keyRaw);
    if (!key) continue;
    out[key] = normalizeCreateDronePreferences(entryRaw);
  }
  return out;
}

function createDronePreferencesForRepo(prefs, repoPath) {
  const globalPrefs = {
    ...DEFAULT_CREATE_DRONE_PREFERENCES,
    ...normalizeCreateDronePreferences(prefs),
  };
  const repoKey = cleanString(repoPath);
  const byRepoKey = normalizeSpawnContextByRepoKey(prefs?.spawnContextByRepoKey);
  if (repoKey && byRepoKey[repoKey]) return { ...globalPrefs, ...byRepoKey[repoKey] };
  if (!repoKey) return globalPrefs;
  return {
    ...globalPrefs,
    repoBranchSource: DEFAULT_CREATE_DRONE_PREFERENCES.repoBranchSource,
    repoCreateRemoteBranch: DEFAULT_CREATE_DRONE_PREFERENCES.repoCreateRemoteBranch,
  };
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

async function createDronePreferences(hub, repoPath = '') {
  try {
    const response = await requestJson(hub, '/api/settings/ui-preferences', { method: 'GET' });
    const prefs = response?.uiPreferences && typeof response.uiPreferences === 'object' ? response.uiPreferences : {};
    const resolved = createDronePreferencesForRepo(prefs, repoPath);
    return {
      ...resolved,
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

async function requireRemoteBranchAvailableForRepo(hub, repoPath, remoteBranch, source) {
  const normalizedRepoPath = cleanString(repoPath);
  const normalizedRemoteBranch = cleanString(remoteBranch).replace(/^refs\/remotes\//, '').replace(/^remotes\//, '');
  if (!normalizedRepoPath || !normalizedRemoteBranch) return normalizedRemoteBranch;
  const data = await requestJson(
    hub,
    `/api/repos/branches?repoPath=${encodeURIComponent(normalizedRepoPath)}`,
    { method: 'GET' },
  );
  const branches = Array.isArray(data?.remoteBranches) ? data.remoteBranches : [];
  if (branches.some((entry) => cleanString(entry?.name) === normalizedRemoteBranch)) return normalizedRemoteBranch;
  throw new Error(
    `${source === 'default' ? 'Saved default remote branch' : 'Remote branch'} "${normalizedRemoteBranch}" is not available for repo ${normalizedRepoPath}. Pass a valid remoteBranch for this repo, or use repoBranchSource=host.`,
  );
}

function repoPathLabel(repoPathRaw) {
  const repoPath = cleanString(repoPathRaw);
  if (!repoPath) return '';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

function repoRefForPath(repoPathRaw) {
  const repoPath = cleanString(repoPathRaw);
  if (!repoPath) return '';
  return `repo:${Buffer.from(repoPath, 'utf8').toString('base64url')}`;
}

function repoPathExists(repoPathRaw) {
  const repoPath = cleanString(repoPathRaw);
  if (!repoPath) return false;
  try {
    return fs.statSync(repoPath).isDirectory();
  } catch {
    return false;
  }
}

function normalizeRepoSummary(repo) {
  const repoPath = cleanString(repo?.path || repo?.repoPath);
  if (!repoPath) return null;
  return {
    repoRef: repoRefForPath(repoPath),
    label: cleanString(repo?.label) || repoPathLabel(repoPath),
    path: repoPath,
    addedAt: cleanIsoTimestamp(repo?.addedAt),
    remoteUrl: cleanString(repo?.remoteUrl) || null,
    github: repo?.github && typeof repo.github === 'object' ? repo.github : null,
    exists: repoPathExists(repoPath),
  };
}

async function requestRepoSummaries(hub) {
  const response = await requestJson(hub, '/api/repos', { method: 'GET' });
  const repos = Array.isArray(response?.repos)
    ? response.repos.map(normalizeRepoSummary).filter(Boolean)
    : [];
  repos.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path));
  return repos;
}

function repoChoiceError(label, matches) {
  const lines = matches.map((repo) => `- ${repo.label} (${repo.path})`);
  return `${label}\n${lines.join('\n')}`;
}

async function resolveRegisteredRepo(hub, args = {}) {
  const repoRef = cleanString(args.repoRef);
  const repoLabel = cleanString(args.repoLabel);
  const repoPath = cleanString(args.repoPath);
  if (!repoRef && !repoLabel && !repoPath) return null;

  const repos = await requestRepoSummaries(hub);
  if (repos.length === 0) {
    throw new Error('No repos are registered in Drone Hub. Register the repo first, then use it for repo-attached drone operations.');
  }

  const resolved = [];
  if (repoRef) {
    const match = repos.find((repo) => repo.repoRef === repoRef);
    if (!match) throw new Error(`Unknown repoRef: ${repoRef}. Use list_repos and pass one of its repoRef values.`);
    resolved.push(match);
  }
  if (repoLabel) {
    const lowerLabel = repoLabel.toLowerCase();
    const matches = repos.filter((repo) => repo.label.toLowerCase() === lowerLabel);
    if (matches.length === 0) throw new Error(`Unknown repoLabel: ${repoLabel}. Use list_repos to see registered repos.`);
    if (matches.length > 1) {
      throw new Error(repoChoiceError(`Repo label "${repoLabel}" is ambiguous. Use repoRef or exact repoPath for one of:`, matches));
    }
    resolved.push(matches[0]);
  }
  if (repoPath) {
    const normalizedPath = path.resolve(repoPath);
    const match = repos.find((repo) => path.resolve(repo.path) === normalizedPath);
    if (!match) {
      const sameLabel = repos.filter((repo) => repo.label.toLowerCase() === repoPathLabel(repoPath).toLowerCase());
      const suffix = sameLabel.length > 0
        ? `\nRegistered repos with the same label:\n${sameLabel.map((repo) => `- ${repo.label} (${repo.path})`).join('\n')}`
        : '';
      throw new Error(`Unregistered repoPath: ${repoPath}. Use list_repos and pass a registered repoRef, repoLabel, or exact repoPath.${suffix}`);
    }
    resolved.push(match);
  }

  const first = resolved[0];
  const conflict = resolved.find((repo) => repo.path !== first.path);
  if (conflict) {
    throw new Error(repoChoiceError('Conflicting repo inputs resolve to different repos:', resolved));
  }
  if (!first.exists) {
    throw new Error(`Registered repo path does not exist on this device: ${first.path}`);
  }
  return first;
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

  const phase = cleanString(drone?.phase);
  if (phase) return phase;

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

function normalizeOrderedStringList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const text = cleanString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeOrderedStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [keyRaw, listRaw] of Object.entries(value)) {
    const key = cleanString(keyRaw);
    if (!key) continue;
    const list = normalizeOrderedStringList(listRaw);
    if (list.length > 0) out[key] = list;
  }
  return out;
}

function normalizeUiPreferences(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    sidebarGroupingMode: raw.sidebarGroupingMode === 'repos' ? 'repos' : 'groups',
    sidebarDensityMode:
      raw.sidebarDensityMode === 'compact' || raw.sidebarDensityMode === 'comfortable'
        ? raw.sidebarDensityMode
        : 'default',
    sidebarGroupOrder: normalizeOrderedStringList(raw.sidebarGroupOrder),
    sidebarDroneOrderByGroup: normalizeOrderedStringMap(raw.sidebarDroneOrderByGroup),
    sidebarNodeOrderByParent: normalizeOrderedStringMap(raw.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: normalizeOrderedStringMap(raw.sidebarChatOrderByDrone),
    pinnedDroneIds: normalizeOrderedStringList(raw.pinnedDroneIds),
    hiddenSidebarGroups: normalizeOrderedStringList(raw.hiddenSidebarGroups),
    autoDelete: raw.autoDelete === true,
    spawnAgentKey: cleanString(raw.spawnAgentKey, DEFAULT_CREATE_DRONE_PREFERENCES.spawnAgentKey),
    spawnModel: cleanString(raw.spawnModel),
    repoBranchSource: normalizeRepoBranchSource(raw.repoBranchSource, DEFAULT_CREATE_DRONE_PREFERENCES.repoBranchSource),
    repoCreateRemoteBranch: cleanString(raw.repoCreateRemoteBranch),
    spawnContextByRepoKey: normalizeSpawnContextByRepoKey(raw.spawnContextByRepoKey),
  };
}

function sidebarGroupOrderToken(group) {
  return `group:${cleanString(group)}`;
}

function sidebarGroupParentPath(value) {
  const group = cleanString(value).replace(/^\/+|\/+$/g, '');
  if (!group || !group.includes('/')) return null;
  return group.split('/').slice(0, -1).join('/') || null;
}

function sidebarDroneNodeId(droneId) {
  return `drone:${cleanString(droneId)}`;
}

function sidebarFolderNodeId(group) {
  return `folder:${cleanString(group)}`;
}

function normalizeGroupForOrder(value) {
  const group = cleanString(value);
  return !group || group.toLowerCase() === 'ungrouped' ? 'Ungrouped' : group;
}

function insertGroupTokenAtParentTop(order, visibleGroups, group) {
  const targetGroup = cleanString(group);
  if (!targetGroup || targetGroup.toLowerCase() === 'ungrouped') return normalizeOrderedStringList(order);

  const nextToken = sidebarGroupOrderToken(targetGroup);
  const normalizedOrder = normalizeOrderedStringList(order);
  if (normalizedOrder.includes(nextToken)) return normalizedOrder;
  const missingAncestorTokens = targetGroup
    .split('/')
    .map((_, index, parts) => parts.slice(0, index + 1).join('/'))
    .slice(0, -1)
    .map(sidebarGroupOrderToken)
    .filter((token) => token && !normalizedOrder.includes(token));
  const tokensToInsert = normalizeOrderedStringList([...missingAncestorTokens, nextToken]);

  const visibleTokens = normalizeOrderedStringList(visibleGroups.map(sidebarGroupOrderToken));
  const visibleTokenSet = new Set(visibleTokens);
  const hiddenTokens = normalizedOrder.filter((token) => !visibleTokenSet.has(token));
  const visibleOrder = normalizeOrderedStringList([
    ...normalizedOrder.filter((token) => visibleTokenSet.has(token)),
    ...visibleTokens.filter((token) => !normalizedOrder.includes(token)),
  ]);
  const parentPath = sidebarGroupParentPath(targetGroup);
  const siblingTokenSet = new Set(
    visibleGroups
      .filter((entry) => sidebarGroupParentPath(entry) === parentPath)
      .map(sidebarGroupOrderToken),
  );
  const siblingIndex = visibleOrder.findIndex((token) => siblingTokenSet.has(token));
  if (siblingIndex >= 0) {
    const nextVisibleOrder = visibleOrder.slice();
    nextVisibleOrder.splice(siblingIndex, 0, ...tokensToInsert);
    return normalizeOrderedStringList([...nextVisibleOrder, ...hiddenTokens]);
  }

  if (parentPath) {
    const parentIndex = visibleOrder.indexOf(sidebarGroupOrderToken(parentPath));
    if (parentIndex >= 0) {
      const nextVisibleOrder = visibleOrder.slice();
      nextVisibleOrder.splice(parentIndex + 1, 0, ...tokensToInsert);
      return normalizeOrderedStringList([...nextVisibleOrder, ...hiddenTokens]);
    }
  }

  return normalizeOrderedStringList([...tokensToInsert, ...visibleOrder, ...hiddenTokens]);
}

function reorderVisibleEntries(existingOrder, visibleEntries, movingEntries, beforeEntry, afterEntry) {
  const visible = normalizeOrderedStringList(visibleEntries);
  const moving = normalizeOrderedStringList(movingEntries).filter((entry) => visible.includes(entry));
  if (moving.length === 0) throw new Error('none of the requested drones are in the selected order scope');

  const withoutMoving = visible.filter((entry) => !moving.includes(entry));
  let insertIndex = 0;
  const after = cleanString(afterEntry);
  const before = cleanString(beforeEntry);
  if (after) {
    const index = withoutMoving.indexOf(after);
    if (index < 0) throw new Error(`afterDrone is not in the selected order scope: ${after}`);
    insertIndex = index + 1;
  } else if (before) {
    const index = withoutMoving.indexOf(before);
    if (index < 0) throw new Error(`beforeDrone is not in the selected order scope: ${before}`);
    insertIndex = index;
  }

  const nextVisible = withoutMoving.slice();
  nextVisible.splice(insertIndex, 0, ...moving);
  const visibleSet = new Set(visible);
  const hidden = normalizeOrderedStringList(existingOrder).filter((entry) => !visibleSet.has(entry));
  return normalizeOrderedStringList([...nextVisible, ...hidden]);
}

async function listGroupNames(hub) {
  const response = await requestJson(hub, '/api/groups', { method: 'GET' });
  return Array.isArray(response?.groups)
    ? response.groups.map((group) => cleanString(group?.name ?? group)).filter(Boolean)
    : [];
}

async function readUiPreferences(hub) {
  const response = await requestJson(hub, '/api/settings/ui-preferences', { method: 'GET' });
  return normalizeUiPreferences(response?.uiPreferences);
}

async function writeUiPreferences(hub, uiPreferences) {
  const response = await requestJson(
    hub,
    '/api/settings/ui-preferences',
    { method: 'POST', body: JSON.stringify({ uiPreferences: normalizeUiPreferences(uiPreferences) }) },
  );
  return normalizeUiPreferences(response?.uiPreferences);
}

async function insertNewGroupAtParentTop(hub, group, existingGroups) {
  const targetGroup = cleanString(group);
  if (!targetGroup || targetGroup.toLowerCase() === 'ungrouped') {
    return { updated: false, group: null };
  }
  const beforeGroups = normalizeOrderedStringList(existingGroups);
  if (beforeGroups.includes(targetGroup)) return { updated: false, group: targetGroup };
  const uiPreferences = await readUiPreferences(hub);
  const nextUiPreferences = {
    ...uiPreferences,
    sidebarGroupOrder: insertGroupTokenAtParentTop(uiPreferences.sidebarGroupOrder, beforeGroups, targetGroup),
  };
  const saved = await writeUiPreferences(hub, nextUiPreferences);
  return { updated: true, group: targetGroup, sidebarGroupOrder: saved.sidebarGroupOrder };
}

async function reorderDronesInUiPreferences(hub, args) {
  const rawDrones = Array.isArray(args?.drones) ? args.drones : [];
  const refs = normalizeOrderedStringList(rawDrones);
  if (refs.length === 0) throw new Error('drones is required');
  if (cleanString(args?.beforeDrone) && cleanString(args?.afterDrone)) {
    throw new Error('use either beforeDrone or afterDrone, not both');
  }

  const response = await requestDroneSummaries(hub);
  const allDrones = Array.isArray(response?.drones) ? response.drones.map(droneSummary) : [];
  const refToDrone = new Map();
  for (const drone of allDrones) {
    if (drone.id) refToDrone.set(drone.id, drone);
    if (drone.name) refToDrone.set(drone.name, drone);
  }
  const movingDrones = refs.map((ref) => {
    const drone = refToDrone.get(ref);
    if (!drone) throw new Error(`unknown drone: ${ref}`);
    return drone;
  });

  const targetGroup = normalizeGroupForOrder(args?.group);
  const scopeDrones = allDrones.filter((drone) => normalizeGroupForOrder(drone.group) === targetGroup);
  const scopeIds = scopeDrones.map((drone) => drone.id).filter(Boolean);
  for (const drone of movingDrones) {
    if (normalizeGroupForOrder(drone.group) !== targetGroup) {
      throw new Error(`drone is not in group ${targetGroup}: ${drone.name || drone.id}`);
    }
  }

  const beforeDrone = cleanString(args?.beforeDrone) ? refToDrone.get(cleanString(args.beforeDrone)) : null;
  const afterDrone = cleanString(args?.afterDrone) ? refToDrone.get(cleanString(args.afterDrone)) : null;
  if (cleanString(args?.beforeDrone) && !beforeDrone) throw new Error(`unknown beforeDrone: ${args.beforeDrone}`);
  if (cleanString(args?.afterDrone) && !afterDrone) throw new Error(`unknown afterDrone: ${args.afterDrone}`);

  const movingIds = movingDrones.map((drone) => drone.id).filter(Boolean);
  const beforeId = beforeDrone?.id || '';
  const afterId = afterDrone?.id || '';
  const groupOrderKey = sidebarGroupOrderToken(targetGroup);
  const parentId = targetGroup === 'Ungrouped' ? 'root' : sidebarFolderNodeId(targetGroup);

  const uiPreferences = await readUiPreferences(hub);
  const nextDroneOrder = reorderVisibleEntries(
    uiPreferences.sidebarDroneOrderByGroup[groupOrderKey] ?? [],
    scopeIds,
    movingIds,
    beforeId,
    afterId,
  );
  const nextNodeOrder = reorderVisibleEntries(
    uiPreferences.sidebarNodeOrderByParent[parentId] ?? [],
    scopeIds.map(sidebarDroneNodeId),
    movingIds.map(sidebarDroneNodeId),
    beforeId ? sidebarDroneNodeId(beforeId) : '',
    afterId ? sidebarDroneNodeId(afterId) : '',
  );
  const nextUiPreferences = {
    ...uiPreferences,
    sidebarDroneOrderByGroup: {
      ...uiPreferences.sidebarDroneOrderByGroup,
      [groupOrderKey]: nextDroneOrder,
    },
    sidebarNodeOrderByParent: {
      ...uiPreferences.sidebarNodeOrderByParent,
      [parentId]: nextNodeOrder,
    },
  };
  const saved = await writeUiPreferences(hub, nextUiPreferences);
  return {
    ok: true,
    group: targetGroup,
    drones: movingDrones.map((drone) => ({ id: drone.id, name: drone.name })),
    sidebarDroneOrder: saved.sidebarDroneOrderByGroup[groupOrderKey] ?? [],
    sidebarNodeOrder: saved.sidebarNodeOrderByParent[parentId] ?? [],
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

function initialMessageSummary(response, fallbackChat = 'default') {
  const initial = response?.initialMessage && typeof response.initialMessage === 'object' ? response.initialMessage : null;
  const promptId = cleanString(initial?.promptId || initial?.runId || response?.seedPromptId || response?.promptId);
  if (!promptId) return null;
  const status = cleanString(initial?.pendingState || initial?.status || response?.pendingState, 'queued');
  return {
    chat: chatName(initial?.chat || initial?.chatName || fallbackChat),
    runId: promptId,
    promptId,
    pendingState: status,
    status,
  };
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

async function resolveDroneRefs(hub, refs) {
  const response = await requestDroneSummaries(hub);
  const drones = Array.isArray(response?.drones) ? response.drones.map(droneSummary) : [];
  return refs.map((ref) => {
    const text = cleanString(ref);
    const match = drones.find((drone) => drone.id === text || drone.name === text);
    return {
      ref: text,
      id: cleanString(match?.id, text),
      name: cleanString(match?.name),
      found: Boolean(match),
    };
  });
}

function normalizeRenameRequests(args = {}) {
  const rawRenames = Array.isArray(args.renames) ? args.renames : [];
  const fallbackDrone = cleanString(args.drone || args.droneId || args.id);
  const fallbackNewName = cleanString(args.newName || args.nextName || args.name);
  const source = rawRenames.length > 0
    ? rawRenames
    : fallbackDrone && fallbackNewName
      ? [{ drone: fallbackDrone, newName: fallbackNewName }]
      : [];
  const seen = new Set();
  return source.map((item) => {
    const explicitDrone = cleanString(item?.drone || item?.droneId || item?.id);
    const explicitNewName = cleanString(item?.newName || item?.nextName);
    const name = cleanString(item?.name);
    const drone = explicitDrone || (explicitNewName ? name : '');
    const newName = explicitNewName || (explicitDrone ? name : '');
    return { drone, newName };
  }).filter((item) => {
    if (!item.drone || !item.newName) return false;
    const key = item.drone;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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

async function rememberRenamedDrone(api, previousAliases, renamedDrone) {
  const aliases = droneAliases(renamedDrone);
  if (aliases.length === 0) return;
  const previous = Array.isArray(previousAliases)
    ? previousAliases.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const now = new Date().toISOString();
  const records = await createdDroneRecords(api);
  const nextRecords = records.map((record) => {
    const recordAliases = Array.isArray(record.aliases) ? record.aliases.map((item) => cleanString(item)).filter(Boolean) : [];
    const matches =
      recordAliases.some((alias) => aliases.includes(alias)) ||
      recordAliases.some((alias) => previous.includes(alias));
    if (!matches) return record;
    return {
      ...record,
      id: cleanString(renamedDrone?.id, cleanString(record.id) || aliases[0]),
      name: cleanString(renamedDrone?.name) || null,
      aliases: [...new Set([...aliases, ...recordAliases, ...previous])],
      updatedAt: now,
    };
  });
  await api.state.set(CREATED_DRONES_STATE_KEY, nextRecords);
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
    name: 'list_repos',
    label: 'List repos',
    description: 'List repos registered in Drone Hub.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    async execute() {
      const repos = await requestRepoSummaries(connection());
      return { ok: true, count: repos.length, repos };
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
    name: 'create_group',
    label: 'Create drone group',
    description: 'Create an empty Drone Hub group and place it at the top of its parent in the sidebar order.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string' },
        name: { type: 'string' },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args = {}) {
      const group = cleanString(args.group || args.name);
      if (!group) throw new Error('group is required');
      const hub = connection();
      const beforeGroups = await listGroupNames(hub);
      const response = await requestJson(
        hub,
        '/api/groups',
        { method: 'POST', body: JSON.stringify({ name: group }) },
      );
      const groupOrder = await insertNewGroupAtParentTop(hub, group, beforeGroups);
      return {
        ok: true,
        group: cleanString(response?.name, group),
        createdAt: cleanIsoTimestamp(response?.createdAt),
        groupOrder,
      };
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
      const beforeGroups = group ? await listGroupNames(hub) : [];
      const droneIds = await resolveDroneIdsForGroupSet(hub, drones);
      const response = await requestJson(
        hub,
        '/api/drones/group-set',
        { method: 'POST', body: JSON.stringify({ droneIds, group }) },
      );
      const moved = Array.isArray(response?.moved) ? response.moved : [];
      const groupOrder =
        group && moved.length > 0
          ? await insertNewGroupAtParentTop(hub, group, beforeGroups)
          : { updated: false, group: group || null };
      return {
        ok: true,
        group: cleanString(response?.group) || null,
        groupOrder,
        moved,
        rejected: Array.isArray(response?.rejected) ? response.rejected : [],
        total: Number.isFinite(Number(response?.total)) ? Number(response.total) : drones.length,
      };
    },
  });

  registerTool(api, {
    name: 'rename_drones',
    label: 'Rename drones',
    description:
      'Rename one or more Drone Hub drones by id or current name. Use renames for multiple exact mappings.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        drone: { type: 'string', description: 'Single drone id or current name.' },
        droneId: { type: 'string', description: 'Alias for drone.' },
        id: { type: 'string', description: 'Alias for drone.' },
        newName: { type: 'string', description: 'New name for the single drone.' },
        name: { type: 'string', description: 'Alias for newName when renaming a single drone.' },
        nextName: { type: 'string', description: 'Alias for newName when renaming a single drone.' },
        renames: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              drone: { type: 'string' },
              droneId: { type: 'string' },
              id: { type: 'string' },
              name: { type: 'string' },
              newName: { type: 'string' },
              nextName: { type: 'string' },
            },
            required: [],
            additionalProperties: false,
          },
        },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args = {}) {
      const renames = normalizeRenameRequests(args);
      if (renames.length === 0) throw new Error('at least one drone and newName are required');

      const duplicateNewNames = new Set();
      const seenNewNames = new Set();
      for (const item of renames) {
        const key = item.newName.toLowerCase();
        if (seenNewNames.has(key)) duplicateNewNames.add(item.newName);
        seenNewNames.add(key);
      }
      if (duplicateNewNames.size > 0) {
        throw new Error(`duplicate target drone name: ${Array.from(duplicateNewNames).join(', ')}`);
      }

      const hub = connection();
      const resolved = await resolveDroneRefs(hub, renames.map((item) => item.drone));
      const renamed = [];
      const rejected = [];

      for (let index = 0; index < renames.length; index += 1) {
        const request = renames[index];
        const target = resolved[index];
        if (!target?.id) {
          rejected.push({ drone: request.drone, newName: request.newName, error: 'drone is required' });
          continue;
        }
        try {
          const response = await requestJson(
            hub,
            `/api/drones/${encodeURIComponent(target.id)}/rename`,
            { method: 'POST', body: JSON.stringify({ newName: request.newName, source: 'voice-stream-next' }) },
          );
          const item = {
            id: cleanString(response?.id, target.id),
            oldName: cleanString(response?.oldName, target.name || target.ref),
            newName: cleanString(response?.newName, request.newName),
            renamed: response?.renamed !== false,
          };
          renamed.push(item);
          await rememberRenamedDrone(api, [target.ref, target.name, target.id], { id: item.id, name: item.newName });
        } catch (error) {
          rejected.push({
            drone: request.drone,
            id: target.id,
            oldName: target.name || target.ref || null,
            newName: request.newName,
            error: cleanString(error?.message, 'rename failed'),
          });
        }
      }

      return {
        ok: rejected.length === 0,
        renamed,
        rejected,
        total: renames.length,
      };
    },
  });

  registerTool(api, {
    name: 'reorder_drones',
    label: 'Reorder drones',
    description:
      'Reorder Drone Hub drones in the sidebar. Omit group, or pass Ungrouped, for the global/root ungrouped drone order; pass a group path to reorder drones inside that group. The listed drones keep the given order and are moved to the top unless beforeDrone or afterDrone is provided.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        drones: { type: 'array', items: { type: 'string' } },
        group: { type: 'string' },
        beforeDrone: { type: 'string' },
        afterDrone: { type: 'string' },
      },
      required: ['drones'],
      additionalProperties: false,
    },
    async execute(args) {
      return reorderDronesInUiPreferences(connection(), args);
    },
  });

  registerTool(api, {
    name: 'create_drone',
    label: 'Create drone',
    description:
      'Create a new Drone Hub container drone, optionally starting its default chat with an initial message. Omitted agent, model, branch source, and remote branch values use the same defaults Drone Hub remembers from manual drone creation. Use repoBranchSource=host for the local/current host branch. Use repoBranchSource=remote with remoteBranch to seed from a specific remote branch.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        group: { type: 'string' },
        agent: { type: 'string', enum: ['cursor', 'codex', 'claude', 'opencode', 'pi'] },
        model: { type: 'string' },
        cwd: { type: 'string' },
        repoRef: { type: 'string' },
        repoLabel: { type: 'string' },
        repoPath: { type: 'string' },
        repoBranchSource: { type: 'string', enum: ['host', 'remote'] },
        remoteBranch: { type: 'string' },
        initialMessage: { type: 'string', description: 'Optional first message to send to the new drone default chat.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    async execute(args) {
      const hub = connection();
      const group = cleanString(args.group);
      const beforeGroups = group ? await listGroupNames(hub) : [];
      const resolvedRepo = await resolveRegisteredRepo(hub, args);
      const repoPath = cleanString(resolvedRepo?.path);
      const defaults = await createDronePreferences(hub, repoPath);
      const seedAgent = args.agent == null ? agentFromPreferenceKey(defaults.spawnAgentKey) : normalizeAgent(args.agent);
      const seedModel = args.model == null ? defaults.spawnModel : cleanString(args.model);
      const repoBranchSource = normalizeRepoBranchSource(args.repoBranchSource, defaults.repoBranchSource);
      const remoteBranchRaw = args.remoteBranch == null ? defaults.repoCreateRemoteBranch : cleanString(args.remoteBranch);
      const remoteBranch =
        repoPath && repoBranchSource === 'remote'
          ? await requireRemoteBranchAvailableForRepo(
              hub,
              repoPath,
              remoteBranchRaw,
              args.remoteBranch == null ? 'default' : 'explicit',
            )
          : remoteBranchRaw;
      const initialMessage = cleanString(args.initialMessage);
      const body = {
        name: cleanString(args.name),
        runtime: 'container',
        ...(group ? { group } : {}),
        ...(seedAgent ? { seedAgent } : {}),
        ...(seedModel ? { seedModel } : {}),
        ...(cleanString(args.cwd) ? { cwd: cleanString(args.cwd) } : {}),
        ...(repoPath ? { repoPath } : {}),
        ...(repoPath ? { repoBranchSource } : {}),
        ...(repoPath && repoBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
        ...(initialMessage ? { seedPrompt: initialMessage, seedSubmittedAt: new Date().toISOString() } : {}),
      };
      if (!body.name) throw new Error('name is required');
      if (repoPath && repoBranchSource === 'remote' && !remoteBranch) {
        throw new Error('remoteBranch is required when repoBranchSource is remote');
      }
      const response = await requestJson(hub, '/api/drones', { method: 'POST', body: JSON.stringify(body) }, 30_000);
      const drone = droneSummary({ ...body, ...response });
      const initialMessageState = initialMessage
        ? initialMessageSummary(response, 'default') ?? {
            chat: 'default',
            runId: null,
            promptId: null,
            pendingState: 'queued',
            status: 'queued',
          }
        : null;
      await rememberCreatedDrone(api, drone, 'create_drone');
      const groupOrder = group ? await insertNewGroupAtParentTop(hub, group, beforeGroups) : { updated: false, group: null };
      return {
        ok: true,
        drone,
        ...(initialMessageState ? { initialMessage: initialMessageState, inProgress: true } : {}),
        createdByExtension: true,
        groupOrder,
        createDefaults: defaults,
        repo: resolvedRepo,
        branch: repoPath
          ? {
              repoBranchSource,
              remoteBranch: repoBranchSource === 'remote' ? remoteBranch : null,
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
      const group = cleanString(args.group);
      const hub = connection();
      const beforeGroups = group ? await listGroupNames(hub) : [];
      const body = {
        name,
        runtime: 'container',
        cloneFrom: source,
        cloneChats: args.cloneChats !== false,
        ...(group ? { group } : {}),
      };
      const response = await requestJson(hub, '/api/drones', { method: 'POST', body: JSON.stringify(body) }, 30_000);
      const drone = droneSummary({ ...body, ...response });
      await rememberCreatedDrone(api, drone, 'clone_drone');
      const groupOrder = group ? await insertNewGroupAtParentTop(hub, group, beforeGroups) : { updated: false, group: null };
      return { ok: true, drone, createdByExtension: true, groupOrder };
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
