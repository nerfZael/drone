#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { defaultProfileDroneRootDir, profileDroneRootDir, readActiveProfileNameSync } from '../host/profiles';

const DEFAULT_HUB_BASE_URL = 'http://127.0.0.1:5174';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_FOR_MS = 1000;
const DEFAULT_IDLE_POLL_INTERVAL_MS = 1000;
const DEFAULT_IDLE_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
const MAX_IDLE_FOR_MS = 60_000;
const MAX_IDLE_POLL_INTERVAL_MS = 30_000;
const MAX_IDLE_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
const MAX_IDLE_TARGETS = 20;

type HubConnection = {
  baseUrl: string;
  token: string;
  source: string;
};

type IdleTarget = {
  drone: string;
  chat: string;
};

type IdleSubscription = {
  id: string;
  mode: 'any' | 'all';
  targets: IdleTarget[];
  clientMeta: Record<string, unknown>;
  status: 'active' | 'fired' | 'expired' | 'stopped';
  createdAt: string;
  expiresAt: string;
  expiresAtMs: number;
  idleForMs: number;
  pollIntervalMs: number;
  idleSince: number | null;
  inFlight: boolean;
  timer: NodeJS.Timeout | null;
  lastStatus: unknown;
  lastError: string | null;
};

const idleSubscriptions = new Map<string, IdleSubscription>();
let idleSubscriptionSequence = 0;

function cleanString(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanPositiveInt(value: unknown, fallback: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function cleanIsoTimestamp(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function truncateString(value: unknown, maxChars: number): { value: string; truncated: boolean; originalLength: number } {
  const text = String(value ?? '');
  if (text.length <= maxChars) return { value: text, truncated: false, originalLength: text.length };
  return { value: text.slice(0, maxChars), truncated: true, originalLength: text.length };
}

function readJson(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function dataDirCandidates(): string[] {
  const explicit = cleanString(process.env.DRONE_DATA_DIR);
  if (explicit) return [path.resolve(explicit)];
  const activeProfile = readActiveProfileNameSync();
  const profileDirs = [
    activeProfile ? profileDroneRootDir(activeProfile) : '',
    defaultProfileDroneRootDir(),
  ].filter(Boolean);
  if (process.platform === 'win32') {
    const appData = cleanString(process.env.APPDATA, path.join(os.homedir(), 'AppData', 'Roaming'));
    return [...profileDirs, path.join(appData, 'drone')];
  }
  if (process.platform === 'darwin') {
    return [...profileDirs, path.join(os.homedir(), 'Library', 'Application Support', 'drone')];
  }
  const xdgDataHome = cleanString(process.env.XDG_DATA_HOME, path.join(os.homedir(), '.local', 'share'));
  return [...profileDirs, path.join(xdgDataHome, 'drone'), path.join(os.homedir(), '.drone')];
}

function readHubStateSnapshot(filePath: string): { apiHost: string; apiPort: number; apiToken: string } | null {
  const state = readJson(filePath);
  const rawHost = cleanString(state?.apiHost, '127.0.0.1');
  const apiHost = rawHost === '0.0.0.0' || rawHost === '::' ? '127.0.0.1' : rawHost;
  const apiPort = Number(state?.apiPort);
  if (!apiHost || !Number.isFinite(apiPort) || apiPort <= 0) return null;
  return { apiHost, apiPort: Math.floor(apiPort), apiToken: cleanString(state?.apiToken) };
}

function resolveHubConnection(): HubConnection {
  const configuredBaseUrl = cleanString(process.env.DRONE_HUB_BASE_URL);
  const configuredToken = cleanString(process.env.DRONE_TOKEN || process.env.DRONE_HUB_API_TOKEN);
  if (configuredToken) {
    return {
      baseUrl: configuredBaseUrl || DEFAULT_HUB_BASE_URL,
      token: configuredToken,
      source: configuredBaseUrl ? 'env' : 'env-token',
    };
  }

  for (const dir of dataDirCandidates()) {
    const state = readHubStateSnapshot(path.join(dir, 'hub.json'));
    const token = readText(path.join(dir, 'hub.token')) || cleanString(state?.apiToken);
    if (!token) continue;
    return {
      baseUrl: state ? `http://${state.apiHost}:${state.apiPort}` : configuredBaseUrl || DEFAULT_HUB_BASE_URL,
      token,
      source: dir,
    };
  }

  throw new Error('Drone Hub connection not found. Start Drone Hub, or set DRONE_HUB_BASE_URL and DRONE_TOKEN.');
}

function joinUrl(baseUrl: string, pathname: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ''), base).toString();
}

async function requestJson(pathname: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
  const connection = resolveHubConnection();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const method = cleanString(init.method, 'GET').toUpperCase();
  try {
    const response = await fetch(joinUrl(connection.baseUrl, pathname), {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail = cleanString(data?.error || text, `HTTP ${response.status}`);
      const error = new Error(`Drone Hub request failed: ${method} ${pathname} returned ${response.status}: ${detail}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error(`Drone Hub request timed out after ${timeoutMs}ms: ${method} ${pathname}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toolResult(data: Record<string, unknown>): any {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function normalizeAgent(value: unknown): { kind: 'builtin'; id: string } | null {
  const id = cleanString(value).toLowerCase();
  if (!id) return null;
  if (!['cursor', 'codex', 'claude', 'opencode', 'pi', 'blip'].includes(id)) throw new Error(`Unsupported built-in agent: ${value}`);
  return { kind: 'builtin', id };
}

function normalizeRepoBranchSource(value: unknown, fallback = 'host'): 'host' | 'remote' {
  const source = cleanString(value).toLowerCase();
  if (source === 'remote' || source === 'host') return source;
  return fallback === 'remote' ? 'remote' : 'host';
}

function repoPathLabel(repoPathRaw: unknown): string {
  const repoPath = cleanString(repoPathRaw);
  if (!repoPath) return '';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

function repoRefForPath(repoPathRaw: unknown): string {
  const repoPath = cleanString(repoPathRaw);
  if (!repoPath) return '';
  return `repo:${Buffer.from(repoPath, 'utf8').toString('base64url')}`;
}

function repoPathExists(repoPathRaw: unknown): boolean {
  const repoPath = cleanString(repoPathRaw);
  if (!repoPath) return false;
  try {
    return fs.statSync(repoPath).isDirectory();
  } catch {
    return false;
  }
}

function normalizeRepoSummary(repo: any) {
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

async function requestRepoSummaries() {
  const response = await requestJson('/api/repos', { method: 'GET' });
  const repos = Array.isArray(response?.repos) ? response.repos.map(normalizeRepoSummary).filter(Boolean) : [];
  repos.sort((a: any, b: any) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path));
  return repos;
}

function droneStatusSummary(drone: any): string | null {
  const hubPhase = cleanString(drone?.hubPhase);
  const hubMessage = cleanString(drone?.hubMessage);
  if (hubPhase) return hubMessage ? `${hubPhase}: ${hubMessage}` : hubPhase;
  const statusError = cleanString(drone?.statusError);
  if (statusError) return `offline: ${statusError}`;
  if (drone?.busy === true || (Array.isArray(drone?.busyChats) && drone.busyChats.length > 0)) return 'busy';
  const phase = cleanString(drone?.phase);
  if (phase) return phase;
  if (typeof drone?.status === 'string') return cleanString(drone.status) || null;
  if (typeof drone?.statusOk === 'boolean') return drone.statusOk ? 'ready' : 'offline';
  return null;
}

function droneSummary(drone: any) {
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

async function requestDroneSummaries() {
  try {
    return await requestJson('/api/drones/summary', { method: 'GET' });
  } catch (error: any) {
    if (error?.status !== 404) throw error;
    return requestJson('/api/drones', { method: 'GET' });
  }
}

function compareDronesByRecentActivity(a: any, b: any): number {
  const aMs = Date.parse(a.lastActivityAt || a.lastMessageAt || a.createdAt || '');
  const bMs = Date.parse(b.lastActivityAt || b.lastMessageAt || b.createdAt || '');
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);
  if (aValid && bValid && aMs !== bMs) return bMs - aMs;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
}

async function resolveDroneRefs(refs: string[]) {
  const response = await requestDroneSummaries();
  const drones = Array.isArray(response?.drones) ? response.drones.map(droneSummary) : [];
  return refs.map((ref) => {
    const match = drones.find((drone: any) => drone.id === ref || drone.name === ref);
    return {
      ref,
      id: cleanString(match?.id, ref),
      name: cleanString(match?.name),
      found: Boolean(match),
    };
  });
}

async function resolveRegisteredRepo(args: any = {}) {
  const repoRef = cleanString(args.repoRef);
  const repoLabel = cleanString(args.repoLabel);
  const repoPath = cleanString(args.repoPath);
  if (!repoRef && !repoLabel && !repoPath) return null;
  const repos = await requestRepoSummaries();
  if (repos.length === 0) throw new Error('No repos are registered in Drone Hub.');
  const resolved: any[] = [];
  if (repoRef) {
    const match = repos.find((repo: any) => repo.repoRef === repoRef);
    if (!match) throw new Error(`Unknown repoRef: ${repoRef}. Use list_repos first.`);
    resolved.push(match);
  }
  if (repoLabel) {
    const matches = repos.filter((repo: any) => repo.label.toLowerCase() === repoLabel.toLowerCase());
    if (matches.length === 0) throw new Error(`Unknown repoLabel: ${repoLabel}. Use list_repos first.`);
    if (matches.length > 1) throw new Error(`Repo label "${repoLabel}" is ambiguous. Use repoRef or repoPath.`);
    resolved.push(matches[0]);
  }
  if (repoPath) {
    const normalizedPath = path.resolve(repoPath);
    const match = repos.find((repo: any) => path.resolve(repo.path) === normalizedPath);
    if (!match) throw new Error(`Unregistered repoPath: ${repoPath}. Use list_repos first.`);
    resolved.push(match);
  }
  const first = resolved[0];
  if (resolved.some((repo) => repo.path !== first.path)) throw new Error('Conflicting repo inputs resolve to different repos.');
  if (!first.exists) throw new Error(`Registered repo path does not exist on this device: ${first.path}`);
  return first;
}

function chatName(value: unknown): string {
  return cleanString(value, 'default');
}

function normalizeOrderedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = cleanString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeOrderedStringMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [keyRaw, listRaw] of Object.entries(value)) {
    const key = cleanString(keyRaw);
    if (!key) continue;
    const list = normalizeOrderedStringList(listRaw);
    if (list.length > 0) out[key] = list;
  }
  return out;
}

function normalizeUiPreferences(value: unknown) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as any : {};
  return {
    sidebarGroupingMode: raw.sidebarGroupingMode === 'repos' ? 'repos' : 'groups',
    sidebarDensityMode: raw.sidebarDensityMode === 'compact' || raw.sidebarDensityMode === 'comfortable' ? raw.sidebarDensityMode : 'default',
    sidebarGroupOrder: normalizeOrderedStringList(raw.sidebarGroupOrder),
    sidebarDroneOrderByGroup: normalizeOrderedStringMap(raw.sidebarDroneOrderByGroup),
    sidebarNodeOrderByParent: normalizeOrderedStringMap(raw.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: normalizeOrderedStringMap(raw.sidebarChatOrderByDrone),
    hiddenSidebarGroups: normalizeOrderedStringList(raw.hiddenSidebarGroups),
    autoDelete: raw.autoDelete === true,
    automations: Array.isArray(raw.automations) ? raw.automations : [],
    spawnAgentKey: cleanString(raw.spawnAgentKey, 'builtin:cursor'),
    spawnModel: cleanString(raw.spawnModel),
    repoBranchSource: normalizeRepoBranchSource(raw.repoBranchSource, 'host'),
    repoCreateRemoteBranch: cleanString(raw.repoCreateRemoteBranch),
    pullHostBranchBeforeCreate: typeof raw.pullHostBranchBeforeCreate === 'boolean' ? raw.pullHostBranchBeforeCreate : true,
    spawnContextByRepoKey: raw.spawnContextByRepoKey && typeof raw.spawnContextByRepoKey === 'object' && !Array.isArray(raw.spawnContextByRepoKey)
      ? raw.spawnContextByRepoKey
      : {},
  };
}

function sidebarGroupOrderToken(group: string): string {
  return `group:${cleanString(group)}`;
}

function sidebarGroupParentPath(value: unknown): string | null {
  const group = cleanString(value).replace(/^\/+|\/+$/g, '');
  if (!group || !group.includes('/')) return null;
  return group.split('/').slice(0, -1).join('/') || null;
}

function sidebarDroneNodeId(droneId: string): string {
  return `drone:${cleanString(droneId)}`;
}

function sidebarFolderNodeId(group: string): string {
  return `folder:${cleanString(group)}`;
}

function normalizeGroupForOrder(value: unknown): string {
  const group = cleanString(value);
  return !group || group.toLowerCase() === 'ungrouped' ? 'Ungrouped' : group;
}

function reorderVisibleEntries(
  existingOrder: unknown,
  visibleEntries: string[],
  movingEntries: string[],
  beforeEntry: string,
  afterEntry: string,
): string[] {
  const visible = normalizeOrderedStringList(visibleEntries);
  const moving = normalizeOrderedStringList(movingEntries).filter((entry) => visible.includes(entry));
  if (moving.length === 0) throw new Error('none of the requested drones are in the selected order scope');

  const withoutMoving = visible.filter((entry) => !moving.includes(entry));
  let insertIndex = 0;
  if (afterEntry) {
    const index = withoutMoving.indexOf(afterEntry);
    if (index < 0) throw new Error(`afterDrone is not in the selected order scope: ${afterEntry}`);
    insertIndex = index + 1;
  } else if (beforeEntry) {
    const index = withoutMoving.indexOf(beforeEntry);
    if (index < 0) throw new Error(`beforeDrone is not in the selected order scope: ${beforeEntry}`);
    insertIndex = index;
  }

  const nextVisible = withoutMoving.slice();
  nextVisible.splice(insertIndex, 0, ...moving);
  const visibleSet = new Set(visible);
  const hidden = normalizeOrderedStringList(existingOrder).filter((entry) => !visibleSet.has(entry));
  return normalizeOrderedStringList([...nextVisible, ...hidden]);
}

function insertGroupTokenAtParentTop(order: unknown, visibleGroups: string[], group: string): string[] {
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

async function readUiPreferences() {
  const response = await requestJson('/api/settings/ui-preferences', { method: 'GET' });
  return normalizeUiPreferences(response?.uiPreferences);
}

async function writeUiPreferences(uiPreferences: unknown) {
  const response = await requestJson('/api/settings/ui-preferences', {
    method: 'POST',
    body: JSON.stringify({ uiPreferences: normalizeUiPreferences(uiPreferences) }),
  });
  return normalizeUiPreferences(response?.uiPreferences);
}

async function listGroupNames() {
  const response = await requestJson('/api/groups', { method: 'GET' });
  return Array.isArray(response?.groups)
    ? response.groups.map((group: any) => cleanString(group?.name ?? group)).filter(Boolean)
    : [];
}

async function insertNewGroupAtParentTop(group: string, existingGroups: string[]) {
  const targetGroup = cleanString(group);
  if (!targetGroup || targetGroup.toLowerCase() === 'ungrouped') return { updated: false, group: null };
  const beforeGroups = normalizeOrderedStringList(existingGroups);
  if (beforeGroups.includes(targetGroup)) return { updated: false, group: targetGroup };
  const uiPreferences = await readUiPreferences();
  const saved = await writeUiPreferences({
    ...uiPreferences,
    sidebarGroupOrder: insertGroupTokenAtParentTop(uiPreferences.sidebarGroupOrder, beforeGroups, targetGroup),
  });
  return { updated: true, group: targetGroup, sidebarGroupOrder: saved.sidebarGroupOrder };
}

async function reorderDronesInUiPreferences(args: any) {
  const refs = normalizeOrderedStringList(args?.drones);
  if (refs.length === 0) throw new Error('drones is required');
  if (cleanString(args?.beforeDrone) && cleanString(args?.afterDrone)) throw new Error('use either beforeDrone or afterDrone, not both');

  const response = await requestDroneSummaries();
  const allDrones = Array.isArray(response?.drones) ? response.drones.map(droneSummary) : [];
  const refToDrone = new Map<string, any>();
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
  const scopeDrones = allDrones.filter((drone: any) => normalizeGroupForOrder(drone.group) === targetGroup);
  const scopeIds = scopeDrones.map((drone: any) => drone.id).filter(Boolean);
  for (const drone of movingDrones) {
    if (normalizeGroupForOrder(drone.group) !== targetGroup) throw new Error(`drone is not in group ${targetGroup}: ${drone.name || drone.id}`);
  }

  const beforeDrone = cleanString(args?.beforeDrone) ? refToDrone.get(cleanString(args.beforeDrone)) : null;
  const afterDrone = cleanString(args?.afterDrone) ? refToDrone.get(cleanString(args.afterDrone)) : null;
  if (cleanString(args?.beforeDrone) && !beforeDrone) throw new Error(`unknown beforeDrone: ${args.beforeDrone}`);
  if (cleanString(args?.afterDrone) && !afterDrone) throw new Error(`unknown afterDrone: ${args.afterDrone}`);

  const movingIds = movingDrones.map((drone: any) => drone.id).filter(Boolean);
  const beforeId = beforeDrone?.id || '';
  const afterId = afterDrone?.id || '';
  const groupOrderKey = sidebarGroupOrderToken(targetGroup);
  const parentId = targetGroup === 'Ungrouped' ? 'root' : sidebarFolderNodeId(targetGroup);
  const uiPreferences = await readUiPreferences();
  const nextUiPreferences = {
    ...uiPreferences,
    sidebarDroneOrderByGroup: {
      ...uiPreferences.sidebarDroneOrderByGroup,
      [groupOrderKey]: reorderVisibleEntries(uiPreferences.sidebarDroneOrderByGroup[groupOrderKey] ?? [], scopeIds, movingIds, beforeId, afterId),
    },
    sidebarNodeOrderByParent: {
      ...uiPreferences.sidebarNodeOrderByParent,
      [parentId]: reorderVisibleEntries(
        uiPreferences.sidebarNodeOrderByParent[parentId] ?? [],
        scopeIds.map(sidebarDroneNodeId),
        movingIds.map(sidebarDroneNodeId),
        beforeId ? sidebarDroneNodeId(beforeId) : '',
        afterId ? sidebarDroneNodeId(afterId) : '',
      ),
    },
  };
  const saved = await writeUiPreferences(nextUiPreferences);
  return {
    ok: true,
    group: targetGroup,
    drones: movingDrones.map((drone: any) => ({ id: drone.id, name: drone.name })),
    sidebarDroneOrder: saved.sidebarDroneOrderByGroup[groupOrderKey] ?? [],
    sidebarNodeOrder: saved.sidebarNodeOrderByParent[parentId] ?? [],
  };
}

function normalizeRenameRequests(args: any = {}) {
  const rawRenames = Array.isArray(args.renames) ? args.renames : [];
  const fallbackDrone = cleanString(args.drone || args.droneId || args.id);
  const fallbackNewName = cleanString(args.newName || args.nextName || args.name);
  const source = rawRenames.length > 0 ? rawRenames : fallbackDrone && fallbackNewName ? [{ drone: fallbackDrone, newName: fallbackNewName }] : [];
  const seen = new Set<string>();
  return source.map((item: any) => {
    const explicitDrone = cleanString(item?.drone || item?.droneId || item?.id);
    const explicitNewName = cleanString(item?.newName || item?.nextName);
    const name = cleanString(item?.name);
    const drone = explicitDrone || (explicitNewName ? name : '');
    const newName = explicitNewName || (explicitDrone ? name : '');
    return { drone, newName };
  }).filter((item: any) => {
    if (!item.drone || !item.newName || seen.has(item.drone)) return false;
    seen.add(item.drone);
    return true;
  });
}

function normalizeIdleTargets(args: any): IdleTarget[] {
  const rawTargets = Array.isArray(args?.targets) ? args.targets : [];
  const fallbackDrone = cleanString(args?.drone || args?.droneId);
  const targets = rawTargets.length > 0 ? rawTargets : fallbackDrone ? [{ drone: fallbackDrone, chat: args?.chat || args?.chatName }] : [];
  const result: IdleTarget[] = [];
  const seen = new Set<string>();
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

function makeIdleSubscriptionId(): string {
  idleSubscriptionSequence += 1;
  return `drone_hub_idle_${Date.now().toString(36)}_${idleSubscriptionSequence.toString(36)}`;
}

async function idleStatus(mode: 'any' | 'all', targets: IdleTarget[]) {
  return requestJson('/api/chats/idle/status', { method: 'POST', body: JSON.stringify({ mode, targets }) });
}

function publicSubscription(subscription: IdleSubscription) {
  return {
    id: subscription.id,
    mode: subscription.mode,
    targets: subscription.targets,
    status: subscription.status,
    createdAt: subscription.createdAt,
    expiresAt: subscription.expiresAt,
    idleForMs: subscription.idleForMs,
    pollIntervalMs: subscription.pollIntervalMs,
    lastStatus: subscription.lastStatus,
    lastError: subscription.lastError,
  };
}

async function sendIdleSubscriptionFiredNotification(server: McpServer, subscription: IdleSubscription) {
  try {
    await server.sendLoggingMessage({
      level: 'info',
      logger: 'drone-hub',
      data: {
        kind: 'drone_hub.chat_idle',
        subscription: publicSubscription(subscription),
        mode: subscription.mode,
        targets: subscription.targets,
        status: subscription.lastStatus,
        clientMeta: subscription.clientMeta,
      },
    });
  } catch {
    // Notifications are best effort. The subscription still fired successfully.
  }
}

function stopIdleSubscription(subscription: IdleSubscription, status: IdleSubscription['status']) {
  if (subscription.timer) clearInterval(subscription.timer);
  subscription.timer = null;
  subscription.status = status;
  if (status !== 'fired') idleSubscriptions.delete(subscription.id);
}

async function runIdleSubscriptionTick(server: McpServer, subscription: IdleSubscription) {
  if (subscription.inFlight || subscription.status !== 'active') return;
  const now = Date.now();
  if (now >= subscription.expiresAtMs) {
    stopIdleSubscription(subscription, 'expired');
    return;
  }
  subscription.inFlight = true;
  try {
    const result = await idleStatus(subscription.mode, subscription.targets);
    if (subscription.status !== 'active') return;
    subscription.lastStatus = result;
    subscription.lastError = null;
    if (result?.matched) {
      subscription.idleSince ??= now;
      if (now - subscription.idleSince >= subscription.idleForMs) {
        stopIdleSubscription(subscription, 'fired');
        idleSubscriptions.set(subscription.id, subscription);
        await sendIdleSubscriptionFiredNotification(server, subscription);
      }
    } else {
      subscription.idleSince = null;
    }
  } catch (error: any) {
    subscription.lastError = error?.message || String(error);
  } finally {
    subscription.inFlight = false;
  }
}

function normalizeClientMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [cleanString(key), item])
      .filter(([key]) => key),
  );
}

function startIdleSubscription(server: McpServer, mode: 'any' | 'all', args: any, extra: any) {
  const targets = normalizeIdleTargets(args);
  if (targets.length === 0) throw new Error('targets are required');
  const now = Date.now();
  const expiresInMs = cleanPositiveInt(args?.expiresInMs, DEFAULT_IDLE_EXPIRES_IN_MS, MAX_IDLE_EXPIRES_IN_MS);
  const subscription: IdleSubscription = {
    id: makeIdleSubscriptionId(),
    mode,
    targets,
    clientMeta: normalizeClientMeta(extra?._meta),
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
  subscription.timer = setInterval(() => void runIdleSubscriptionTick(server, subscription), subscription.pollIntervalMs);
  subscription.timer.unref?.();
  idleSubscriptions.set(subscription.id, subscription);
  void runIdleSubscriptionTick(server, subscription);
  return { ok: true, subscription: publicSubscription(subscription) };
}

function boundedTranscriptTurn(turn: any, maxCharsPerField: number) {
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

async function createDronePreferences(repoPath = '') {
  try {
    const response = await requestJson('/api/settings/ui-preferences', { method: 'GET' });
    const prefs = response?.uiPreferences && typeof response.uiPreferences === 'object' ? response.uiPreferences : {};
    const byRepo = prefs.spawnContextByRepoKey && typeof prefs.spawnContextByRepoKey === 'object' ? prefs.spawnContextByRepoKey : {};
    const repoPrefs = repoPath && byRepo[repoPath] && typeof byRepo[repoPath] === 'object' ? byRepo[repoPath] : {};
    const merged = { ...prefs, ...repoPrefs };
    return {
      spawnAgentKey: cleanString(merged.spawnAgentKey, 'builtin:cursor'),
      spawnModel: cleanString(merged.spawnModel),
      repoBranchSource: normalizeRepoBranchSource(merged.repoBranchSource, 'host'),
      repoCreateRemoteBranch: cleanString(merged.repoCreateRemoteBranch),
      pullHostBranchBeforeCreate: typeof merged.pullHostBranchBeforeCreate === 'boolean' ? merged.pullHostBranchBeforeCreate : true,
      source: response?.updatedAt ? 'drone_hub_ui_preferences' : 'default',
      updatedAt: cleanIsoTimestamp(response?.updatedAt),
    };
  } catch (error: any) {
    return {
      spawnAgentKey: 'builtin:cursor',
      spawnModel: '',
      repoBranchSource: 'host' as const,
      repoCreateRemoteBranch: '',
      pullHostBranchBeforeCreate: true,
      source: 'default',
      updatedAt: null,
      warning: error?.message || String(error),
    };
  }
}

async function requireRemoteBranchAvailableForRepo(repoPath: string, remoteBranch: string, source: 'default' | 'explicit') {
  const normalizedRemoteBranch = cleanString(remoteBranch).replace(/^refs\/remotes\//, '').replace(/^remotes\//, '');
  if (!repoPath || !normalizedRemoteBranch) return normalizedRemoteBranch;
  const data = await requestJson(`/api/repos/branches?repoPath=${encodeURIComponent(repoPath)}`, { method: 'GET' });
  const branches = Array.isArray(data?.remoteBranches) ? data.remoteBranches : [];
  if (branches.some((entry: any) => cleanString(entry?.name) === normalizedRemoteBranch)) return normalizedRemoteBranch;
  throw new Error(`${source === 'default' ? 'Saved default remote branch' : 'Remote branch'} "${normalizedRemoteBranch}" is not available for repo ${repoPath}.`);
}

function agentFromPreferenceKey(value: string) {
  return normalizeAgent(String(value || '').replace(/^builtin:/, ''));
}

function registerTools(server: McpServer) {
  server.registerTool('list_drones', {
    title: 'List drones',
    description: 'List local Drone Hub drones, optionally filtered by group or names.',
    inputSchema: { group: z.string().optional(), names: z.array(z.string()).optional(), limit: z.number().optional() },
  }, async (args) => {
    const response = await requestDroneSummaries();
    const wantedNames = new Set((args.names ?? []).map((item) => cleanString(item)).filter(Boolean));
    const group = cleanString(args.group);
    const limit = cleanPositiveInt(args.limit, 50, 200);
    let drones = Array.isArray(response?.drones) ? response.drones.map(droneSummary) : [];
    if (group) drones = drones.filter((drone: any) => drone.group === group);
    if (wantedNames.size > 0) drones = drones.filter((drone: any) => wantedNames.has(drone.id) || wantedNames.has(drone.name));
    drones.sort(compareDronesByRecentActivity);
    return toolResult({ ok: true, count: drones.length, drones: drones.slice(0, limit) });
  });

  server.registerTool('list_repos', {
    title: 'List repos',
    description: 'List repos registered in Drone Hub.',
    inputSchema: {},
  }, async () => {
    const repos = await requestRepoSummaries();
    return toolResult({ ok: true, count: repos.length, repos });
  });

  server.registerTool('list_groups', {
    title: 'List drone groups',
    description: 'List Drone Hub groups and their drone counts.',
    inputSchema: {},
  }, async () => toolResult(await requestJson('/api/groups', { method: 'GET' })));

  server.registerTool('create_group', {
    title: 'Create drone group',
    description: 'Create an empty Drone Hub group.',
    inputSchema: { group: z.string().optional(), name: z.string().optional() },
  }, async (args) => {
    const group = cleanString(args.group || args.name);
    if (!group) throw new Error('group is required');
    const beforeGroups = await listGroupNames();
    const response = await requestJson('/api/groups', { method: 'POST', body: JSON.stringify({ name: group }) });
    const groupOrder = await insertNewGroupAtParentTop(group, beforeGroups);
    return toolResult({ ok: true, group: cleanString(response?.name, group), createdAt: cleanIsoTimestamp(response?.createdAt), groupOrder });
  });

  server.registerTool('set_drone_group', {
    title: 'Set drone group',
    description: 'Move one or more Drone Hub drones into a group, or clear their group.',
    inputSchema: {
      drones: z.array(z.string()).optional(),
      drone: z.string().optional(),
      group: z.string().optional(),
      clearGroup: z.boolean().optional(),
    },
  }, async (args) => {
    const drones = [...new Set([...(args.drones ?? []).map((item) => cleanString(item)).filter(Boolean), ...(cleanString(args.drone) ? [cleanString(args.drone)] : [])])];
    if (drones.length === 0) throw new Error('at least one drone is required');
    const group = args.clearGroup === true ? null : cleanString(args.group) || null;
    if (group == null && args.clearGroup !== true) throw new Error('group is required unless clearGroup is true');
    const beforeGroups = group ? await listGroupNames() : [];
    const resolved = await resolveDroneRefs(drones);
    const droneIds = resolved.map((item) => item.id);
    const response = await requestJson('/api/drones/group-set', { method: 'POST', body: JSON.stringify({ droneIds, group }) });
    const groupOrder = group && Array.isArray(response?.moved) && response.moved.length > 0
      ? await insertNewGroupAtParentTop(group, beforeGroups)
      : { updated: false, group };
    return toolResult({ ok: true, ...response, groupOrder });
  });

  server.registerTool('rename_drones', {
    title: 'Rename drones',
    description: 'Rename one or more Drone Hub drones by id or current name.',
    inputSchema: {
      drone: z.string().optional(),
      droneId: z.string().optional(),
      id: z.string().optional(),
      newName: z.string().optional(),
      name: z.string().optional(),
      nextName: z.string().optional(),
      renames: z.array(z.object({
        drone: z.string().optional(),
        droneId: z.string().optional(),
        id: z.string().optional(),
        name: z.string().optional(),
        newName: z.string().optional(),
        nextName: z.string().optional(),
      })).optional(),
    },
  }, async (args) => {
    const renames = normalizeRenameRequests(args);
    if (renames.length === 0) throw new Error('at least one drone and newName are required');
    const resolved = await resolveDroneRefs(renames.map((item: { drone: string }) => item.drone));
    const renamed = [];
    const rejected = [];
    for (let index = 0; index < renames.length; index += 1) {
      const request = renames[index];
      const target = resolved[index];
      try {
        const response = await requestJson(`/api/drones/${encodeURIComponent(target.id)}/rename`, {
          method: 'POST',
          body: JSON.stringify({ newName: request.newName, source: 'drone-hub-mcp' }),
        });
        renamed.push(response);
      } catch (error: any) {
        rejected.push({ drone: request.drone, newName: request.newName, error: error?.message || String(error) });
      }
    }
    return toolResult({ ok: rejected.length === 0, renamed, rejected, total: renames.length });
  });

  server.registerTool('reorder_drones', {
    title: 'Reorder drones',
    description: 'Reorder Drone Hub drones in the sidebar preferences.',
    inputSchema: {
      drones: z.array(z.string()),
      group: z.string().optional(),
      beforeDrone: z.string().optional(),
      afterDrone: z.string().optional(),
    },
  }, async (args) => toolResult(await reorderDronesInUiPreferences(args)));

  server.registerTool('create_drone', {
    title: 'Create drone',
    description: 'Create a new Drone Hub container drone. Returns after Drone Hub accepts the create request.',
    inputSchema: {
      name: z.string(),
      group: z.string().optional(),
      agent: z.enum(['cursor', 'codex', 'claude', 'opencode', 'pi', 'blip']).optional(),
      model: z.string().optional(),
      cwd: z.string().optional(),
      repoRef: z.string().optional(),
      repoLabel: z.string().optional(),
      repoPath: z.string().optional(),
      repoBranchSource: z.enum(['host', 'remote']).optional(),
      remoteBranch: z.string().optional(),
      pullHostBranchBeforeCreate: z.boolean().optional(),
      initialMessage: z.string().optional(),
    },
  }, async (args) => {
    const resolvedRepo = await resolveRegisteredRepo(args);
    const repoPath = cleanString(resolvedRepo?.path);
    const defaults = await createDronePreferences(repoPath);
    const seedAgent = args.agent == null ? agentFromPreferenceKey(defaults.spawnAgentKey) : normalizeAgent(args.agent);
    const seedModel = args.model == null ? defaults.spawnModel : cleanString(args.model);
    const repoBranchSource = normalizeRepoBranchSource(args.repoBranchSource, defaults.repoBranchSource);
    const remoteBranchRaw = args.remoteBranch == null ? defaults.repoCreateRemoteBranch : cleanString(args.remoteBranch);
    const remoteBranch = repoPath && repoBranchSource === 'remote'
      ? await requireRemoteBranchAvailableForRepo(repoPath, remoteBranchRaw, args.remoteBranch == null ? 'default' : 'explicit')
      : remoteBranchRaw;
    const body = {
      name: cleanString(args.name),
      runtime: 'container',
      ...(cleanString(args.group) ? { group: cleanString(args.group) } : {}),
      ...(seedAgent ? { seedAgent } : {}),
      ...(seedModel ? { seedModel } : {}),
      ...(cleanString(args.cwd) ? { cwd: cleanString(args.cwd) } : {}),
      ...(repoPath ? { repoPath, repoBranchSource } : {}),
      ...(repoPath && repoBranchSource === 'host' ? { pullHostBranchBeforeCreate: args.pullHostBranchBeforeCreate ?? defaults.pullHostBranchBeforeCreate } : {}),
      ...(repoPath && repoBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
      ...(cleanString(args.initialMessage) ? { seedPrompt: cleanString(args.initialMessage), seedSubmittedAt: new Date().toISOString() } : {}),
    };
    const response = await requestJson('/api/drones', { method: 'POST', body: JSON.stringify(body) }, 30_000);
    return toolResult({ ok: true, drone: droneSummary({ ...body, ...response }), raw: response, createDefaults: defaults, repo: resolvedRepo });
  });

  server.registerTool('clone_drone', {
    title: 'Clone drone',
    description: 'Create a new drone cloned from an existing Drone Hub drone.',
    inputSchema: {
      source: z.string(),
      name: z.string(),
      group: z.string().optional(),
      cloneChats: z.boolean().optional(),
    },
  }, async (args) => {
    const body = {
      name: cleanString(args.name),
      runtime: 'container',
      cloneFrom: cleanString(args.source),
      cloneChats: args.cloneChats !== false,
      ...(cleanString(args.group) ? { group: cleanString(args.group) } : {}),
    };
    const response = await requestJson('/api/drones', { method: 'POST', body: JSON.stringify(body) }, 30_000);
    return toolResult({ ok: true, drone: droneSummary({ ...body, ...response }), raw: response });
  });

  server.registerTool('list_chats', {
    title: 'List drone chats',
    description: 'List chats for a Drone Hub drone.',
    inputSchema: { drone: z.string() },
  }, async (args) => {
    const response = await requestJson(`/api/drones/${encodeURIComponent(args.drone)}/chats`, { method: 'GET' });
    return toolResult({ ok: true, drone: args.drone, chats: Array.isArray(response?.chats) ? response.chats.map((name: any) => ({ name: cleanString(name) })) : [] });
  });

  server.registerTool('create_chat', {
    title: 'Create drone chat',
    description: 'Create a chat for a Drone Hub drone.',
    inputSchema: { drone: z.string(), chat: z.string() },
  }, async (args) => {
    let created = true;
    await requestJson(`/api/drones/${encodeURIComponent(args.drone)}/chats`, {
      method: 'POST',
      body: JSON.stringify({ name: args.chat }),
    }).catch((error: any) => {
      if (error?.status !== 409) throw error;
      created = false;
    });
    return toolResult({ ok: true, drone: args.drone, chat: args.chat, created });
  });

  server.registerTool('send_message', {
    title: 'Send drone message',
    description: 'Send a message to a Drone Hub drone chat and return the queued run.',
    inputSchema: {
      drone: z.string(),
      chat: z.string().optional(),
      message: z.string(),
      idempotencyKey: z.string().optional(),
      createChat: z.boolean().optional(),
    },
  }, async (args) => {
    const chat = chatName(args.chat);
    if (args.createChat) {
      await requestJson(`/api/drones/${encodeURIComponent(args.drone)}/chats`, {
        method: 'POST',
        body: JSON.stringify({ name: chat }),
      }).catch((error: any) => {
        if (error?.status !== 409) throw error;
      });
    }
    const body = { prompt: args.message, ...(cleanString(args.idempotencyKey) ? { promptId: cleanString(args.idempotencyKey) } : {}) };
    const response = await requestJson(`/api/drones/${encodeURIComponent(args.drone)}/chats/${encodeURIComponent(chat)}/prompt`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, 30_000);
    return toolResult({ ok: true, drone: cleanString(response?.id, args.drone), chat, runId: cleanString(response?.promptId || body.promptId), status: cleanString(response?.pendingState, 'queued'), raw: response });
  });

  const idleTargetSchema = z.object({
    drone: z.string().optional(),
    droneId: z.string().optional(),
    id: z.string().optional(),
    chat: z.string().optional(),
    chatName: z.string().optional(),
  });
  const idleInputSchema = {
    targets: z.array(idleTargetSchema).optional(),
    drone: z.string().optional(),
    droneId: z.string().optional(),
    chat: z.string().optional(),
    chatName: z.string().optional(),
    idleForMs: z.number().optional(),
    pollIntervalMs: z.number().optional(),
    expiresInMs: z.number().optional(),
  };
  server.registerTool('subscribe_to_any_chat_idle', {
    title: 'Subscribe to any chat idle',
    description: 'Start a background Drone Hub idle subscription. Returns immediately with subscription status.',
    inputSchema: idleInputSchema,
  }, async (args, extra) => toolResult(startIdleSubscription(server, 'any', args, extra)));

  server.registerTool('subscribe_to_all_chats_idle', {
    title: 'Subscribe to all chats idle',
    description: 'Start a background Drone Hub idle subscription. Returns immediately with subscription status.',
    inputSchema: idleInputSchema,
  }, async (args, extra) => toolResult(startIdleSubscription(server, 'all', args, extra)));

  server.registerTool('read_chat', {
    title: 'Read drone chat',
    description: 'Read recent transcript turns for a Drone Hub drone chat.',
    inputSchema: {
      drone: z.string(),
      chat: z.string().optional(),
      limit: z.number().optional(),
      maxCharsPerField: z.number().optional(),
    },
  }, async (args) => {
    const chat = chatName(args.chat);
    const limit = cleanPositiveInt(args.limit, 10, 20);
    const maxCharsPerField = cleanPositiveInt(args.maxCharsPerField, 4000, 8000);
    try {
      const response = await requestJson(
        `/api/drones/${encodeURIComponent(args.drone)}/chats/${encodeURIComponent(chat)}/state?turn=all&transcript=selected&pending=none`,
        { method: 'GET' },
      );
      const turns = Array.isArray(response?.transcripts) ? response.transcripts.slice(-limit).map((turn: any) => boundedTranscriptTurn(turn, maxCharsPerField)) : [];
      return toolResult({ ok: true, drone: args.drone, chat, turns, limit, maxCharsPerField });
    } catch (error: any) {
      if (error?.status !== 410) throw error;
      const response = await requestJson(`/api/drones/${encodeURIComponent(args.drone)}/chats/${encodeURIComponent(chat)}/output`, { method: 'GET' });
      const output = truncateString(cleanString(response?.output), maxCharsPerField * 2);
      return toolResult({ ok: true, drone: args.drone, chat, output: output.value, outputOriginalLength: output.originalLength, outputTruncated: output.truncated, truncated: output.truncated });
    }
  });
}

export async function startDroneHubMcpServer() {
  const server = new McpServer(
    { name: 'Drone Hub MCP Server', version: '0.1.0' },
    { capabilities: { logging: {} } },
  );
  registerTools(server);
  await server.connect(new StdioServerTransport());
  return server;
}

if (require.main === module) {
  startDroneHubMcpServer().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
