#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  mcpChatAccessAllowsDrone,
  type McpChatAccessKind,
} from './mcp-chat-access';
import type { McpTokenIdentity } from './mcp-tokens';

import { defaultProfileDroneRootDir, profileDroneRootDir, readActiveProfileNameSync } from '../host/profiles';
import { McpIdleSubscriptionStore } from './assistant/mcp-idle-subscription-store';
import { droneSummary } from './mcp-summaries';
import { registerWorkflowMcpTools } from './workflows/workflow-mcp-tools';
import { isWorkflowChildDroneEntry } from './workflows/workflow-child-drone-metadata';
import {
  WORKFLOW_DRONE_DEFAULTED_TOOL_NAMES,
  WORKFLOW_MCP_TOOL_NAMES,
  WORKFLOW_WRITE_SCOPED_TOOL_NAMES,
} from './workflows/workflow-tool-names';

const DEFAULT_HUB_BASE_URL = 'http://127.0.0.1:5174';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_FOR_MS = 1000;
const DEFAULT_IDLE_POLL_INTERVAL_MS = 1000;
const DEFAULT_IDLE_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HIGHLIGHT_DURATION_MS = 10_000;
const MAX_IDLE_FOR_MS = 60_000;
const MAX_IDLE_POLL_INTERVAL_MS = 30_000;
const MAX_IDLE_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
const MAX_IDLE_TARGETS = 20;
const MAX_HIGHLIGHT_DURATION_MS = 60_000;

const whiteboardShapeSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fromId: z.string().optional(),
  toId: z.string().optional(),
  startX: z.number().optional(),
  startY: z.number().optional(),
  endX: z.number().optional(),
  endY: z.number().optional(),
  strokeColor: z.string().optional(),
  backgroundColor: z.string().optional(),
}).passthrough();

const whiteboardOperationSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  ids: z.array(z.string()).optional(),
  text: z.string().optional(),
  shape: whiteboardShapeSchema.optional(),
  shapes: z.array(whiteboardShapeSchema).optional(),
}).passthrough();

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
let idleSubscriptionsRestored = false;
let idleSubscriptionStore: McpIdleSubscriptionStore | null = null;

function subscriptionStore(): McpIdleSubscriptionStore {
  idleSubscriptionStore ??= new McpIdleSubscriptionStore();
  return idleSubscriptionStore;
}

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

export function imageToolResult(args: { text: string; data: string; mimeType: string; metadata: Record<string, unknown> }): any {
  return {
    content: [
      {
        type: 'image' as const,
        data: args.data,
        mimeType: args.mimeType,
        _meta: args.metadata,
      },
      { type: 'text' as const, text: args.text },
    ],
  };
}

function compactWhiteboard(whiteboard: any): Record<string, unknown> {
  const elements = Array.isArray(whiteboard?.scene?.elements) ? whiteboard.scene.elements : [];
  const visible = elements.filter((element: any) => element?.isDeleted !== true);
  const compactElements = visible.slice(0, 100).map((element: any) => {
    const compact: Record<string, unknown> = {
      id: cleanString(element?.id),
      type: cleanString(element?.type),
      x: Number(element?.x ?? 0),
      y: Number(element?.y ?? 0),
      width: Number(element?.width ?? 0),
      height: Number(element?.height ?? 0),
    };
    if (typeof element?.text === 'string') {
      compact.text = element.text.length > 500 ? `${element.text.slice(0, 500)}...` : element.text;
    }
    if (typeof element?.strokeColor === 'string') compact.strokeColor = element.strokeColor;
    if (typeof element?.backgroundColor === 'string') compact.backgroundColor = element.backgroundColor;
    if (Array.isArray(element?.points)) compact.points = element.points;
    return compact;
  });
  return {
    id: cleanString(whiteboard?.id),
    title: cleanString(whiteboard?.title),
    scopeType: cleanString(whiteboard?.scopeType),
    scopeValue: cleanString(whiteboard?.scopeValue),
    version: Number(whiteboard?.version ?? 0),
    updatedAt: cleanString(whiteboard?.updatedAt),
    totalElementCount: elements.length,
    visibleElementCount: visible.length,
    truncatedElements: visible.length > compactElements.length,
    elements: compactElements,
  };
}

async function ensureDefaultWhiteboardExists(): Promise<void> {
  await requestJson('/api/whiteboards', { method: 'GET' });
}

async function requestWhiteboard(whiteboardIdRaw: unknown): Promise<any> {
  const whiteboardId = cleanString(whiteboardIdRaw, 'main');
  try {
    return await requestJson(`/api/whiteboards/${encodeURIComponent(whiteboardId)}`, { method: 'GET' });
  } catch (error: any) {
    if (whiteboardId !== 'main' || error?.status !== 404) throw error;
    await ensureDefaultWhiteboardExists();
    return await requestJson('/api/whiteboards/main', { method: 'GET' });
  }
}

function normalizeWhiteboardOperations(args: any): unknown[] {
  const operations = Array.isArray(args?.operations) ? args.operations : [];
  if (operations.length > 0) return operations;
  const shapes = Array.isArray(args?.shapes) ? args.shapes : [];
  return shapes.length > 0 ? [{ action: 'add_shape', shapes }] : [];
}

function appendOptionalSearchParam(params: URLSearchParams, key: string, value: unknown): void {
  const text = cleanString(value);
  if (text) params.set(key, text);
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

async function requestDroneSummaries() {
  try {
    return await requestJson('/api/drones/summary', { method: 'GET' });
  } catch (error: any) {
    if (error?.status !== 404) throw error;
    return requestJson('/api/drones', { method: 'GET' });
  }
}

async function waitForMcpDroneReady(droneRef: string, timeoutMs = 10 * 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await requestDroneSummaries();
    const drones = Array.isArray(response?.drones) ? response.drones : [];
    const drone = drones.find((candidate: any) => cleanString(candidate?.id) === droneRef || cleanString(candidate?.name) === droneRef);
    const phase = cleanString(drone?.hub?.phase || drone?.phase || drone?.status).toLowerCase();
    if (drone && (phase === 'ready' || phase === 'running' || phase === 'idle')) return droneSummary(drone);
    if (phase === 'error' || phase === 'failed') throw new Error(`drone failed while becoming ready: ${droneRef}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for drone to be ready: ${droneRef}`);
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

async function resolveRequiredDroneIds(refs: string[]): Promise<string[]> {
  const wantedRefs = normalizeOrderedStringList(refs);
  if (wantedRefs.length === 0) throw new Error('at least one drone is required');
  const resolved = await resolveDroneRefs(wantedRefs);
  const unknown = resolved.filter((item) => !item.found).map((item) => item.ref);
  if (unknown.length > 0) throw new Error(`unknown drone${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
  return normalizeOrderedStringList(resolved.map((item) => item.id));
}

function normalizeHighlightDurationMs(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_HIGHLIGHT_DURATION_MS;
  return Math.max(1000, Math.min(MAX_HIGHLIGHT_DURATION_MS, Math.floor(number)));
}

async function emitUiAction(uiAction: Record<string, unknown>) {
  return requestJson('/api/assistant/ui-action', {
    method: 'POST',
    body: JSON.stringify({ uiAction }),
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
    pinnedDroneIds: normalizeOrderedStringList(raw.pinnedDroneIds),
    hiddenSidebarGroups: normalizeOrderedStringList(raw.hiddenSidebarGroups),
    autoDelete: raw.autoDelete === true,
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

function persistIdleSubscription(subscription: IdleSubscription) {
  subscriptionStore().save({
    id: subscription.id,
    status: subscription.status,
    expiresAtMs: subscription.expiresAtMs,
    updatedAt: new Date().toISOString(),
    subscription: {
      ...publicSubscription(subscription),
      clientMeta: subscription.clientMeta,
      idleSince: subscription.idleSince,
    },
  });
}

function restoredIdleSubscription(record: ReturnType<McpIdleSubscriptionStore['list']>[number]): IdleSubscription | null {
  const value = record.subscription as any;
  const mode = value?.mode === 'all' ? 'all' : value?.mode === 'any' ? 'any' : null;
  const targets = normalizeIdleTargets({ targets: value?.targets });
  if (!mode || targets.length === 0) return null;
  return {
    id: record.id,
    mode,
    targets,
    clientMeta: normalizeClientMeta(value?.clientMeta),
    status: record.status,
    createdAt: cleanIsoTimestamp(value?.createdAt) ?? record.updatedAt,
    expiresAt: cleanIsoTimestamp(value?.expiresAt) ?? new Date(record.expiresAtMs).toISOString(),
    expiresAtMs: record.expiresAtMs,
    idleForMs: cleanPositiveInt(value?.idleForMs, DEFAULT_IDLE_FOR_MS, MAX_IDLE_FOR_MS),
    pollIntervalMs: cleanPositiveInt(value?.pollIntervalMs, DEFAULT_IDLE_POLL_INTERVAL_MS, MAX_IDLE_POLL_INTERVAL_MS),
    idleSince: Number.isFinite(Number(value?.idleSince)) ? Number(value.idleSince) : null,
    inFlight: false,
    timer: null,
    lastStatus: value?.lastStatus ?? null,
    lastError: typeof value?.lastError === 'string' ? value.lastError : null,
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
  persistIdleSubscription(subscription);
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
    persistIdleSubscription(subscription);
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
  persistIdleSubscription(subscription);
  void runIdleSubscriptionTick(server, subscription);
  return { ok: true, subscription: publicSubscription(subscription) };
}

function restoreIdleSubscriptions(server: McpServer): void {
  if (idleSubscriptionsRestored) return;
  idleSubscriptionsRestored = true;
  const now = Date.now();
  for (const record of subscriptionStore().list()) {
    const subscription = restoredIdleSubscription(record);
    if (!subscription) continue;
    if (subscription.status === 'active' && subscription.expiresAtMs <= now) {
      subscription.status = 'expired';
      persistIdleSubscription(subscription);
    }
    idleSubscriptions.set(subscription.id, subscription);
    if (subscription.status !== 'active') continue;
    subscription.timer = setInterval(() => void runIdleSubscriptionTick(server, subscription), subscription.pollIntervalMs);
    subscription.timer.unref?.();
    void runIdleSubscriptionTick(server, subscription);
  }
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
    let drones = Array.isArray(response?.drones)
      ? response.drones
          .filter((drone: any) => !isWorkflowChildDroneEntry(drone))
          .map(droneSummary)
      : [];
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

  const openDroneChat = async (args: any) => {
    const droneRef = cleanString(args.droneId);
    const [droneId] = await resolveRequiredDroneIds([droneRef]);
    const chat = chatName(args.chatName);
    if (chat !== 'default') {
      const response = await requestJson(`/api/drones/${encodeURIComponent(droneId)}/chats`, { method: 'GET' });
      const chats = Array.isArray(response?.chats) ? response.chats.map((name: any) => cleanString(name)).filter(Boolean) : [];
      if (!chats.includes(chat)) throw new Error(`unknown chat: ${droneId}/${chat}`);
    }
    const response = await emitUiAction({ type: 'open_drone_chat', droneId, droneIds: [droneId], chatName: chat });
    return toolResult({ ok: true, droneId, chatName: chat, uiAction: response?.uiAction ?? null });
  };
  const openDroneInputSchema = {
    droneId: z.string(),
    chatName: z.string().optional(),
  };

  server.registerTool('open_drone_chat', {
    title: 'Open drone chat',
    description: 'Open an existing drone chat in the Drone Hub UI. This is a UI navigation action and does not create a chat.',
    inputSchema: openDroneInputSchema,
  }, openDroneChat);

  server.registerTool('open_drone', {
    title: 'Open drone',
    description: 'Open a drone chat in the Drone Hub UI. Alias for open_drone_chat; does not create a chat.',
    inputSchema: openDroneInputSchema,
  }, openDroneChat);

  server.registerTool('highlight_drones', {
    title: 'Highlight drones',
    description: 'Temporarily highlight one or more drones in the Drone Hub UI and expand their collapsed group folders. Highlights default to 10 seconds.',
    inputSchema: {
      droneIds: z.array(z.string()),
      durationMs: z.number().optional(),
    },
  }, async (args) => {
    const droneIds = await resolveRequiredDroneIds(Array.isArray(args.droneIds) ? args.droneIds : []);
    const durationMs = normalizeHighlightDurationMs(args.durationMs);
    const response = await emitUiAction({ type: 'highlight_drones', droneIds, durationMs });
    return toolResult({ ok: true, droneIds, durationMs, uiAction: response?.uiAction ?? null });
  });

  server.registerTool('list_whiteboards', {
    title: 'List whiteboards',
    description: 'List backend-saved Drone Hub whiteboards with ids, titles, scopes, and versions.',
    inputSchema: {
      scopeType: z.string().optional(),
      scopeValue: z.string().optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams();
    const scopeType = cleanString(args.scopeType);
    const scopeValue = cleanString(args.scopeValue);
    if (scopeType) params.set('scopeType', scopeType);
    if (scopeValue) params.set('scopeValue', scopeValue);
    const pathname = `/api/whiteboards${params.size > 0 ? `?${params.toString()}` : ''}`;
    return toolResult(await requestJson(pathname, { method: 'GET' }));
  });

  server.registerTool('read_whiteboard', {
    title: 'Read whiteboard',
    description: 'Read a backend-saved whiteboard scene summary and elements. Omit whiteboardId for the main whiteboard.',
    inputSchema: {
      whiteboardId: z.string().optional(),
    },
  }, async (args) => {
    const response = await requestWhiteboard(args.whiteboardId);
    const whiteboard = compactWhiteboard(response?.whiteboard);
    return toolResult({ ok: true, whiteboard });
  });

  server.registerTool('create_whiteboard', {
    title: 'Create whiteboard',
    description: 'Create a backend-saved Drone Hub whiteboard.',
    inputSchema: {
      title: z.string().optional(),
      scopeType: z.string().optional(),
      scopeValue: z.string().optional(),
    },
  }, async (args) => {
    const body = {
      ...(cleanString(args.title) ? { title: cleanString(args.title) } : {}),
      ...(cleanString(args.scopeType) ? { scopeType: cleanString(args.scopeType) } : {}),
      ...(cleanString(args.scopeValue) ? { scopeValue: cleanString(args.scopeValue) } : {}),
      actorId: 'mcp',
    };
    const response = await requestJson('/api/whiteboards', { method: 'POST', body: JSON.stringify(body) });
    return toolResult({ ok: true, whiteboard: compactWhiteboard(response?.whiteboard) });
  });

  server.registerTool('update_whiteboard', {
    title: 'Update whiteboard',
    description:
      'Add, delete, or update simple whiteboard shapes. For add_shape, pass shapes with type rectangle, text, or arrow plus x/y/width/height/text. Arrows may use fromId/toId or startX/startY/endX/endY.',
    inputSchema: {
      whiteboardId: z.string().optional(),
      title: z.string().optional(),
      shapes: z.array(whiteboardShapeSchema).optional(),
      operations: z.array(whiteboardOperationSchema).optional(),
    },
  }, async (args) => {
    const whiteboardId = cleanString(args.whiteboardId, 'main');
    if (whiteboardId === 'main') await requestWhiteboard('main');
    const operations = normalizeWhiteboardOperations(args);
    const title = cleanString(args.title);
    if (!title && operations.length === 0) throw new Error('title, shapes, or operations are required');
    let response: any = null;
    if (title) {
      response = await requestJson(`/api/whiteboards/${encodeURIComponent(whiteboardId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ actorId: 'mcp', title }),
      });
    }
    if (operations.length > 0) {
      response = await requestJson(`/api/whiteboards/${encodeURIComponent(whiteboardId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ actorId: 'mcp', operations }),
      });
    }
    return toolResult({ ok: true, whiteboard: compactWhiteboard(response?.whiteboard) });
  });

  server.registerTool('capture_whiteboard', {
    title: 'Capture whiteboard',
    description: 'Render the full visible whiteboard as a PNG image fitted to all visible shapes.',
    inputSchema: {
      whiteboardId: z.string().optional(),
      padding: z.number().optional(),
      maxWidth: z.number().optional(),
      maxHeight: z.number().optional(),
      backgroundColor: z.string().optional(),
    },
  }, async (args) => {
    const whiteboardId = cleanString(args.whiteboardId, 'main');
    const params = new URLSearchParams();
    appendOptionalSearchParam(params, 'padding', args.padding);
    appendOptionalSearchParam(params, 'maxWidth', args.maxWidth);
    appendOptionalSearchParam(params, 'maxHeight', args.maxHeight);
    appendOptionalSearchParam(params, 'backgroundColor', args.backgroundColor);
    const response = await requestJson(
      `/api/whiteboards/${encodeURIComponent(whiteboardId)}/image${params.size > 0 ? `?${params.toString()}` : ''}`,
      { method: 'GET' },
    );
    const metadata = response?.metadata && typeof response.metadata === 'object' ? response.metadata : {};
    const data = cleanString(response?.data);
    const mimeType = cleanString((metadata as any).mimeType, 'image/png');
    if (!data) throw new Error('whiteboard image response did not include image data');
    return imageToolResult({
      text: `Captured whiteboard ${cleanString((metadata as any).title, whiteboardId)} as a ${Number((metadata as any).width ?? 0) || '?'}x${Number((metadata as any).height ?? 0) || '?'} PNG.`,
      data,
      mimeType,
      metadata,
    });
  });

  server.registerTool('open_whiteboard', {
    title: 'Open whiteboard',
    description: 'Open the Whiteboard panel in Drone Hub. Omit whiteboardId for the main whiteboard.',
    inputSchema: {
      whiteboardId: z.string().optional(),
    },
  }, async (args) => {
    const response = await requestWhiteboard(args.whiteboardId);
    const whiteboardId = cleanString(response?.whiteboard?.id, cleanString(args.whiteboardId, 'main'));
    const uiActionResponse = await emitUiAction({ type: 'open_whiteboard', whiteboardId });
    return toolResult({ ok: true, whiteboardId, uiAction: uiActionResponse?.uiAction ?? null });
  });

  server.registerTool('close_whiteboard', {
    title: 'Close whiteboard',
    description: 'Close the Whiteboard panel in Drone Hub.',
    inputSchema: {},
  }, async () => {
    const response = await emitUiAction({ type: 'close_whiteboard' });
    return toolResult({ ok: true, uiAction: response?.uiAction ?? null });
  });

  server.registerTool('create_drone', {
    title: 'Create drone',
    description: 'Create a new Drone Hub container drone. Drafts return immediately; other drones return when ready unless completion is accepted.',
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
      draft: z.boolean().optional(),
      completion: z.enum(['ready', 'accepted']).optional(),
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
      ...(args.draft === true ? { draft: true } : {}),
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
    const accepted = droneSummary({ ...body, ...response });
    const returnsImmediately = args.draft === true || args.completion === 'accepted';
    const drone = returnsImmediately
      ? accepted
      : await waitForMcpDroneReady(cleanString(response?.id || response?.name, accepted.id || accepted.name));
    return toolResult({ ok: true, phase: args.draft === true ? 'draft' : returnsImmediately ? 'accepted' : 'ready', drone, raw: response, createDefaults: defaults, repo: resolvedRepo });
  });

  server.registerTool('clone_drone', {
    title: 'Clone drone',
    description: 'Create a new drone cloned from an existing Drone Hub drone.',
    inputSchema: {
      source: z.string(),
      name: z.string(),
      group: z.string().optional(),
      cloneChats: z.boolean().optional(),
      completion: z.enum(['ready', 'accepted']).optional(),
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
    const accepted = droneSummary({ ...body, ...response });
    const drone = args.completion === 'accepted'
      ? accepted
      : await waitForMcpDroneReady(cleanString(response?.id || response?.name, accepted.id || accepted.name));
    return toolResult({ ok: true, phase: args.completion === 'accepted' ? 'accepted' : 'ready', drone, raw: response });
  });

  registerWorkflowMcpTools(server, { requestJson, toolResult });

  server.registerTool('list_chats', {
    title: 'List drone chats',
    description: 'List chats for a Drone Hub drone.',
    inputSchema: { drone: z.string() },
  }, async (args) => {
    const response = await requestJson(`/api/drones/${encodeURIComponent(args.drone)}/chats`, { method: 'GET' });
    const draftByChat: Record<string, boolean> =
      response?.draftChats && typeof response.draftChats === 'object' && !Array.isArray(response.draftChats)
        ? Object.fromEntries(
            Object.entries(response.draftChats)
              .map(([name, draft]) => [cleanString(name), draft === true] as const)
              .filter(([name, draft]) => Boolean(name) && draft),
          )
        : {};
    for (const item of Array.isArray(response?.chatDetails) ? response.chatDetails : []) {
      const name = cleanString(item?.chat ?? item?.name);
      if (name && item?.draft === true) draftByChat[name] = true;
    }
    return toolResult({
      ok: true,
      drone: args.drone,
      chats: Array.isArray(response?.chats)
        ? response.chats
            .map((item: any) => {
              const name = typeof item === 'string' ? cleanString(item) : cleanString(item?.chat ?? item?.name);
              return name ? { name, ...((typeof item === 'object' && item?.draft === true) || draftByChat[name] ? { draft: true } : {}) } : null;
            })
            .filter(Boolean)
        : [],
    });
  });

  server.registerTool('create_chat', {
    title: 'Create drone chat',
    description: 'Create a chat for a Drone Hub drone.',
    inputSchema: { drone: z.string(), chat: z.string(), draft: z.boolean().optional() },
  }, async (args) => {
    let created = true;
    await requestJson(`/api/drones/${encodeURIComponent(args.drone)}/chats`, {
      method: 'POST',
      body: JSON.stringify({ name: args.chat, ...(args.draft === true ? { draft: true } : {}) }),
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

  server.registerTool('list_chat_idle_subscriptions', {
    title: 'List chat idle subscriptions',
    description: 'List durable Drone Hub chat-idle subscriptions and their latest state.',
    inputSchema: {},
  }, async () => toolResult({
    ok: true,
    subscriptions: [...idleSubscriptions.values()].map(publicSubscription),
  }));

  server.registerTool('cancel_chat_idle_subscription', {
    title: 'Cancel chat idle subscription',
    description: 'Stop a durable Drone Hub chat-idle subscription.',
    inputSchema: { subscriptionId: z.string() },
  }, async (args) => {
    const subscription = idleSubscriptions.get(cleanString(args.subscriptionId));
    if (!subscription) throw new Error(`unknown chat-idle subscription: ${args.subscriptionId}`);
    if (subscription.status === 'active') stopIdleSubscription(subscription, 'stopped');
    return toolResult({ ok: true, subscription: publicSubscription(subscription) });
  });

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

export type DroneHubMcpServerContext = {
  principal: McpTokenIdentity;
  correlationId?: string;
  allowedDroneRefs?: string[];
  allowedWriteDroneRefs?: string[];
  allowedDroneIds?: string[];
};

export type DroneHubMcpServer = McpServer & {
  setPrincipal: (principal: McpTokenIdentity) => void;
};

const WRITE_SCOPED_TOOLS = new Set([
  'set_drone_group',
  'rename_drones',
  'reorder_drones',
  'create_chat',
  'send_message',
  ...WORKFLOW_WRITE_SCOPED_TOOL_NAMES,
]);

const CHAT_EXECUTE_SCOPED_TOOLS = new Set([
  'open_drone_chat',
  'open_drone',
  'highlight_drones',
  'open_whiteboard',
  'close_whiteboard',
  'send_message',
  'subscribe_to_any_chat_idle',
  'subscribe_to_all_chats_idle',
  'cancel_chat_idle_subscription',
]);

const CHAT_WRITE_SCOPED_TOOLS = new Set([
  'set_drone_group',
  'rename_drones',
  'reorder_drones',
  'create_whiteboard',
  'update_whiteboard',
  'create_chat',
]);

function chatAccessKindForTool(tool: string): McpChatAccessKind {
  if (CHAT_EXECUTE_SCOPED_TOOLS.has(tool)) return 'execute';
  if (CHAT_WRITE_SCOPED_TOOLS.has(tool)) return 'write';
  return 'read';
}

const DRONE_PRINCIPAL_TOOLS = new Set([
  'list_drones',
  'open_drone_chat',
  'open_drone',
  'highlight_drones',
  'list_whiteboards',
  'read_whiteboard',
  'create_whiteboard',
  'update_whiteboard',
  'capture_whiteboard',
  'open_whiteboard',
  'close_whiteboard',
  'list_chats',
  'create_chat',
  'send_message',
  'subscribe_to_any_chat_idle',
  'subscribe_to_all_chats_idle',
  'read_chat',
  ...WORKFLOW_MCP_TOOL_NAMES,
]);

const DRONE_DEFAULTED_TOOLS = new Set<string>(WORKFLOW_DRONE_DEFAULTED_TOOL_NAMES);

function assertedDroneRefs(args: any): string[] {
  const direct = [args?.drone, args?.droneId, args?.targetDroneId, args?.id, args?.beforeDrone, args?.afterDrone]
    .map((value) => cleanString(value))
    .filter(Boolean);
  const arrays = [args?.drones, args?.droneIds, args?.targets, args?.renames]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .map((value: any) => cleanString(value?.drone || value?.droneId || value?.id || value))
    .filter(Boolean);
  return [...new Set([...direct, ...arrays])];
}

export function authorizeDroneHubMcpTool(context: DroneHubMcpServerContext, tool: string, args: any): void {
  const principal = context.principal;
  if (context.allowedDroneRefs) {
    const scope = WRITE_SCOPED_TOOLS.has(tool) ? context.allowedWriteDroneRefs ?? [] : context.allowedDroneRefs;
    const allowed = new Set(scope.map((value) => cleanString(value)).filter(Boolean));
    const refs = assertedDroneRefs(args);
    if (refs.some((ref) => !allowed.has(ref))) {
      throw new Error(`MCP principal ${principal.name} is not authorized for the requested drone`);
    }
  }
  if (principal.kind === 'legacy' || principal.kind === 'host') return;
  if (principal.kind === 'chat') {
    const refs = assertedDroneRefs(args);
    const kind = chatAccessKindForTool(tool);
    if (
      refs.every((ref) =>
        mcpChatAccessAllowsDrone(
          principal.accessScope,
          kind,
          ref,
          principal.selectedDroneRefs,
        ),
      )
    ) {
      return;
    }
    throw new Error(
      `MCP principal ${principal.name} ${kind} scope does not include the requested drone`,
    );
  }
  const scopedDroneId = cleanString(principal.droneId);
  if (!scopedDroneId || !DRONE_PRINCIPAL_TOOLS.has(tool)) {
    throw new Error(`MCP principal ${principal.name} is not authorized for ${tool}`);
  }
  const refs = assertedDroneRefs(args);
  if (tool === 'list_drones' && refs.length === 0) return;
  if (refs.length === 0 || refs.some((ref) => ref !== scopedDroneId)) {
    throw new Error(`MCP principal ${principal.name} is scoped to drone ${scopedDroneId}`);
  }
}

function projectMcpResultForPrincipal(context: DroneHubMcpServerContext, tool: string, result: any): any {
  const principal = context.principal;
  if (tool !== 'list_drones') return result;
  const structured = result?.structuredContent;
  if (!structured || typeof structured !== 'object') return result;
  const allowedIds = context.allowedDroneIds ? new Set(context.allowedDroneIds.map((value) => cleanString(value)).filter(Boolean)) : null;
  const chatAllowedIds =
    principal.kind === 'chat' && principal.accessScope.readMode === 'selected'
      ? new Set(principal.accessScope.droneIds)
      : null;
  if (principal.kind !== 'drone' && !allowedIds && !chatAllowedIds) return result;
  const drones = Array.isArray(structured.drones)
    ? structured.drones.filter((drone: any) => principal.kind === 'drone'
      ? cleanString(drone?.id) === principal.droneId
      : (allowedIds ?? chatAllowedIds)!.has(cleanString(drone?.id)))
    : [];
  const next = { ...structured, count: drones.length, drones };
  return toolResult(next);
}

function registerAuthorizedTools(server: McpServer, context: DroneHubMcpServerContext): void {
  const registerTool = server.registerTool.bind(server) as any;
  (server as any).registerTool = (name: string, config: any, handler: (args: any, extra: any) => Promise<any>) =>
    registerTool(name, config, async (args: any, extra: any) => {
      const effectiveArgs =
        context.principal.kind === 'drone' &&
        DRONE_DEFAULTED_TOOLS.has(name) &&
        !cleanString(args?.drone)
          ? { ...args, drone: context.principal.droneId }
          : args;
      authorizeDroneHubMcpTool(context, name, effectiveArgs);
      return projectMcpResultForPrincipal(context, name, await handler(effectiveArgs, extra));
    });
  registerTools(server);
  (server as any).registerTool = registerTool;
}

export function createDroneHubMcpServer(input?: Partial<DroneHubMcpServerContext>): DroneHubMcpServer {
  const context: DroneHubMcpServerContext = {
    principal: input?.principal ?? { kind: 'legacy', tokenId: 'legacy', name: 'Legacy Drone Hub MCP token' },
    ...(input?.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input?.allowedDroneRefs ? { allowedDroneRefs: input.allowedDroneRefs } : {}),
    ...(input?.allowedWriteDroneRefs ? { allowedWriteDroneRefs: input.allowedWriteDroneRefs } : {}),
    ...(input?.allowedDroneIds ? { allowedDroneIds: input.allowedDroneIds } : {}),
  };
  const server = new McpServer(
    { name: 'Drone Hub MCP Server', version: '0.1.0' },
    { capabilities: { logging: {} } },
  ) as DroneHubMcpServer;
  server.setPrincipal = (principal) => {
    context.principal = principal;
  };
  registerAuthorizedTools(server, context);
  restoreIdleSubscriptions(server);
  return server;
}

export async function startDroneHubMcpServer() {
  const server = createDroneHubMcpServer();
  await server.connect(new StdioServerTransport());
  return server;
}

if (require.main === module) {
  startDroneHubMcpServer().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
