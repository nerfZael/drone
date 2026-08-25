#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { allocateUntitledChatName } from '@drone/assistant-chat';
import {
  applySidebarMove,
  buildSidebarChatTree,
  isSameOrDescendantSidebarChatGroupPath,
  normalizeSidebarChatGroupPath,
  normalizeSidebarLayout,
  sidebarChatGroupBaseName,
  sidebarChatGroupNodeId,
  sidebarChatGroupParentPath,
  sidebarChatNodeId,
  sidebarLayoutPatch,
  type SidebarChatTreeModel,
  type SidebarMoveIntent,
} from '@drone/hub-model';
import { z } from 'zod';

import { mcpChatAccessAllowsDrone, type McpChatAccessKind } from './mcp-chat-access';
import type { McpTokenIdentity } from './mcp-tokens';
import { registerChangeRequestMcpTools } from './change-requests/change-request-mcp-tools';
import {
  CHANGE_REQUEST_CHAT_EXECUTE_TOOL_NAMES,
  CHANGE_REQUEST_CHAT_WRITE_TOOL_NAMES,
  CHANGE_REQUEST_MANAGE_TOOL_NAMES,
  CHANGE_REQUEST_MERGE_TOOL_NAME,
  CHANGE_REQUEST_PUBLIC_REVIEW_TOOL_NAMES,
  CHANGE_REQUEST_PUBLIC_UPDATE_TOOL_NAMES,
  CHANGE_REQUEST_WRITE_SCOPED_TOOL_NAMES,
} from './change-requests/change-request-tool-names';
import { normalizeChangeRequestSubscriptionId } from './subscriptions/change-request-subscription-events';
import { MCP_RESOURCE_SUBSCRIPTION_EVENTS } from './subscriptions/resource-subscription-capabilities';

import {
  defaultProfileDroneRootDir,
  profileDroneRootDir,
  readActiveProfileNameSync,
} from '../host/profiles';
import { GROQ_SPEECH_MAX_CHARS, GROQ_SPEECH_VOICES } from './groq-speech';
import { droneSummary } from './mcp-summaries';
import { placeMcpRepoScopedGroupNodeAtTop } from './mcp-sidebar-group-order';
import { searchActiveChatMessages } from './transcript-store';
import { registerWorkflowMcpTools } from './workflows/workflow-mcp-tools';
import { isWorkflowChildDroneEntry } from './workflows/workflow-child-drone-metadata';
import { createHttpHubServices, type HubServices } from './application/hub-services';
import {
  WORKFLOW_DRONE_DEFAULTED_TOOL_NAMES,
  WORKFLOW_MCP_TOOL_NAMES,
  WORKFLOW_WRITE_SCOPED_TOOL_NAMES,
} from './workflows/workflow-tool-names';

const DEFAULT_HUB_BASE_URL = 'http://127.0.0.1:5174';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_HIGHLIGHT_DURATION_MS = 10_000;
const MAX_HIGHLIGHT_DURATION_MS = 60_000;

const whiteboardShapeSchema = z
  .object({
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
  })
  .passthrough();

const whiteboardOperationSchema = z
  .object({
    action: z.string(),
    id: z.string().optional(),
    ids: z.array(z.string()).optional(),
    text: z.string().optional(),
    shape: whiteboardShapeSchema.optional(),
    shapes: z.array(whiteboardShapeSchema).optional(),
  })
  .passthrough();

type HubConnection = {
  baseUrl: string;
  token: string;
  source: string;
};

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

function truncateString(
  value: unknown,
  maxChars: number,
): { value: string; truncated: boolean; originalLength: number } {
  const text = String(value ?? '');
  if (text.length <= maxChars)
    return { value: text, truncated: false, originalLength: text.length };
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
  const xdgDataHome = cleanString(
    process.env.XDG_DATA_HOME,
    path.join(os.homedir(), '.local', 'share'),
  );
  return [...profileDirs, path.join(xdgDataHome, 'drone'), path.join(os.homedir(), '.drone')];
}

function readHubStateSnapshot(
  filePath: string,
): { apiHost: string; apiPort: number; apiToken: string } | null {
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
      baseUrl: state
        ? `http://${state.apiHost}:${state.apiPort}`
        : configuredBaseUrl || DEFAULT_HUB_BASE_URL,
      token,
      source: dir,
    };
  }

  throw new Error(
    'Drone Hub connection not found. Start Drone Hub, or set DRONE_HUB_BASE_URL and DRONE_TOKEN.',
  );
}

function joinUrl(baseUrl: string, pathname: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ''), base).toString();
}

async function requestJson(
  pathname: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<any> {
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
      const error = new Error(
        `Drone Hub request failed: ${method} ${pathname} returned ${response.status}: ${detail}`,
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error: any) {
    if (error?.name === 'AbortError')
      throw new Error(`Drone Hub request timed out after ${timeoutMs}ms: ${method} ${pathname}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function localMachineTimeZone(): string {
  try {
    return new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

async function defaultCronTimeZone(): Promise<string> {
  try {
    const response = await requestJson('/api/settings/user-context', { method: 'GET' });
    const timeZone = cleanString(response?.userContext?.timeZone);
    if (timeZone) return timeZone;
  } catch {
    // Standalone MCP clients may connect to an older or temporarily unavailable Hub.
  }
  return localMachineTimeZone();
}

function toolResult(data: Record<string, unknown>): any {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export function imageToolResult(args: {
  text: string;
  data: string;
  mimeType: string;
  metadata: Record<string, unknown>;
}): any {
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
    if (typeof element?.backgroundColor === 'string')
      compact.backgroundColor = element.backgroundColor;
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
    return await requestJson(`/api/whiteboards/${encodeURIComponent(whiteboardId)}`, {
      method: 'GET',
    });
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
  if (!['cursor', 'codex', 'claude', 'opencode', 'pi', 'blip'].includes(id))
    throw new Error(`Unsupported built-in agent: ${value}`);
  return { kind: 'builtin', id };
}

type McpConfigurableChatAgent = { kind: 'native' } | { kind: 'builtin'; id: string };

function normalizeConfigurableChatAgent(value: unknown): McpConfigurableChatAgent | null {
  const id = cleanString(value).toLowerCase();
  if (!id) return null;
  if (id === 'native') return { kind: 'native' };
  return normalizeAgent(id);
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

async function requestRepoSummaries(services: HubServices) {
  const response = await services.repositories.list();
  const repos = Array.isArray(response?.repos)
    ? response.repos.map(normalizeRepoSummary).filter(Boolean)
    : [];
  repos.sort(
    (a: any, b: any) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) ||
      a.path.localeCompare(b.path),
  );
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

type McpInitialMessageReadiness = {
  chat: string;
  promptId: string;
};

function initialMessageReadiness(raw: any): McpInitialMessageReadiness | null {
  const promptId = cleanString(raw?.promptId);
  if (!promptId) return null;
  return {
    chat: chatName(raw?.chat),
    promptId,
  };
}

async function mcpInitialMessageIsMaterialized(
  droneRef: string,
  expected: McpInitialMessageReadiness,
): Promise<boolean> {
  try {
    const state = await requestJson(
      `/api/drones/${encodeURIComponent(droneRef)}/chats/${encodeURIComponent(expected.chat)}/state?turn=last`,
      { method: 'GET' },
    );
    const rows = [
      ...(Array.isArray(state?.pending) ? state.pending : []),
      ...(Array.isArray(state?.transcripts) ? state.transcripts : []),
    ];
    return rows.some(
      (row: any) => cleanString(row?.id || row?.promptId || row?.turnId) === expected.promptId,
    );
  } catch (error: any) {
    if (error?.status === 404) return false;
    throw error;
  }
}

async function waitForMcpDroneReady(
  droneRef: string,
  opts?: {
    timeoutMs?: number;
    initialMessage?: McpInitialMessageReadiness | null;
  },
) {
  const timeoutMs = opts?.timeoutMs ?? 10 * 60_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await requestDroneSummaries();
    const drones = Array.isArray(response?.drones) ? response.drones : [];
    const drone = drones.find(
      (candidate: any) =>
        cleanString(candidate?.id) === droneRef || cleanString(candidate?.name) === droneRef,
    );
    const phase = cleanString(
      drone?.hub?.phase || drone?.hubPhase || drone?.phase || drone?.status,
    ).toLowerCase();
    if (phase === 'error' || phase === 'failed')
      throw new Error(`drone failed while becoming ready: ${droneRef}`);
    const phaseReady =
      phase === 'ready' ||
      phase === 'running' ||
      phase === 'idle' ||
      (Boolean(opts?.initialMessage) && phase === 'busy');
    if (
      drone &&
      phaseReady &&
      (!opts?.initialMessage ||
        (await mcpInitialMessageIsMaterialized(droneRef, opts.initialMessage)))
    ) {
      return droneSummary(drone);
    }
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
      group: cleanString(match?.group) || null,
      groupId: cleanString(match?.groupId) || null,
      repoPath: cleanString(match?.repoPath),
      found: Boolean(match),
    };
  });
}

async function resolveRequiredDroneIds(refs: string[]): Promise<string[]> {
  const wantedRefs = normalizeOrderedStringList(refs);
  if (wantedRefs.length === 0) throw new Error('at least one drone is required');
  const resolved = await resolveDroneRefs(wantedRefs);
  const unknown = resolved.filter((item) => !item.found).map((item) => item.ref);
  if (unknown.length > 0)
    throw new Error(`unknown drone${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
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

async function resolveRegisteredRepo(args: any, services: HubServices) {
  const repoRef = cleanString(args.repoRef);
  const repoLabel = cleanString(args.repoLabel);
  const repoPath = cleanString(args.repoPath);
  if (!repoRef && !repoLabel && !repoPath) return null;
  const repos = await requestRepoSummaries(services);
  if (repos.length === 0) throw new Error('No repos are registered in Drone Hub.');
  const resolved: any[] = [];
  if (repoRef) {
    const match = repos.find((repo: any) => repo.repoRef === repoRef);
    if (!match) throw new Error(`Unknown repoRef: ${repoRef}. Use list_repos first.`);
    resolved.push(match);
  }
  if (repoLabel) {
    const matches = repos.filter(
      (repo: any) => repo.label.toLowerCase() === repoLabel.toLowerCase(),
    );
    if (matches.length === 0)
      throw new Error(`Unknown repoLabel: ${repoLabel}. Use list_repos first.`);
    if (matches.length > 1)
      throw new Error(`Repo label "${repoLabel}" is ambiguous. Use repoRef or repoPath.`);
    resolved.push(matches[0]);
  }
  if (repoPath) {
    const normalizedPath = path.resolve(repoPath);
    const match = repos.find((repo: any) => path.resolve(repo.path) === normalizedPath);
    if (!match) throw new Error(`Unregistered repoPath: ${repoPath}. Use list_repos first.`);
    resolved.push(match);
  }
  const first = resolved[0];
  if (resolved.some((repo) => repo.path !== first.path))
    throw new Error('Conflicting repo inputs resolve to different repos.');
  if (!first.exists)
    throw new Error(`Registered repo path does not exist on this device: ${first.path}`);
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

function normalizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [keyRaw, itemRaw] of Object.entries(value)) {
    const key = cleanString(keyRaw);
    if (!key) continue;
    out[key] = itemRaw === true;
  }
  return out;
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([keyRaw, itemRaw]) => {
      const key = cleanString(keyRaw);
      const item = cleanString(itemRaw);
      return key && item ? [[key, item] as const] : [];
    }),
  );
}

function normalizeUiPreferences(value: unknown) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as any) : {};
  return {
    sidebarGroupingMode: raw.sidebarGroupingMode === 'repos' ? 'repos' : 'groups',
    sidebarDensityMode:
      raw.sidebarDensityMode === 'compact' || raw.sidebarDensityMode === 'comfortable'
        ? raw.sidebarDensityMode
        : 'default',
    collapsedGroups: normalizeBooleanRecord(raw.collapsedGroups),
    collapsedDroneSections: normalizeBooleanRecord(raw.collapsedDroneSections),
    sidebarGroupOrder: normalizeOrderedStringList(raw.sidebarGroupOrder),
    sidebarDroneOrderByGroup: normalizeOrderedStringMap(raw.sidebarDroneOrderByGroup),
    sidebarNodeOrderByParent: normalizeOrderedStringMap(raw.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: normalizeOrderedStringMap(raw.sidebarChatOrderByDrone),
    sidebarChatGroupPathsByDrone: normalizeOrderedStringMap(raw.sidebarChatGroupPathsByDrone),
    sidebarChatGroupByChat: normalizeStringRecord(raw.sidebarChatGroupByChat),
    sidebarChatNodeOrderByParent: normalizeOrderedStringMap(raw.sidebarChatNodeOrderByParent),
    pinnedDroneIds: normalizeOrderedStringList(raw.pinnedDroneIds),
    mutedSidebarGroupIds: normalizeOrderedStringList(raw.mutedSidebarGroupIds),
    mutedDroneIds: normalizeOrderedStringList(raw.mutedDroneIds),
    mutedChatIds: normalizeOrderedStringList(raw.mutedChatIds),
    hiddenSidebarGroups: normalizeOrderedStringList(raw.hiddenSidebarGroups),
    spawnAgentKey: cleanString(raw.spawnAgentKey, 'builtin:cursor'),
    spawnModel: cleanString(raw.spawnModel),
    spawnReasoning: cleanString(raw.spawnReasoning),
    spawnAgentPermissionMode:
      raw.spawnAgentPermissionMode === 'read' || raw.spawnAgentPermissionMode === 'write'
        ? raw.spawnAgentPermissionMode
        : 'execute',
    spawnApprovalPolicy:
      raw.spawnApprovalPolicy === 'auto' || raw.spawnApprovalPolicy === 'none'
        ? raw.spawnApprovalPolicy
        : 'ask',
    repoBranchSource: normalizeRepoBranchSource(raw.repoBranchSource, 'host'),
    repoCreateRemoteBranch: cleanString(raw.repoCreateRemoteBranch),
    spawnContextByRepoKey:
      raw.spawnContextByRepoKey &&
      typeof raw.spawnContextByRepoKey === 'object' &&
      !Array.isArray(raw.spawnContextByRepoKey)
        ? raw.spawnContextByRepoKey
        : {},
  };
}

type McpGroupSummary = {
  id: string;
  repoPath: string;
  name: string;
  label: string;
  parentId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  droneCount: number;
  pendingCount: number;
  totalCount: number;
};

function normalizeGroupSummary(group: any): McpGroupSummary | null {
  const name = cleanString(group?.name ?? group);
  if (!name) return null;
  return {
    id: cleanString(group?.id),
    repoPath: cleanString(group?.repoPath),
    name,
    label: cleanString(group?.label, name.slice(name.lastIndexOf('/') + 1)),
    parentId: cleanString(group?.parentId) || null,
    createdAt: cleanIsoTimestamp(group?.createdAt),
    updatedAt: cleanIsoTimestamp(group?.updatedAt),
    droneCount: Number.isFinite(Number(group?.droneCount)) ? Number(group.droneCount) : 0,
    pendingCount: Number.isFinite(Number(group?.pendingCount)) ? Number(group.pendingCount) : 0,
    totalCount: Number.isFinite(Number(group?.totalCount)) ? Number(group.totalCount) : 0,
  };
}

function sidebarGroupOrderToken(group: Pick<McpGroupSummary, 'id' | 'name'> | string): string {
  if (typeof group !== 'string') {
    const id = cleanString(group?.id);
    if (id) return `group-id:${id}`;
    return `group:${cleanString(group?.name)}`;
  }
  return `group:${cleanString(group)}`;
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
  const moving = normalizeOrderedStringList(movingEntries).filter((entry) =>
    visible.includes(entry),
  );
  if (moving.length === 0)
    throw new Error('none of the requested drones are in the selected order scope');

  const withoutMoving = visible.filter((entry) => !moving.includes(entry));
  let insertIndex = 0;
  if (afterEntry) {
    const index = withoutMoving.indexOf(afterEntry);
    if (index < 0) throw new Error(`afterDrone is not in the selected order scope: ${afterEntry}`);
    insertIndex = index + 1;
  } else if (beforeEntry) {
    const index = withoutMoving.indexOf(beforeEntry);
    if (index < 0)
      throw new Error(`beforeDrone is not in the selected order scope: ${beforeEntry}`);
    insertIndex = index;
  }

  const nextVisible = withoutMoving.slice();
  nextVisible.splice(insertIndex, 0, ...moving);
  const visibleSet = new Set(visible);
  const hidden = normalizeOrderedStringList(existingOrder).filter(
    (entry) => !visibleSet.has(entry),
  );
  return normalizeOrderedStringList([...nextVisible, ...hidden]);
}

function migrateScopedGroupOrderToIds(order: unknown, groups: McpGroupSummary[]): string[] {
  const idByLegacyToken = new Map(
    groups
      .filter((group) => group.id)
      .map((group) => [`group:${group.name}`, sidebarGroupOrderToken(group)]),
  );
  return normalizeOrderedStringList(
    normalizeOrderedStringList(order).map((token) => idByLegacyToken.get(token) ?? token),
  );
}

function insertGroupTokenAtParentTop(
  order: unknown,
  visibleGroups: McpGroupSummary[],
  group: McpGroupSummary,
): string[] {
  const targetGroup = cleanString(group.name);
  if (!targetGroup || targetGroup.toLowerCase() === 'ungrouped')
    return normalizeOrderedStringList(order);
  const scopedGroups = visibleGroups.filter((candidate) => candidate.repoPath === group.repoPath);
  const nextToken = sidebarGroupOrderToken(group);
  const normalizedOrder = migrateScopedGroupOrderToIds(order, scopedGroups);
  if (normalizedOrder.includes(nextToken)) return normalizedOrder;

  const missingAncestorTokens = targetGroup
    .split('/')
    .map((_, index, parts) => parts.slice(0, index + 1).join('/'))
    .slice(0, -1)
    .map((name) => scopedGroups.find((candidate) => candidate.name === name))
    .filter((candidate): candidate is McpGroupSummary => Boolean(candidate))
    .map(sidebarGroupOrderToken)
    .filter((token) => token && !normalizedOrder.includes(token));
  const tokensToInsert = normalizeOrderedStringList([...missingAncestorTokens, nextToken]);
  const visibleTokens = normalizeOrderedStringList(scopedGroups.map(sidebarGroupOrderToken));
  const visibleTokenSet = new Set(visibleTokens);
  const hiddenTokens = normalizedOrder.filter((token) => !visibleTokenSet.has(token));
  const visibleOrder = normalizeOrderedStringList([
    ...normalizedOrder.filter((token) => visibleTokenSet.has(token)),
    ...visibleTokens.filter((token) => !normalizedOrder.includes(token)),
  ]);
  const siblingTokenSet = new Set(
    scopedGroups.filter((entry) => entry.parentId === group.parentId).map(sidebarGroupOrderToken),
  );
  const siblingIndex = visibleOrder.findIndex((token) => siblingTokenSet.has(token));
  if (siblingIndex >= 0) {
    const nextVisibleOrder = visibleOrder.slice();
    nextVisibleOrder.splice(siblingIndex, 0, ...tokensToInsert);
    return normalizeOrderedStringList([...nextVisibleOrder, ...hiddenTokens]);
  }
  if (group.parentId) {
    const parent = scopedGroups.find((candidate) => candidate.id === group.parentId);
    const parentIndex = parent ? visibleOrder.indexOf(sidebarGroupOrderToken(parent)) : -1;
    if (parentIndex >= 0) {
      const nextVisibleOrder = visibleOrder.slice();
      nextVisibleOrder.splice(parentIndex + 1, 0, ...tokensToInsert);
      return normalizeOrderedStringList([...nextVisibleOrder, ...hiddenTokens]);
    }
  }
  return normalizeOrderedStringList([...tokensToInsert, ...visibleOrder, ...hiddenTokens]);
}

async function readUiPreferences(services: HubServices) {
  const response = await services.settings.uiPreferences.read();
  return {
    uiPreferences: normalizeUiPreferences(response?.uiPreferences),
    version:
      Number.isSafeInteger(response?.version) && Number(response.version) > 0
        ? Number(response.version)
        : response?.version === null
          ? null
          : undefined,
  };
}

async function writeUiPreferences(
  uiPreferences: unknown,
  expectedVersion: number | null | undefined,
  services: HubServices,
) {
  const normalized = normalizeUiPreferences(uiPreferences);
  const response = await services.settings.uiPreferences.update({
    uiPreferences: normalized,
    expectedVersion,
    notificationMode: 'sidebar-snapshot',
  });
  return normalizeUiPreferences(response?.uiPreferences);
}

async function updateUiPreferences(
  update: (
    current: ReturnType<typeof normalizeUiPreferences>,
  ) => ReturnType<typeof normalizeUiPreferences>,
  services: HubServices,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readUiPreferences(services);
    try {
      return await writeUiPreferences(update(current.uiPreferences), current.version, services);
    } catch (error: any) {
      if ((error?.status !== 409 && error?.statusCode !== 409) || attempt === 3) throw error;
    }
  }
  throw new Error('Failed to update UI preferences');
}

type McpChatListEntry = {
  name: string;
  resourceId?: string;
  draft?: true;
};

type McpChatTreeSnapshot = {
  drone: {
    id: string;
    name: string;
    repoPath: string;
  };
  chats: McpChatListEntry[];
  tree: SidebarChatTreeModel;
};

function normalizeMcpChatList(response: any): McpChatListEntry[] {
  const draftByChat: Record<string, boolean> =
    response?.draftChats &&
    typeof response.draftChats === 'object' &&
    !Array.isArray(response.draftChats)
      ? Object.fromEntries(
          Object.entries(response.draftChats)
            .map(([name, draft]) => [cleanString(name), draft === true] as const)
            .filter(([name, draft]) => Boolean(name) && draft),
        )
      : {};
  const chatIdByName = Object.fromEntries(
    (Array.isArray(response?.chatDetails) ? response.chatDetails : [])
      .map(
        (item: any) => [cleanString(item?.chat ?? item?.name), cleanString(item?.chatId)] as const,
      )
      .filter(([name, id]: readonly [string, string]) => Boolean(name && id)),
  );
  for (const item of Array.isArray(response?.chatDetails) ? response.chatDetails : []) {
    const name = cleanString(item?.chat ?? item?.name);
    if (name && item?.draft === true) draftByChat[name] = true;
  }
  return (Array.isArray(response?.chats) ? response.chats : [])
    .map((item: any) => {
      const name =
        typeof item === 'string' ? cleanString(item) : cleanString(item?.chat ?? item?.name);
      if (!name) return null;
      const resourceId =
        (typeof item === 'object' ? cleanString(item?.chatId ?? item?.id) : '') ||
        chatIdByName[name];
      return {
        name,
        ...(resourceId ? { resourceId } : {}),
        ...((typeof item === 'object' && item?.draft === true) || draftByChat[name]
          ? { draft: true as const }
          : {}),
      };
    })
    .filter((entry: McpChatListEntry | null): entry is McpChatListEntry => Boolean(entry));
}

async function readMcpChatTreeSnapshot(
  droneRef: string,
  services: HubServices,
): Promise<McpChatTreeSnapshot> {
  const [resolved] = await resolveDroneRefs([droneRef]);
  if (!resolved?.found) throw new Error(`unknown drone: ${droneRef}`);
  const [response, preferences] = await Promise.all([
    requestJson(`/api/drones/${encodeURIComponent(resolved.id)}/chats`, { method: 'GET' }),
    readUiPreferences(services),
  ]);
  const listedChats = normalizeMcpChatList(response);
  const chatByName = new Map(listedChats.map((chat) => [chat.name, chat]));
  const orderedNames = normalizeOrderedStringList([
    ...(preferences.uiPreferences.sidebarChatOrderByDrone[resolved.id] ?? []),
    ...listedChats.map((chat) => chat.name),
  ]).filter((name) => chatByName.has(name));
  const chats = orderedNames.map((name) => chatByName.get(name)!);
  const tree = buildSidebarChatTree({
    droneId: resolved.id,
    chatNames: chats.map((chat) => chat.name),
    groupPaths: preferences.uiPreferences.sidebarChatGroupPathsByDrone[resolved.id] ?? [],
    groupByChat: preferences.uiPreferences.sidebarChatGroupByChat,
    nodeOrderByParent: preferences.uiPreferences.sidebarChatNodeOrderByParent,
  });
  return {
    drone: {
      id: resolved.id,
      name: resolved.name,
      repoPath: resolved.repoPath,
    },
    chats,
    tree,
  };
}

function serializeMcpChatTree(snapshot: McpChatTreeSnapshot) {
  const chatByName = new Map(snapshot.chats.map((chat) => [chat.name, chat]));
  const serializeNode = (nodeId: string): any => {
    const node = snapshot.tree.nodesById[nodeId];
    if (!node) return null;
    if (node.kind === 'chat') {
      const chat = chatByName.get(node.chatName);
      return {
        kind: 'chat',
        name: node.chatName,
        ...(chat?.resourceId ? { resourceId: chat.resourceId } : {}),
        ...(chat?.draft ? { draft: true } : {}),
      };
    }
    return {
      kind: 'group',
      name: node.label,
      path: node.path,
      children: (snapshot.tree.childIdsByParent[node.id] ?? []).map(serializeNode).filter(Boolean),
    };
  };
  return snapshot.tree.rootChildIds.map(serializeNode).filter(Boolean);
}

async function applyMcpChatTreeIntent(intent: SidebarMoveIntent, services: HubServices) {
  return updateUiPreferences((current) => {
    const nextLayout = applySidebarMove(normalizeSidebarLayout(current), intent);
    return normalizeUiPreferences({
      ...current,
      ...sidebarLayoutPatch(nextLayout, intent),
    });
  }, services);
}

function requireChatGroupPath(value: unknown, fieldName: string): string {
  const path = normalizeSidebarChatGroupPath(value);
  if (!path) throw new Error(`${fieldName} is required`);
  return path;
}

function findMcpChatTreeAnchor(args: {
  snapshot: McpChatTreeSnapshot;
  targetPath: string;
  beforeChat?: unknown;
  afterChat?: unknown;
  beforeGroup?: unknown;
  afterGroup?: unknown;
}) {
  const anchors = [
    { value: cleanString(args.beforeChat), kind: 'chat' as const, placement: 'before' as const },
    { value: cleanString(args.afterChat), kind: 'chat' as const, placement: 'after' as const },
    {
      value: normalizeSidebarChatGroupPath(args.beforeGroup),
      kind: 'group' as const,
      placement: 'before' as const,
    },
    {
      value: normalizeSidebarChatGroupPath(args.afterGroup),
      kind: 'group' as const,
      placement: 'after' as const,
    },
  ].filter((anchor) => anchor.value);
  if (anchors.length > 1) {
    throw new Error('use only one of beforeChat, afterChat, beforeGroup, or afterGroup');
  }
  if (anchors.length === 0) return { overNodeId: undefined, placement: 'inside' as const };
  const anchor = anchors[0]!;
  const overNodeId =
    anchor.kind === 'chat'
      ? sidebarChatNodeId(args.snapshot.drone.id, anchor.value)
      : sidebarChatGroupNodeId(args.snapshot.drone.id, anchor.value);
  const node = args.snapshot.tree.nodesById[overNodeId];
  if (!node) throw new Error(`unknown ${anchor.kind}: ${anchor.value}`);
  const targetParentId = args.targetPath
    ? sidebarChatGroupNodeId(args.snapshot.drone.id, args.targetPath)
    : args.snapshot.tree.rootId;
  if (node.parentId !== targetParentId) {
    throw new Error(`${anchor.kind} is not directly inside the target group: ${anchor.value}`);
  }
  return { overNodeId, placement: anchor.placement };
}

function buildMcpChatTreeMoveIntent(args: {
  snapshot: McpChatTreeSnapshot;
  itemKind: 'chat' | 'folder';
  activeNodeIds: string[];
  targetGroup?: unknown;
  beforeChat?: unknown;
  afterChat?: unknown;
  beforeGroup?: unknown;
  afterGroup?: unknown;
}): SidebarMoveIntent {
  const { snapshot } = args;
  const activeNodeId = args.activeNodeIds[0]!;
  const activeNode = snapshot.tree.nodesById[activeNodeId];
  if (!activeNode) throw new Error('the item to move does not exist');
  const targetPath = normalizeSidebarChatGroupPath(args.targetGroup);
  if (
    targetPath &&
    !snapshot.tree.nodesById[sidebarChatGroupNodeId(snapshot.drone.id, targetPath)]
  ) {
    throw new Error(`unknown chat group: ${targetPath}`);
  }
  if (args.itemKind === 'folder' && activeNode.kind === 'folder') {
    if (targetPath && isSameOrDescendantSidebarChatGroupPath(targetPath, activeNode.path)) {
      throw new Error(`cannot move chat group ${activeNode.path} into itself or its descendant`);
    }
    const nextPath = normalizeSidebarChatGroupPath(
      [targetPath, sidebarChatGroupBaseName(activeNode.path)].filter(Boolean).join('/'),
    );
    if (
      nextPath !== activeNode.path &&
      snapshot.tree.nodesById[sidebarChatGroupNodeId(snapshot.drone.id, nextPath)]
    ) {
      throw new Error(`chat group already exists: ${nextPath}`);
    }
  }
  const sourcePath =
    activeNode.kind === 'chat'
      ? normalizeSidebarChatGroupPath(
          activeNode.parentId === snapshot.tree.rootId
            ? ''
            : (snapshot.tree.nodesById[activeNode.parentId] as any)?.path,
        )
      : normalizeSidebarChatGroupPath(sidebarChatGroupParentPath(activeNode.path));
  const sourceParentId = activeNode.parentId;
  const targetParentId = targetPath
    ? sidebarChatGroupNodeId(snapshot.drone.id, targetPath)
    : snapshot.tree.rootId;
  const anchor = findMcpChatTreeAnchor({ ...args, targetPath });
  if (anchor.overNodeId && args.activeNodeIds.includes(anchor.overNodeId)) {
    throw new Error('cannot position an item relative to itself');
  }
  return {
    kind: 'chat-tree-move',
    droneId: snapshot.drone.id,
    itemKind: args.itemKind,
    activeNodeId,
    ...(args.itemKind === 'chat' ? { activeNodeIds: args.activeNodeIds } : {}),
    sourcePath: sourcePath || null,
    sourceSiblingNodeIds: snapshot.tree.childIdsByParent[sourceParentId] ?? [],
    targetPath: targetPath || null,
    targetSiblingNodeIds: snapshot.tree.childIdsByParent[targetParentId] ?? [],
    ...(anchor.overNodeId ? { overNodeId: anchor.overNodeId } : {}),
    placement: anchor.placement,
  };
}

async function listGroups(
  repoPath: string | undefined,
  services: HubServices,
): Promise<McpGroupSummary[]> {
  const response = await services.groups.list(repoPath);
  return Array.isArray(response?.groups)
    ? response.groups
        .map((group: any) => normalizeGroupSummary(group))
        .filter((group: McpGroupSummary | null): group is McpGroupSummary => Boolean(group))
    : [];
}

async function insertNewGroupsAtParentTop(
  targetGroups: McpGroupSummary[],
  beforeGroups: McpGroupSummary[],
  afterGroups: McpGroupSummary[],
  services: HubServices,
) {
  const beforeIds = new Set(beforeGroups.map((group) => group.id).filter(Boolean));
  const beforeScopesAndNames = new Set(
    beforeGroups.map((group) => `${group.repoPath}\0${group.name}`),
  );
  const newGroups = targetGroups.filter((group) =>
    group.id
      ? !beforeIds.has(group.id)
      : !beforeScopesAndNames.has(`${group.repoPath}\0${group.name}`),
  );
  if (newGroups.length === 0) return { updated: false, groups: targetGroups };
  const droneResponse = await requestDroneSummaries();
  const sidebarDrones = Array.isArray(droneResponse?.drones)
    ? droneResponse.drones
        .filter((drone: any) => !isWorkflowChildDroneEntry(drone))
        .map(droneSummary)
    : [];
  const saved = await updateUiPreferences((uiPreferences) => {
    let sidebarGroupOrder = uiPreferences.sidebarGroupOrder;
    let sidebarNodeOrderByParent = uiPreferences.sidebarNodeOrderByParent;
    for (const group of newGroups) {
      sidebarGroupOrder = insertGroupTokenAtParentTop(sidebarGroupOrder, afterGroups, group);
      sidebarNodeOrderByParent = placeMcpRepoScopedGroupNodeAtTop({
        nodeOrderByParent: sidebarNodeOrderByParent,
        groupOrder: sidebarGroupOrder,
        droneOrderByGroup: uiPreferences.sidebarDroneOrderByGroup,
        groups: afterGroups,
        drones: sidebarDrones,
        group,
      });
    }
    return {
      ...uiPreferences,
      sidebarGroupOrder,
      sidebarNodeOrderByParent,
    };
  }, services);
  return { updated: true, groups: targetGroups, sidebarGroupOrder: saved.sidebarGroupOrder };
}

async function reorderDronesInUiPreferences(args: any, services: HubServices) {
  const refs = normalizeOrderedStringList(args?.drones);
  if (refs.length === 0) throw new Error('drones is required');
  if (cleanString(args?.beforeDrone) && cleanString(args?.afterDrone))
    throw new Error('use either beforeDrone or afterDrone, not both');
  if (cleanString(args?.group) && cleanString(args?.groupId))
    throw new Error('use either group or groupId, not both');

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

  const repoPaths = [...new Set(movingDrones.map((drone: any) => cleanString(drone.repoPath)))];
  if (repoPaths.length !== 1)
    throw new Error('all reordered drones must belong to the same repository');
  const inferredRepoPath = repoPaths[0] ?? '';
  const requestedRepoPath =
    args?.repoPath === undefined ? inferredRepoPath : cleanString(args.repoPath);
  if (requestedRepoPath !== inferredRepoPath)
    throw new Error('repoPath does not match the reordered drones');
  const targetGroup = normalizeGroupForOrder(args?.group);
  const requestedGroupId = cleanString(args?.groupId);
  const groups =
    requestedGroupId || targetGroup !== 'Ungrouped' ? await listGroups(undefined, services) : [];
  const groupRecord = requestedGroupId
    ? groups.find((group) => group.id === requestedGroupId)
    : groups.find((group) => group.repoPath === requestedRepoPath && group.name === targetGroup);
  if (requestedGroupId && !groupRecord) throw new Error(`unknown group: ${requestedGroupId}`);
  if (groupRecord && groupRecord.repoPath !== requestedRepoPath)
    throw new Error('group belongs to a different repository');
  if (targetGroup !== 'Ungrouped' && !groupRecord) {
    throw new Error(`unknown group in repository ${requestedRepoPath || '(none)'}: ${targetGroup}`);
  }
  const effectiveGroupName = groupRecord?.name ?? targetGroup;
  const effectiveGroupId = groupRecord?.id ?? '';
  const scopeDrones = allDrones.filter(
    (drone: any) =>
      cleanString(drone.repoPath) === requestedRepoPath &&
      (effectiveGroupId
        ? cleanString(drone.groupId) === effectiveGroupId
        : normalizeGroupForOrder(drone.group) === effectiveGroupName),
  );
  const scopeIds = scopeDrones.map((drone: any) => drone.id).filter(Boolean);
  for (const drone of movingDrones) {
    const belongsToGroup = effectiveGroupId
      ? cleanString(drone.groupId) === effectiveGroupId
      : normalizeGroupForOrder(drone.group) === effectiveGroupName;
    if (!belongsToGroup)
      throw new Error(`drone is not in group ${effectiveGroupName}: ${drone.name || drone.id}`);
  }

  const beforeDrone = cleanString(args?.beforeDrone)
    ? refToDrone.get(cleanString(args.beforeDrone))
    : null;
  const afterDrone = cleanString(args?.afterDrone)
    ? refToDrone.get(cleanString(args.afterDrone))
    : null;
  if (cleanString(args?.beforeDrone) && !beforeDrone)
    throw new Error(`unknown beforeDrone: ${args.beforeDrone}`);
  if (cleanString(args?.afterDrone) && !afterDrone)
    throw new Error(`unknown afterDrone: ${args.afterDrone}`);
  if (beforeDrone && !scopeIds.includes(beforeDrone.id))
    throw new Error(`beforeDrone is not in the selected repository group: ${args.beforeDrone}`);
  if (afterDrone && !scopeIds.includes(afterDrone.id))
    throw new Error(`afterDrone is not in the selected repository group: ${args.afterDrone}`);

  const movingIds = movingDrones.map((drone: any) => drone.id).filter(Boolean);
  const beforeId = beforeDrone?.id || '';
  const afterId = afterDrone?.id || '';
  const groupOrderKey = groupRecord
    ? sidebarGroupOrderToken(groupRecord)
    : sidebarGroupOrderToken(effectiveGroupName);
  const repoGroupPath = `repo:${requestedRepoPath}`;
  let parentId = '';
  const saved = await updateUiPreferences((uiPreferences) => {
    parentId =
      uiPreferences.sidebarGroupingMode === 'repos'
        ? effectiveGroupName === 'Ungrouped'
          ? sidebarFolderNodeId(repoGroupPath)
          : sidebarFolderNodeId(`repo-scope:${repoGroupPath}:${effectiveGroupName}`)
        : effectiveGroupName === 'Ungrouped'
          ? 'root'
          : sidebarFolderNodeId(effectiveGroupName);
    return {
      ...uiPreferences,
      sidebarDroneOrderByGroup: {
        ...uiPreferences.sidebarDroneOrderByGroup,
        [groupOrderKey]: reorderVisibleEntries(
          uiPreferences.sidebarDroneOrderByGroup[groupOrderKey] ?? [],
          scopeIds,
          movingIds,
          beforeId,
          afterId,
        ),
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
  }, services);
  return {
    ok: true,
    group: effectiveGroupName,
    groupId: effectiveGroupId || null,
    repoPath: requestedRepoPath,
    drones: movingDrones.map((drone: any) => ({ id: drone.id, name: drone.name })),
    sidebarDroneOrder: saved.sidebarDroneOrderByGroup[groupOrderKey] ?? [],
    sidebarNodeOrder: saved.sidebarNodeOrderByParent[parentId] ?? [],
  };
}

function normalizeRenameRequests(args: any = {}) {
  const rawRenames = Array.isArray(args.renames) ? args.renames : [];
  const fallbackDrone = cleanString(args.drone || args.droneId || args.id);
  const fallbackNewName = cleanString(args.newName || args.nextName || args.name);
  const source =
    rawRenames.length > 0
      ? rawRenames
      : fallbackDrone && fallbackNewName
        ? [{ drone: fallbackDrone, newName: fallbackNewName }]
        : [];
  const seen = new Set<string>();
  return source
    .map((item: any) => {
      const explicitDrone = cleanString(item?.drone || item?.droneId || item?.id);
      const explicitNewName = cleanString(item?.newName || item?.nextName);
      const name = cleanString(item?.name);
      const drone = explicitDrone || (explicitNewName ? name : '');
      const newName = explicitNewName || (explicitDrone ? name : '');
      return { drone, newName };
    })
    .filter((item: any) => {
      if (!item.drone || !item.newName || seen.has(item.drone)) return false;
      seen.add(item.drone);
      return true;
    });
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

async function createDronePreferences(services: HubServices, repoPath = '') {
  try {
    const response = await services.settings.uiPreferences.read();
    const prefs: any =
      response?.uiPreferences && typeof response.uiPreferences === 'object'
        ? response.uiPreferences
        : {};
    const byRepo: any =
      prefs.spawnContextByRepoKey && typeof prefs.spawnContextByRepoKey === 'object'
        ? prefs.spawnContextByRepoKey
        : {};
    const repoPrefsRaw = repoPath ? byRepo[repoPath] : byRepo.__no_repo__;
    const fallbackPrefsRaw = byRepo.__no_repo__;
    const repoPrefs =
      repoPrefsRaw && typeof repoPrefsRaw === 'object'
        ? repoPrefsRaw
        : fallbackPrefsRaw && typeof fallbackPrefsRaw === 'object'
          ? fallbackPrefsRaw
          : {};
    const merged = { ...prefs, ...repoPrefs };
    return {
      spawnAgentKey: cleanString(merged.spawnAgentKey, 'builtin:cursor'),
      spawnModel: cleanString(merged.spawnModel),
      spawnReasoning: cleanString(merged.spawnReasoning),
      spawnAgentPermissionMode:
        merged.spawnAgentPermissionMode === 'read' || merged.spawnAgentPermissionMode === 'write'
          ? merged.spawnAgentPermissionMode
          : ('execute' as const),
      spawnApprovalPolicy:
        merged.spawnApprovalPolicy === 'auto' || merged.spawnApprovalPolicy === 'none'
          ? merged.spawnApprovalPolicy
          : ('ask' as const),
      repoBranchSource: normalizeRepoBranchSource(merged.repoBranchSource, 'host'),
      repoCreateRemoteBranch: cleanString(merged.repoCreateRemoteBranch),
      source: response?.updatedAt ? 'drone_hub_ui_preferences' : 'default',
      updatedAt: cleanIsoTimestamp(response?.updatedAt),
    };
  } catch (error: any) {
    return {
      spawnAgentKey: 'builtin:cursor',
      spawnModel: '',
      spawnReasoning: '',
      spawnAgentPermissionMode: 'execute' as const,
      spawnApprovalPolicy: 'ask' as const,
      repoBranchSource: 'host' as const,
      repoCreateRemoteBranch: '',
      source: 'default',
      updatedAt: null,
      warning: error?.message || String(error),
    };
  }
}

async function requireRemoteBranchAvailableForRepo(
  repoPath: string,
  remoteBranch: string,
  source: 'default' | 'explicit',
) {
  const normalizedRemoteBranch = cleanString(remoteBranch)
    .replace(/^refs\/remotes\//, '')
    .replace(/^remotes\//, '');
  if (!repoPath || !normalizedRemoteBranch) return normalizedRemoteBranch;
  const data = await requestJson(`/api/repos/branches?repoPath=${encodeURIComponent(repoPath)}`, {
    method: 'GET',
  });
  const branches = Array.isArray(data?.remoteBranches) ? data.remoteBranches : [];
  if (branches.some((entry: any) => cleanString(entry?.name) === normalizedRemoteBranch))
    return normalizedRemoteBranch;
  throw new Error(
    `${source === 'default' ? 'Saved default remote branch' : 'Remote branch'} "${normalizedRemoteBranch}" is not available for repo ${repoPath}.`,
  );
}

function agentFromPreferenceKey(value: string) {
  return normalizeAgent(String(value || '').replace(/^builtin:/, ''));
}

function chatAgentFromPreferenceKey(value: string): McpConfigurableChatAgent | null {
  const key = String(value || '').trim();
  if (key === 'native') return { kind: 'native' };
  if (key.startsWith('custom:')) {
    throw new Error(
      'The last-used custom agent is local to the Drone Hub UI and cannot be resolved by MCP. Pass agent explicitly.',
    );
  }
  return normalizeConfigurableChatAgent(key.replace(/^builtin:/, ''));
}

type McpToolRegistrationContext = {
  principal: McpTokenIdentity;
  allowedWriteDroneRefs?: string[];
  allowedDroneIds?: string[];
  nativeThreadId?: string;
  speechEnabled?: boolean;
  onSpeechToolRegistered?: (tool: RegisteredTool) => void;
  hubServices: HubServices;
};

function chatPrincipal(
  context: McpToolRegistrationContext,
): Extract<McpTokenIdentity, { kind: 'chat' }> | null {
  return context.principal.kind === 'chat' ? context.principal : null;
}

function subscriptionSubscriber(context: McpToolRegistrationContext) {
  const principal = chatPrincipal(context);
  if (!principal) {
    throw new Error('resource subscriptions require a DroneHub conversation identity');
  }
  return {
    chatId: principal.chatId,
    droneId: principal.droneId,
    chatName: principal.chatName,
  };
}

function mcpSubscription(value: any): any {
  if (!value || typeof value !== 'object') return value;
  const { cursor: _cursor, subscriber: _subscriber, ...subscription } = value;
  return subscription;
}

async function authorizeChatSubscriptionResource(
  context: McpToolRegistrationContext,
  resourceId: string,
): Promise<void> {
  const principal = chatPrincipal(context);
  if (!principal) return;
  const response = await requestJson(
    `/api/resource-subscriptions/chat-resource/${encodeURIComponent(resourceId)}`,
    { method: 'GET' },
  );
  const droneId = cleanString(response?.resource?.droneId);
  if (
    !droneId ||
    !mcpChatAccessAllowsDrone(principal.accessScope, 'read', droneId, principal.selectedDroneRefs)
  ) {
    throw new Error('MCP principal is not authorized for the requested chat resource');
  }
}

async function authorizeChangeRequestSubscriptionResource(
  context: McpToolRegistrationContext,
  resourceId: string,
): Promise<void> {
  const principal = chatPrincipal(context);
  if (!principal) return;
  const requestNumber = normalizeChangeRequestSubscriptionId(resourceId);
  const response = await requestJson(`/api/change-requests/${encodeURIComponent(requestNumber)}`, {
    method: 'GET',
  });
  const droneId = cleanString(response?.request?.droneId);
  if (
    !droneId ||
    !mcpChatAccessAllowsDrone(principal.accessScope, 'read', droneId, principal.selectedDroneRefs)
  ) {
    throw new Error('MCP principal is not authorized for the requested change request');
  }
}

async function requireContainerDroneForManagedChat(
  context: McpToolRegistrationContext,
  droneRefRaw: unknown,
  operation: string,
): Promise<string | null> {
  const principal = chatPrincipal(context);
  if (!principal) return null;
  const droneRef = cleanString(droneRefRaw);
  const response = await requestDroneSummaries();
  const drone = (Array.isArray(response?.drones) ? response.drones : []).find(
    (candidate: any) =>
      cleanString(candidate?.id) === droneRef || cleanString(candidate?.name) === droneRef,
  );
  if (!drone) throw new Error(`unknown drone: ${droneRef}`);
  const runtime = cleanString(drone?.runtime, 'container').toLowerCase();
  if (runtime !== 'container') {
    throw new Error(
      `Managed chats cannot ${operation} on host-runtime drone ${cleanString(drone?.name, droneRef)}`,
    );
  }
  return cleanString(drone?.id, droneRef);
}

async function grantCreatedDroneAccessToManagedChat(
  context: McpToolRegistrationContext,
  createdDrone: any,
): Promise<any | null> {
  const principal = chatPrincipal(context);
  if (!principal) return null;
  const droneId = cleanString(createdDrone?.id || createdDrone?.name);
  if (!droneId) throw new Error('created drone response did not include an id or name');
  const hasSelectedMode =
    principal.accessScope.readMode === 'selected' ||
    principal.accessScope.writeMode === 'selected' ||
    principal.accessScope.executeMode === 'selected';
  if (!hasSelectedMode) return principal.accessScope;
  const response = context.nativeThreadId
    ? await requestJson('/api/assistant/scope', {
        method: 'POST',
        body: JSON.stringify({
          threadId: context.nativeThreadId,
          addDroneIds: [droneId],
        }),
      })
    : await requestJson(
        `/api/drones/${encodeURIComponent(principal.droneId)}/chats/${encodeURIComponent(principal.chatName)}/mcp-access`,
        {
          method: 'PUT',
          body: JSON.stringify({ addDroneIds: [droneId] }),
        },
      );
  const persistedAccessScope =
    response?.accessScope &&
    typeof response.accessScope === 'object' &&
    !Array.isArray(response.accessScope)
      ? response.accessScope
      : null;
  if (!persistedAccessScope) {
    throw new Error('Drone Hub access grant response did not include an access scope');
  }
  const persistedDroneIds = Array.isArray(persistedAccessScope.droneIds)
    ? persistedAccessScope.droneIds.map((value: unknown) => cleanString(value)).filter(Boolean)
    : [];
  if (!persistedDroneIds.includes(droneId)) {
    throw new Error(`Drone Hub access grant did not persist created drone ${droneId}`);
  }
  const latestPrincipal = chatPrincipal(context) ?? principal;
  const confirmedDroneIds = [
    ...new Set([...latestPrincipal.accessScope.droneIds, ...persistedDroneIds]),
  ];
  const accessScope = {
    // Additive grants must not replace the current principal's access modes.
    // A delayed response may contain an older, broader policy snapshot.
    ...latestPrincipal.accessScope,
    droneIds: confirmedDroneIds,
  };
  context.principal = {
    ...latestPrincipal,
    accessScope,
    selectedDroneRefs: [
      ...new Set(
        [...latestPrincipal.selectedDroneRefs, droneId, cleanString(createdDrone?.name)].filter(
          Boolean,
        ),
      ),
    ],
  };
  return accessScope;
}

async function grantCreatedDroneAccessBestEffort(
  context: McpToolRegistrationContext,
  createdDrone: any,
): Promise<{ accessScope: any | null; accessGrantError: string | null }> {
  if (!chatPrincipal(context)) return { accessScope: null, accessGrantError: null };
  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return {
        accessScope: await grantCreatedDroneAccessToManagedChat(context, createdDrone),
        accessGrantError: null,
      };
    } catch (error: any) {
      lastError = error;
    }
  }
  return {
    accessScope: null,
    accessGrantError: lastError?.message || String(lastError),
  };
}

function registerTools(server: McpServer, context: McpToolRegistrationContext) {
  server.registerTool(
    'ask_questions',
    {
      title: 'Ask the user questions',
      description:
        'Pause this Drone Hub chat and ask the user one or more multiple-choice questions. Preserve question order. Each question may include an optional detailedExplanation with background, constraints, or the problem being decided, plus an optional importance integer from 1 to 100 that defaults to 50; importance never changes order. Mark at most one choice recommended=true per question. A recommended choice is preselected. Drone Hub always offers a custom-answer field and an explicit skip action for every question, so do not add an Other, Custom, None, or Skip choice yourself. The user may accept a choice, enter a custom answer, explicitly skip individual questions, add overall notes, or skip the whole request. If any message is queued for this chat, the request is automatically skipped and the queued message proceeds normally. Prefer a small focused set even though up to 99 questions are supported.',
      inputSchema: {
        questions: z
          .array(
            z.object({
              id: z.string().min(1).max(120),
              question: z.string().min(1).max(1_000),
              detailedExplanation: z.string().max(4_000).optional(),
              importance: z.number().int().min(1).max(100).optional().default(50),
              choices: z
                .array(
                  z.object({
                    id: z.string().min(1).max(120),
                    label: z.string().min(1).max(240),
                    description: z.string().max(1_000).optional(),
                    recommended: z.boolean().optional(),
                  }),
                )
                .min(2)
                .max(12),
            }),
          )
          .min(1)
          .max(99),
        _blip: z
          .object({
            sessionId: z.string().optional(),
            toolCallId: z.string().optional(),
          })
          .optional(),
      },
    },
    async (args, extra) => {
      const conversation = chatPrincipal(context);
      if (!conversation) {
        throw new Error('ask_questions requires a Drone Hub chat connection');
      }
      const result = await context.hubServices.questions.ask(
        {
          droneId: conversation.droneId,
          chatName: conversation.chatName,
          chatId: conversation.chatId,
          ...(context.nativeThreadId ? { nativeThreadId: context.nativeThreadId } : {}),
          ...(args._blip?.toolCallId ? { toolCallId: args._blip.toolCallId } : {}),
          toolName: 'drone_hub__ask_questions',
          questions: args.questions,
        },
        extra.signal,
      );
      return toolResult(result);
    },
  );

  server.registerTool(
    'list_drones',
    {
      title: 'List drones',
      description:
        'List local Drone Hub drones, optionally filtered by repository, canonical group id, group name, or drone names.',
      inputSchema: {
        repoPath: z.string().optional(),
        groupId: z.string().optional(),
        group: z.string().optional(),
        names: z.array(z.string()).optional(),
        limit: z.number().optional(),
      },
    },
    async (args) => {
      const response = await requestDroneSummaries();
      const wantedNames = new Set(
        (args.names ?? []).map((item) => cleanString(item)).filter(Boolean),
      );
      const repoPath = args.repoPath === undefined ? null : cleanString(args.repoPath);
      const groupId = cleanString(args.groupId);
      const group = cleanString(args.group);
      const limit = cleanPositiveInt(args.limit, 50, 200);
      let drones = Array.isArray(response?.drones)
        ? response.drones
            .filter((drone: any) => !isWorkflowChildDroneEntry(drone))
            .map(droneSummary)
        : [];
      if (repoPath !== null)
        drones = drones.filter((drone: any) => cleanString(drone.repoPath) === repoPath);
      if (groupId) drones = drones.filter((drone: any) => drone.groupId === groupId);
      if (group) drones = drones.filter((drone: any) => drone.group === group);
      if (wantedNames.size > 0)
        drones = drones.filter(
          (drone: any) => wantedNames.has(drone.id) || wantedNames.has(drone.name),
        );
      drones.sort(compareDronesByRecentActivity);
      return toolResult({ ok: true, count: drones.length, drones: drones.slice(0, limit) });
    },
  );

  server.registerTool(
    'list_repos',
    {
      title: 'List repos',
      description: 'List repos registered in Drone Hub.',
      inputSchema: {},
    },
    async () => {
      const repos = await requestRepoSummaries(context.hubServices);
      const response = await requestDroneSummaries();
      const droneCounts = new Map<string, number>();
      for (const raw of Array.isArray(response?.drones) ? response.drones : []) {
        if (isWorkflowChildDroneEntry(raw)) continue;
        const repoPath = cleanString(raw?.repoPath);
        if (repoPath) droneCounts.set(repoPath, (droneCounts.get(repoPath) ?? 0) + 1);
      }
      return toolResult({
        ok: true,
        count: repos.length,
        repos: repos.map((repo: any) => ({
          ...repo,
          droneCount: droneCounts.get(cleanString(repo.path)) ?? 0,
        })),
      });
    },
  );

  server.registerTool(
    'list_agent_models',
    {
      title: 'List agent models',
      description:
        'List models available to a Drone Hub agent. Each model includes its supported reasoningLevels and defaultReasoningLevel when the agent reports them. For agent="native", provider may select the Built-in OpenAI, Codex, or Gemini catalog. Container discovery reflects agents installed in Drone Hub drones; host discovery reflects agents installed on the Hub host. Use refresh only when a cached catalog may be stale.',
      inputSchema: {
        agent: z.enum(['native', 'cursor', 'codex', 'claude', 'opencode', 'pi', 'blip']),
        provider: z.enum(['openai', 'codex', 'gemini']).optional(),
        runtime: z.enum(['container', 'host']).optional(),
        refresh: z.boolean().optional(),
      },
    },
    async (args) => {
      const agent = normalizeConfigurableChatAgent(args.agent);
      if (!agent) throw new Error(`unsupported agent: ${args.agent}`);
      const agentId = agent.kind === 'native' ? 'native' : agent.id;
      if (args.provider != null && agent.kind !== 'native') {
        throw new Error(
          'provider is only available with agent="native" (the Drone Hub Built-in agent)',
        );
      }
      const runtime = args.runtime ?? 'container';
      const query = new URLSearchParams({ agent: agentId, runtime });
      if (args.provider) query.set('provider', args.provider);
      if (args.refresh === true) query.set('refresh', '1');
      const response = await requestJson(`/api/model-catalog?${query.toString()}`, {
        method: 'GET',
      });
      return toolResult({
        ok: true,
        agent: agentId,
        runtime,
        models: Array.isArray(response?.models) ? response.models : [],
        source: cleanString(response?.source) || 'none',
        ...(response?.provider ? { provider: response.provider } : {}),
        ...(response?.defaultModel ? { defaultModel: response.defaultModel } : {}),
        ...(response?.discoveredAt ? { discoveredAt: response.discoveredAt } : {}),
        ...(response?.stale === true ? { stale: true } : {}),
        ...(response?.error ? { error: cleanString(response.error) } : {}),
      });
    },
  );

  server.registerTool(
    'search_chat_messages',
    {
      title: 'Search chat messages',
      description:
        'Keyword-search visible user, assistant, and error text across active Drone Hub chats. Archived chats are excluded.',
      inputSchema: {
        query: z.string().max(500),
        repoPath: z.string().max(4096).optional(),
        droneId: z.string().max(200).optional(),
        chatName: z.string().max(200).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async (args) => {
      const response = await requestDroneSummaries();
      let drones = Array.isArray(response?.drones)
        ? response.drones
            .filter((drone: any) => !isWorkflowChildDroneEntry(drone))
            .map(droneSummary)
        : [];
      if (context.allowedDroneIds) {
        const allowedIds = new Set(context.allowedDroneIds.map((id) => cleanString(id)));
        drones = drones.filter((drone: any) => allowedIds.has(cleanString(drone.id)));
      }
      const principal = chatPrincipal(context);
      if (principal?.accessScope.readMode === 'selected') {
        drones = drones.filter((drone: any) =>
          mcpChatAccessAllowsDrone(
            principal.accessScope,
            'read',
            cleanString(drone.id),
            principal.selectedDroneRefs,
          ),
        );
      }
      const repoPath = args.repoPath === undefined ? null : cleanString(args.repoPath);
      if (repoPath !== null) {
        drones = drones.filter((drone: any) => cleanString(drone.repoPath) === repoPath);
      }
      const requestedDrone = cleanString(args.droneId);
      if (requestedDrone) {
        drones = drones.filter(
          (drone: any) => drone.id === requestedDrone || drone.name === requestedDrone,
        );
      }
      const droneById = new Map<string, any>();
      for (const drone of drones) {
        const id = cleanString(drone.id);
        if (id) droneById.set(id, drone);
      }
      const search = searchActiveChatMessages({
        query: args.query,
        droneIds: [...droneById.keys()],
        chatName: cleanString(args.chatName) || undefined,
        limit: args.limit,
        offset: args.offset,
      });
      const results = search.results.map((item) => {
        const drone: any = droneById.get(item.droneId);
        const droneRepoPath = cleanString(drone?.repoPath);
        return {
          ...item,
          droneName: cleanString(drone?.name, item.droneId),
          repository: droneRepoPath
            ? {
                path: droneRepoPath,
                label: repoPathLabel(droneRepoPath),
                ref: repoRefForPath(droneRepoPath),
              }
            : null,
          chatRef: `${item.droneId}/${item.chatName}`,
        };
      });
      return toolResult({
        ok: true,
        query: args.query,
        count: results.length,
        results,
        limit: search.limit,
        offset: search.offset,
      });
    },
  );

  registerChangeRequestMcpTools(server, { context, requestJson, toolResult });

  server.registerTool(
    'list_groups',
    {
      title: 'List drone groups',
      description:
        'List repository-scoped Drone Hub groups, their immutable ids, and drone counts.',
      inputSchema: { repoPath: z.string().optional() },
    },
    async (args) => {
      const repoPath = args.repoPath === undefined ? undefined : cleanString(args.repoPath);
      const groups = await listGroups(repoPath, context.hubServices);
      return toolResult({ ok: true, groups, total: groups.length });
    },
  );

  server.registerTool(
    'create_group',
    {
      title: 'Create drone group',
      description:
        'Create an empty group scoped to one repository. Omit repoPath only for drones without a repository.',
      inputSchema: {
        group: z.string().optional(),
        name: z.string().optional(),
        repoPath: z.string().optional(),
      },
    },
    async (args) => {
      const group = cleanString(args.group || args.name);
      if (!group) throw new Error('group is required');
      const repoPath = cleanString(args.repoPath);
      const beforeGroups = await listGroups(repoPath, context.hubServices);
      const response = await context.hubServices.groups.create({ name: group, repoPath });
      const created = normalizeGroupSummary(response);
      if (!created) throw new Error('Drone Hub returned an invalid group after creation');
      const afterGroups = await listGroups(repoPath, context.hubServices);
      const canonical = afterGroups.find((candidate) => candidate.id === created.id) ?? created;
      const groupOrder = await insertNewGroupsAtParentTop(
        [canonical],
        beforeGroups,
        afterGroups,
        context.hubServices,
      );
      return toolResult({ ok: true, ...canonical, group: canonical.name, groupOrder });
    },
  );

  server.registerTool(
    'set_drone_group',
    {
      title: 'Set drone group',
      description:
        'Move one or more Drone Hub drones into repository-scoped groups, or clear their group. A name creates or selects an independent group in each drone repository; groupId selects one exact group.',
      inputSchema: {
        drones: z.array(z.string()).optional(),
        drone: z.string().optional(),
        group: z.string().optional(),
        groupId: z.string().optional(),
        clearGroup: z.boolean().optional(),
      },
    },
    async (args) => {
      const drones = [
        ...new Set([
          ...(args.drones ?? []).map((item) => cleanString(item)).filter(Boolean),
          ...(cleanString(args.drone) ? [cleanString(args.drone)] : []),
        ]),
      ];
      if (drones.length === 0) throw new Error('at least one drone is required');
      const groupId = cleanString(args.groupId);
      const group = args.clearGroup === true ? null : cleanString(args.group) || null;
      if (args.clearGroup === true && (groupId || cleanString(args.group)))
        throw new Error('clearGroup cannot be combined with group or groupId');
      if (groupId && group) throw new Error('use either group or groupId, not both');
      if (!groupId && group == null && args.clearGroup !== true)
        throw new Error('group or groupId is required unless clearGroup is true');
      const beforeGroups = groupId || group ? await listGroups(undefined, context.hubServices) : [];
      const resolved = await resolveDroneRefs(drones);
      const unknown = resolved.filter((item) => !item.found).map((item) => item.ref);
      if (unknown.length > 0)
        throw new Error(`unknown drone${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
      const selectedGroup = groupId
        ? beforeGroups.find((candidate) => candidate.id === groupId)
        : null;
      if (groupId && !selectedGroup) throw new Error(`unknown group: ${groupId}`);
      if (selectedGroup && resolved.some((item) => item.repoPath !== selectedGroup.repoPath)) {
        throw new Error('group belongs to a different repository than one or more selected drones');
      }
      const droneIds = resolved.map((item) => item.id);
      const response = await context.hubServices.groups.setDroneGroup(
        groupId ? { droneIds, groupId } : { droneIds, group },
      );
      let groupOrder: any = { updated: false, groups: [] };
      if ((groupId || group) && Array.isArray(response?.moved) && response.moved.length > 0) {
        const afterGroups = await listGroups(undefined, context.hubServices);
        const targetRepoPaths = new Set(
          resolved.filter((item) => item.found).map((item) => item.repoPath),
        );
        const targetGroups = groupId
          ? afterGroups.filter((candidate) => candidate.id === groupId)
          : afterGroups.filter(
              (candidate) => targetRepoPaths.has(candidate.repoPath) && candidate.name === group,
            );
        groupOrder = await insertNewGroupsAtParentTop(
          targetGroups,
          beforeGroups,
          afterGroups,
          context.hubServices,
        );
      }
      return toolResult({ ...response, ok: true, groupOrder });
    },
  );

  server.registerTool(
    'rename_drones',
    {
      title: 'Rename drones',
      description: 'Rename one or more Drone Hub drones by id or current name.',
      inputSchema: {
        drone: z.string().optional(),
        droneId: z.string().optional(),
        id: z.string().optional(),
        newName: z.string().optional(),
        name: z.string().optional(),
        nextName: z.string().optional(),
        renames: z
          .array(
            z.object({
              drone: z.string().optional(),
              droneId: z.string().optional(),
              id: z.string().optional(),
              name: z.string().optional(),
              newName: z.string().optional(),
              nextName: z.string().optional(),
            }),
          )
          .optional(),
      },
    },
    async (args) => {
      const renames = normalizeRenameRequests(args);
      if (renames.length === 0) throw new Error('at least one drone and newName are required');
      const renamed = [];
      const rejected = [];
      for (let index = 0; index < renames.length; index += 1) {
        const request = renames[index];
        try {
          const response = await context.hubServices.drones.rename({
            droneRef: request.drone,
            newName: request.newName,
            source: 'drone-hub-mcp',
          });
          renamed.push(response);
        } catch (error: any) {
          rejected.push({
            drone: request.drone,
            newName: request.newName,
            error: error?.message || String(error),
          });
        }
      }
      return toolResult({ ok: rejected.length === 0, renamed, rejected, total: renames.length });
    },
  );

  server.registerTool(
    'reorder_drones',
    {
      title: 'Reorder drones',
      description:
        'Reorder drones within one repository-scoped sidebar group. Prefer groupId when group names are duplicated across repositories.',
      inputSchema: {
        drones: z.array(z.string()),
        group: z.string().optional(),
        groupId: z.string().optional(),
        repoPath: z.string().optional(),
        beforeDrone: z.string().optional(),
        afterDrone: z.string().optional(),
      },
    },
    async (args) => toolResult(await reorderDronesInUiPreferences(args, context.hubServices)),
  );

  const openDroneChat = async (args: any) => {
    const droneRef = cleanString(args.droneId);
    const [droneId] = await resolveRequiredDroneIds([droneRef]);
    const chat = chatName(args.chatName);
    if (chat !== 'default') {
      const response = await requestJson(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
        method: 'GET',
      });
      const chats = Array.isArray(response?.chats)
        ? response.chats.map((name: any) => cleanString(name)).filter(Boolean)
        : [];
      if (!chats.includes(chat)) throw new Error(`unknown chat: ${droneId}/${chat}`);
    }
    const response = await emitUiAction({
      type: 'open_drone_chat',
      droneId,
      droneIds: [droneId],
      chatName: chat,
    });
    return toolResult({ ok: true, droneId, chatName: chat, uiAction: response?.uiAction ?? null });
  };
  const openDroneInputSchema = {
    droneId: z.string(),
    chatName: z.string().optional(),
  };

  server.registerTool(
    'open_drone_chat',
    {
      title: 'Open drone chat',
      description:
        'Open an existing drone chat in the Drone Hub UI. This is a UI navigation action and does not create a chat.',
      inputSchema: openDroneInputSchema,
    },
    openDroneChat,
  );

  server.registerTool(
    'open_drone',
    {
      title: 'Open drone',
      description:
        'Open a drone chat in the Drone Hub UI. Alias for open_drone_chat; does not create a chat.',
      inputSchema: openDroneInputSchema,
    },
    openDroneChat,
  );

  server.registerTool(
    'highlight_drones',
    {
      title: 'Highlight drones',
      description:
        'Temporarily highlight one or more drones in the Drone Hub UI and expand their collapsed group folders. Highlights default to 10 seconds.',
      inputSchema: {
        droneIds: z.array(z.string()),
        durationMs: z.number().optional(),
      },
    },
    async (args) => {
      const droneIds = await resolveRequiredDroneIds(
        Array.isArray(args.droneIds) ? args.droneIds : [],
      );
      const durationMs = normalizeHighlightDurationMs(args.durationMs);
      const response = await emitUiAction({ type: 'highlight_drones', droneIds, durationMs });
      return toolResult({ ok: true, droneIds, durationMs, uiAction: response?.uiAction ?? null });
    },
  );

  const speechTool = server.registerTool(
    'speak',
    {
      title: 'Speak',
      description:
        'Queue text-to-speech with GROQ and play it in the open Drone Hub UI. Returns immediately while synthesis and playback continue in the background.',
      inputSchema: {
        text: z.string().min(1).max(GROQ_SPEECH_MAX_CHARS),
        voice: z.enum(GROQ_SPEECH_VOICES).optional(),
      },
    },
    async (args) => {
      const response = await requestJson('/api/audio/speech', {
        method: 'POST',
        body: JSON.stringify({
          text: args.text,
          ...(args.voice ? { voice: args.voice } : {}),
          ...(context.nativeThreadId ? { threadId: context.nativeThreadId } : {}),
        }),
      });
      return toolResult(response);
    },
  );
  context.onSpeechToolRegistered?.(speechTool);
  if (context.speechEnabled === false) speechTool.disable();

  server.registerTool(
    'list_whiteboards',
    {
      title: 'List whiteboards',
      description:
        'List backend-saved Drone Hub whiteboards with ids, titles, scopes, and versions.',
      inputSchema: {
        scopeType: z.string().optional(),
        scopeValue: z.string().optional(),
      },
    },
    async (args) => {
      const params = new URLSearchParams();
      const scopeType = cleanString(args.scopeType);
      const scopeValue = cleanString(args.scopeValue);
      if (scopeType) params.set('scopeType', scopeType);
      if (scopeValue) params.set('scopeValue', scopeValue);
      const pathname = `/api/whiteboards${params.size > 0 ? `?${params.toString()}` : ''}`;
      return toolResult(await requestJson(pathname, { method: 'GET' }));
    },
  );

  server.registerTool(
    'read_whiteboard',
    {
      title: 'Read whiteboard',
      description:
        'Read a backend-saved whiteboard scene summary and elements. Omit whiteboardId for the main whiteboard.',
      inputSchema: {
        whiteboardId: z.string().optional(),
      },
    },
    async (args) => {
      const response = await requestWhiteboard(args.whiteboardId);
      const whiteboard = compactWhiteboard(response?.whiteboard);
      return toolResult({ ok: true, whiteboard });
    },
  );

  server.registerTool(
    'create_whiteboard',
    {
      title: 'Create whiteboard',
      description: 'Create a backend-saved Drone Hub whiteboard.',
      inputSchema: {
        title: z.string().optional(),
        scopeType: z.string().optional(),
        scopeValue: z.string().optional(),
      },
    },
    async (args) => {
      const body = {
        ...(cleanString(args.title) ? { title: cleanString(args.title) } : {}),
        ...(cleanString(args.scopeType) ? { scopeType: cleanString(args.scopeType) } : {}),
        ...(cleanString(args.scopeValue) ? { scopeValue: cleanString(args.scopeValue) } : {}),
        actorId: 'mcp',
      };
      const response = await requestJson('/api/whiteboards', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return toolResult({ ok: true, whiteboard: compactWhiteboard(response?.whiteboard) });
    },
  );

  server.registerTool(
    'update_whiteboard',
    {
      title: 'Update whiteboard',
      description:
        'Add, delete, or update simple whiteboard shapes. For add_shape, pass shapes with type rectangle, text, or arrow plus x/y/width/height/text. Arrows may use fromId/toId or startX/startY/endX/endY.',
      inputSchema: {
        whiteboardId: z.string().optional(),
        title: z.string().optional(),
        shapes: z.array(whiteboardShapeSchema).optional(),
        operations: z.array(whiteboardOperationSchema).optional(),
      },
    },
    async (args) => {
      const whiteboardId = cleanString(args.whiteboardId, 'main');
      if (whiteboardId === 'main') await requestWhiteboard('main');
      const operations = normalizeWhiteboardOperations(args);
      const title = cleanString(args.title);
      if (!title && operations.length === 0)
        throw new Error('title, shapes, or operations are required');
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
    },
  );

  server.registerTool(
    'capture_whiteboard',
    {
      title: 'Capture whiteboard',
      description:
        'Render the full visible whiteboard as a PNG image fitted to all visible shapes.',
      inputSchema: {
        whiteboardId: z.string().optional(),
        padding: z.number().optional(),
        maxWidth: z.number().optional(),
        maxHeight: z.number().optional(),
        backgroundColor: z.string().optional(),
      },
    },
    async (args) => {
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
      const metadata =
        response?.metadata && typeof response.metadata === 'object' ? response.metadata : {};
      const data = cleanString(response?.data);
      const mimeType = cleanString((metadata as any).mimeType, 'image/png');
      if (!data) throw new Error('whiteboard image response did not include image data');
      return imageToolResult({
        text: `Captured whiteboard ${cleanString((metadata as any).title, whiteboardId)} as a ${Number((metadata as any).width ?? 0) || '?'}x${Number((metadata as any).height ?? 0) || '?'} PNG.`,
        data,
        mimeType,
        metadata,
      });
    },
  );

  server.registerTool(
    'open_whiteboard',
    {
      title: 'Open whiteboard',
      description:
        'Open the Whiteboard panel in Drone Hub. Omit whiteboardId for the main whiteboard.',
      inputSchema: {
        whiteboardId: z.string().optional(),
      },
    },
    async (args) => {
      const response = await requestWhiteboard(args.whiteboardId);
      const whiteboardId = cleanString(
        response?.whiteboard?.id,
        cleanString(args.whiteboardId, 'main'),
      );
      const uiActionResponse = await emitUiAction({ type: 'open_whiteboard', whiteboardId });
      return toolResult({ ok: true, whiteboardId, uiAction: uiActionResponse?.uiAction ?? null });
    },
  );

  server.registerTool(
    'close_whiteboard',
    {
      title: 'Close whiteboard',
      description: 'Close the Whiteboard panel in Drone Hub.',
      inputSchema: {},
    },
    async () => {
      const response = await emitUiAction({ type: 'close_whiteboard' });
      return toolResult({ ok: true, uiAction: response?.uiAction ?? null });
    },
  );

  server.registerTool(
    'create_drone',
    {
      title: 'Create drone',
      description:
        'Create a new Drone Hub container drone. The drone is independent unless parent is explicitly supplied. Drafts return immediately; other drones return when ready unless completion is accepted. Unattended Codex drones default to execute access with no interactive approvals; pass agentPermissionMode and approvalPolicy to override that behavior. For repo-attached drones, agentsMd overrides the AGENTS.md content inherited from Drone Hub settings.',
      inputSchema: {
        name: z.string(),
        parent: z
          .string()
          .describe('Optional existing drone id or name to make the new drone a child of.')
          .optional(),
        group: z.string().optional(),
        groupId: z.string().optional(),
        agent: z.enum(['cursor', 'codex', 'claude', 'opencode', 'pi', 'blip']).optional(),
        model: z.string().optional(),
        reasoning: z.string().optional(),
        agentPermissionMode: z.enum(['read', 'write', 'execute']).optional(),
        approvalPolicy: z
          .enum(['ask', 'auto', 'none'])
          .describe(
            'Approval behavior for Codex: "ask" sends approval-gated requests to the user, "auto" has Codex review them automatically, and "none" never asks.',
          )
          .optional(),
        cwd: z.string().optional(),
        repoRef: z.string().optional(),
        repoLabel: z.string().optional(),
        repoPath: z.string().optional(),
        repoBranchSource: z.enum(['host', 'remote']).optional(),
        remoteBranch: z.string().optional(),
        agentsMd: z
          .string()
          .describe(
            'Optional AGENTS.md content for this repo-attached drone, limited to 2 MiB of UTF-8 text. Pass an empty string to override inherited content with an empty file.',
          )
          .optional(),
        initialMessage: z.string().optional(),
        draft: z.boolean().optional(),
        completion: z.enum(['ready', 'accepted']).optional(),
      },
    },
    async (args) => {
      if (cleanString(args.group) && cleanString(args.groupId))
        throw new Error('use either group or groupId, not both');
      const resolvedRepo = await resolveRegisteredRepo(args, context.hubServices);
      const repoPath = cleanString(resolvedRepo?.path);
      const defaults = await createDronePreferences(context.hubServices, repoPath);
      const seedAgent =
        args.agent == null
          ? agentFromPreferenceKey(defaults.spawnAgentKey)
          : normalizeAgent(args.agent);
      const seedModel = args.model == null ? defaults.spawnModel : cleanString(args.model);
      const seedAgentIsCodex = seedAgent?.kind === 'builtin' && seedAgent.id === 'codex';
      const seedAgentSupportsAccess =
        seedAgent?.kind === 'builtin' && (seedAgent.id === 'codex' || seedAgent.id === 'blip');
      if (
        args.agentPermissionMode != null &&
        args.agentPermissionMode !== 'execute' &&
        !seedAgentSupportsAccess
      ) {
        throw new Error('agentPermissionMode is only available for Codex and Blip drones');
      }
      if (args.approvalPolicy != null && !seedAgentIsCodex) {
        throw new Error('approvalPolicy is only available for Codex drones');
      }
      if (args.reasoning != null && !seedAgentSupportsAccess) {
        throw new Error('reasoning is only available for Codex and Blip drones');
      }
      const requestedPermissionMode = args.agentPermissionMode ?? 'execute';
      const seedAgentPermissionMode = seedAgentSupportsAccess ? requestedPermissionMode : 'execute';
      const seedAgentSupportsApproval = seedAgentIsCodex;
      const requestedApprovalPolicy =
        args.approvalPolicy ?? (seedAgentIsCodex ? 'none' : defaults.spawnApprovalPolicy);
      const seedApprovalPolicy = !seedAgentSupportsApproval ? 'ask' : requestedApprovalPolicy;
      const seedReasoning =
        seedAgent?.kind === 'builtin' && (seedAgent.id === 'codex' || seedAgent.id === 'blip')
          ? args.reasoning == null
            ? defaults.spawnReasoning
            : cleanString(args.reasoning)
          : '';
      const repoBranchSource = normalizeRepoBranchSource(
        args.repoBranchSource,
        defaults.repoBranchSource,
      );
      const remoteBranchRaw =
        args.remoteBranch == null
          ? defaults.repoCreateRemoteBranch
          : cleanString(args.remoteBranch);
      const remoteBranch =
        repoPath && repoBranchSource === 'remote'
          ? await requireRemoteBranchAvailableForRepo(
              repoPath,
              remoteBranchRaw,
              args.remoteBranch == null ? 'default' : 'explicit',
            )
          : remoteBranchRaw;
      const body = {
        name: cleanString(args.name),
        runtime: 'container',
        ...(args.draft === true ? { draft: true } : {}),
        ...(cleanString(args.groupId)
          ? { groupId: cleanString(args.groupId) }
          : cleanString(args.group)
            ? { group: cleanString(args.group) }
            : {}),
        ...(seedAgent ? { seedAgent } : {}),
        ...(seedModel ? { seedModel } : {}),
        ...(seedReasoning ? { seedReasoning } : {}),
        ...(seedAgentPermissionMode !== 'execute' ? { seedAgentPermissionMode } : {}),
        ...(seedApprovalPolicy !== 'ask' ? { seedApprovalPolicy } : {}),
        ...(cleanString(args.cwd) ? { cwd: cleanString(args.cwd) } : {}),
        ...(repoPath ? { repoPath, repoBranchSource } : {}),
        ...(repoPath && repoBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
        ...(args.agentsMd !== undefined ? { agentsMd: args.agentsMd } : {}),
        ...(cleanString(args.initialMessage)
          ? {
              seedPrompt: cleanString(args.initialMessage),
              seedSubmittedAt: new Date().toISOString(),
            }
          : {}),
        ...(cleanString(args.parent) ? { fleetParentId: cleanString(args.parent) } : {}),
      };
      const response = await requestJson(
        '/api/drones',
        { method: 'POST', body: JSON.stringify(body) },
        30_000,
      );
      const { accessScope, accessGrantError } = await grantCreatedDroneAccessBestEffort(
        context,
        response,
      );
      const accepted = droneSummary({ ...body, ...response });
      const returnsImmediately = args.draft === true || args.completion === 'accepted';
      const drone = returnsImmediately
        ? accepted
        : await waitForMcpDroneReady(
            cleanString(response?.id || response?.name, accepted.id || accepted.name),
            { initialMessage: initialMessageReadiness(response?.initialMessage) },
          );
      return toolResult({
        ok: true,
        phase: args.draft === true ? 'draft' : returnsImmediately ? 'accepted' : 'ready',
        drone,
        raw: response,
        createDefaults: defaults,
        repo: resolvedRepo,
        ...(accessScope ? { accessScope } : {}),
        ...(accessGrantError
          ? {
              accessGrantError,
              warning:
                'The drone was created, but this chat could not be granted access automatically.',
            }
          : {}),
      });
    },
  );

  server.registerTool(
    'clone_drone',
    {
      title: 'Clone drone',
      description:
        'Create an independent new drone cloned from an existing Drone Hub drone. Supply parent only when the clone should be a child of an existing drone.',
      inputSchema: {
        source: z.string(),
        name: z.string(),
        parent: z
          .string()
          .describe('Optional existing drone id or name to make the cloned drone a child of.')
          .optional(),
        group: z.string().optional(),
        groupId: z.string().optional(),
        cloneChats: z.boolean().optional(),
        completion: z.enum(['ready', 'accepted']).optional(),
      },
    },
    async (args) => {
      if (cleanString(args.group) && cleanString(args.groupId))
        throw new Error('use either group or groupId, not both');
      const body = {
        name: cleanString(args.name),
        runtime: 'container',
        cloneFrom: cleanString(args.source),
        cloneChats: args.cloneChats !== false,
        ...(cleanString(args.groupId)
          ? { groupId: cleanString(args.groupId) }
          : cleanString(args.group)
            ? { group: cleanString(args.group) }
            : {}),
        ...(cleanString(args.parent) ? { fleetParentId: cleanString(args.parent) } : {}),
      };
      const response = await requestJson(
        '/api/drones',
        { method: 'POST', body: JSON.stringify(body) },
        30_000,
      );
      const { accessScope, accessGrantError } = await grantCreatedDroneAccessBestEffort(
        context,
        response,
      );
      const accepted = droneSummary({ ...body, ...response });
      const drone =
        args.completion === 'accepted'
          ? accepted
          : await waitForMcpDroneReady(
              cleanString(response?.id || response?.name, accepted.id || accepted.name),
            );
      return toolResult({
        ok: true,
        phase: args.completion === 'accepted' ? 'accepted' : 'ready',
        drone,
        raw: response,
        ...(accessScope ? { accessScope } : {}),
        ...(accessGrantError
          ? {
              accessGrantError,
              warning:
                'The cloned drone was created, but this chat could not be granted access automatically.',
            }
          : {}),
      });
    },
  );

  registerWorkflowMcpTools(server, { requestJson, toolResult });

  server.registerTool(
    'list_chats',
    {
      title: 'List drone chats',
      description: 'List chats for a Drone Hub drone.',
      inputSchema: { drone: z.string() },
    },
    async (args) => {
      const response = await requestJson(`/api/drones/${encodeURIComponent(args.drone)}/chats`, {
        method: 'GET',
      });
      return toolResult({
        ok: true,
        drone: args.drone,
        chats: normalizeMcpChatList(response),
      });
    },
  );

  server.registerTool(
    'get_chat_tree',
    {
      title: 'Get drone chat tree',
      description: 'Get the ordered chat and nested chat-group tree for a Drone Hub drone.',
      inputSchema: { drone: z.string() },
    },
    async (args) => {
      const snapshot = await readMcpChatTreeSnapshot(args.drone, context.hubServices);
      return toolResult({
        ok: true,
        drone: snapshot.drone,
        tree: serializeMcpChatTree(snapshot),
      });
    },
  );

  server.registerTool(
    'create_chat',
    {
      title: 'Create drone chat',
      description:
        'Create and configure a chat for a Drone Hub drone. When settings are omitted, the most recently used settings for that drone repository are inherited. When chat is omitted, an Untitled name is allocated for a draft-style workflow. Use agent="codex" for a Codex CLI chat and omit provider. Use agent="native" for a Drone Hub Built-in chat; only that agent accepts provider="openai", "codex", or "gemini".',
      inputSchema: {
        drone: z.string(),
        chat: z.string().optional(),
        draft: z.boolean().optional(),
        agent: z
          .enum(['native', 'cursor', 'codex', 'claude', 'opencode', 'pi', 'blip'])
          .describe(
            'Chat runtime. "native" means the Drone Hub Built-in agent; "codex" means the Codex CLI agent.',
          )
          .optional(),
        provider: z
          .enum(['openai', 'codex', 'gemini'])
          .describe(
            'Model provider for agent="native" only. Omit this field for agent="codex" and every other agent.',
          )
          .optional(),
        model: z.string().optional(),
        reasoning: z.string().optional(),
        agentPermissionMode: z.enum(['read', 'write', 'execute']).optional(),
        approvalPolicy: z.enum(['ask', 'auto', 'none']).optional(),
        group: z.string().optional(),
        beforeChat: z.string().optional(),
        afterChat: z.string().optional(),
        beforeGroup: z.string().optional(),
        afterGroup: z.string().optional(),
      },
    },
    async (args) => {
      await requireContainerDroneForManagedChat(context, args.drone, 'create chats');
      const [resolved] = await resolveDroneRefs([args.drone]);
      if (!resolved?.found) throw new Error(`unknown drone: ${args.drone}`);
      const defaults = await createDronePreferences(context.hubServices, resolved.repoPath);
      const agent =
        args.agent == null
          ? chatAgentFromPreferenceKey(defaults.spawnAgentKey)
          : normalizeConfigurableChatAgent(args.agent);
      const isNative = agent?.kind === 'native';
      const isCodex = agent?.kind === 'builtin' && agent.id === 'codex';
      const supportsAccess =
        isNative || (agent?.kind === 'builtin' && (agent.id === 'codex' || agent.id === 'blip'));
      const supportsApproval = isNative || isCodex;
      if (
        args.agentPermissionMode != null &&
        args.agentPermissionMode !== 'execute' &&
        !supportsAccess
      ) {
        throw new Error(
          'agentPermissionMode is only available for Built-in, Codex, and Blip chats',
        );
      }
      if (
        args.approvalPolicy != null &&
        (!supportsApproval || (args.approvalPolicy === 'auto' && !isCodex))
      ) {
        throw new Error(
          'approvalPolicy is only available for Built-in and Codex chats; auto is Codex-only',
        );
      }
      if (args.reasoning != null && !supportsAccess) {
        throw new Error('reasoning is only available for Built-in, Codex, and Blip chats');
      }
      if (args.provider != null && !isNative) {
        throw new Error(
          'provider is only available with agent="native" (the Drone Hub Built-in agent); omit provider when agent="codex"',
        );
      }
      const model = args.model == null ? defaults.spawnModel : cleanString(args.model);
      const reasoning = supportsAccess
        ? args.reasoning == null
          ? defaults.spawnReasoning
          : cleanString(args.reasoning)
        : '';
      const agentPermissionMode = supportsAccess
        ? (args.agentPermissionMode ?? defaults.spawnAgentPermissionMode)
        : undefined;
      const requestedApprovalPolicy = args.approvalPolicy ?? defaults.spawnApprovalPolicy;
      const approvalPolicy = supportsApproval
        ? requestedApprovalPolicy === 'auto' && !isCodex
          ? 'ask'
          : requestedApprovalPolicy
        : undefined;

      const layoutRequested = Boolean(
        cleanString(args.group) ||
        cleanString(args.beforeChat) ||
        cleanString(args.afterChat) ||
        cleanString(args.beforeGroup) ||
        cleanString(args.afterGroup),
      );
      const destinationSnapshot = layoutRequested
        ? await readMcpChatTreeSnapshot(resolved.id, context.hubServices)
        : null;
      if (destinationSnapshot) {
        const targetPath = normalizeSidebarChatGroupPath(args.group);
        if (
          targetPath &&
          !destinationSnapshot.tree.nodesById[sidebarChatGroupNodeId(resolved.id, targetPath)]
        ) {
          throw new Error(`unknown chat group: ${targetPath}`);
        }
        findMcpChatTreeAnchor({
          snapshot: destinationSnapshot,
          targetPath,
          beforeChat: args.beforeChat,
          afterChat: args.afterChat,
          beforeGroup: args.beforeGroup,
          afterGroup: args.afterGroup,
        });
      }

      let listed: any = null;
      let chat = cleanString(args.chat);
      const generatedName = !chat;
      const createAsDraft = args.draft ?? generatedName;
      if (!chat) {
        if (destinationSnapshot) {
          chat = allocateUntitledChatName(destinationSnapshot.chats.map((entry) => entry.name));
        } else {
          listed = await requestJson(`/api/drones/${encodeURIComponent(resolved.id)}/chats`, {
            method: 'GET',
          });
          chat = allocateUntitledChatName(normalizeMcpChatList(listed).map((entry) => entry.name));
        }
      }
      let created = true;
      let result: any = null;
      let createConflictError: any = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          result = await requestJson(`/api/drones/${encodeURIComponent(resolved.id)}/chats`, {
            method: 'POST',
            // Stage every MCP-created chat as a draft until its requested
            // configuration has been applied. That makes rollback a hard delete
            // even when the user's normal delete mode is archive.
            body: JSON.stringify({ name: chat, draft: true }),
          });
          break;
        } catch (error: any) {
          if (error?.status !== 409) throw error;
          createConflictError = error;
          const conflictedChat = chat;
          listed = await requestJson(`/api/drones/${encodeURIComponent(resolved.id)}/chats`, {
            method: 'GET',
          });
          const existingChats = normalizeMcpChatList(listed);
          const existingChat = existingChats.find((entry) => entry.name === conflictedChat);
          if (!existingChat) throw error;
          if (!generatedName) {
            created = false;
            result = {
              chat: existingChat.name,
              chatId: existingChat.resourceId,
              draft: existingChat.draft === true,
            };
            break;
          }
          chat = allocateUntitledChatName(existingChats.map((entry) => entry.name));
          if (attempt === 19) throw new Error('could not allocate an available chat name');
        }
      }
      if (!created && !result)
        throw createConflictError ?? new Error(`chat already exists: ${chat}`);
      const config = {
        ...(agent ? { agent } : {}),
        ...(args.provider ? { provider: args.provider } : {}),
        ...(model ? { model } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(agentPermissionMode ? { agentPermissionMode } : {}),
        ...(approvalPolicy ? { approvalPolicy } : {}),
      };
      if (created) {
        try {
          await requestJson(
            `/api/drones/${encodeURIComponent(resolved.id)}/chats/${encodeURIComponent(chat)}/config`,
            { method: 'POST', body: JSON.stringify(config) },
          );
          if (!createAsDraft) {
            await requestJson(
              `/api/drones/${encodeURIComponent(resolved.id)}/chats/${encodeURIComponent(chat)}/publish`,
              { method: 'POST' },
            );
            result = { ...result, draft: false };
          }
        } catch (setupError: any) {
          try {
            await requestJson(
              `/api/drones/${encodeURIComponent(resolved.id)}/chats/${encodeURIComponent(chat)}`,
              { method: 'DELETE' },
            );
          } catch (rollbackError: any) {
            throw new Error(
              `chat setup failed: ${setupError?.message ?? String(setupError)}; rollback failed: ${rollbackError?.message ?? String(rollbackError)}`,
            );
          }
          throw new Error(
            `chat setup failed; the new chat was rolled back: ${setupError?.message ?? String(setupError)}`,
          );
        }
      }
      if (!result?.chatId) {
        listed = await requestJson(`/api/drones/${encodeURIComponent(resolved.id)}/chats`, {
          method: 'GET',
        });
        result =
          (Array.isArray(listed?.chatDetails) ? listed.chatDetails : []).find(
            (item: any) => cleanString(item?.chat ?? item?.name) === chat,
          ) ?? result;
      }
      let layoutWarning = '';
      if (created && layoutRequested) {
        try {
          const snapshot = await readMcpChatTreeSnapshot(resolved.id, context.hubServices);
          const intent = buildMcpChatTreeMoveIntent({
            snapshot,
            itemKind: 'chat',
            activeNodeIds: [sidebarChatNodeId(resolved.id, chat)],
            targetGroup: args.group,
            beforeChat: args.beforeChat,
            afterChat: args.afterChat,
            beforeGroup: args.beforeGroup,
            afterGroup: args.afterGroup,
          });
          await applyMcpChatTreeIntent(intent, context.hubServices);
        } catch (error: any) {
          layoutWarning = `The chat was created and configured, but its sidebar placement could not be saved: ${error?.message ?? String(error)}`;
        }
      }
      return toolResult({
        ok: true,
        drone: { id: resolved.id, name: resolved.name },
        chat,
        created,
        draft: created ? createAsDraft : undefined,
        resourceId: cleanString(result?.chatId) || undefined,
        settingsApplied: created,
        settings: created ? config : undefined,
        ...(!created
          ? { warning: 'The chat already existed, so its settings were not changed.' }
          : layoutWarning
            ? { warning: layoutWarning }
            : {}),
      });
    },
  );

  server.registerTool(
    'rename_chat',
    {
      title: 'Rename drone chat',
      description:
        'Rename a non-default chat while preserving its sidebar group, order, and mute state.',
      inputSchema: { drone: z.string(), chat: z.string(), newName: z.string() },
    },
    async (args) => {
      const snapshot = await readMcpChatTreeSnapshot(args.drone, context.hubServices);
      const chat = cleanString(args.chat);
      const newName = cleanString(args.newName);
      if (chat === 'default') throw new Error('cannot rename default chat');
      if (!snapshot.chats.some((entry) => entry.name === chat))
        throw new Error(`unknown chat: ${chat}`);
      if (!newName) throw new Error('newName is required');
      if (newName === chat) {
        return toolResult({ ok: true, drone: snapshot.drone, oldChat: chat, chat, renamed: false });
      }
      if (snapshot.chats.some((entry) => entry.name === newName))
        throw new Error(`chat already exists: ${newName}`);
      const response = await requestJson(
        `/api/drones/${encodeURIComponent(snapshot.drone.id)}/chats/${encodeURIComponent(chat)}/rename`,
        { method: 'POST', body: JSON.stringify({ newName }) },
      );
      const oldNodeId = sidebarChatNodeId(snapshot.drone.id, chat);
      const newNodeId = sidebarChatNodeId(snapshot.drone.id, newName);
      let layoutWarning = '';
      try {
        await updateUiPreferences((current) => {
          const nextGroupByChat = { ...current.sidebarChatGroupByChat };
          const group = nextGroupByChat[oldNodeId];
          delete nextGroupByChat[oldNodeId];
          if (group) nextGroupByChat[newNodeId] = group;
          const nextNodeOrder = Object.fromEntries(
            Object.entries(current.sidebarChatNodeOrderByParent).map(([parentId, nodeIds]) => [
              parentId,
              normalizeOrderedStringList(
                nodeIds.map((nodeId) => (nodeId === oldNodeId ? newNodeId : nodeId)),
              ),
            ]),
          );
          return normalizeUiPreferences({
            ...current,
            sidebarChatOrderByDrone: {
              ...current.sidebarChatOrderByDrone,
              [snapshot.drone.id]: normalizeOrderedStringList(
                (current.sidebarChatOrderByDrone[snapshot.drone.id] ?? []).map((name) =>
                  name === chat ? newName : name,
                ),
              ),
            },
            sidebarChatGroupByChat: nextGroupByChat,
            sidebarChatNodeOrderByParent: nextNodeOrder,
            mutedChatIds: normalizeOrderedStringList(
              current.mutedChatIds.map((nodeId) => (nodeId === oldNodeId ? newNodeId : nodeId)),
            ),
          });
        }, context.hubServices);
      } catch (error: any) {
        layoutWarning = `The chat was renamed, but its sidebar metadata could not be migrated: ${error?.message ?? String(error)}`;
      }
      return toolResult({
        ok: true,
        drone: snapshot.drone,
        oldChat: chat,
        chat: cleanString(response?.chat, newName),
        renamed: true,
        ...(layoutWarning ? { warning: layoutWarning } : {}),
      });
    },
  );

  server.registerTool(
    'delete_chat',
    {
      title: 'Delete drone chat',
      description:
        'Delete or archive a non-default chat according to Drone Hub delete settings and remove its sidebar metadata.',
      inputSchema: { drone: z.string(), chat: z.string() },
    },
    async (args) => {
      const snapshot = await readMcpChatTreeSnapshot(args.drone, context.hubServices);
      const chat = cleanString(args.chat);
      if (chat === 'default') throw new Error('cannot delete default chat');
      const targetChat = snapshot.chats.find((entry) => entry.name === chat);
      if (!targetChat) throw new Error(`unknown chat: ${chat}`);
      const principal = chatPrincipal(context);
      if (
        principal?.droneId === snapshot.drone.id &&
        ((cleanString(principal.chatId) &&
          cleanString(principal.chatId) === targetChat.resourceId) ||
          ((!cleanString(principal.chatId) || !targetChat.resourceId) &&
            principal.chatName === chat))
      ) {
        throw new Error('cannot delete the chat that is currently running this MCP client');
      }
      const response = await requestJson(
        `/api/drones/${encodeURIComponent(snapshot.drone.id)}/chats/${encodeURIComponent(chat)}`,
        { method: 'DELETE' },
      );
      const nodeId = sidebarChatNodeId(snapshot.drone.id, chat);
      let layoutWarning = '';
      try {
        await updateUiPreferences((current) => {
          const intent: SidebarMoveIntent = {
            kind: 'chat-tree-remove',
            droneId: snapshot.drone.id,
            nodeIds: [nodeId],
          };
          const nextLayout = applySidebarMove(normalizeSidebarLayout(current), intent);
          return normalizeUiPreferences({
            ...current,
            ...sidebarLayoutPatch(nextLayout, intent),
            sidebarChatOrderByDrone: {
              ...current.sidebarChatOrderByDrone,
              [snapshot.drone.id]: (
                current.sidebarChatOrderByDrone[snapshot.drone.id] ?? []
              ).filter((name) => name !== chat),
            },
            mutedChatIds: current.mutedChatIds.filter((id) => id !== nodeId),
          });
        }, context.hubServices);
      } catch (error: any) {
        layoutWarning = `The chat was ${response?.archivedChat ? 'archived' : 'deleted'}, but its sidebar metadata could not be removed: ${error?.message ?? String(error)}`;
      }
      return toolResult({
        ok: true,
        drone: snapshot.drone,
        chat,
        disposition: response?.archivedChat ? 'archived' : 'deleted',
        raw: response,
        ...(layoutWarning ? { warning: layoutWarning } : {}),
      });
    },
  );

  server.registerTool(
    'create_chat_group',
    {
      title: 'Create chat group',
      description: 'Create a chat group, optionally nested below another chat group.',
      inputSchema: { drone: z.string(), group: z.string(), parentGroup: z.string().optional() },
    },
    async (args) => {
      const snapshot = await readMcpChatTreeSnapshot(args.drone, context.hubServices);
      const parentGroup = normalizeSidebarChatGroupPath(args.parentGroup);
      const groupName = requireChatGroupPath(args.group, 'group');
      if (
        parentGroup &&
        !snapshot.tree.nodesById[sidebarChatGroupNodeId(snapshot.drone.id, parentGroup)]
      ) {
        throw new Error(`unknown parent chat group: ${parentGroup}`);
      }
      if (parentGroup && groupName.includes('/'))
        throw new Error('group must be a single name when parentGroup is supplied');
      const path = normalizeSidebarChatGroupPath(
        [parentGroup, groupName].filter(Boolean).join('/'),
      );
      if (snapshot.tree.nodesById[sidebarChatGroupNodeId(snapshot.drone.id, path)]) {
        throw new Error(`chat group already exists: ${path}`);
      }
      const saved = await applyMcpChatTreeIntent(
        { kind: 'chat-group-create', droneId: snapshot.drone.id, path },
        context.hubServices,
      );
      if (!(saved.sidebarChatGroupPathsByDrone[snapshot.drone.id] ?? []).includes(path)) {
        throw new Error(`chat group was not created: ${path}`);
      }
      return toolResult({ ok: true, drone: snapshot.drone, group: path });
    },
  );

  server.registerTool(
    'rename_chat_group',
    {
      title: 'Rename chat group',
      description: 'Rename or relocate a chat group and all nested chats/groups.',
      inputSchema: {
        drone: z.string(),
        group: z.string(),
        newName: z.string().optional(),
        newGroup: z.string().optional(),
      },
    },
    async (args) => {
      const snapshot = await readMcpChatTreeSnapshot(args.drone, context.hubServices);
      const group = requireChatGroupPath(args.group, 'group');
      if (!snapshot.tree.nodesById[sidebarChatGroupNodeId(snapshot.drone.id, group)]) {
        throw new Error(`unknown chat group: ${group}`);
      }
      if (cleanString(args.newName) && cleanString(args.newGroup))
        throw new Error('use either newName or newGroup, not both');
      const newName = normalizeSidebarChatGroupPath(args.newName);
      if (newName.includes('/'))
        throw new Error('newName must be a single group name; use newGroup for a full path');
      const parent = sidebarChatGroupParentPath(group);
      const newGroup =
        normalizeSidebarChatGroupPath(args.newGroup) ||
        normalizeSidebarChatGroupPath([parent, newName].filter(Boolean).join('/'));
      if (!newGroup) throw new Error('newName or newGroup is required');
      if (newGroup === group) {
        return toolResult({
          ok: true,
          drone: snapshot.drone,
          oldGroup: group,
          group,
          renamed: false,
        });
      }
      if (isSameOrDescendantSidebarChatGroupPath(newGroup, group)) {
        throw new Error(`cannot move chat group ${group} into itself or its descendant`);
      }
      if (snapshot.tree.nodesById[sidebarChatGroupNodeId(snapshot.drone.id, newGroup)]) {
        throw new Error(`chat group already exists: ${newGroup}`);
      }
      const saved = await applyMcpChatTreeIntent(
        {
          kind: 'chat-group-rename',
          droneId: snapshot.drone.id,
          path: group,
          newPath: newGroup,
        },
        context.hubServices,
      );
      const savedGroupPaths = saved.sidebarChatGroupPathsByDrone[snapshot.drone.id] ?? [];
      if (
        !savedGroupPaths.includes(newGroup) ||
        savedGroupPaths.some((path) => isSameOrDescendantSidebarChatGroupPath(path, group))
      ) {
        throw new Error(`chat group was not renamed: ${group}`);
      }
      return toolResult({
        ok: true,
        drone: snapshot.drone,
        oldGroup: group,
        group: newGroup,
        renamed: true,
      });
    },
  );

  server.registerTool(
    'delete_chat_group',
    {
      title: 'Delete chat group',
      description:
        'Delete a chat group without deleting its chats; contained chats are promoted to the parent group.',
      inputSchema: { drone: z.string(), group: z.string() },
    },
    async (args) => {
      const snapshot = await readMcpChatTreeSnapshot(args.drone, context.hubServices);
      const group = requireChatGroupPath(args.group, 'group');
      if (!snapshot.tree.nodesById[sidebarChatGroupNodeId(snapshot.drone.id, group)]) {
        throw new Error(`unknown chat group: ${group}`);
      }
      const saved = await applyMcpChatTreeIntent(
        { kind: 'chat-group-delete', droneId: snapshot.drone.id, path: group },
        context.hubServices,
      );
      if (
        (saved.sidebarChatGroupPathsByDrone[snapshot.drone.id] ?? []).some((path) =>
          isSameOrDescendantSidebarChatGroupPath(path, group),
        )
      ) {
        throw new Error(`chat group was not deleted: ${group}`);
      }
      return toolResult({
        ok: true,
        drone: snapshot.drone,
        deletedGroup: group,
        chatsDeleted: false,
      });
    },
  );

  server.registerTool(
    'move_chats',
    {
      title: 'Move or reorder chats',
      description:
        'Move one or more chats into a chat group or the root, optionally positioning them before or after a direct child.',
      inputSchema: {
        drone: z.string(),
        chats: z.array(z.string()).min(1),
        targetGroup: z.string().optional(),
        beforeChat: z.string().optional(),
        afterChat: z.string().optional(),
        beforeGroup: z.string().optional(),
        afterGroup: z.string().optional(),
      },
    },
    async (args) => {
      const snapshot = await readMcpChatTreeSnapshot(args.drone, context.hubServices);
      const chats = normalizeOrderedStringList(args.chats);
      const unknown = chats.filter((chat) => !snapshot.chats.some((entry) => entry.name === chat));
      if (unknown.length)
        throw new Error(`unknown chat${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
      const activeNodeIds = chats.map((chat) => sidebarChatNodeId(snapshot.drone.id, chat));
      const intent = buildMcpChatTreeMoveIntent({
        snapshot,
        itemKind: 'chat',
        activeNodeIds,
        targetGroup: args.targetGroup,
        beforeChat: args.beforeChat,
        afterChat: args.afterChat,
        beforeGroup: args.beforeGroup,
        afterGroup: args.afterGroup,
      });
      const saved = await applyMcpChatTreeIntent(intent, context.hubServices);
      const targetGroup = normalizeSidebarChatGroupPath(args.targetGroup);
      if (
        activeNodeIds.some(
          (nodeId) =>
            normalizeSidebarChatGroupPath(saved.sidebarChatGroupByChat[nodeId]) !== targetGroup,
        )
      ) {
        throw new Error('one or more chats were not moved to the target group');
      }
      const updated = await readMcpChatTreeSnapshot(snapshot.drone.id, context.hubServices);
      return toolResult({
        ok: true,
        drone: snapshot.drone,
        chats,
        tree: serializeMcpChatTree(updated),
      });
    },
  );

  server.registerTool(
    'move_chat_group',
    {
      title: 'Move or reorder chat group',
      description:
        'Move a chat group into another group or the root, optionally positioning it before or after a direct child.',
      inputSchema: {
        drone: z.string(),
        group: z.string(),
        targetGroup: z.string().optional(),
        beforeChat: z.string().optional(),
        afterChat: z.string().optional(),
        beforeGroup: z.string().optional(),
        afterGroup: z.string().optional(),
      },
    },
    async (args) => {
      const snapshot = await readMcpChatTreeSnapshot(args.drone, context.hubServices);
      const group = requireChatGroupPath(args.group, 'group');
      const nodeId = sidebarChatGroupNodeId(snapshot.drone.id, group);
      if (!snapshot.tree.nodesById[nodeId]) throw new Error(`unknown chat group: ${group}`);
      const intent = buildMcpChatTreeMoveIntent({
        snapshot,
        itemKind: 'folder',
        activeNodeIds: [nodeId],
        targetGroup: args.targetGroup,
        beforeChat: args.beforeChat,
        afterChat: args.afterChat,
        beforeGroup: args.beforeGroup,
        afterGroup: args.afterGroup,
      });
      const saved = await applyMcpChatTreeIntent(intent, context.hubServices);
      const targetGroup = normalizeSidebarChatGroupPath(args.targetGroup);
      const movedGroup = normalizeSidebarChatGroupPath(
        [targetGroup, sidebarChatGroupBaseName(group)].filter(Boolean).join('/'),
      );
      const savedGroupPaths = saved.sidebarChatGroupPathsByDrone[snapshot.drone.id] ?? [];
      if (
        !savedGroupPaths.includes(movedGroup) ||
        (movedGroup !== group &&
          savedGroupPaths.some((path) => isSameOrDescendantSidebarChatGroupPath(path, group)))
      ) {
        throw new Error(`chat group was not moved: ${group}`);
      }
      const updated = await readMcpChatTreeSnapshot(snapshot.drone.id, context.hubServices);
      return toolResult({
        ok: true,
        drone: snapshot.drone,
        oldGroup: group,
        group: movedGroup,
        tree: serializeMcpChatTree(updated),
      });
    },
  );

  server.registerTool(
    'send_message',
    {
      title: 'Send drone message',
      description: 'Send a message to a Drone Hub drone chat and return the queued run.',
      inputSchema: {
        drone: z.string(),
        chat: z.string().optional(),
        message: z.string(),
        idempotencyKey: z.string().optional(),
        createChat: z.boolean().optional(),
      },
    },
    async (args) => {
      const chat = chatName(args.chat);
      if (args.createChat) {
        await requireContainerDroneForManagedChat(context, args.drone, 'create chats');
        await requestJson(`/api/drones/${encodeURIComponent(args.drone)}/chats`, {
          method: 'POST',
          body: JSON.stringify({ name: chat }),
        }).catch((error: any) => {
          if (error?.status !== 409) throw error;
        });
      }
      const body = {
        prompt: args.message,
        submissionSource: 'assistant-tool',
        ...(cleanString(args.idempotencyKey) ? { promptId: cleanString(args.idempotencyKey) } : {}),
      };
      const response = await requestJson(
        `/api/drones/${encodeURIComponent(args.drone)}/chats/${encodeURIComponent(chat)}/prompt`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        30_000,
      );
      return toolResult({
        ok: true,
        drone: cleanString(response?.id, args.drone),
        chat,
        runId: cleanString(response?.promptId || body.promptId),
        status: cleanString(response?.pendingState, 'queued'),
        raw: response,
      });
    },
  );

  const resourceEventSchema = z.enum(MCP_RESOURCE_SUBSCRIPTION_EVENTS);
  server.registerTool(
    'subscribe_to_resource_events',
    {
      title: 'Subscribe to resource events',
      description:
        'Subscribe this conversation to events. DroneHub chat IDs support chat.idle and chat.failed. Native DroneHub change-request numbers support change_request.updated, change_request.merged, and change_request.closed. Both require read access to their target drone. GitHub owner/repository supports pull_request.opened, pull_request.comment.created, pull_request.merged, and pull_request.closed. GitHub owner/repository#number supports pull_request.comment.created, pull_request.merged, and pull_request.closed. GitHub resources are validated directly with the Hub GitHub identity and do not need to be registered in DroneHub. Delivery settings and cursors are managed by DroneHub.',
      inputSchema: {
        provider: z.enum(['drone-hub', 'github']),
        resourceType: z.enum(['chat', 'repository', 'pull_request', 'change_request']),
        resourceId: z.string(),
        events: z.array(resourceEventSchema).min(1),
        intent: z.string().optional(),
      },
    },
    async (args) => {
      const subscriber = subscriptionSubscriber(context);
      if (args.provider === 'drone-hub' && args.resourceType === 'chat') {
        await authorizeChatSubscriptionResource(context, args.resourceId);
      }
      if (args.provider === 'drone-hub' && args.resourceType === 'change_request') {
        await authorizeChangeRequestSubscriptionResource(context, args.resourceId);
      }
      const response = await requestJson('/api/resource-subscriptions', {
        method: 'POST',
        body: JSON.stringify({ ...args, subscriber }),
      });
      return toolResult({
        ok: true,
        created: response?.created === true,
        subscription: mcpSubscription(response?.subscription),
      });
    },
  );

  server.registerTool(
    'subscribe_to_cron',
    {
      title: 'Subscribe to cron',
      description:
        'Durably resume this conversation on a recurring five-field cron schedule. The minimum frequency is once per minute. If timeZone is omitted, DroneHub uses the latest timezone reported by the user interface, then the MCP host machine timezone, then UTC. An explicit timeZone always wins. Missed occurrences are coalesced, and delivery can be delayed by batching, queue load, or rate limits. The subscription remains active until cancelled.',
      inputSchema: {
        expression: z.string().min(1).max(200),
        timeZone: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe('Optional IANA timezone. Omit it to use the user interface timezone.'),
        intent: z.string().min(1).max(2_000),
      },
    },
    async (args) => {
      const subscriber = subscriptionSubscriber(context);
      const timeZone = cleanString(args.timeZone) || (await defaultCronTimeZone());
      const response = await requestJson('/api/resource-subscriptions/cron', {
        method: 'POST',
        body: JSON.stringify({ ...args, timeZone, subscriber }),
      });
      return toolResult({
        ok: true,
        created: response?.created === true,
        subscription: mcpSubscription(response?.subscription),
      });
    },
  );

  server.registerTool(
    'list_resource_subscriptions',
    {
      title: 'List resource subscriptions',
      description: 'List resource subscriptions owned by this conversation.',
      inputSchema: { includeInactive: z.boolean().optional() },
    },
    async (args) => {
      const subscriber = subscriptionSubscriber(context);
      const response = await requestJson(
        `/api/resource-subscriptions?subscriberChatId=${encodeURIComponent(subscriber.chatId)}&includeInactive=${args.includeInactive === true}`,
        { method: 'GET' },
      );
      return toolResult({
        ok: true,
        subscriptions: (Array.isArray(response?.subscriptions) ? response.subscriptions : []).map(
          mcpSubscription,
        ),
      });
    },
  );

  server.registerTool(
    'get_resource_subscription',
    {
      title: 'Get resource subscription',
      description: 'Read one resource subscription owned by this conversation.',
      inputSchema: { subscriptionId: z.string() },
    },
    async (args) => {
      const subscriber = subscriptionSubscriber(context);
      const response = await requestJson(
        `/api/resource-subscriptions/${encodeURIComponent(args.subscriptionId)}?subscriberChatId=${encodeURIComponent(subscriber.chatId)}`,
        { method: 'GET' },
      );
      return toolResult({ ok: true, subscription: mcpSubscription(response?.subscription) });
    },
  );

  server.registerTool(
    'update_resource_subscription',
    {
      title: 'Update resource subscription',
      description:
        'Change the events or intent for a resource subscription owned by this conversation.',
      inputSchema: {
        subscriptionId: z.string(),
        events: z.array(resourceEventSchema).min(1).optional(),
        intent: z.string().optional(),
      },
    },
    async (args) => {
      const subscriber = subscriptionSubscriber(context);
      const response = await requestJson(
        `/api/resource-subscriptions/${encodeURIComponent(args.subscriptionId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            subscriberChatId: subscriber.chatId,
            ...(args.events ? { events: args.events } : {}),
            ...(args.intent !== undefined ? { intent: args.intent } : {}),
          }),
        },
      );
      return toolResult({ ok: true, subscription: mcpSubscription(response?.subscription) });
    },
  );

  server.registerTool(
    'cancel_resource_subscription',
    {
      title: 'Cancel resource subscription',
      description: 'Cancel a resource subscription owned by this conversation.',
      inputSchema: { subscriptionId: z.string() },
    },
    async (args) => {
      const subscriber = subscriptionSubscriber(context);
      const response = await requestJson(
        `/api/resource-subscriptions/${encodeURIComponent(args.subscriptionId)}?subscriberChatId=${encodeURIComponent(subscriber.chatId)}`,
        { method: 'DELETE' },
      );
      return toolResult({ ok: true, subscription: mcpSubscription(response?.subscription) });
    },
  );

  server.registerTool(
    'read_chat',
    {
      title: 'Read drone chat',
      description: 'Read recent transcript turns for a Drone Hub drone chat.',
      inputSchema: {
        drone: z.string(),
        chat: z.string().optional(),
        limit: z.number().optional(),
        maxCharsPerField: z.number().optional(),
      },
    },
    async (args) => {
      const chat = chatName(args.chat);
      const limit = cleanPositiveInt(args.limit, 10, 20);
      const maxCharsPerField = cleanPositiveInt(args.maxCharsPerField, 4000, 8000);
      try {
        const response = await requestJson(
          `/api/drones/${encodeURIComponent(args.drone)}/chats/${encodeURIComponent(chat)}/state?turn=all&transcript=selected&pending=none`,
          { method: 'GET' },
        );
        const turns = Array.isArray(response?.transcripts)
          ? response.transcripts
              .slice(-limit)
              .map((turn: any) => boundedTranscriptTurn(turn, maxCharsPerField))
          : [];
        return toolResult({ ok: true, drone: args.drone, chat, turns, limit, maxCharsPerField });
      } catch (error: any) {
        if (error?.status !== 410) throw error;
        const response = await requestJson(
          `/api/drones/${encodeURIComponent(args.drone)}/chats/${encodeURIComponent(chat)}/output`,
          { method: 'GET' },
        );
        const output = truncateString(cleanString(response?.output), maxCharsPerField * 2);
        return toolResult({
          ok: true,
          drone: args.drone,
          chat,
          output: output.value,
          outputOriginalLength: output.originalLength,
          outputTruncated: output.truncated,
          truncated: output.truncated,
        });
      }
    },
  );
}

export type DroneHubMcpServerContext = McpToolRegistrationContext & {
  correlationId?: string;
  allowedDroneRefs?: string[];
  allowedWriteDroneRefs?: string[];
  allowedDroneIds?: string[];
};

export type DroneHubMcpServer = McpServer & {
  setPrincipal: (principal: McpTokenIdentity) => void;
  setSpeechEnabled: (enabled: boolean) => void;
};

const WRITE_SCOPED_TOOLS = new Set([
  'set_drone_group',
  'rename_drones',
  'reorder_drones',
  'create_chat',
  'rename_chat',
  'delete_chat',
  'create_chat_group',
  'rename_chat_group',
  'delete_chat_group',
  'move_chats',
  'move_chat_group',
  'send_message',
  ...CHANGE_REQUEST_WRITE_SCOPED_TOOL_NAMES,
  ...WORKFLOW_WRITE_SCOPED_TOOL_NAMES,
]);

const CHAT_EXECUTE_SCOPED_TOOLS = new Set([
  'open_drone_chat',
  'open_drone',
  'highlight_drones',
  'speak',
  'open_whiteboard',
  'close_whiteboard',
  'send_message',
  ...CHANGE_REQUEST_CHAT_EXECUTE_TOOL_NAMES,
]);

const CHAT_WRITE_SCOPED_TOOLS = new Set([
  'set_drone_group',
  'rename_drones',
  'reorder_drones',
  'create_whiteboard',
  'update_whiteboard',
  'create_chat',
  'rename_chat',
  'delete_chat',
  'create_chat_group',
  'rename_chat_group',
  'delete_chat_group',
  'move_chats',
  'move_chat_group',
  ...CHANGE_REQUEST_CHAT_WRITE_TOOL_NAMES,
]);

function chatAccessKindForTool(tool: string): McpChatAccessKind {
  if (CHAT_EXECUTE_SCOPED_TOOLS.has(tool)) return 'execute';
  if (CHAT_WRITE_SCOPED_TOOLS.has(tool)) return 'write';
  return 'read';
}

const DRONE_PRINCIPAL_TOOLS = new Set([
  'list_drones',
  'list_agent_models',
  'open_drone_chat',
  'open_drone',
  'highlight_drones',
  'speak',
  'list_whiteboards',
  'read_whiteboard',
  'create_whiteboard',
  'update_whiteboard',
  'capture_whiteboard',
  'open_whiteboard',
  'close_whiteboard',
  'list_chats',
  'get_chat_tree',
  'create_chat',
  'rename_chat',
  'delete_chat',
  'create_chat_group',
  'rename_chat_group',
  'delete_chat_group',
  'move_chats',
  'move_chat_group',
  'send_message',
  'read_chat',
  ...CHANGE_REQUEST_PUBLIC_REVIEW_TOOL_NAMES,
  ...CHANGE_REQUEST_PUBLIC_UPDATE_TOOL_NAMES,
  ...WORKFLOW_MCP_TOOL_NAMES,
]);

const DRONE_DEFAULTED_TOOLS = new Set<string>(WORKFLOW_DRONE_DEFAULTED_TOOL_NAMES);

function assertedDroneRefs(args: any): string[] {
  const direct = [
    args?.drone,
    args?.droneId,
    args?.targetDroneId,
    args?.id,
    args?.beforeDrone,
    args?.afterDrone,
    args?.source,
    args?.parent,
  ]
    .map((value) => cleanString(value))
    .filter(Boolean);
  const arrays = [args?.drones, args?.droneIds, args?.targets, args?.renames]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((value: any) => cleanString(value?.drone || value?.droneId || value?.id || value))
    .filter(Boolean);
  return [...new Set([...direct, ...arrays])];
}

export function authorizeDroneHubMcpTool(
  context: DroneHubMcpServerContext,
  tool: string,
  args: any,
): void {
  const principal = context.principal;
  if (context.allowedDroneRefs) {
    const scope = WRITE_SCOPED_TOOLS.has(tool)
      ? (context.allowedWriteDroneRefs ?? [])
      : context.allowedDroneRefs;
    const allowed = new Set(scope.map((value) => cleanString(value)).filter(Boolean));
    const refs = assertedDroneRefs(args);
    if (refs.some((ref) => !allowed.has(ref))) {
      throw new Error(`MCP principal ${principal.name} is not authorized for the requested drone`);
    }
  }
  if (principal.kind === 'legacy' || principal.kind === 'host') return;
  if (principal.kind === 'chat') {
    if (
      CHANGE_REQUEST_MANAGE_TOOL_NAMES.some((name) => name === tool) &&
      principal.accessScope.changeRequestCreate === false
    ) {
      throw new Error(`MCP principal ${principal.name} is not allowed to manage change requests`);
    }
    if (
      tool === CHANGE_REQUEST_MERGE_TOOL_NAME &&
      principal.accessScope.changeRequestMerge !== true
    ) {
      throw new Error(`MCP principal ${principal.name} is not allowed to merge change requests`);
    }
    const refs = assertedDroneRefs(args);
    const kind = chatAccessKindForTool(tool);
    if (
      refs.every((ref) =>
        mcpChatAccessAllowsDrone(principal.accessScope, kind, ref, principal.selectedDroneRefs),
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
  if (CHANGE_REQUEST_PUBLIC_REVIEW_TOOL_NAMES.some((name) => name === tool) && refs.length === 0) {
    return;
  }
  if (CHANGE_REQUEST_PUBLIC_UPDATE_TOOL_NAMES.some((name) => name === tool) && refs.length === 0) {
    return;
  }
  if (
    (tool === 'list_drones' || tool === 'list_agent_models' || tool === 'speak') &&
    refs.length === 0
  )
    return;
  if (refs.length === 0 || refs.some((ref) => ref !== scopedDroneId)) {
    throw new Error(`MCP principal ${principal.name} is scoped to drone ${scopedDroneId}`);
  }
}

function projectMcpResultForPrincipal(
  context: DroneHubMcpServerContext,
  tool: string,
  result: any,
): any {
  const principal = context.principal;
  if (tool !== 'list_drones') return result;
  const structured = result?.structuredContent;
  if (!structured || typeof structured !== 'object') return result;
  const allowedIds = context.allowedDroneIds
    ? new Set(context.allowedDroneIds.map((value) => cleanString(value)).filter(Boolean))
    : null;
  const chatAllowedIds =
    principal.kind === 'chat' && principal.accessScope.readMode === 'selected'
      ? new Set(principal.accessScope.droneIds)
      : null;
  if (principal.kind !== 'drone' && !allowedIds && !chatAllowedIds) return result;
  const drones = Array.isArray(structured.drones)
    ? structured.drones.filter((drone: any) =>
        principal.kind === 'drone'
          ? cleanString(drone?.id) === principal.droneId
          : (allowedIds ?? chatAllowedIds)!.has(cleanString(drone?.id)),
      )
    : [];
  const next = { ...structured, count: drones.length, drones };
  return toolResult(next);
}

function registerAuthorizedTools(server: McpServer, context: DroneHubMcpServerContext): void {
  const registerTool = server.registerTool.bind(server) as any;
  (server as any).registerTool = (
    name: string,
    config: any,
    handler: (args: any, extra: any) => Promise<any>,
  ) =>
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
  registerTools(server, context);
  (server as any).registerTool = registerTool;
}

export function createDroneHubMcpServer(
  input?: Partial<DroneHubMcpServerContext>,
): DroneHubMcpServer {
  let speechTool: RegisteredTool | null = null;
  const context: DroneHubMcpServerContext = {
    principal: input?.principal ?? {
      kind: 'legacy',
      tokenId: 'legacy',
      name: 'Legacy Drone Hub MCP token',
    },
    ...(input?.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input?.nativeThreadId ? { nativeThreadId: input.nativeThreadId } : {}),
    ...(input?.allowedDroneRefs ? { allowedDroneRefs: input.allowedDroneRefs } : {}),
    ...(input?.allowedWriteDroneRefs ? { allowedWriteDroneRefs: input.allowedWriteDroneRefs } : {}),
    ...(input?.allowedDroneIds ? { allowedDroneIds: input.allowedDroneIds } : {}),
    hubServices: input?.hubServices ?? createHttpHubServices(requestJson),
    speechEnabled: input?.speechEnabled !== false,
    onSpeechToolRegistered: (tool) => {
      speechTool = tool;
    },
  };
  const server = new McpServer(
    { name: 'Drone Hub MCP Server', version: '0.1.0' },
    { capabilities: { logging: {} } },
  ) as DroneHubMcpServer;
  server.setPrincipal = (principal) => {
    context.principal = principal;
  };
  server.setSpeechEnabled = (enabled) => {
    if (context.speechEnabled === enabled) return;
    context.speechEnabled = enabled;
    if (enabled) speechTool?.enable();
    else speechTool?.disable();
  };
  registerAuthorizedTools(server, context);
  return server;
}

export async function startDroneHubMcpServer() {
  let speechEnabled = true;
  try {
    const response = await requestJson('/api/settings/speech', { method: 'GET' }, 1_000);
    speechEnabled = response?.speech?.enabled !== false;
  } catch {
    // Keep the tool available if an older Hub does not expose speech settings yet.
  }
  const server = createDroneHubMcpServer({ speechEnabled });
  await server.connect(new StdioServerTransport());
  return server;
}

if (require.main === module) {
  startDroneHubMcpServer().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
