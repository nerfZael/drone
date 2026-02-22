import type { ChatAgentConfig } from '../../domain';
import { parseIsoTimestampMs } from './helpers';
import type { RightPanelTabId } from './RightPanel';
import type { StartupSeedState } from './app-types';

export const BUILTIN_AGENT_OPTIONS: Array<{ key: string; label: string; agent: ChatAgentConfig }> = [
  { key: 'builtin:cursor', label: 'Cursor Agent', agent: { kind: 'builtin', id: 'cursor' } },
  { key: 'builtin:codex', label: 'Codex', agent: { kind: 'builtin', id: 'codex' } },
  { key: 'builtin:claude', label: 'Claude Code', agent: { kind: 'builtin', id: 'claude' } },
  { key: 'builtin:opencode', label: 'OpenCode', agent: { kind: 'builtin', id: 'opencode' } },
];

export const PORT_PREVIEW_STORAGE_KEY = 'droneHub.portPreviewByDrone';
export const PREVIEW_URL_STORAGE_KEY = 'droneHub.previewUrlByDrone';
export const FS_EXPLORER_VIEW_STORAGE_KEY = 'droneHub.fsExplorerView';
export const PORT_STATUS_POLL_INTERVAL_MS = 15_000;
export const PORT_STATUS_TIMEOUT_MS = 1_800;
export const DRONE_DND_MIME = 'application/x-drone-ids+json';
export const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'droneHub.rightPanelWidth';
export const RIGHT_PANEL_SPLIT_STORAGE_KEY = 'droneHub.rightPanelSplit';
export const RIGHT_PANEL_TOP_TAB_STORAGE_KEY = 'droneHub.rightPanelTopTab';
export const RIGHT_PANEL_BOTTOM_TAB_STORAGE_KEY = 'droneHub.rightPanelBottomTab';
export const RIGHT_PANEL_DEFAULT_WIDTH_PX = 460;
export const RIGHT_PANEL_MIN_WIDTH_PX = 360;
export const RIGHT_PANEL_MAX_WIDTH_VIEWPORT_RATIO = 0.7;
export const GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY = 'droneHub.groupMultiChatColumnWidth';
export const GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX = 420;
export const GROUP_MULTI_CHAT_COLUMN_WIDTH_MIN_PX = 300;
export const GROUP_MULTI_CHAT_COLUMN_WIDTH_MAX_PX = 640;
export const SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY = 'droneHub.sidebarReposCollapsed';
export const SIDEBAR_AUTO_MINIMIZE_STORAGE_KEY = 'droneHub.sidebarAutoMinimize';
export const HUB_LOGS_TAIL_LINES = 600;
export const HUB_LOGS_MAX_BYTES = 200_000;
export const STARTUP_SEED_MISSING_GRACE_MS = 30_000;

export type RightPanelTab = RightPanelTabId;
export const RIGHT_PANEL_TABS: RightPanelTab[] = [
  'terminal',
  'files',
  'preview',
  'links',
  'changes',
  'prs',
  'canvas',
];
export const RIGHT_PANEL_TAB_LABELS: Record<RightPanelTab, string> = {
  terminal: 'Terminal',
  files: 'Files',
  preview: 'Browser',
  links: 'Links',
  changes: 'Changes',
  prs: 'PRs',
  canvas: 'Canvas',
};

export function viewportWidthPx(): number {
  if (typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
    return window.innerWidth;
  }
  return 1440;
}

export function rightPanelMaxWidthPx(viewportWidth: number): number {
  return Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.floor(viewportWidth * RIGHT_PANEL_MAX_WIDTH_VIEWPORT_RATIO));
}

export function clampRightPanelWidthPx(width: number, viewportWidth: number = viewportWidthPx()): number {
  const safe = Number.isFinite(width) ? width : RIGHT_PANEL_DEFAULT_WIDTH_PX;
  return Math.min(rightPanelMaxWidthPx(viewportWidth), Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.round(safe)));
}

export function clampGroupMultiChatColumnWidthPx(width: number): number {
  const safe = Number.isFinite(width) ? width : GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX;
  return Math.min(GROUP_MULTI_CHAT_COLUMN_WIDTH_MAX_PX, Math.max(GROUP_MULTI_CHAT_COLUMN_WIDTH_MIN_PX, Math.round(safe)));
}

export function parseRightPanelTab(raw: string | null | undefined, fallback: RightPanelTab): RightPanelTab {
  if (raw && RIGHT_PANEL_TABS.includes(raw as RightPanelTab)) return raw as RightPanelTab;
  return fallback;
}

export function isStartupSeedFresh(seed: StartupSeedState | null | undefined, nowMs: number = Date.now()): boolean {
  const atMs = parseIsoTimestampMs(seed?.at);
  return atMs != null && nowMs - atMs < STARTUP_SEED_MISSING_GRACE_MS;
}
