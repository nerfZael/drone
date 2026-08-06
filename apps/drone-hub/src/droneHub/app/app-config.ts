import type { ChatAgentConfig } from '../../domain';
import { profileStorageKey } from '../../profile-storage';
import { parseIsoTimestampMs } from './helpers';
import type { StartupSeedState } from './app-types';

export const BUILTIN_AGENT_OPTIONS: Array<{ key: string; label: string; agent: ChatAgentConfig }> = [
  { key: 'native', label: 'Built-in', agent: { kind: 'native' } },
  { key: 'builtin:cursor', label: 'Cursor Agent', agent: { kind: 'builtin', id: 'cursor' } },
  { key: 'builtin:codex', label: 'Codex', agent: { kind: 'builtin', id: 'codex' } },
  { key: 'builtin:claude', label: 'Claude Code', agent: { kind: 'builtin', id: 'claude' } },
  { key: 'builtin:opencode', label: 'OpenCode', agent: { kind: 'builtin', id: 'opencode' } },
  { key: 'builtin:pi', label: 'Pi', agent: { kind: 'builtin', id: 'pi' } },
  { key: 'builtin:blip', label: 'Blip', agent: { kind: 'builtin', id: 'blip' } },
];

export const PORT_PREVIEW_STORAGE_KEY = profileStorageKey('droneHub.portPreviewByDrone');
export const PREVIEW_URL_STORAGE_KEY = profileStorageKey('droneHub.previewUrlByDrone');
export const PORT_STATUS_POLL_INTERVAL_MS = 15_000;
export const PORT_STATUS_TIMEOUT_MS = 1_800;
export const DRONE_DND_MIME = 'application/x-drone-ids+json';
export const DRONE_CHAT_DND_MIME = 'application/x-drone-chat-refs+json';
export const GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY = profileStorageKey('droneHub.groupMultiChatColumnWidth');
export const GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX = 420;
export const GROUP_MULTI_CHAT_COLUMN_WIDTH_MIN_PX = 300;
export const GROUP_MULTI_CHAT_COLUMN_WIDTH_MAX_PX = 640;
export const SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY = profileStorageKey('droneHub.sidebarReposCollapsed');
export const SIDEBAR_AUTO_MINIMIZE_STORAGE_KEY = profileStorageKey('droneHub.sidebarAutoMinimize');
export const HUB_LOGS_TAIL_LINES = 600;
export const HUB_LOGS_MAX_BYTES = 200_000;
export const STARTUP_SEED_MISSING_GRACE_MS = 30_000;

export const WORKSPACE_TOOLS = {
  terminal: { label: 'Terminal', header: true, lazy: true },
  env: { label: 'Env', header: true, lazy: true },
  editor: { label: 'Editor', header: true, lazy: false },
  preview: { label: 'Browser', header: true, lazy: true },
  links: { label: 'Links', header: false, lazy: true },
  changes: { label: 'Changes', header: true, lazy: true },
  prs: { label: 'PRs', header: true, lazy: false },
  canvas: { label: 'Canvas', header: true, lazy: true },
  whiteboard: { label: 'Whiteboard', header: true, lazy: false },
  workflows: { label: 'Workflows', header: true, lazy: true },
} as const;
export type RightPanelTab = keyof typeof WORKSPACE_TOOLS;
export const RIGHT_PANEL_TABS = Object.keys(WORKSPACE_TOOLS) as RightPanelTab[];
export const RIGHT_PANEL_TAB_LABELS = Object.fromEntries(
  RIGHT_PANEL_TABS.map((tab) => [tab, WORKSPACE_TOOLS[tab].label]),
) as Record<RightPanelTab, string>;
export function rightPanelHeaderTabs(tabs: readonly RightPanelTab[]): RightPanelTab[] {
  return tabs.filter((tab) => WORKSPACE_TOOLS[tab].header);
}
export function isRightPanelTabLazyLoaded(tab: RightPanelTab): boolean {
  return WORKSPACE_TOOLS[tab].lazy;
}
export function rightPanelTabsForRuntime(runtimeRaw: unknown): RightPanelTab[] {
  void runtimeRaw;
  return [...RIGHT_PANEL_TABS];
}
export function repoUnavailableReasonForRuntime(runtimeRaw: unknown): string | null {
  void runtimeRaw;
  return null;
}

export function clampGroupMultiChatColumnWidthPx(width: number): number {
  const safe = Number.isFinite(width) ? width : GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX;
  return Math.min(GROUP_MULTI_CHAT_COLUMN_WIDTH_MAX_PX, Math.max(GROUP_MULTI_CHAT_COLUMN_WIDTH_MIN_PX, Math.round(safe)));
}

export function normalizeRightPanelTab(raw: unknown): RightPanelTab | null {
  const tab = raw === 'files' ? 'editor' : raw;
  return typeof tab === 'string' && RIGHT_PANEL_TABS.includes(tab as RightPanelTab)
    ? (tab as RightPanelTab)
    : null;
}

export function parseRightPanelTab(raw: unknown, fallback: RightPanelTab): RightPanelTab {
  return normalizeRightPanelTab(raw) ?? fallback;
}

const CANVAS_CHAT_NODE_PREFIX = 'chat:';
const CANVAS_CHAT_NODE_SEPARATOR = '::';

export type CanvasChatRef = {
  droneId: string;
  chatName: string;
};

export function createCanvasChatNodeId(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  if (!droneId) return '';
  return `${CANVAS_CHAT_NODE_PREFIX}${encodeURIComponent(droneId)}${CANVAS_CHAT_NODE_SEPARATOR}${encodeURIComponent(chatName)}`;
}

export function parseCanvasChatNodeId(nodeIdRaw: string): CanvasChatRef | null {
  const nodeId = String(nodeIdRaw ?? '').trim();
  if (!nodeId.startsWith(CANVAS_CHAT_NODE_PREFIX)) return null;
  const body = nodeId.slice(CANVAS_CHAT_NODE_PREFIX.length);
  const separatorIdx = body.indexOf(CANVAS_CHAT_NODE_SEPARATOR);
  if (separatorIdx <= 0 || separatorIdx >= body.length - CANVAS_CHAT_NODE_SEPARATOR.length) return null;
  const encodedDroneId = body.slice(0, separatorIdx);
  const encodedChatName = body.slice(separatorIdx + CANVAS_CHAT_NODE_SEPARATOR.length);
  try {
    const droneId = decodeURIComponent(encodedDroneId).trim();
    const chatName = decodeURIComponent(encodedChatName).trim() || 'default';
    if (!droneId) return null;
    return { droneId, chatName };
  } catch {
    return null;
  }
}

export function isStartupSeedFresh(seed: StartupSeedState | null | undefined, nowMs: number = Date.now()): boolean {
  const atMs = parseIsoTimestampMs(seed?.at);
  return atMs != null && nowMs - atMs < STARTUP_SEED_MISSING_GRACE_MS;
}
