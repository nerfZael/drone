import React from 'react';
import { CreateDronesFromAgentMessageModal } from './CreateDronesFromAgentMessageModal';
import {
  type ChatAgentConfig,
  type ChatInfo,
  isUngroupedGroupName,
  isValidDroneNameDashCase,
  normalizeChatInfoPayload,
  stripAnsi,
} from './domain';
import {
  ChatInput,
  ChatTabs,
  CollapsibleOutput,
  EmptyState,
  PendingTranscriptTurn,
  TranscriptSkeleton,
  TranscriptTurn,
} from './droneHub/chat';
import { DroneChangesDock } from './droneHub/changes';
import { DroneFilesDock } from './droneHub/files';
import {
  DroneCard,
  DroneLinksDock,
  DronePreviewDock,
  GroupBadge,
  StatusBadge,
} from './droneHub/overview';
import { DroneTerminalDock } from './droneHub/terminal';
import { requestJson } from './droneHub/http';
import { TypingDots } from './droneHub/overview/icons';
import { GuidedOnboarding } from './onboarding/GuidedOnboarding';
import { usePaneReadiness } from './droneHub/panes/usePaneReadiness';
import { cn } from './ui/cn';
import { dropdownMenuItemBaseClass, dropdownPanelBaseClass, useDropdownDismiss } from './ui/dropdown';
import { UiMenuSelect } from './ui/menuSelect';
import type {
  CustomAgentProfile,
  DroneFsEntry,
  DroneFsListPayload,
  DronePortMapping,
  DronePortsPayload,
  DroneSummary,
  EditableJob,
  JobSpec,
  PendingPrompt,
  PortPreviewByDrone,
  PortReachabilityByDrone,
  PortReachabilityByHostPort,
  PreviewUrlByDrone,
  RepoSummary,
  TranscriptItem,
} from './droneHub/types';

const BUILTIN_AGENT_OPTIONS: Array<{ key: string; label: string; agent: ChatAgentConfig }> = [
  { key: 'builtin:cursor', label: 'Cursor Agent', agent: { kind: 'builtin', id: 'cursor' } },
  { key: 'builtin:codex', label: 'Codex', agent: { kind: 'builtin', id: 'codex' } },
  { key: 'builtin:claude', label: 'Claude Code', agent: { kind: 'builtin', id: 'claude' } },
  { key: 'builtin:opencode', label: 'OpenCode', agent: { kind: 'builtin', id: 'opencode' } },
];

type ChatModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
  isCurrent?: boolean;
};

type TldrState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: string }
  | { status: 'error'; error: string };

const PORT_PREVIEW_STORAGE_KEY = 'droneHub.portPreviewByDrone';
const PREVIEW_URL_STORAGE_KEY = 'droneHub.previewUrlByDrone';
const FS_EXPLORER_VIEW_STORAGE_KEY = 'droneHub.fsExplorerView';
const PORT_STATUS_POLL_INTERVAL_MS = 15_000;
const PORT_STATUS_TIMEOUT_MS = 1_800;
const DRONE_DND_MIME = 'application/x-drone-names+json';
const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'droneHub.rightPanelWidth';
const RIGHT_PANEL_SPLIT_STORAGE_KEY = 'droneHub.rightPanelSplit';
const RIGHT_PANEL_TOP_TAB_STORAGE_KEY = 'droneHub.rightPanelTopTab';
const RIGHT_PANEL_BOTTOM_TAB_STORAGE_KEY = 'droneHub.rightPanelBottomTab';
const RIGHT_PANEL_DEFAULT_WIDTH_PX = 460;
const RIGHT_PANEL_MIN_WIDTH_PX = 360;
const RIGHT_PANEL_MAX_WIDTH_VIEWPORT_RATIO = 0.7;
const SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY = 'droneHub.sidebarReposCollapsed';
const ONBOARDING_STORAGE_PREFIX = 'droneHub.onboarding.';
const ONBOARDING_DISMISSED_AT_STORAGE_KEY = `${ONBOARDING_STORAGE_PREFIX}dismissedAt`;
const ONBOARDING_COMPLETED_AT_STORAGE_KEY = `${ONBOARDING_STORAGE_PREFIX}completedAt`;
const ONBOARDING_VERSION_STORAGE_KEY = `${ONBOARDING_STORAGE_PREFIX}version`;
const ONBOARDING_VERSION = '1';
const HUB_LOGS_TAIL_LINES = 600;
const HUB_LOGS_MAX_BYTES = 200_000;
const STARTUP_SEED_MISSING_GRACE_MS = 30_000;
type RightPanelTab = 'terminal' | 'files' | 'preview' | 'links' | 'changes';
const RIGHT_PANEL_TABS: RightPanelTab[] = ['terminal', 'files', 'preview', 'links', 'changes'];
const RIGHT_PANEL_TAB_LABELS: Record<RightPanelTab, string> = {
  terminal: 'Terminal',
  files: 'Files',
  preview: 'Browser',
  links: 'Links',
  changes: 'Changes',
};

type RepoOpErrorMeta = {
  code: string | null;
  patchName: string | null;
  conflictFiles: string[];
};

type RepoPullConflict = {
  isConflict: boolean;
  patchName: string | null;
  files: string[];
};

type DroneErrorModalState = {
  droneName: string;
  message: string;
  conflict: RepoPullConflict;
};
type AppView = 'workspace' | 'settings';
type LlmProviderId = 'openai' | 'gemini';
type ApiKeySettingsResponse = {
  ok: true;
  hasKey: boolean;
  source: 'settings' | 'environment' | null;
  keyHint: string | null;
  updatedAt: string | null;
};
type LlmSettingsResponse = {
  ok: true;
  provider: {
    selected: LlmProviderId;
    source: 'settings' | 'environment' | 'default';
  };
  openai: Omit<ApiKeySettingsResponse, 'ok'>;
  gemini: Omit<ApiKeySettingsResponse, 'ok'>;
};
type HubLogsResponse = {
  ok: true;
  logPath: string;
  text: string;
  truncated: boolean;
  fileSize: number;
  bytesRead: number;
  updatedAt: string | null;
  maxBytes: number;
  tailLines: number;
};

type StartupSeedState = {
  chatName: string;
  agent: ChatAgentConfig | null;
  model: string | null;
  prompt: string;
  at: string;
};

type DraftChatState = {
  // If set, this is the (optimistic) name of the drone being created for this draft chat.
  droneName: string;
  prompt: PendingPrompt | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function makeId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return String(c.randomUUID());
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function viewportWidthPx(): number {
  if (typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
    return window.innerWidth;
  }
  return 1440;
}

function rightPanelMaxWidthPx(viewportWidth: number): number {
  return Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.floor(viewportWidth * RIGHT_PANEL_MAX_WIDTH_VIEWPORT_RATIO));
}

function clampRightPanelWidthPx(width: number, viewportWidth: number = viewportWidthPx()): number {
  const safe = Number.isFinite(width) ? width : RIGHT_PANEL_DEFAULT_WIDTH_PX;
  return Math.min(rightPanelMaxWidthPx(viewportWidth), Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.round(safe)));
}

function parseRightPanelTab(raw: string | null | undefined, fallback: RightPanelTab): RightPanelTab {
  if (raw && RIGHT_PANEL_TABS.includes(raw as RightPanelTab)) return raw as RightPanelTab;
  return fallback;
}

function parseConflictFilesFromMessage(message: string): string[] {
  const text = String(message ?? '');
  const out = new Set<string>();

  const patchFailedRe = /patch failed:\s+(.+?):\d+/gi;
  let m: RegExpExecArray | null = null;
  while ((m = patchFailedRe.exec(text))) {
    const file = String(m[1] ?? '').trim();
    if (file) out.add(file);
  }

  const mergeConflictRe = /CONFLICT\s+\([^)]+\):\s+.*\s+in\s+(.+)$/gim;
  while ((m = mergeConflictRe.exec(text))) {
    const file = String(m[1] ?? '').trim();
    if (file) out.add(file);
  }

  const doesNotApplyRe = /error:\s+(.+?):\s+patch does not apply$/gim;
  while ((m = doesNotApplyRe.exec(text))) {
    const file = String(m[1] ?? '').trim();
    if (file) out.add(file);
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function parseIsoTimestampMs(raw: string | null | undefined): number | null {
  const ms = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(ms) ? ms : null;
}

function isStartupSeedFresh(seed: StartupSeedState | null | undefined, nowMs: number = Date.now()): boolean {
  const atMs = parseIsoTimestampMs(seed?.at);
  return atMs != null && nowMs - atMs < STARTUP_SEED_MISSING_GRACE_MS;
}

function compareDronesByNewestFirst(a: DroneSummary, b: DroneSummary): number {
  const aMs = parseIsoTimestampMs(a.createdAt);
  const bMs = parseIsoTimestampMs(b.createdAt);
  if (aMs == null && bMs != null) return 1;
  if (aMs != null && bMs == null) return -1;
  if (aMs != null && bMs != null && aMs !== bMs) return bMs - aMs;
  return a.name.localeCompare(b.name);
}

function parseRepoPullConflict(message: string, meta?: Partial<RepoOpErrorMeta> | null): RepoPullConflict {
  const text = String(message ?? '');
  const patchFromMeta = String(meta?.patchName ?? '').trim();
  const patchFromMessage =
    text.match(/while applying\s+([^\n:]+\.patch)/i)?.[1] ??
    text.match(/Failed applying patch\s+([^\n:]+\.patch)/i)?.[1] ??
    null;
  const patchName = patchFromMeta || (patchFromMessage ? String(patchFromMessage).trim() : null);
  const rawConflictFiles = Array.isArray(meta?.conflictFiles) ? meta.conflictFiles : [];
  const filesFromMeta = rawConflictFiles.map((f) => String(f ?? '').trim()).filter(Boolean);
  const filesFromMessage = parseConflictFilesFromMessage(text);
  const files = Array.from(new Set([...filesFromMeta, ...filesFromMessage])).sort((a, b) => a.localeCompare(b));
  const code = String(meta?.code ?? '').trim().toLowerCase();
  const isConflict =
    code === 'patch_apply_conflict' ||
    code === 'host_conflicts_ready' ||
    files.length > 0 ||
    /patch apply conflict|patch does not apply|failed applying patch|could not apply|CONFLICT/i.test(text);
  return { isConflict, patchName: patchName || null, files };
}

function writeLocalStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readLocalStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLocalStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function clearLocalStorageKeysByPrefix(prefix: string): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) removeLocalStorageItem(k);
  } catch {
    // ignore
  }
}

function usePersistedLocalStorageItem(key: string, value: string): void {
  React.useEffect(() => {
    writeLocalStorageItem(key, value);
  }, [key, value]);
}

function normalizePortRows(
  ports: DronePortMapping[] | null | undefined,
  hostPort: number | null,
  containerPort: number | null,
): DronePortMapping[] {
  const raw = Array.isArray(ports) && ports.length > 0 ? ports : hostPort && containerPort ? [{ hostPort, containerPort }] : [];
  const seen = new Set<string>();
  const uniq: DronePortMapping[] = [];
  for (const p of raw) {
    const hp = Number((p as any)?.hostPort);
    const cp = Number((p as any)?.containerPort);
    if (!Number.isFinite(hp) || !Number.isFinite(cp)) continue;
    const key = `${cp}:${hp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ hostPort: hp, containerPort: cp });
  }
  uniq.sort((a, b) => a.containerPort - b.containerPort || a.hostPort - b.hostPort);
  return uniq;
}

function readPortPreviewByDrone(): PortPreviewByDrone {
  const raw = readLocalStorageItem(PORT_PREVIEW_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: PortPreviewByDrone = {};
    for (const [droneName, value] of Object.entries(parsed as Record<string, any>)) {
      const name = String(droneName ?? '').trim();
      const hp = Number((value as any)?.hostPort);
      const cp = Number((value as any)?.containerPort);
      if (!name || !Number.isFinite(hp) || !Number.isFinite(cp)) continue;
      out[name] = { hostPort: hp, containerPort: cp };
    }
    return out;
  } catch {
    return {};
  }
}

function normalizePreviewUrl(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return trimmed;
  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeContainerPathInput(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function maybeExtractApiKey(raw: string, provider: LlmProviderId): string {
  const text = String(raw ?? '');
  const envName = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine ?? '').trim();
    if (!line) continue;
    const m = line.match(new RegExp(`^(?:export\\s+)?${envName}\\s*=\\s*(.*)$`, 'i'));
    if (!m) continue;
    let value = String(m[1] ?? '').trim();
    if (!value) return '';
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      // Support `.env` style trailing comments for unquoted values.
      value = value.replace(/\s+#.*$/, '').trim();
    }
    return value;
  }
  return text;
}

function droneHomePath(drone: Pick<DroneSummary, 'repoAttached' | 'repoPath'> | null | undefined): string {
  const repoAttached = Boolean(drone?.repoAttached ?? Boolean(String(drone?.repoPath ?? '').trim()));
  return repoAttached ? '/work/repo' : '/dvm-data/home';
}

function readPreviewUrlByDrone(): PreviewUrlByDrone {
  const raw = readLocalStorageItem(PREVIEW_URL_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: PreviewUrlByDrone = {};
    for (const [droneName, value] of Object.entries(parsed as Record<string, any>)) {
      const name = String(droneName ?? '').trim();
      const normalized = normalizePreviewUrl(String(value ?? ''));
      if (!name || !normalized) continue;
      out[name] = normalized;
    }
    return out;
  } catch {
    return {};
  }
}

function buildContainerPreviewUrl(droneName: string, containerPort: number): string {
  const dn = encodeURIComponent(String(droneName ?? '').trim());
  const cp = encodeURIComponent(String(containerPort ?? ''));
  return `/api/drones/${dn}/preview/${cp}/`;
}

function rewriteLoopbackUrlToContainerPreview(
  rawUrl: string,
  droneName: string,
  portRows: DronePortMapping[],
): string | null {
  try {
    const u = new URL(String(rawUrl));
    const host = String(u.hostname ?? '').toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return null;
    const loopbackPort = Number(u.port);
    if (!Number.isFinite(loopbackPort) || loopbackPort <= 0 || Math.floor(loopbackPort) !== loopbackPort) return null;
    const mapped = portRows.find((p) => p.containerPort === loopbackPort) ?? portRows.find((p) => p.hostPort === loopbackPort);
    const containerPort = mapped?.containerPort ?? loopbackPort;
    const base = `/api/drones/${encodeURIComponent(String(droneName ?? '').trim())}/preview/${containerPort}`;
    const path = u.pathname && u.pathname.startsWith('/') ? u.pathname : '/';
    return `${base}${path}${u.search || ''}${u.hash || ''}`;
  } catch {
    return null;
  }
}

function sameReachabilityMap(a: PortReachabilityByHostPort, b: PortReachabilityByHostPort): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

async function probeLocalhostPort(hostPort: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PORT_STATUS_TIMEOUT_MS);
  const url = `http://localhost:${hostPort}`;
  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/*  Data hooks                                                        */
/* ------------------------------------------------------------------ */

function usePoll<T>(fn: () => Promise<T>, intervalMs: number, deps: any[] = []) {
  const [value, setValue] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let mounted = true;
    let timer: any = null;
    setValue(null);
    setError(null);
    setLoading(true);
    const tick = async () => {
      try {
        const v = await fn();
        if (!mounted) return;
        setValue(v);
        setError(null);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message ?? String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    tick();
    timer = setInterval(tick, intervalMs);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { value, error, loading };
}

function useNowMs(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return;
    const ms = Math.max(250, Math.floor(intervalMs || 1000));
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [enabled, intervalMs]);
  return now;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

function isNotFoundError(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').trim();
  return /^404\b/.test(msg);
}

/* ------------------------------------------------------------------ */
/*  Tiny SVG icons (inline to avoid deps)                             */
/* ------------------------------------------------------------------ */

function IconDrone({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="6" height="6" rx="1" />
      <line x1="2" y1="2" x2="5" y2="5" />
      <line x1="14" y1="2" x2="11" y2="5" />
      <line x1="2" y1="14" x2="5" y2="11" />
      <line x1="14" y1="14" x2="11" y2="11" />
      <circle cx="2" cy="2" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="2" r="1" fill="currentColor" stroke="none" />
      <circle cx="2" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconChat({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 2A1.5 1.5 0 000 3.5v8A1.5 1.5 0 001.5 13H3v2.5l4-2.5h7.5A1.5 1.5 0 0016 11.5v-8A1.5 1.5 0 0014.5 2h-13z" />
    </svg>
  );
}

function IconChevron({ down, className }: { down?: boolean; className?: string }) {
  return (
    <svg
      className={`transition-transform duration-150 ${down ? 'rotate-0' : '-rotate-90'} ${className ?? ''}`}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
    </svg>
  );
}

function IconFolder({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2c-.33-.44-.85-.7-1.4-.7h-3.25z" />
    </svg>
  );
}

function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 4.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.5 3.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM3 8a.75.75 0 11-1.5 0A.75.75 0 013 8zm1.5-.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM3 11.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.5 11a.5.5 0 000 1h9a.5.5 0 000-1h-9z" />
    </svg>
  );
}

function IconSettings({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.8 1.03a1.2 1.2 0 012.4 0l.1.81a5.9 5.9 0 011.36.57l.68-.46a1.2 1.2 0 011.53.15l1.4 1.4a1.2 1.2 0 01.15 1.53l-.46.68c.23.43.42.89.56 1.36l.81.1a1.2 1.2 0 010 2.4l-.81.1a5.9 5.9 0 01-.56 1.36l.46.68a1.2 1.2 0 01-.15 1.53l-1.4 1.4a1.2 1.2 0 01-1.53.15l-.68-.46c-.43.23-.89.42-1.36.56l-.1.81a1.2 1.2 0 01-2.4 0l-.1-.81a5.9 5.9 0 01-1.36-.56l-.68.46a1.2 1.2 0 01-1.53-.15l-1.4-1.4a1.2 1.2 0 01-.15-1.53l.46-.68a5.9 5.9 0 01-.56-1.36l-.81-.1a1.2 1.2 0 010-2.4l.81-.1a5.9 5.9 0 01.56-1.36l-.46-.68a1.2 1.2 0 01.15-1.53l1.4-1.4a1.2 1.2 0 011.53-.15l.68.46c.43-.23.89-.42 1.36-.57l.1-.81zM8 5.75a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5z" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.75a.75.75 0 01.75.75v4.75h4.75a.75.75 0 010 1.5H8.75v4.75a.75.75 0 01-1.5 0V8.75H2.5a.75.75 0 010-1.5h4.75V2.5A.75.75 0 018 1.75z" />
    </svg>
  );
}

function IconPlusDouble({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 2.25a.75.75 0 01.75.75v2.5h2.5a.75.75 0 010 1.5h-2.5v2.5a.75.75 0 01-1.5 0V7h-2.5a.75.75 0 010-1.5h2.5V3A.75.75 0 015 2.25z" />
      <path d="M11 6.25a.75.75 0 01.75.75v2h2a.75.75 0 010 1.5h-2v2a.75.75 0 01-1.5 0v-2h-2a.75.75 0 010-1.5h2V7A.75.75 0 0111 6.25z" />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.5 1.5a.5.5 0 00-.5.5v1H3a.5.5 0 000 1h.5v9.25c0 .966.784 1.75 1.75 1.75h5.5A1.75 1.75 0 0012.5 13.25V4H13a.5.5 0 000-1h-3V2a.5.5 0 00-.5-.5h-3zM7 3V2.5h2V3H7zM5 4h6v9.25a.75.75 0 01-.75.75h-4.5a.75.75 0 01-.75-.75V4z" />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.94 8.94a.75.75 0 01-.318.19l-3.5 1a.75.75 0 01-.927-.927l1-3.5a.75.75 0 01.19-.318l8.935-8.945zM12.073 2.487L3.5 11.06l-.64 2.24 2.24-.64 8.573-8.573-1.6-1.6z" />
    </svg>
  );
}

function IconCopy({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 1.75A1.75 1.75 0 016.75 0h6.5C14.216 0 15 .784 15 1.75v6.5A1.75 1.75 0 0113.25 10h-6.5A1.75 1.75 0 015 8.25v-6.5zm1.75-.75a.75.75 0 00-.75.75v6.5c0 .414.336.75.75.75h6.5a.75.75 0 00.75-.75v-6.5a.75.75 0 00-.75-.75h-6.5z" />
      <path d="M1 5.75C1 4.784 1.784 4 2.75 4h1a.5.5 0 010 1h-1a.75.75 0 00-.75.75v6.5c0 .414.336.75.75.75h6.5a.75.75 0 00.75-.75v-1a.5.5 0 011 0v1A1.75 1.75 0 019.25 14.5h-6.5A1.75 1.75 0 011 12.75v-7z" />
    </svg>
  );
}

function IconSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? ''}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-75"
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconVsCode({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.8 1.6a1 1 0 011.2.2l1.2 1.2a1 1 0 01.3.7v8.6a1 1 0 01-.3.7l-1.2 1.2a1 1 0 01-1.2.2L6.4 11.7 3.9 14.2a1 1 0 01-1.4 0l-1-1a1 1 0 010-1.4L3.6 9.7 1.5 7.6a1 1 0 010-1.4l1-1a1 1 0 011.4 0L6.4 7.3 11.8 1.6zM6.4 8.7L4.9 10.2l1.5 1.5 4.2 2.8V2.9L6.4 8.7z" />
    </svg>
  );
}

function IconCursorApp({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.2 1.4a.75.75 0 011.02-.24l9.6 5.6a.75.75 0 01-.05 1.33l-3.63 1.66 1.67 3.62a.75.75 0 01-1.02.98l-1.73-.79-1.6-.72-1.66 3.63a.75.75 0 01-1.33.05L1.16 4.22a.75.75 0 01.24-1.02L3.2 1.4zm.12 1.93l2.67 9.9 1.14-2.5a.75.75 0 011.01-.36l2.5 1.14-.9-1.95a.75.75 0 01.36-1.01l2.5-1.14-9.9-2.67z" />
    </svg>
  );
}

function SkeletonLine({ w }: { w: string }) {
  return <div className="h-2.5 rounded bg-[var(--border-subtle)] animate-pulse" style={{ width: w }} />;
}

function droneChatQueueKey(droneNameRaw: string, chatNameRaw: string): string {
  const droneName = String(droneNameRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  return `${droneName}::${chatName}`;
}

function parseDroneChatQueueKey(key: string): { droneName: string; chatName: string } | null {
  const raw = String(key ?? '');
  const idx = raw.indexOf('::');
  if (idx < 0) return null;
  const droneName = raw.slice(0, idx).trim();
  const chatName = raw.slice(idx + 2).trim() || 'default';
  if (!droneName) return null;
  return { droneName, chatName };
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Main app                                                          */
/* ------------------------------------------------------------------ */

export default function DroneHubApp() {
  const { value: dronesResp, error: dronesError, loading: dronesLoading } = usePoll<{ ok: true; drones: DroneSummary[] }>(
    () => fetchJson('/api/drones'),
    2000,
    [],
  );
  const polledDrones = dronesResp?.drones ?? [];
  const [optimisticallyDeletedDrones, setOptimisticallyDeletedDrones] = React.useState<Record<string, boolean>>({});
  const drones = React.useMemo(() => {
    const hiddenNames = Object.keys(optimisticallyDeletedDrones);
    if (hiddenNames.length === 0) return polledDrones;
    return polledDrones.filter((d) => !optimisticallyDeletedDrones[d.name]);
  }, [optimisticallyDeletedDrones, polledDrones]);

  React.useEffect(() => {
    if (Object.keys(optimisticallyDeletedDrones).length === 0) return;
    const liveNames = new Set(polledDrones.map((d) => d.name));
    setOptimisticallyDeletedDrones((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const name of Object.keys(prev)) {
        if (liveNames.has(name)) {
          next[name] = true;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [optimisticallyDeletedDrones, polledDrones]);

  const { value: reposResp, error: reposError, loading: reposLoading } = usePoll<{ ok: true; repos: RepoSummary[] }>(
    () => fetchJson('/api/repos'),
    5000,
    [],
  );
  const repos = reposResp?.repos ?? [];
  const registeredRepoPaths = React.useMemo(
    () =>
      repos
        .map((r) => String(r?.path ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [repos],
  );
  const registeredRepoPathSet = React.useMemo(() => new Set(registeredRepoPaths), [registeredRepoPaths]);

  const { value: groupsResp } = usePoll<{ ok: true; groups: Array<{ name: string }> }>(() => fetchJson('/api/groups'), 5000, []);
  const registryGroupNames = React.useMemo(() => {
    const out = new Set<string>();
    for (const g of groupsResp?.groups ?? []) {
      const name = String((g as any)?.name ?? '').trim();
      if (!name) continue;
      if (isUngroupedGroupName(name)) continue;
      out.add(name);
    }
    return Array.from(out.values()).sort((a, b) => a.localeCompare(b));
  }, [groupsResp]);

  const [activeRepoPath, setActiveRepoPath] = React.useState<string>(() => readLocalStorageItem('droneHub.activeRepoPath') || '');
  usePersistedLocalStorageItem('droneHub.activeRepoPath', activeRepoPath || '');

  React.useEffect(() => {
    if (!activeRepoPath) return;
    const exists = repos.some((r) => String(r?.path ?? '').trim() === activeRepoPath);
    if (!exists) setActiveRepoPath('');
  }, [repos, activeRepoPath]);

  const [chatHeaderRepoPath, setChatHeaderRepoPath] = React.useState<string>(() => {
    const saved = String(readLocalStorageItem('droneHub.chatHeaderRepoPath') ?? '').trim();
    if (saved) return saved;
    const fallback = String(activeRepoPath ?? '').trim();
    return fallback || '';
  });
  usePersistedLocalStorageItem('droneHub.chatHeaderRepoPath', chatHeaderRepoPath || '');

  React.useEffect(() => {
    // If a previously-saved repo path was removed from the registry, drop back to "No repo".
    setChatHeaderRepoPath((prev) => {
      const p = String(prev ?? '').trim();
      if (!p) return '';
      return registeredRepoPathSet.has(p) ? p : '';
    });
  }, [registeredRepoPathSet]);

  const [sidebarReposCollapsed, setSidebarReposCollapsed] = React.useState<boolean>(() => readLocalStorageItem(SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY) === '1');
  usePersistedLocalStorageItem(SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY, sidebarReposCollapsed ? '1' : '0');

  const [appView, setAppView] = React.useState<AppView>(() => (readLocalStorageItem('droneHub.appView') === 'settings' ? 'settings' : 'workspace'));
  usePersistedLocalStorageItem('droneHub.appView', appView);

  const onboardingSteps = React.useMemo(
    () =>
      [
        {
          id: 'welcome',
          title: 'Welcome to Drone Hub',
          body: (
            <div className="space-y-2">
              <p>Drone Hub is your control room for running and interacting with drones.</p>
              <p className="text-[var(--muted)]">This quick tour highlights the core workflow. You can replay it anytime from Settings.</p>
            </div>
          ),
        },
        {
          id: 'create',
          title: 'Create drones fast',
          body: (
            <div className="space-y-2">
              <p>Use the “Create” action to spawn one or many drones from detected jobs.</p>
              <p className="text-[var(--muted)]">Tip: you can also start a brand new chat to create an untitled drone instantly.</p>
            </div>
          ),
        },
        {
          id: 'inspect',
          title: 'Inspect output & files',
          body: (
            <div className="space-y-2">
              <p>Follow the transcript/output, browse files, and use the terminal dock for interactive debugging.</p>
              <p className="text-[var(--muted)]">The right panel tabs keep everything in one place.</p>
            </div>
          ),
        },
        {
          id: 'settings',
          title: 'Configure providers',
          body: (
            <div className="space-y-2">
              <p>Set up your OpenAI/Gemini keys and select a default provider in Settings.</p>
              <p className="text-[var(--muted)]">You can always return to Settings from the header.</p>
            </div>
          ),
        },
      ] as const,
    [],
  );
  const onboardingTotal = onboardingSteps.length;

  const [onboardingOpen, setOnboardingOpen] = React.useState(false);
  const [onboardingStepIndex, setOnboardingStepIndex] = React.useState(0);
  const [onboardingAutoStarted, setOnboardingAutoStarted] = React.useState(false);

  const closeOnboarding = React.useCallback(
    (reason: 'dismiss' | 'complete') => {
      setOnboardingOpen(false);
      const now = new Date().toISOString();
      if (reason === 'complete') writeLocalStorageItem(ONBOARDING_COMPLETED_AT_STORAGE_KEY, now);
      else writeLocalStorageItem(ONBOARDING_DISMISSED_AT_STORAGE_KEY, now);
      writeLocalStorageItem(ONBOARDING_VERSION_STORAGE_KEY, ONBOARDING_VERSION);
    },
    [],
  );

  const replayOnboarding = React.useCallback(() => {
    clearLocalStorageKeysByPrefix(ONBOARDING_STORAGE_PREFIX);
    setOnboardingStepIndex(0);
    setOnboardingOpen(true);
    setOnboardingAutoStarted(true);
    setAppView('workspace');
  }, [setAppView]);

  React.useEffect(() => {
    if (appView !== 'workspace') return;
    if (onboardingAutoStarted) return;
    const version = readLocalStorageItem(ONBOARDING_VERSION_STORAGE_KEY);
    const dismissedAt = readLocalStorageItem(ONBOARDING_DISMISSED_AT_STORAGE_KEY);
    const completedAt = readLocalStorageItem(ONBOARDING_COMPLETED_AT_STORAGE_KEY);
    if (version === ONBOARDING_VERSION && (dismissedAt || completedAt)) return;
    setOnboardingStepIndex(0);
    setOnboardingOpen(true);
    setOnboardingAutoStarted(true);
  }, [appView, onboardingAutoStarted]);

  React.useEffect(() => {
    if (!onboardingOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOnboarding('dismiss');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeOnboarding, onboardingOpen]);

  const safeOnboardingStepIndex = Math.max(0, Math.min(onboardingStepIndex, onboardingTotal - 1));
  const safeOnboardingStep = onboardingSteps[safeOnboardingStepIndex];
  const onboardingIsFirst = safeOnboardingStepIndex <= 0;
  const onboardingIsLast = safeOnboardingStepIndex >= onboardingTotal - 1;

  const goPrevOnboardingStep = React.useCallback(() => {
    setOnboardingStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNextOnboardingStep = React.useCallback(() => {
    setOnboardingStepIndex((i) => Math.min(onboardingTotal - 1, i + 1));
  }, [onboardingTotal]);

  const [viewMode, setViewMode] = React.useState<'grouped' | 'flat'>(() => (readLocalStorageItem('droneHub.viewMode') === 'flat' ? 'flat' : 'grouped'));

  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>(() => {
    const raw = readLocalStorageItem('droneHub.collapsedGroups');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });

  const [autoDelete, setAutoDelete] = React.useState<boolean>(() => readLocalStorageItem('droneHub.autoDelete') === '1');

  const [terminalEmulator, setTerminalEmulator] = React.useState<string>(() => readLocalStorageItem('droneHub.terminalEmulator') || 'auto');
  usePersistedLocalStorageItem('droneHub.viewMode', viewMode);
  usePersistedLocalStorageItem('droneHub.collapsedGroups', JSON.stringify(collapsedGroups));
  usePersistedLocalStorageItem('droneHub.autoDelete', autoDelete ? '1' : '0');
  usePersistedLocalStorageItem('droneHub.terminalEmulator', terminalEmulator);

  const dronesFilteredByRepo = React.useMemo(() => {
    const targetRepo = String(activeRepoPath ?? '').trim();
    if (!targetRepo) return drones;
    return drones.filter((d) => String(d?.repoPath ?? '').trim() === targetRepo);
  }, [activeRepoPath, drones]);

  const droneCountByRepoPath = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of drones) {
      const p = String(d?.repoPath ?? '').trim();
      if (!p) continue;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return counts;
  }, [drones]);

  const groups = React.useMemo(() => {
    const m = new Map<string, DroneSummary[]>();
    for (const rawName of registryGroupNames) {
      const g = String(rawName ?? '').trim();
      if (!g || isUngroupedGroupName(g)) continue;
      if (!m.has(g)) m.set(g, []);
    }
    for (const d of dronesFilteredByRepo) {
      const raw = (d.group ?? '').trim();
      const g = !raw || isUngroupedGroupName(raw) ? 'Ungrouped' : raw;
      const arr = m.get(g) ?? [];
      arr.push(d);
      m.set(g, arr);
    }
    const out = Array.from(m.entries()).map(([group, items]) => {
      items.sort(compareDronesByNewestFirst);
      return { group, items };
    });
    out.sort((a, b) => {
      if (isUngroupedGroupName(a.group) && !isUngroupedGroupName(b.group)) return -1;
      if (!isUngroupedGroupName(a.group) && isUngroupedGroupName(b.group)) return 1;
      return a.group.localeCompare(b.group);
    });
    return out;
  }, [dronesFilteredByRepo, registryGroupNames]);
  const hasUngroupedGroup = React.useMemo(
    () => groups.some((g) => isUngroupedGroupName(g.group)),
    [groups],
  );

  const [selectedDrone, setSelectedDrone] = React.useState<string | null>(null);
  const [selectedDroneNames, setSelectedDroneNames] = React.useState<string[]>([]);
  const [selectedChat, setSelectedChat] = React.useState<string>('default');
  const [startupSeedByDrone, setStartupSeedByDrone] = React.useState<Record<string, StartupSeedState>>({});
  const [draftChat, setDraftChat] = React.useState<DraftChatState | null>(null);
  const [draftCreateOpen, setDraftCreateOpen] = React.useState(false);
  const [draftCreateName, setDraftCreateName] = React.useState('');
  const [draftCreateGroup, setDraftCreateGroup] = React.useState('');
  const [draftCreateError, setDraftCreateError] = React.useState<string | null>(null);
  const [draftCreating, setDraftCreating] = React.useState(false);
  const [draftAutoRenaming, setDraftAutoRenaming] = React.useState(false);
  // Local-only prompt queue used while drones are provisioning (hubPhase starting/seeding).
  // Key format: `${droneName}::${chatName}`
  const [queuedPromptsByDroneChat, setQueuedPromptsByDroneChat] = React.useState<Record<string, PendingPrompt[]>>({});
  const queuedPromptsByDroneChatRef = React.useRef<Record<string, PendingPrompt[]>>({});
  React.useEffect(() => {
    queuedPromptsByDroneChatRef.current = queuedPromptsByDroneChat;
  }, [queuedPromptsByDroneChat]);
  const flushingQueuedKeysRef = React.useRef<Set<string>>(new Set());
  const [draftNameSuggesting, setDraftNameSuggesting] = React.useState(false);
  const [draftSuggestedName, setDraftSuggestedName] = React.useState('');
  const [draftNameSuggestionError, setDraftNameSuggestionError] = React.useState<string | null>(null);
  const draftNameSuggestSeqRef = React.useRef(0);
  const draftCreateNameRef = React.useRef<HTMLInputElement | null>(null);
  const selectionAnchorRef = React.useRef<string | null>(null);
  const selectedDroneSet = React.useMemo(() => new Set(selectedDroneNames), [selectedDroneNames]);
  const orderedDroneNames = React.useMemo(() => {
    if (viewMode === 'flat') {
      return dronesFilteredByRepo
        .slice()
        .sort(compareDronesByNewestFirst)
        .map((d) => d.name);
    }
    return groups.flatMap((g) => g.items.map((d) => d.name));
  }, [dronesFilteredByRepo, groups, viewMode]);
  const sidebarOptimisticDrones = React.useMemo(() => {
    const known = new Set(drones.map((d) => d.name));
    const nowMs = Date.now();
    const out: DroneSummary[] = [];
    for (const [name, seed] of Object.entries(startupSeedByDrone)) {
      if (optimisticallyDeletedDrones[name]) continue;
      if (known.has(name)) continue;
      if (!isStartupSeedFresh(seed, nowMs)) continue;
      const chatName = String(seed.chatName ?? 'default').trim() || 'default';
      out.push({
        name,
        group: null,
        createdAt: seed.at || new Date().toISOString(),
        repoAttached: false,
        repoPath: '',
        containerPort: 0,
        hostPort: null,
        statusOk: true,
        statusError: null,
        chats: [chatName],
        hubPhase: 'starting',
        hubMessage: 'Queued',
        busy: true,
      });
    }
    out.sort(compareDronesByNewestFirst);
    return out;
  }, [drones, optimisticallyDeletedDrones, startupSeedByDrone]);
  const sidebarOptimisticDroneNameSet = React.useMemo(
    () => new Set(sidebarOptimisticDrones.map((d) => d.name)),
    [sidebarOptimisticDrones],
  );
  const sidebarDrones = React.useMemo(() => [...drones, ...sidebarOptimisticDrones], [drones, sidebarOptimisticDrones]);
  const sidebarDronesFilteredByRepo = React.useMemo(() => {
    const targetRepo = String(activeRepoPath ?? '').trim();
    if (!targetRepo) return sidebarDrones;
    return sidebarDrones.filter((d) => String(d?.repoPath ?? '').trim() === targetRepo);
  }, [activeRepoPath, sidebarDrones]);
  const sidebarGroups = React.useMemo(() => {
    const m = new Map<string, DroneSummary[]>();
    for (const rawName of registryGroupNames) {
      const g = String(rawName ?? '').trim();
      if (!g || isUngroupedGroupName(g)) continue;
      if (!m.has(g)) m.set(g, []);
    }
    for (const d of sidebarDronesFilteredByRepo) {
      const raw = (d.group ?? '').trim();
      const g = !raw || isUngroupedGroupName(raw) ? 'Ungrouped' : raw;
      const arr = m.get(g) ?? [];
      arr.push(d);
      m.set(g, arr);
    }
    const out = Array.from(m.entries()).map(([group, items]) => {
      items.sort(compareDronesByNewestFirst);
      return { group, items };
    });
    out.sort((a, b) => {
      if (isUngroupedGroupName(a.group) && !isUngroupedGroupName(b.group)) return -1;
      if (!isUngroupedGroupName(a.group) && isUngroupedGroupName(b.group)) return 1;
      return a.group.localeCompare(b.group);
    });
    return out;
  }, [sidebarDronesFilteredByRepo, registryGroupNames]);
  const sidebarHasUngroupedGroup = React.useMemo(
    () => sidebarGroups.some((g) => isUngroupedGroupName(g.group)),
    [sidebarGroups],
  );

  /* ── Layout state ── */
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [rightPanelOpen, setRightPanelOpen] = React.useState(true);
  const [rightPanelWidth, setRightPanelWidth] = React.useState<number>(() => {
    const saved = Number(readLocalStorageItem(RIGHT_PANEL_WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) return clampRightPanelWidthPx(saved);
    return clampRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  });
  const [rightPanelResizing, setRightPanelResizing] = React.useState(false);
  const rightPanelResizeRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const [rightPanelTab, setRightPanelTab] = React.useState<RightPanelTab>(() => parseRightPanelTab(readLocalStorageItem(RIGHT_PANEL_TOP_TAB_STORAGE_KEY), 'files'));
  const [rightPanelSplit, setRightPanelSplit] = React.useState<boolean>(() => {
    const raw = readLocalStorageItem(RIGHT_PANEL_SPLIT_STORAGE_KEY);
    return raw === null ? true : raw === '1';
  });
  const [rightPanelBottomTab, setRightPanelBottomTab] = React.useState<RightPanelTab>(() =>
    parseRightPanelTab(readLocalStorageItem(RIGHT_PANEL_BOTTOM_TAB_STORAGE_KEY), 'terminal'),
  );
  const [reposModalOpen, setReposModalOpen] = React.useState(false);
  const [droneErrorModal, setDroneErrorModal] = React.useState<DroneErrorModalState | null>(null);
  const [clearingDroneError, setClearingDroneError] = React.useState(false);
  const [headerOverflowOpen, setHeaderOverflowOpen] = React.useState(false);
  const headerOverflowRef = React.useRef<HTMLDivElement | null>(null);
  const preferredSelectedDroneRef = React.useRef<string | null>(null);
  const preferredSelectedDroneHoldUntilRef = React.useRef<number>(0);
  const droneIdentityByNameRef = React.useRef<Record<string, string>>({});
  const [llmSettings, setLlmSettings] = React.useState<LlmSettingsResponse | null>(null);
  const [llmSettingsLoading, setLlmSettingsLoading] = React.useState(false);
  const [llmSettingsError, setLlmSettingsError] = React.useState<string | null>(null);
  const [llmProviderDraft, setLlmProviderDraft] = React.useState<LlmProviderId>('openai');
  const [savingLlmProvider, setSavingLlmProvider] = React.useState(false);
  const [showGeminiKey, setShowGeminiKey] = React.useState(false);
  const [geminiSettingsDraft, setGeminiSettingsDraft] = React.useState('');
  const [savingGeminiSettings, setSavingGeminiSettings] = React.useState(false);
  const [clearingGeminiSettings, setClearingGeminiSettings] = React.useState(false);
  const [openAiSettingsDraft, setOpenAiSettingsDraft] = React.useState('');
  const [savingOpenAiSettings, setSavingOpenAiSettings] = React.useState(false);
  const [clearingOpenAiSettings, setClearingOpenAiSettings] = React.useState(false);
  const [showOpenAiKey, setShowOpenAiKey] = React.useState(false);
  const [llmSettingsNotice, setLlmSettingsNotice] = React.useState<string | null>(null);
  const [hubLogs, setHubLogs] = React.useState<HubLogsResponse | null>(null);
  const [hubLogsLoading, setHubLogsLoading] = React.useState(false);
  const [hubLogsError, setHubLogsError] = React.useState<string | null>(null);
  const [hubLogsNotice, setHubLogsNotice] = React.useState<string | null>(null);
  const [hubLogsExpanded, setHubLogsExpanded] = React.useState(false);
  const [hubLogsPinnedToBottom, setHubLogsPinnedToBottom] = React.useState(true);
  const hubLogsTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const [chatInfo, setChatInfo] = React.useState<ChatInfo | null>(null);
  const [chatInfoError, setChatInfoError] = React.useState<string | null>(null);
  const [loadingChatInfo, setLoadingChatInfo] = React.useState(false);
  const [chatModels, setChatModels] = React.useState<ChatModelOption[]>([]);
  const [chatModelsSource, setChatModelsSource] = React.useState<'live' | 'cache' | 'none'>('none');
  const [chatModelsDiscoveredAt, setChatModelsDiscoveredAt] = React.useState<string | null>(null);
  const [chatModelsError, setChatModelsError] = React.useState<string | null>(null);
  const [loadingChatModels, setLoadingChatModels] = React.useState(false);
  const [chatModelsRefreshNonce, setChatModelsRefreshNonce] = React.useState(0);
  const chatModelsRefreshHandledRef = React.useRef(0);
  const [manualChatModelInput, setManualChatModelInput] = React.useState('');
  const chatModelDiscoveryAgentId: 'cursor' | 'codex' | 'claude' | 'opencode' | null =
    chatInfo?.agent?.kind === 'builtin' ? chatInfo.agent.id : null;

  const [customAgents, setCustomAgents] = React.useState<CustomAgentProfile[]>(() => {
    const raw = readLocalStorageItem('droneHub.customAgents');
    try {
      const parsed = raw ? (JSON.parse(raw) as any) : [];
      return Array.isArray(parsed)
        ? parsed
            .map((x) => ({
              id: String(x?.id ?? '').trim(),
              label: String(x?.label ?? '').trim(),
              command: String(x?.command ?? '').trim(),
            }))
            .filter((x) => x.id && x.label && x.command)
        : [];
    } catch {
      return [];
    }
  });
  const [customAgentModalOpen, setCustomAgentModalOpen] = React.useState(false);
  const [newCustomAgentLabel, setNewCustomAgentLabel] = React.useState('');
  const [newCustomAgentCommand, setNewCustomAgentCommand] = React.useState('');
  const [customAgentError, setCustomAgentError] = React.useState<string | null>(null);

  const [transcripts, setTranscripts] = React.useState<TranscriptItem[] | null>(null);
  const [transcriptError, setTranscriptError] = React.useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = React.useState(false);
  const transcriptsRef = React.useRef<TranscriptItem[] | null>(null);
  const transcriptErrorRef = React.useRef<string | null>(null);
  const chatEndRef = React.useRef<HTMLDivElement | null>(null);
  const [optimisticPendingPrompts, setOptimisticPendingPrompts] = React.useState<PendingPrompt[]>([]);
  const [parsingJobsByTurn, setParsingJobsByTurn] = React.useState<Record<number, boolean>>({});

  const [tldrByMessageId, setTldrByMessageId] = React.useState<Record<string, TldrState>>({});
  const tldrByMessageIdRef = React.useRef<Record<string, TldrState>>({});
  const [showTldrByMessageId, setShowTldrByMessageId] = React.useState<Record<string, boolean>>({});
  const showTldrByMessageIdRef = React.useRef<Record<string, boolean>>({});
  const [hoveredAgentMessageId, setHoveredAgentMessageId] = React.useState<string | null>(null);
  const hoveredAgentMessageIdRef = React.useRef<string | null>(null);
  const chatUiModeRef = React.useRef<'transcript' | 'cli'>('transcript');

  const [jobsModal, setJobsModal] = React.useState<
    null | {
      turn: number;
      message: string;
      jobs: EditableJob[];
      group: string;
      prefix: string;
      agentKey: string;
      sourceRepoPath: string;
    }
  >(null);
  const [jobsModalError, setJobsModalError] = React.useState<string | null>(null);
  const [spawningJobById, setSpawningJobById] = React.useState<Record<string, boolean>>({});
  const [spawnedJobById, setSpawnedJobById] = React.useState<Record<string, boolean>>({});
  const [spawnJobErrorById, setSpawnJobErrorById] = React.useState<Record<string, string>>({});
  const [spawningAllJobs, setSpawningAllJobs] = React.useState(false);
  const spawningAllJobsRef = React.useRef(false);
  const [detailsOpenByJobId, setDetailsOpenByJobId] = React.useState<Record<string, boolean>>({});
  const prevChatItemsLenRef = React.useRef(0);

  const [sessionText, setSessionText] = React.useState<string>('');
  const sessionTextRef = React.useRef<string>('');
  const [sessionOffsetBytes, setSessionOffsetBytes] = React.useState<number | null>(null);
  const sessionOffsetRef = React.useRef<number | null>(null);
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const [loadingSession, setLoadingSession] = React.useState(false);
  const [outputView, setOutputView] = React.useState<'screen' | 'log'>(() => (readLocalStorageItem('droneHub.outputView') === 'log' ? 'log' : 'screen'));
  const screenLoadedRef = React.useRef(false);
  const [fsExplorerView, setFsExplorerView] = React.useState<'list' | 'thumb'>(() => (readLocalStorageItem(FS_EXPLORER_VIEW_STORAGE_KEY) === 'thumb' ? 'thumb' : 'list'));
  const [fsPathByDrone, setFsPathByDrone] = React.useState<Record<string, string>>({});
  const [fsRefreshNonce, setFsRefreshNonce] = React.useState(0);

  React.useEffect(() => {
    sessionTextRef.current = sessionText;
  }, [sessionText]);

  React.useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  React.useEffect(() => {
    transcriptErrorRef.current = transcriptError;
  }, [transcriptError]);

  React.useEffect(() => {
    tldrByMessageIdRef.current = tldrByMessageId;
  }, [tldrByMessageId]);

  React.useEffect(() => {
    showTldrByMessageIdRef.current = showTldrByMessageId;
  }, [showTldrByMessageId]);

  React.useEffect(() => {
    hoveredAgentMessageIdRef.current = hoveredAgentMessageId;
  }, [hoveredAgentMessageId]);

  React.useEffect(() => {
    const ids = droneIdentityByNameRef.current;
    for (const d of drones) {
      const name = String(d?.name ?? '').trim();
      if (!name) continue;
      if (!ids[name]) ids[name] = makeId();
    }
  }, [drones]);

  usePersistedLocalStorageItem('droneHub.outputView', outputView);
  usePersistedLocalStorageItem(FS_EXPLORER_VIEW_STORAGE_KEY, fsExplorerView);
  usePersistedLocalStorageItem('droneHub.customAgents', JSON.stringify(customAgents));
  usePersistedLocalStorageItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(rightPanelWidth));
  usePersistedLocalStorageItem(RIGHT_PANEL_SPLIT_STORAGE_KEY, rightPanelSplit ? '1' : '0');
  usePersistedLocalStorageItem(RIGHT_PANEL_TOP_TAB_STORAGE_KEY, rightPanelTab);
  usePersistedLocalStorageItem(RIGHT_PANEL_BOTTOM_TAB_STORAGE_KEY, rightPanelBottomTab);

  React.useEffect(() => {
    const onResize = () => {
      setRightPanelWidth((prev) => clampRightPanelWidthPx(prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  React.useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const [spawnAgentKey, setSpawnAgentKey] = React.useState<string>(() => readLocalStorageItem('droneHub.spawnAgent') || 'builtin:cursor');
  usePersistedLocalStorageItem('droneHub.spawnAgent', spawnAgentKey);

  const [spawnModel, setSpawnModel] = React.useState<string>(() => readLocalStorageItem('droneHub.spawnModel') || '');
  usePersistedLocalStorageItem('droneHub.spawnModel', spawnModel);

  React.useEffect(() => {
    const valid = new Set<string>([
      ...BUILTIN_AGENT_OPTIONS.map((o) => o.key),
      ...customAgents.map((a) => `custom:${a.id}`),
    ]);
    if (!valid.has(spawnAgentKey)) setSpawnAgentKey('builtin:cursor');
  }, [customAgents, spawnAgentKey]);

  const resolveAgentKeyToConfig = React.useCallback(
    (key: string): ChatAgentConfig => {
      const k = String(key ?? '').trim();
      const builtin = BUILTIN_AGENT_OPTIONS.find((o) => o.key === k);
      if (builtin) return builtin.agent;
      if (k.startsWith('custom:')) {
        const id = k.slice('custom:'.length);
        const local = customAgents.find((a) => a.id === id) ?? null;
        if (local) return { kind: 'custom', id: local.id, label: local.label, command: local.command };
      }
      // Fallback if a saved custom agent no longer exists locally.
      return { kind: 'builtin', id: 'cursor' };
    },
    [customAgents],
  );

  const spawnAgentConfig = React.useMemo(() => resolveAgentKeyToConfig(spawnAgentKey), [resolveAgentKeyToConfig, spawnAgentKey]);
  const spawnModelValue = React.useMemo(() => {
    const value = String(spawnModel ?? '').trim();
    return value || null;
  }, [spawnModel]);
  const spawnModelForSeed = spawnAgentConfig.kind === 'builtin' ? spawnModelValue : null;

  const rememberStartupSeed = React.useCallback((names: string[], opts: { agent: ChatAgentConfig | null; model?: string | null; prompt: string; chatName?: string }) => {
    const uniqueNames = Array.from(new Set(names.map((x) => String(x ?? '').trim()).filter(Boolean)));
    if (uniqueNames.length === 0) return;
    const prompt = String(opts.prompt ?? '').trim();
    const chatName = String(opts.chatName ?? 'default').trim() || 'default';
    const model = String(opts.model ?? '').trim() || null;
    if (!prompt && !opts.agent && !model) return;
    const at = new Date().toISOString();
    setStartupSeedByDrone((prev) => {
      const next = { ...prev };
      for (const name of uniqueNames) {
        next[name] = {
          chatName,
          agent: opts.agent ?? null,
          model,
          prompt,
          at,
        };
      }
      return next;
    });
  }, []);

  type DroneQueueSpec = {
    name: string;
    group?: string;
    repoPath?: string;
    build?: boolean;
    containerPort?: number;
    cloneFrom?: string;
    cloneChats?: boolean;
    seedAgent?: ChatAgentConfig;
    seedModel?: string | null;
    seedChat?: string;
    seedPrompt?: string;
    seedCwd?: string;
  };

  const queueDrones = React.useCallback(async (list: DroneQueueSpec[]) => {
    return await requestJson<{
      ok: true;
      accepted: Array<{ name: string; phase: 'starting' }>;
      rejected: Array<{ name: string; error: string; status?: number }>;
      total: number;
    }>(`/api/drones/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drones: list }),
    });
  }, []);

  const loadLlmSettings = React.useCallback(async () => {
    setLlmSettingsLoading(true);
    setLlmSettingsError(null);
    try {
      const data = await requestJson<LlmSettingsResponse>('/api/settings/llm');
      setLlmSettings(data);
      setLlmProviderDraft(data.provider.selected);
    } catch (e: any) {
      setLlmSettingsError(e?.message ?? String(e));
    } finally {
      setLlmSettingsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadLlmSettings();
  }, [loadLlmSettings]);

  const updateProviderKeySettings = React.useCallback((provider: LlmProviderId, data: ApiKeySettingsResponse) => {
    setLlmSettings((prev) => {
      if (!prev) return prev;
      const next = {
        hasKey: data.hasKey,
        source: data.source,
        keyHint: data.keyHint,
        updatedAt: data.updatedAt,
      };
      if (provider === 'openai') return { ...prev, openai: next };
      return { ...prev, gemini: next };
    });
  }, []);

  const mutateApiKeySettings = React.useCallback(
    async (provider: LlmProviderId, action: 'save' | 'clear') => {
      const providerLabel = provider === 'gemini' ? 'Gemini' : 'OpenAI';
      const envKeyName = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
      const draft = provider === 'openai' ? openAiSettingsDraft : geminiSettingsDraft;
      const apiKey = String(maybeExtractApiKey(draft, provider) ?? '').trim();
      if (action === 'save') {
        if (!apiKey) {
          setLlmSettingsError(`${providerLabel} API key is required.`);
          return;
        }
        if (apiKey !== draft) {
          if (provider === 'openai') setOpenAiSettingsDraft(apiKey);
          else setGeminiSettingsDraft(apiKey);
        }
      }
      if (provider === 'openai') {
        if (action === 'save') setSavingOpenAiSettings(true);
        else setClearingOpenAiSettings(true);
      } else if (action === 'save') {
        setSavingGeminiSettings(true);
      } else {
        setClearingGeminiSettings(true);
      }
      setLlmSettingsError(null);
      setLlmSettingsNotice(null);
      try {
        const data = await requestJson<ApiKeySettingsResponse>(`/api/settings/${provider}`, {
          method: action === 'save' ? 'POST' : 'DELETE',
          ...(action === 'save'
            ? {
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ apiKey }),
              }
            : {}),
        });
        updateProviderKeySettings(provider, data);
        if (provider === 'openai') {
          setOpenAiSettingsDraft('');
          setShowOpenAiKey(false);
        } else {
          setGeminiSettingsDraft('');
          setShowGeminiKey(false);
        }
        if (action === 'save') {
          setLlmSettingsNotice(`Saved ${providerLabel} API key.`);
        } else {
          setLlmSettingsNotice(data.hasKey ? `Using environment ${envKeyName}.` : `Cleared stored ${providerLabel} API key.`);
        }
      } catch (e: any) {
        setLlmSettingsError(e?.message ?? String(e));
      } finally {
        if (provider === 'openai') {
          if (action === 'save') setSavingOpenAiSettings(false);
          else setClearingOpenAiSettings(false);
        } else if (action === 'save') {
          setSavingGeminiSettings(false);
        } else {
          setClearingGeminiSettings(false);
        }
      }
    },
    [geminiSettingsDraft, openAiSettingsDraft, updateProviderKeySettings],
  );

  const saveLlmProviderSettings = React.useCallback(async () => {
    setSavingLlmProvider(true);
    setLlmSettingsError(null);
    setLlmSettingsNotice(null);
    try {
      const data = await requestJson<LlmSettingsResponse>('/api/settings/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: llmProviderDraft }),
      });
      setLlmSettings((prev) => (prev ? { ...prev, provider: data.provider } : data));
      setLlmProviderDraft(data.provider.selected);
      setLlmSettingsNotice(`Using ${data.provider.selected === 'gemini' ? 'Gemini' : 'OpenAI'} for LLM calls.`);
    } catch (e: any) {
      setLlmSettingsError(e?.message ?? String(e));
    } finally {
      setSavingLlmProvider(false);
    }
  }, [llmProviderDraft]);

  const loadHubLogs = React.useCallback(async () => {
    setHubLogsLoading(true);
    setHubLogsError(null);
    setHubLogsNotice(null);
    try {
      const data = await requestJson<HubLogsResponse>(`/api/settings/hub/logs?tail=${HUB_LOGS_TAIL_LINES}&maxBytes=${HUB_LOGS_MAX_BYTES}`);
      setHubLogs(data);
    } catch (e: any) {
      setHubLogsError(e?.message ?? String(e));
    } finally {
      setHubLogsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (appView !== 'settings') return;
    void loadHubLogs();
  }, [appView, loadHubLogs]);

  const copyHubLogs = React.useCallback(async () => {
    const text = String(hubLogs?.text ?? '');
    if (!text.trim()) return;
    await copyText(text);
    setHubLogsNotice('Copied hub logs.');
  }, [hubLogs?.text]);

  const handleHubLogsScroll = React.useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distanceFromBottom <= 8;
    setHubLogsPinnedToBottom((prev) => (prev === pinned ? prev : pinned));
  }, []);

  React.useEffect(() => {
    if (!hubLogsExpanded) return;
    if (!hubLogsPinnedToBottom) return;
    const el = hubLogsTextareaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [hubLogs?.text, hubLogsExpanded, hubLogsPinnedToBottom]);

  const transcriptMessageId = React.useCallback((t: TranscriptItem): string => {
    const explicit = typeof t?.id === 'string' ? t.id.trim() : '';
    if (explicit) return explicit;
    const session = String(t?.session ?? '').trim() || 'session';
    const turn = String(t?.turn ?? '');
    const iso = String(t?.completedAt ?? t?.at ?? '').trim() || 'at';
    return `${session}:${turn}:${iso}`;
  }, []);

  const cleanedAgentTextForTldr = React.useCallback((t: TranscriptItem): string => {
    return stripAnsi(t.ok ? t.output : t.error || 'failed');
  }, []);

  const cleanedPromptTextForTldr = React.useCallback((t: TranscriptItem): string => {
    return stripAnsi(t.prompt ?? '');
  }, []);

  const requestTldrForAgentMessage = React.useCallback(
    async (target: TranscriptItem) => {
      const messageId = transcriptMessageId(target);
      const existing = tldrByMessageIdRef.current?.[messageId] ?? null;
      if (existing?.status === 'loading' || existing?.status === 'ready') return;

      const clip = (s: string, max: number) => {
        const text = String(s ?? '').trim();
        if (!text) return '';
        return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
      };

      const list = transcriptsRef.current ?? [];
      let idx = list.findIndex((x) => transcriptMessageId(x) === messageId);
      if (idx < 0) idx = list.findIndex((x) => x.session === target.session && x.turn === target.turn);
      const end = idx >= 0 ? idx + 1 : list.length;
      const start = Math.max(0, end - 3);
      const slice = list.length > 0 ? list.slice(start, end) : [target];

      const context = slice.map((t) => ({
        turn: t.turn,
        prompt: clip(cleanedPromptTextForTldr(t), 2200),
        response: clip(cleanedAgentTextForTldr(t), 5200),
      }));

      setTldrByMessageId((prev) => ({ ...prev, [messageId]: { status: 'loading' } }));
      try {
        const data = await requestJson<{ ok: true; tldr: string }>(`/api/tldr/from-message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: clip(cleanedPromptTextForTldr(target), 6000),
            response: clip(cleanedAgentTextForTldr(target), 14_000),
            context,
          }),
        });
        const tldr = String((data as any)?.tldr ?? '').trim();
        if (!tldr) throw new Error('Empty TLDR response.');
        setTldrByMessageId((prev) => ({ ...prev, [messageId]: { status: 'ready', summary: tldr } }));
      } catch (e: any) {
        setTldrByMessageId((prev) => ({ ...prev, [messageId]: { status: 'error', error: e?.message ?? String(e) } }));
      }
    },
    [cleanedAgentTextForTldr, cleanedPromptTextForTldr, transcriptMessageId],
  );

  const toggleTldrForAgentMessage = React.useCallback(
    (target: TranscriptItem) => {
      const messageId = transcriptMessageId(target);
      const cur = Boolean(showTldrByMessageIdRef.current?.[messageId]);
      const next = !cur;
      setShowTldrByMessageId((prev) => ({ ...prev, [messageId]: next }));
      if (next) void requestTldrForAgentMessage(target);
    },
    [requestTldrForAgentMessage, transcriptMessageId],
  );

  const handleAgentMessageHover = React.useCallback(
    (t: TranscriptItem | null) => {
      setHoveredAgentMessageId(t ? transcriptMessageId(t) : null);
    },
    [transcriptMessageId],
  );

  const toggleTldrFromShortcut = React.useCallback(() => {
    if (chatUiModeRef.current !== 'transcript') return;
    const list = transcriptsRef.current ?? [];
    if (list.length === 0) return;
    const hoveredId = hoveredAgentMessageIdRef.current;
    const target = hoveredId ? list.find((t) => transcriptMessageId(t) === hoveredId) ?? null : null;
    const chosen = target ?? list[list.length - 1];
    toggleTldrForAgentMessage(chosen);
  }, [toggleTldrForAgentMessage, transcriptMessageId]);

  const parseJobsFromAgentMessage = React.useCallback(async (opts: { turn: number; message: string }) => {
    const message = String(opts.message ?? '').trim();
    if (!message) return;
    setParsingJobsByTurn((prev) => ({ ...prev, [opts.turn]: true }));
    setJobsModalError(null);
    try {
      const data = await requestJson<{ ok: true; jobs: any[]; group?: any }>(`/api/jobs/from-message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const rawJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const group = String(data?.group ?? '').trim() || 'jobs';
      const jobs: EditableJob[] = rawJobs
        .map((j: any, idx: number) => {
          const name = String(j?.name ?? '').trim();
          const title = String(j?.title ?? j?.description ?? '').trim();

          const detailsFromServer =
            typeof j?.details === 'string'
              ? j.details
              : Array.isArray(j?.details)
                ? j.details.map((x: any) => String(x ?? '')).join('\n\n')
                : '';
          let details = String(detailsFromServer || '').trim();

          if (!details) details = message;

          if (!name) return null;
          // Allow missing title (older servers); we still show the job and fall back in UI.
          return { id: makeId(), name, title, details };
        })
        .filter(Boolean) as EditableJob[];
      if (jobs.length === 0) throw new Error('No jobs were produced from that message.');
      const src = drones.find((d) => d.name === selectedDrone) ?? null;
      const sourceRepoPath = src && (src.repoAttached ?? Boolean(String(src.repoPath ?? '').trim())) ? src.repoPath : '';
      setSpawnJobErrorById({});
      setSpawnedJobById({});
      setDetailsOpenByJobId({});
      setJobsModal({
        turn: opts.turn,
        message,
        jobs,
        group,
        prefix: '',
        agentKey: spawnAgentKey || 'builtin:cursor',
        sourceRepoPath,
      });
    } catch (e: any) {
      setJobsModalError(e?.message ?? String(e));
      setJobsModal(null);
    } finally {
      setParsingJobsByTurn((prev) => ({ ...prev, [opts.turn]: false }));
    }
  }, [drones, selectedDrone, spawnAgentKey]);

  const spawnDroneForJob = React.useCallback(
    async (job: EditableJob, group: string, prefix: string, agentKey: string, repoPathOverride?: string): Promise<boolean> => {
    const nameRaw = String(job?.name ?? '');
    const name = nameRaw.trim();
    if (!name) return false;
    if (droneNameHasWhitespace(nameRaw) || !isValidDroneNameDashCase(name)) {
      setSpawnJobErrorById((prev) => ({ ...prev, [job.id]: 'Invalid drone name. Use dash-case (letters/numbers and single hyphens), no spaces, max 48 chars.' }));
      return false;
    }
    setSpawningJobById((prev) => ({ ...prev, [job.id]: true }));
    setSpawnJobErrorById((prev) => ({ ...prev, [job.id]: '' }));
    try {
      const groupName = String(group ?? '').trim();
      const title = String(job?.title ?? '').trim();
      const details = String(job?.details ?? '').trim();
      const prefixText = String(prefix ?? '').trim();
      const seedPrompt = [
        prefixText || null,
        `Job: ${name}`,
        title ? `Title: ${title}` : null,
        '',
        details ? details : null,
      ]
        .filter((x) => typeof x === 'string' && x.trim().length > 0)
        .join('\n');

      const seedAgent = resolveAgentKeyToConfig(agentKey);
      const seedModel = seedAgent.kind === 'builtin' ? spawnModelForSeed : null;
      const repoPath = String(repoPathOverride ?? '').trim();

      const resp = await queueDrones([
        {
          name,
          build: false,
          ...(groupName ? { group: groupName } : {}),
          ...(repoPath ? { repoPath } : {}),
          seedAgent,
          ...(seedModel ? { seedModel } : {}),
          seedChat: 'default',
          ...(seedPrompt.trim() ? { seedPrompt } : {}),
        },
      ]);

      const accepted = new Set((resp?.accepted ?? []).map((a) => String(a?.name ?? '').trim()).filter(Boolean));
      const rejected = (resp?.rejected ?? []).find((r) => String(r?.name ?? '').trim() === name) ?? null;
      if (!accepted.has(name)) {
        const msg = String(rejected?.error ?? 'Failed to queue drone.');
        setSpawnJobErrorById((prev) => ({ ...prev, [job.id]: msg }));
        return false;
      }

      rememberStartupSeed([name], { agent: seedAgent, model: seedModel, prompt: seedPrompt, chatName: 'default' });
      setSpawnedJobById((prev) => ({ ...prev, [job.id]: true }));
      return true;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setSpawnJobErrorById((prev) => ({ ...prev, [job.id]: msg }));
      return false;
    } finally {
      setSpawningJobById((prev) => ({ ...prev, [job.id]: false }));
    }
    },
    [queueDrones, rememberStartupSeed, resolveAgentKeyToConfig, spawnModelForSeed],
  );

  const spawnAllDronesForJobs = React.useCallback(
    async (
      jobs: EditableJob[],
      group: string,
      prefix: string,
      agentKey: string,
      repoPathOverride?: string,
    ): Promise<{ accepted: number; rejected: number }> => {
      const alreadySpawned = new Set(Object.keys(spawnedJobById).filter((k) => spawnedJobById[k]));

      const nameToJobIds = new Map<string, string[]>();
      for (const j of jobs) {
        const name = String(j?.name ?? '').trim();
        if (!name) continue;
        const ids = nameToJobIds.get(name) ?? [];
        ids.push(j.id);
        nameToJobIds.set(name, ids);
      }

      // Mark duplicates and invalid names so "spawn all" isn't silently skipping them.
      const dupErrorsById: Record<string, string> = {};
      for (const [name, ids] of nameToJobIds.entries()) {
        if (ids.length <= 1) continue;
        for (const id of ids) dupErrorsById[id] = `Duplicate name "${name}" in list.`;
      }
      if (Object.keys(dupErrorsById).length > 0) {
        setSpawnJobErrorById((prev) => {
          const next = { ...prev };
          for (const [id, msg] of Object.entries(dupErrorsById)) {
            next[id] = next[id] || msg;
          }
          return next;
        });
      }

      const groupName = String(group ?? '').trim();
      const prefixText = String(prefix ?? '').trim();
      const seedAgent = resolveAgentKeyToConfig(agentKey);
      const seedModel = seedAgent.kind === 'builtin' ? spawnModelForSeed : null;
      const repoPath = String(repoPathOverride ?? '').trim();

      const specs: DroneQueueSpec[] = [];
      const nameToJobId = new Map<string, string>();
      const nameToSeedPrompt = new Map<string, string>();
      for (const j of jobs) {
        const nameRaw = String(j?.name ?? '');
        const name = nameRaw.trim();
        if (!name) continue;
        const ids = nameToJobIds.get(name) ?? [];
        if (ids.length > 1) continue;
        if (alreadySpawned.has(j.id)) continue;
        if (droneNameHasWhitespace(nameRaw) || !isValidDroneNameDashCase(name)) {
          setSpawnJobErrorById((prev) => ({ ...prev, [j.id]: 'Invalid drone name. Use dash-case (letters/numbers and single hyphens), no spaces, max 48 chars.' }));
          continue;
        }
        nameToJobId.set(name, j.id);
        const title = String(j?.title ?? '').trim();
        const details = String(j?.details ?? '').trim();
        const seedPrompt = [
          prefixText || null,
          `Job: ${name}`,
          title ? `Title: ${title}` : null,
          '',
          details ? details : null,
        ]
          .filter((x) => typeof x === 'string' && x.trim().length > 0)
          .join('\n');
        nameToSeedPrompt.set(name, seedPrompt);

        specs.push({
          name,
          build: false,
          ...(groupName ? { group: groupName } : {}),
          ...(repoPath ? { repoPath } : {}),
          seedAgent,
          ...(seedModel ? { seedModel } : {}),
          seedChat: 'default',
          ...(seedPrompt.trim() ? { seedPrompt } : {}),
        });
      }

      if (specs.length === 0) return { accepted: 0, rejected: 0 };

      const resp = await queueDrones(specs);
      const acceptedNames = new Set((resp?.accepted ?? []).map((a) => String(a?.name ?? '').trim()).filter(Boolean));
      const rejected = Array.isArray(resp?.rejected) ? resp.rejected : [];

      // Apply per-name outcomes back onto per-job state.
      for (const name of acceptedNames) {
        const jobId = nameToJobId.get(name);
        if (jobId) setSpawnedJobById((prev) => ({ ...prev, [jobId]: true }));
      }
      for (const r of rejected) {
        const name = String((r as any)?.name ?? '').trim();
        const msg = String((r as any)?.error ?? 'Failed to queue drone.');
        if (!name) continue;
        const jobId = nameToJobId.get(name);
        if (jobId) setSpawnJobErrorById((prev) => ({ ...prev, [jobId]: msg }));
      }

      if (acceptedNames.size > 0) {
        for (const name of acceptedNames) {
          rememberStartupSeed([name], { agent: seedAgent, model: seedModel, prompt: nameToSeedPrompt.get(name) || '', chatName: 'default' });
        }
      }
      return { accepted: acceptedNames.size, rejected: rejected.length };
    },
    [queueDrones, rememberStartupSeed, resolveAgentKeyToConfig, spawnedJobById, spawnModelForSeed],
  );

  const spawnOneFromJobsModal = React.useCallback(
    (jobId: string) => {
      const cur = jobsModal;
      if (!cur) return;
      const job = cur.jobs.find((j) => j.id === jobId);
      if (!job) return;

      const name = String(job?.name ?? '').trim();
      if (!name) return;

      const dup = cur.jobs.filter((x) => String((x as any)?.name ?? '').trim() === name).length > 1;
      if (dup) {
        setSpawnJobErrorById((prev) => ({ ...prev, [jobId]: 'Duplicate name in list.' }));
        return;
      }

      void spawnDroneForJob(job, cur.group, cur.prefix, cur.agentKey, cur.sourceRepoPath);
    },
    [jobsModal, spawnDroneForJob],
  );

  const spawnAllFromJobsModal = React.useCallback(() => {
    const cur = jobsModal;
    if (!cur) return;
    if (spawningAllJobsRef.current) return;
    spawningAllJobsRef.current = true;
    void (async () => {
      setSpawningAllJobs(true);
      try {
        const r = await spawnAllDronesForJobs(cur.jobs, cur.group, cur.prefix, cur.agentKey, cur.sourceRepoPath);
        // If everything queued cleanly, close immediately (backend-driven).
        if (r.accepted > 0 && r.rejected === 0) setJobsModal(null);
      } finally {
        setSpawningAllJobs(false);
        spawningAllJobsRef.current = false;
      }
    })();
  }, [jobsModal, spawnAllDronesForJobs]);

  React.useEffect(() => {
    if (!selectedDrone || !selectedChat) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    const summary = drones.find((d) => d.name === selectedDrone) ?? null;
    if (summary?.hubPhase === 'starting' || summary?.hubPhase === 'seeding') {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    // Avoid 404 spam: don't fetch chat info until the chat exists on this drone.
    if (summary && Array.isArray(summary.chats) && !summary.chats.includes(selectedChat)) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    let mounted = true;
    setLoadingChatInfo(true);
    setChatInfoError(null);
    fetchJson<any>(`/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}`)
      .then((data) => {
        if (!mounted) return;
        setChatInfo(normalizeChatInfoPayload(data));
        setChatInfoError(null);
      })
      .catch((e: any) => {
        if (!mounted) return;
        const msg = e?.message ?? String(e);
        setChatInfo(null);
        setChatInfoError(isNotFoundError(e) ? null : msg);
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingChatInfo(false);
      });
    return () => {
      mounted = false;
    };
  }, [drones, selectedDrone, selectedChat]);

  React.useEffect(() => {
    setManualChatModelInput(chatInfo?.model ?? '');
  }, [chatInfo?.model, selectedDrone, selectedChat]);

  React.useEffect(() => {
    if (!selectedDrone || !selectedChat || !chatModelDiscoveryAgentId) {
      setChatModels([]);
      setChatModelsSource('none');
      setChatModelsDiscoveredAt(null);
      setChatModelsError(null);
      setLoadingChatModels(false);
      return;
    }

    let mounted = true;
    const forceRefresh = chatModelsRefreshNonce > chatModelsRefreshHandledRef.current;
    if (forceRefresh) chatModelsRefreshHandledRef.current = chatModelsRefreshNonce;
    setLoadingChatModels(true);
    setChatModelsError(null);
    fetchJson<any>(
      `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}/models?refresh=${
        forceRefresh ? '1' : '0'
      }`,
    )
      .then((data) => {
        if (!mounted) return;
        const listRaw = Array.isArray(data?.models) ? data.models : [];
        const list: ChatModelOption[] = listRaw
          .map((x: any): ChatModelOption => ({
            id: String(x?.id ?? '').trim(),
            label: String(x?.label ?? '').trim() || String(x?.id ?? '').trim(),
            ...(x?.isDefault ? { isDefault: true } : {}),
            ...(x?.isCurrent ? { isCurrent: true } : {}),
          }))
          .filter((x: ChatModelOption) => x.id);
        setChatModels(list);
        const source = String(data?.source ?? 'none').toLowerCase();
        setChatModelsSource(source === 'live' || source === 'cache' ? source : 'none');
        const discoveredAt = String(data?.discoveredAt ?? '').trim();
        setChatModelsDiscoveredAt(discoveredAt || null);
        const discoveredError = String(data?.error ?? '').trim();
        setChatModelsError(discoveredError || null);
      })
      .catch((e: any) => {
        if (!mounted) return;
        setChatModels([]);
        setChatModelsSource('none');
        setChatModelsDiscoveredAt(null);
        setChatModelsError(e?.message ?? String(e));
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingChatModels(false);
      });
    return () => {
      mounted = false;
    };
  }, [chatModelDiscoveryAgentId, chatModelsRefreshNonce, selectedChat, selectedDrone]);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [createMode, setCreateMode] = React.useState<'create' | 'clone'>('create');
  const [cloneSourceName, setCloneSourceName] = React.useState<string | null>(null);
  const [cloneIncludeChats, setCloneIncludeChats] = React.useState(true);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createName, setCreateName] = React.useState('');
  const [createGroup, setCreateGroup] = React.useState('');
  const [createRepoPath, setCreateRepoPath] = React.useState('');
  const [createInitialMessage, setCreateInitialMessage] = React.useState('');
  const [createMessageSuffixRows, setCreateMessageSuffixRows] = React.useState<string[]>(['']);
  const createNameRef = React.useRef<HTMLInputElement | null>(null);
  const [createRepoMenuOpen, setCreateRepoMenuOpen] = React.useState(false);
  const createNameRows = React.useMemo(() => {
    const normalized = String(createName ?? '').replace(/\r\n/g, '\n');
    const rows = normalized.split('\n');
    return rows.length > 0 ? rows : [''];
  }, [createName]);
  const createNameEntries = React.useMemo(
    () => createNameRows.map((row) => String(row ?? '').trim()).filter(Boolean),
    [createNameRows],
  );
  const createNameCounts = React.useMemo(() => {
    const out = new Map<string, number>();
    for (const name of createNameEntries) {
      out.set(name, (out.get(name) ?? 0) + 1);
    }
    return out;
  }, [createNameEntries]);
  const [groupMoveError, setGroupMoveError] = React.useState<string | null>(null);
  const [movingDroneGroups, setMovingDroneGroups] = React.useState(false);
  const [draggingDroneNames, setDraggingDroneNames] = React.useState<string[] | null>(null);
  const [dragOverGroup, setDragOverGroup] = React.useState<string | null>(null);
  const [dragOverUngrouped, setDragOverUngrouped] = React.useState(false);
  const [deletingDrones, setDeletingDrones] = React.useState<Record<string, boolean>>({});
  const [renamingDrones, setRenamingDrones] = React.useState<Record<string, boolean>>({});
  const [deletingGroups, setDeletingGroups] = React.useState<Record<string, boolean>>({});
  const [renamingGroups, setRenamingGroups] = React.useState<Record<string, boolean>>({});
  const [createGroupDraft, setCreateGroupDraft] = React.useState('');
  const [createGroupError, setCreateGroupError] = React.useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = React.useState(false);
  const [deletingRepos, setDeletingRepos] = React.useState<Record<string, boolean>>({});
  const [openingTerminal, setOpeningTerminal] = React.useState<{ mode: 'ssh' | 'agent' } | null>(null);
  const [openingEditor, setOpeningEditor] = React.useState<{ editor: 'code' | 'cursor' } | null>(null);
  const [launchHint, setLaunchHint] = React.useState<
    | {
        context: 'terminal' | 'code' | 'cursor';
        command?: string;
        launcher?: string;
        kind: 'copied';
      }
    | null
  >(null);
  const [nameSuggestToast, setNameSuggestToast] = React.useState<null | { id: string; message: string }>(null);
  const [terminalMenuOpen, setTerminalMenuOpen] = React.useState(false);
  const terminalMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = React.useState(false);

  const showNameSuggestionFailureToast = React.useCallback((error: unknown) => {
    const msg = String((error as any)?.message ?? error ?? '').trim();
    const id = makeId();
    setNameSuggestToast({ id, message: msg || 'Name suggestion failed.' });
    window.setTimeout(() => {
      setNameSuggestToast((cur) => (cur?.id === id ? null : cur));
    }, 6000);
  }, []);

  const normalizeCreateRepoPath = React.useCallback(
    (candidate: string): string => {
      const p = String(candidate ?? '').trim();
      if (!p) return '';
      return registeredRepoPathSet.has(p) ? p : '';
    },
    [registeredRepoPathSet],
  );

  const suggestCloneName = React.useCallback(
    (sourceName: string) => {
      const base = `${sourceName}-copy`;
      const taken = new Set(drones.map((d) => d.name.toLowerCase()));
      if (!taken.has(base.toLowerCase())) return base;
      let i = 2;
      while (taken.has(`${base}-${i}`.toLowerCase())) i += 1;
      return `${base}-${i}`;
    },
    [drones],
  );

  function normalizeDraftDroneName(input: string): string {
    const cleaned = String(input ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return cleaned.slice(0, 48).replace(/-+$/g, '');
  }

  function uniqueDraftDroneName(baseRaw: string, opts?: { exclude?: string }): string {
    const exclude = String(opts?.exclude ?? '').trim().toLowerCase();
    const taken = new Set<string>();
    for (const d of drones) {
      const name = String(d?.name ?? '').trim().toLowerCase();
      if (!name || name === exclude) continue;
      taken.add(name);
    }
    for (const nameRaw of Object.keys(startupSeedByDrone)) {
      const name = String(nameRaw ?? '').trim().toLowerCase();
      if (!name || name === exclude) continue;
      taken.add(name);
    }
    const base = normalizeDraftDroneName(baseRaw) || 'untitled';
    if (!taken.has(base)) return base;
    let i = 2;
    while (i < 10_000) {
      const suffix = `-${i}`;
      const maxBaseLen = Math.max(1, 48 - suffix.length);
      const prefix = (base.slice(0, maxBaseLen).replace(/-+$/g, '') || 'untitled').slice(0, maxBaseLen);
      const candidate = `${prefix}${suffix}`;
      if (!taken.has(candidate)) return candidate;
      i += 1;
    }
    return `untitled-${Date.now().toString(36).slice(-6)}`;
  }

  function droneNameHasWhitespace(input: string): boolean {
    return /\s/.test(String(input ?? ''));
  }

  const openCreateModal = React.useCallback(() => {
    if (creating) return;
    setAppView('workspace');
    setDraftChat(null);
    setDraftCreateOpen(false);
    setDraftCreateError(null);
    setCreateError(null);
    if (createMode === 'clone') {
      setCreateName('');
      setCreateGroup('');
      setCreateRepoPath('');
      setCreateInitialMessage('');
      setCreateMessageSuffixRows(['']);
      setCloneIncludeChats(true);
    }
    setCreateMode('create');
    setCloneSourceName(null);
    setCreateRepoPath(normalizeCreateRepoPath(activeRepoPath || ''));
    setCreateInitialMessage('');
    setCreateMessageSuffixRows(['']);
    setCreateOpen(true);
  }, [activeRepoPath, createMode, creating, normalizeCreateRepoPath]);

  const openDraftChatComposer = React.useCallback(() => {
    setAppView('workspace');
    setCreateOpen(false);
    setCreateError(null);
    setDraftCreateOpen(false);
    setDraftCreateName('');
    setDraftCreateGroup('');
    setDraftCreateError(null);
    setDraftAutoRenaming(false);
    setDraftNameSuggestionError(null);
    setDraftNameSuggesting(false);
    draftNameSuggestSeqRef.current = 0;
    setDraftChat({ droneName: '', prompt: null });
    setSelectedDrone(null);
    setSelectedDroneNames([]);
    selectionAnchorRef.current = null;
    preferredSelectedDroneRef.current = null;
    preferredSelectedDroneHoldUntilRef.current = 0;
    setSelectedChat('default');
  }, []);

  const openCloneModal = React.useCallback(
    (source: DroneSummary) => {
      if (creating || deletingDrones[source.name] || renamingDrones[source.name]) return;
      setAppView('workspace');
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      setCreateError(null);
      setCreateMode('clone');
      setCloneSourceName(source.name);
      setCreateName(suggestCloneName(source.name));
      setCreateGroup(source.group ?? '');
      setCreateRepoPath(
        normalizeCreateRepoPath(
          source && (source.repoAttached ?? Boolean(String(source.repoPath ?? '').trim())) ? source.repoPath : '',
        ),
      );
      setCreateInitialMessage('');
      setCreateMessageSuffixRows(['']);
      setCloneIncludeChats(true);
      setCreateOpen(true);
    },
    [creating, deletingDrones, normalizeCreateRepoPath, renamingDrones, suggestCloneName],
  );

  React.useEffect(() => {
    setCreateMessageSuffixRows((prev) => {
      const targetLen = Math.max(1, createNameRows.length);
      if (prev.length === targetLen) return prev;
      if (prev.length > targetLen) return prev.slice(0, targetLen);
      return [...prev, ...Array.from({ length: targetLen - prev.length }, () => '')];
    });
  }, [createNameRows]);

  React.useEffect(() => {
    setCreateRepoPath((prev) => {
      const next = normalizeCreateRepoPath(prev);
      return next === prev ? prev : next;
    });
  }, [normalizeCreateRepoPath]);

  const terminalOptions = React.useMemo(
    () => [
      { id: 'auto', label: 'Auto' },
      { id: 'osascript', label: 'Terminal.app (macOS)' },
      { id: 'wt', label: 'Windows Terminal' },
      { id: 'powershell.exe', label: 'PowerShell (Windows)' },
      { id: 'pwsh', label: 'PowerShell Core' },
      { id: 'kitty', label: 'kitty' },
      { id: 'gnome-terminal', label: 'gnome-terminal' },
      { id: 'x-terminal-emulator', label: 'system default' },
      { id: 'xterm', label: 'xterm' },
      { id: 'konsole', label: 'konsole' },
      { id: 'alacritty', label: 'alacritty' },
    ],
    []
  );

  const terminalLabel =
    terminalOptions.find((o) => o.id === terminalEmulator)?.label ??
    (terminalEmulator === 'auto' ? 'Auto' : terminalEmulator);

  useDropdownDismiss(terminalMenuRef, terminalMenuOpen, setTerminalMenuOpen);
  useDropdownDismiss(headerOverflowRef, headerOverflowOpen, setHeaderOverflowOpen);

  React.useEffect(() => {
    if (!droneErrorModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDroneErrorModal(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [droneErrorModal]);

  React.useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (isEditableTarget(e.target)) return;

      // Keep existing power-user shortcut for opening the bulk create modal.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'n') {
        e.preventDefault();
        openCreateModal();
        return;
      }

      // Letter shortcuts only apply for plain key presses.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (key === 'w') {
        e.preventDefault();
        toggleTldrFromShortcut();
        return;
      }
      if (key === 'a') {
        e.preventDefault();
        openDraftChatComposer();
        return;
      }
      if (key === 's') {
        e.preventDefault();
        openCreateModal();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openCreateModal, openDraftChatComposer, toggleTldrFromShortcut]);

  React.useEffect(() => {
    if (!createOpen) {
      setCreateRepoMenuOpen(false);
      return;
    }
    setCreateRepoMenuOpen(false);
    const id = requestAnimationFrame(() => {
      const el = createNameRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [createOpen]);

  React.useEffect(() => {
    if (!draftCreateOpen) return;
    const id = requestAnimationFrame(() => {
      const el = draftCreateNameRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [draftCreateOpen]);

  React.useEffect(() => {
    if (draftChat) return;
    setDraftCreateOpen(false);
    setDraftCreateError(null);
    setDraftCreating(false);
    setDraftCreateName('');
    setDraftCreateGroup('');
    setDraftNameSuggesting(false);
    setDraftSuggestedName('');
    setDraftNameSuggestionError(null);
    draftNameSuggestSeqRef.current = 0;
  }, [draftChat]);

  React.useEffect(() => {
    if (!draftCreateOpen) return;
    const prompt = String(draftChat?.prompt?.prompt ?? '').trim();
    if (!prompt) return;
    const selectedProvider = llmSettings?.provider?.selected ?? 'openai';
    const selectedSettings = selectedProvider === 'gemini' ? llmSettings?.gemini : llmSettings?.openai;
    if (!selectedSettings?.hasKey) return;
    let mounted = true;
    const seq = draftNameSuggestSeqRef.current + 1;
    draftNameSuggestSeqRef.current = seq;
    setDraftNameSuggesting(true);
    setDraftSuggestedName('');
    setDraftNameSuggestionError(null);
    void requestJson<{ ok: true; name: string }>('/api/drones/name-from-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: prompt }),
    })
      .then((data) => {
        if (!mounted) return;
        if (draftNameSuggestSeqRef.current !== seq) return;
        const suggested = String(data?.name ?? '').trim();
        if (!suggested) return;
        setDraftSuggestedName(suggested);
      })
      .catch((e: any) => {
        if (!mounted) return;
        if (draftNameSuggestSeqRef.current !== seq) return;
        console.error('[DroneHub] draft name suggestion failed', {
          provider: llmSettings?.provider?.selected ?? 'openai',
          error: e?.message ?? String(e),
        });
        setDraftNameSuggestionError(e?.message ?? String(e));
        showNameSuggestionFailureToast(e);
      })
      .finally(() => {
        if (!mounted) return;
        if (draftNameSuggestSeqRef.current !== seq) return;
        setDraftNameSuggesting(false);
      });
    return () => {
      mounted = false;
    };
  }, [draftChat?.prompt?.prompt, draftCreateOpen, llmSettings, showNameSuggestionFailureToast]);

  const outputScrollRef = React.useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = React.useRef(true);
  const [pinnedToBottom, setPinnedToBottom] = React.useState(true);
  const prevOutputLenRef = React.useRef(0);

  function updatePinned(el: HTMLDivElement | null) {
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = gap < 80;
    pinnedToBottomRef.current = pinned;
    setPinnedToBottom(pinned);
  }

  function scrollChatToBottom() {
    // Force-follow on selection change so newly loaded content lands at the bottom.
    pinnedToBottomRef.current = true;
    setPinnedToBottom(true);
    prevOutputLenRef.current = -1;
    prevChatItemsLenRef.current = -1;
    requestAnimationFrame(() => {
      const transcriptEnd = chatEndRef.current;
      if (transcriptEnd) {
        transcriptEnd.scrollIntoView({ behavior: 'auto' });
      }
      const el = outputScrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      updatePinned(el);
    });
  }

  function shouldConfirmDelete(): boolean {
    return !autoDelete;
  }

  function closeDroneErrorModal() {
    setDroneErrorModal(null);
  }

  function openDroneErrorModal(drone: Pick<DroneSummary, 'name'>, message: string, meta?: Partial<RepoOpErrorMeta> | null) {
    const droneName = String(drone?.name ?? '').trim();
    const text = String(message ?? '').trim();
    if (!droneName || !text) return;
    setDroneErrorModal({
      droneName,
      message: text,
      conflict: parseRepoPullConflict(text, meta),
    });
  }

  async function clearDroneHubError(droneNameRaw: string, opts?: { closeModal?: boolean }) {
    const droneName = String(droneNameRaw ?? '').trim();
    if (!droneName) return;
    setClearingDroneError(true);
    try {
      await requestJson<{ ok: true; name: string; cleared: boolean }>(
        `/api/drones/${encodeURIComponent(droneName)}/hub/error/clear`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      );
      if (currentDrone?.name === droneName) {
        setRepoOpError(null);
        setRepoOpErrorMeta(null);
      }
      if (opts?.closeModal !== false) closeDroneErrorModal();
    } catch (e: any) {
      setRepoOpError(e?.message ?? String(e));
    } finally {
      setClearingDroneError(false);
    }
  }

  async function copyText(text: string) {
    const t = String(text ?? '');
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      return;
    } catch {
      // ignore; fall back below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      // ignore
    }
  }

  function githubUrlForRepo(r: RepoSummary): string | null {
    if (r.github && r.github.owner && r.github.repo) return `https://github.com/${r.github.owner}/${r.github.repo}`;
    return null;
  }

  async function deleteRepo(repoPath: string) {
    const p = String(repoPath ?? '').trim();
    if (!p) return;
    if (shouldConfirmDelete()) {
      const ok = window.confirm(`Remove repo "${p}" from the registry?`);
      if (!ok) return;
    }
    setDeletingRepos((prev) => ({ ...prev, [p]: true }));
    try {
      await requestJson(`/api/repos?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
      if (activeRepoPath === p) setActiveRepoPath('');
    } catch (e: any) {
      console.error('[DroneHub] delete repo failed', { path: p, error: e });
    } finally {
      setDeletingRepos((prev) => {
        if (!prev[p]) return prev;
        const next = { ...prev };
        delete next[p];
        return next;
      });
    }
  }

  async function deleteDrone(nameRaw: string) {
    const name = String(nameRaw ?? '').trim();
    if (!name) return;
    if (deletingDrones[name] || renamingDrones[name] || optimisticallyDeletedDrones[name]) return;
    if (shouldConfirmDelete()) {
      const ok = window.confirm(
        `Are you sure you want to delete drone "${name}"?\n\nThis will remove the container and remove it from your registry.`
      );
      if (!ok) return;
    }
    setOptimisticallyDeletedDrones((prev) => ({ ...prev, [name]: true }));
    setDeletingDrones((prev) => ({ ...prev, [name]: true }));
    try {
      await requestJson(`/api/drones/${encodeURIComponent(name)}`, { method: 'DELETE' });
    } catch (e: any) {
      console.error('[DroneHub] delete drone failed', { name, error: e });
      setOptimisticallyDeletedDrones((prev) => {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    } finally {
      setDeletingDrones((prev) => {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  async function renameDrone(nameRaw: string) {
    const name = String(nameRaw ?? '').trim();
    if (!name) return;
    if (deletingDrones[name] || renamingDrones[name]) return;
    const suggested = String(window.prompt(`Rename drone "${name}" to:`, name) ?? '').trim();
    if (!suggested || suggested === name) return;
    const renamed = await renameDroneTo(name, suggested, { showAlert: true });
    if (!renamed.ok) return;
  }

  async function renameDroneTo(
    nameRaw: string,
    newNameRaw: string,
    opts?: { showAlert?: boolean },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const name = String(nameRaw ?? '').trim();
    const newName = String(newNameRaw ?? '').trim();
    if (!name || !newName || newName === name) return { ok: false, error: 'no-op rename' };
    if (deletingDrones[name] || renamingDrones[name]) return { ok: false, error: 'rename busy' };
    if (!isValidDroneNameDashCase(newName)) {
      if (opts?.showAlert) {
        window.alert('Invalid drone name. Use dash-case (letters/numbers and single hyphens), max 48 chars.');
      }
      return { ok: false, error: 'invalid new name' };
    }
    if (drones.some((d) => d.name === newName && d.name !== name)) {
      if (opts?.showAlert) {
        window.alert(`A drone named "${newName}" already exists.`);
      }
      return { ok: false, error: 'name already exists' };
    }

    setRenamingDrones((prev) => ({ ...prev, [name]: true }));
    try {
      await requestJson<{ ok: true; oldName: string; newName: string }>(`/api/drones/${encodeURIComponent(name)}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newName }),
      });
      {
        const ids = droneIdentityByNameRef.current;
        const existingId = ids[name] || makeId();
        ids[newName] = ids[newName] || existingId;
        delete ids[name];
      }
      if (selectedDrone === name || preferredSelectedDroneRef.current === name) {
        preferredSelectedDroneRef.current = newName;
        preferredSelectedDroneHoldUntilRef.current = Date.now() + STARTUP_SEED_MISSING_GRACE_MS;
      }
      if (selectionAnchorRef.current === name) selectionAnchorRef.current = newName;
      setStartupSeedByDrone((prev) => {
        if (!prev[name]) return prev;
        const next = { ...prev };
        const seed = next[name];
        delete next[name];
        if (!next[newName]) next[newName] = seed;
        return next;
      });
      return { ok: true };
    } catch (e: any) {
      console.error('[DroneHub] rename drone failed', { name, newName, error: e });
      if (opts?.showAlert) {
        window.alert(`Rename failed: ${e?.message ?? String(e)}`);
      }
      return { ok: false, error: e?.message ?? String(e) };
    } finally {
      setRenamingDrones((prev) => {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  async function suggestAndRenameDraftDrone(nameRaw: string, promptRaw: string): Promise<void> {
    const currentName = String(nameRaw ?? '').trim();
    const prompt = String(promptRaw ?? '').trim();
    if (!currentName || !prompt) return;
    try {
      const data = await requestJson<{ ok: true; name: string }>('/api/drones/name-from-message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: prompt }),
      });
      const suggested = uniqueDraftDroneName(String(data?.name ?? '').trim(), { exclude: currentName });
      if (!suggested || suggested === currentName) return;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const renamed = await renameDroneTo(currentName, suggested);
        if (renamed.ok) return;
        const msg = String(renamed.error ?? '').toLowerCase();
        const retriable =
          msg.includes('still starting') ||
          msg.includes('unknown drone') ||
          msg.includes('rename busy') ||
          msg.includes('is still provisioning');
        if (!retriable) {
          console.warn('[DroneHub] draft auto-rename aborted', {
            name: currentName,
            suggested,
            attempt: attempt + 1,
            error: renamed.error,
          });
          return;
        }
        const delayMs = Math.min(1800, 200 + attempt * 120);
        await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
      }
      console.warn('[DroneHub] draft auto-rename timed out waiting for drone startup', {
        name: currentName,
        suggested,
      });
    } catch (e: any) {
      console.error('[DroneHub] draft auto-rename skipped', { name: currentName, error: e?.message ?? String(e) });
      showNameSuggestionFailureToast(e);
    }
  }

  async function createGroupFromDraft(): Promise<void> {
    const name = String(createGroupDraft ?? '').trim();
    if (creatingGroup) return;
    if (!name) {
      setCreateGroupError('Group name is required.');
      return;
    }
    if (isUngroupedGroupName(name)) {
      setCreateGroupError('"Ungrouped" is reserved.');
      return;
    }
    setCreatingGroup(true);
    setCreateGroupError(null);
    try {
      await requestJson<{ ok: true; name: string }>('/api/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setCreateGroupDraft('');
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? '').trim();
      setCreateGroupError(msg || 'Failed to create group.');
    } finally {
      setCreatingGroup(false);
    }
  }

  async function renameGroup(groupRaw: string): Promise<void> {
    const group = String(groupRaw ?? '').trim();
    if (!group) return;
    if (isUngroupedGroupName(group)) return;
    if (renamingGroups[group]) return;

    const next = window.prompt(`Rename group "${group}" to:`, group);
    const newName = String(next ?? '').trim();
    if (!newName) return;
    if (newName === group) return;
    if (isUngroupedGroupName(newName)) {
      window.alert('"Ungrouped" is reserved.');
      return;
    }

    setRenamingGroups((prev) => ({ ...prev, [group]: true }));
    try {
      await requestJson<{ ok: true; oldName: string; newName: string; renamed: boolean }>(`/api/groups/${encodeURIComponent(group)}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newName }),
      });

      // Keep per-group UI state aligned after rename.
      setCollapsedGroups((prev) => {
        if (!(group in prev)) return prev;
        const next = { ...prev };
        const wasCollapsed = Boolean(next[group]);
        delete next[group];
        next[newName] = wasCollapsed;
        return next;
      });
      setDeletingGroups((prev) => {
        if (!(group in prev)) return prev;
        const next = { ...prev };
        delete next[group];
        return next;
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? '').trim();
      console.error('[DroneHub] rename group failed', { group, newName, error: e });
      window.alert(msg || 'Rename failed.');
    } finally {
      setRenamingGroups((prev) => {
        if (!prev[group]) return prev;
        const next = { ...prev };
        delete next[group];
        return next;
      });
    }
  }

  async function deleteGroup(groupRaw: string, countHint?: number) {
    const group = String(groupRaw ?? '').trim();
    if (!group || deletingGroups[group]) return;
    if (shouldConfirmDelete()) {
      const n = typeof countHint === 'number' && Number.isFinite(countHint) ? countHint : null;
      const ok = window.confirm(
        `Are you sure you want to delete group "${group}"${n != null ? ` (${n} drone${n === 1 ? '' : 's'})` : ''}?\n\nThis will delete ALL drones inside the group (containers + registry entries).`
      );
      if (!ok) return;
    }
    const wantsUngrouped = isUngroupedGroupName(group);
    const targetNames = Array.from(
      new Set(
        polledDrones
          .filter((d) => {
            const droneGroup = String(d?.group ?? '').trim();
            if (wantsUngrouped) return !droneGroup || isUngroupedGroupName(droneGroup);
            return droneGroup === group;
          })
          .map((d) => String(d?.name ?? '').trim())
          .filter(Boolean),
      ),
    );
    const preHidden = new Set(Object.keys(optimisticallyDeletedDrones).filter((name) => optimisticallyDeletedDrones[name]));
    const addedByThisDelete = targetNames.filter((name) => !preHidden.has(name));
    if (targetNames.length > 0) {
      setOptimisticallyDeletedDrones((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const name of targetNames) {
          if (next[name]) continue;
          next[name] = true;
          changed = true;
        }
        return changed ? next : prev;
      });
    }
    setDeletingGroups((prev) => ({ ...prev, [group]: true }));
    try {
      await requestJson(`/api/groups/${encodeURIComponent(group)}`, { method: 'DELETE' });
    } catch (e: any) {
      console.error('[DroneHub] delete group failed', { group, error: e });
      if (addedByThisDelete.length > 0) {
        setOptimisticallyDeletedDrones((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const name of addedByThisDelete) {
            if (!next[name]) continue;
            delete next[name];
            changed = true;
          }
          return changed ? next : prev;
        });
      }
    } finally {
      setDeletingGroups((prev) => {
        if (!prev[group]) return prev;
        const next = { ...prev };
        delete next[group];
        return next;
      });
    }
  }

  const selectDroneCard = React.useCallback(
    (droneName: string, opts?: { toggle?: boolean; range?: boolean }) => {
      const name = String(droneName ?? '').trim();
      if (!name) return;
      setAppView('workspace');
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      if (opts?.range && orderedDroneNames.length > 0) {
        const anchor =
          (selectionAnchorRef.current && orderedDroneNames.includes(selectionAnchorRef.current) && selectionAnchorRef.current) ||
          (selectedDrone && orderedDroneNames.includes(selectedDrone) ? selectedDrone : name);
        const anchorIdx = orderedDroneNames.indexOf(anchor);
        const selectedIdx = orderedDroneNames.indexOf(name);
        if (anchorIdx >= 0 && selectedIdx >= 0) {
          const start = Math.min(anchorIdx, selectedIdx);
          const end = Math.max(anchorIdx, selectedIdx);
          setSelectedDroneNames(orderedDroneNames.slice(start, end + 1));
          setSelectedDrone(name);
          selectionAnchorRef.current = anchor;
          scrollChatToBottom();
          return;
        }
      }
      if (opts?.toggle) {
        setSelectedDroneNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
        setSelectedDrone(name);
        selectionAnchorRef.current = name;
        scrollChatToBottom();
        return;
      }
      setSelectedDroneNames([name]);
      setSelectedDrone(name);
      selectionAnchorRef.current = name;
      scrollChatToBottom();
    },
    [orderedDroneNames, selectedDrone],
  );

  const parseDroneNamesFromDrag = React.useCallback(
    (event: React.DragEvent<HTMLElement>): string[] => {
      const out: string[] = [];
      const add = (raw: any) => {
        const name = String(raw ?? '').trim();
        if (!name || out.includes(name)) return;
        out.push(name);
      };

      try {
        const jsonRaw = event.dataTransfer.getData(DRONE_DND_MIME);
        if (jsonRaw) {
          const parsed = JSON.parse(jsonRaw);
          if (Array.isArray(parsed)) {
            for (const n of parsed) add(n);
          }
        }
      } catch {
        // ignore malformed drag payload
      }

      if (out.length === 0) {
        const plain = String(event.dataTransfer.getData('text/plain') ?? '');
        if (plain) {
          for (const line of plain.split('\n')) add(line);
        }
      }

      if (out.length === 0 && Array.isArray(draggingDroneNames)) {
        for (const n of draggingDroneNames) add(n);
      }
      return out;
    },
    [draggingDroneNames],
  );

  const moveDronesToGroup = React.useCallback(
    async (targetGroupLabel: string, rawDroneNames: string[]) => {
      const target = String(targetGroupLabel ?? '').trim();
      if (!target) return;
      const targetGroup = isUngroupedGroupName(target) ? null : target;
      const byName = new Map(drones.map((d) => [d.name, d]));
      const requested = Array.from(new Set(rawDroneNames.map((n) => String(n ?? '').trim()).filter(Boolean)));
      if (requested.length === 0) return;

      const movable = requested.filter((name) => {
        const d = byName.get(name);
        if (!d) return false;
        const currentRaw = String(d.group ?? '').trim();
        const currentGroup = !currentRaw || isUngroupedGroupName(currentRaw) ? 'Ungrouped' : currentRaw;
        return currentGroup !== target;
      });
      if (movable.length === 0) return;

      setGroupMoveError(null);
      setMovingDroneGroups(true);
      try {
        const resp = await requestJson<{
          ok: true;
          moved: Array<{ name: string; previousGroup: string | null; group: string | null }>;
          rejected: Array<{ name: string; error: string }>;
        }>(`/api/drones/group-set`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ drones: movable, group: targetGroup }),
        });
        const rejected = Array.isArray(resp?.rejected) ? resp.rejected : [];
        if (rejected.length > 0) {
          const msg = rejected
            .slice(0, 3)
            .map((r) => `${String(r?.name ?? 'unknown')}: ${String(r?.error ?? 'failed')}`)
            .join(', ');
          setGroupMoveError(rejected.length > 3 ? `Some drones could not be moved (${msg}, +${rejected.length - 3} more).` : `Some drones could not be moved (${msg}).`);
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (isNotFoundError(e)) {
          setGroupMoveError('Hub API is missing group-move support. Restart the hub after rebuilding/updating `drone`.');
        } else {
          setGroupMoveError(msg);
        }
        console.error('[DroneHub] move drones between groups failed', { targetGroup: targetGroup ?? null, drones: movable, error: e });
      } finally {
        setMovingDroneGroups(false);
      }
    },
    [drones],
  );

  const onDroneDragStart = React.useCallback(
    (droneName: string, event: React.DragEvent<HTMLDivElement>) => {
      if (movingDroneGroups) {
        event.preventDefault();
        return;
      }
      const name = String(droneName ?? '').trim();
      if (!name) return;
      const names =
        selectedDroneSet.has(name) && selectedDroneNames.length > 0
          ? selectedDroneNames.slice()
          : [name];
      setDraftChat(null);
      setSelectedDrone(name);
      if (!selectedDroneSet.has(name)) setSelectedDroneNames([name]);
      selectionAnchorRef.current = name;
      setDraggingDroneNames(names);
      setDragOverGroup(null);
      setDragOverUngrouped(false);
      setGroupMoveError(null);
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData(DRONE_DND_MIME, JSON.stringify(names));
      } catch {
        // ignore
      }
      try {
        event.dataTransfer.setData('text/plain', names.join('\n'));
      } catch {
        // ignore
      }
    },
    [movingDroneGroups, selectedDroneNames, selectedDroneSet],
  );

  const onDroneDragEnd = React.useCallback(() => {
    setDraggingDroneNames(null);
    setDragOverGroup(null);
    setDragOverUngrouped(false);
  }, []);

  const onGroupDragOver = React.useCallback(
    (group: string, event: React.DragEvent<HTMLDivElement>) => {
      const names = draggingDroneNames && draggingDroneNames.length > 0 ? draggingDroneNames : parseDroneNamesFromDrag(event);
      if (names.length === 0) return;
      event.stopPropagation();
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDragOverUngrouped(false);
      if (dragOverGroup !== group) setDragOverGroup(group);
    },
    [dragOverGroup, draggingDroneNames, parseDroneNamesFromDrag],
  );

  const onGroupDragLeave = React.useCallback((group: string, event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragOverGroup((prev) => (prev === group ? null : prev));
  }, []);

  const onGroupDrop = React.useCallback(
    (group: string, event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragOverGroup(null);
      setDragOverUngrouped(false);
      const names = parseDroneNamesFromDrag(event);
      setDraggingDroneNames(null);
      if (names.length === 0) return;
      void moveDronesToGroup(group, names);
    },
    [moveDronesToGroup, parseDroneNamesFromDrag],
  );

  const onUngroupedDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (hasUngroupedGroup) return;
      const names = draggingDroneNames && draggingDroneNames.length > 0 ? draggingDroneNames : parseDroneNamesFromDrag(event);
      if (names.length === 0) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (dragOverGroup !== null) setDragOverGroup(null);
      if (!dragOverUngrouped) setDragOverUngrouped(true);
    },
    [dragOverGroup, dragOverUngrouped, draggingDroneNames, hasUngroupedGroup, parseDroneNamesFromDrag],
  );

  const onUngroupedDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragOverUngrouped(false);
  }, []);

  const onUngroupedDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (hasUngroupedGroup) return;
      event.preventDefault();
      setDragOverGroup(null);
      setDragOverUngrouped(false);
      const names = parseDroneNamesFromDrag(event);
      setDraggingDroneNames(null);
      if (names.length === 0) return;
      void moveDronesToGroup('Ungrouped', names);
    },
    [hasUngroupedGroup, moveDronesToGroup, parseDroneNamesFromDrag],
  );

  async function openDroneTerminal(mode: 'ssh' | 'agent') {
    if (!currentDrone) return;
    setOpeningTerminal({ mode });
    try {
      const qs = new URLSearchParams();
      qs.set('mode', mode);
      qs.set('chat', selectedChat || 'default');
      qs.set('cwd', droneHomePath(currentDrone));
      if (terminalEmulator && terminalEmulator !== 'auto') qs.set('terminal', terminalEmulator);
      const url = `/api/drones/${encodeURIComponent(currentDrone.name)}/open-terminal?${qs.toString()}`;
      const r = await fetch(url, { method: 'POST' });
      const text = await r.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // ignore
      }

      const cmd = String(data?.manualCommand ?? data?.command ?? '');
      const launcher = typeof data?.launcher === 'string' ? data.launcher : undefined;
      if (!r.ok) {
        const msg = data?.error ?? `${r.status} ${r.statusText}`;
        if (cmd) {
          try {
            await navigator.clipboard.writeText(cmd);
            setLaunchHint({ context: 'terminal', command: cmd, launcher, kind: 'copied' });
            setTimeout(() => setLaunchHint(null), 12_000);
          } catch {
            // ignore
          }
        }
        console.error('[DroneHub] open terminal failed', {
          mode,
          drone: currentDrone.name,
          terminal: terminalEmulator,
          status: r.status,
          statusText: r.statusText,
          msg,
          command: cmd || null,
          launcher: launcher || null,
        });
        return;
      }

      // Success: terminal was (supposedly) opened. Don't auto-copy.
      // No UI hint on success (avoid noisy "Opened terminal" message).
    } catch (e: any) {
      console.error('[DroneHub] open terminal request errored', {
        mode,
        drone: currentDrone?.name ?? null,
        terminal: terminalEmulator,
        error: e,
      });
    } finally {
      setOpeningTerminal(null);
    }
  }

  async function createDrone() {
    const rowSpecs = createNameRows.map((nameRaw, idx) => ({
      nameRaw: String(nameRaw ?? ''),
      name: String(nameRaw ?? '').trim(),
      messageSuffix: String(createMessageSuffixRows[idx] ?? ''),
    }));
    const namedRows = rowSpecs.filter((row) => row.name);
    const names = namedRows.map((row) => row.name);
    const group = createGroup.trim();
    const repoPath = createRepoPath.trim();
    const seedPrompt = createInitialMessage.trim();
    const isClone = createMode === 'clone' && Boolean(cloneSourceName);
    // If we're cloning chats, preserve the source chat agent config(s) by not seeding a new default agent.
    const seedAgent = isClone && cloneIncludeChats ? null : resolveAgentKeyToConfig(spawnAgentKey);
    const seedModel = isClone && cloneIncludeChats ? null : spawnModelForSeed;
    if (names.length === 0) {
      setCreateError('At least one name is required.');
      return;
    }

    const invalid = Array.from(new Set(namedRows.filter((row) => droneNameHasWhitespace(row.nameRaw) || !isValidDroneNameDashCase(row.name)).map((row) => row.name)));
    if (invalid.length > 0) {
      const preview = invalid.slice(0, 4).join(', ');
      const extra = invalid.length > 4 ? ` (+${invalid.length - 4} more)` : '';
      setCreateError(`Invalid name(s): ${preview}${extra}. Use dash-case (letters/numbers and single hyphens), no spaces, max 48 chars.`);
      return;
    }

    const nameCounts = new Map<string, number>();
    for (const name of names) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    const duplicates = Array.from(nameCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name);
    if (duplicates.length > 0) {
      const preview = duplicates.slice(0, 4).join(', ');
      const extra = duplicates.length > 4 ? ` (+${duplicates.length - 4} more)` : '';
      setCreateError(`Duplicate name(s) in list: ${preview}${extra}.`);
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const resp = await queueDrones(
        namedRows.map(({ name, messageSuffix }) => {
          const suffix = messageSuffix.trim();
          const combinedSeedPrompt = [seedPrompt || null, suffix || null]
            .filter((part) => typeof part === 'string' && part.trim().length > 0)
            .join('\n\n');
          return {
            name,
            ...(group ? { group } : {}),
            ...(repoPath ? { repoPath } : {}),
            ...(isClone && cloneSourceName ? { cloneFrom: cloneSourceName, cloneChats: Boolean(cloneIncludeChats) } : {}),
            seedChat: 'default',
            ...(seedAgent ? { seedAgent } : {}),
            ...(seedModel ? { seedModel } : {}),
            ...(combinedSeedPrompt ? { seedPrompt: combinedSeedPrompt } : {}),
          };
        }),
      );

      const acceptedNames = new Set((resp?.accepted ?? []).map((a) => String(a?.name ?? '').trim()).filter(Boolean));
      const rejected = Array.isArray(resp?.rejected) ? resp.rejected : [];

      if (acceptedNames.size > 0) {
        rememberStartupSeed(Array.from(acceptedNames), { agent: seedAgent, model: seedModel, prompt: seedPrompt, chatName: 'default' });
      }

      const firstAccepted = names.find((n) => acceptedNames.has(n)) ?? null;
      if (firstAccepted) {
        preferredSelectedDroneRef.current = firstAccepted;
        preferredSelectedDroneHoldUntilRef.current = Date.now() + STARTUP_SEED_MISSING_GRACE_MS;
        setSelectedDrone(firstAccepted);
        setSelectedDroneNames([firstAccepted]);
        selectionAnchorRef.current = firstAccepted;
      }

      if (rejected.length > 0) {
        const byName = new Map<string, string>();
        for (const r of rejected) {
          const name = String((r as any)?.name ?? '').trim();
          if (!name) continue;
          byName.set(name, String((r as any)?.error ?? 'Failed to queue drone.'));
        }
        const pendingRows = namedRows.filter((row) => !acceptedNames.has(row.name));
        setCreateName(pendingRows.map((row) => row.name).join('\n'));
        setCreateMessageSuffixRows(pendingRows.map((row) => row.messageSuffix));

        const pendingNames = pendingRows.map((row) => row.name);
        const topErrors = pendingNames
          .slice(0, 4)
          .map((name) => `${name}: ${byName.get(name) ?? 'Failed to queue drone.'}`)
          .join('\n');
        const hiddenCount = Math.max(0, pendingNames.length - 4);
        const moreText = hiddenCount > 0 ? `\n(+${hiddenCount} more)` : '';
        const queuedText = acceptedNames.size > 0 ? `${acceptedNames.size} queued. ` : '';
        setCreateError(`${queuedText}${pendingNames.length} failed:\n${topErrors}${moreText}`);
        return;
      }

      setCreateOpen(false);
      setCreateMode('create');
      setCloneSourceName(null);
      setCreateName('');
      setCreateGroup('');
      setCreateRepoPath('');
      setCreateInitialMessage('');
      setCreateMessageSuffixRows(['']);
    } catch (e: any) {
      setCreateError(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  }

  async function startDraftPrompt(promptRaw: string): Promise<boolean> {
    const prompt = String(promptRaw ?? '').trim();
    if (!prompt) return false;
    const tempName = uniqueDraftDroneName('untitled');
    setDraftChat({
      droneName: tempName,
      prompt: {
        id: `draft-${makeId()}`,
        at: new Date().toISOString(),
        prompt,
        state: 'sending',
      },
    });
    setDraftCreateError(null);
    setDraftCreateName('');
    setDraftCreateGroup('');
    setDraftSuggestedName('');
    setDraftNameSuggesting(false);
    setDraftNameSuggestionError(null);
    setDraftAutoRenaming(false);
    setDraftCreateOpen(false);
    const ok = await createDroneFromDraft({ prompt, name: tempName, group: '', autoRename: true });
    if (!ok) {
      clearQueuedPromptsForDrone(tempName);
      setDraftChat({ droneName: '', prompt: null });
      setDraftCreateName('');
      setDraftCreateGroup('');
      return false;
    }
    return true;
  }

  async function createDroneFromDraft(opts?: { prompt?: string; name?: string; group?: string; autoRename?: boolean }): Promise<boolean> {
    const pending = draftChat?.prompt ?? null;
    const prompt = String(opts?.prompt ?? pending?.prompt ?? '').trim();
    const nameRaw = String(opts?.name ?? draftCreateName ?? '');
    const name = nameRaw.trim();
    const group = String(opts?.group ?? draftCreateGroup ?? '').trim();
    const repoPath = String(chatHeaderRepoPath ?? '').trim();
    if (!prompt) {
      setDraftCreateError('Send a first message before creating a drone.');
      return false;
    }
    if (!name) {
      setDraftCreateError('Drone name is required.');
      return false;
    }
    if (droneNameHasWhitespace(nameRaw) || !isValidDroneNameDashCase(name)) {
      setDraftCreateError('Invalid name. Use dash-case (letters/numbers and single hyphens), no spaces, max 48 chars.');
      return false;
    }

    setDraftCreating(true);
    setDraftCreateError(null);
    const seedAgent = resolveAgentKeyToConfig(spawnAgentKey);
    const seedModel = spawnModelForSeed;
    rememberStartupSeed([name], { agent: seedAgent, model: seedModel, prompt, chatName: 'default' });
    preferredSelectedDroneRef.current = name;
    preferredSelectedDroneHoldUntilRef.current = Date.now() + STARTUP_SEED_MISSING_GRACE_MS;
    setSelectedDrone(name);
    setSelectedDroneNames([name]);
    selectionAnchorRef.current = name;
    setSelectedChat('default');
    try {
      const data = await requestJson<{
        ok: true;
        accepted: true;
        name: string;
        chat: string;
        promptId: string;
        created?: boolean;
        phase?: string;
      }>(`/api/drones/${encodeURIComponent(name)}/chats/${encodeURIComponent('default')}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          createIfMissing: true,
          create: {
            ...(group ? { group } : {}),
            ...(repoPath ? { repoPath } : {}),
          },
          seedAgent: seedAgent ?? undefined,
          seedModel: seedModel ?? undefined,
        }),
      });
      const promptId = String((data as any)?.promptId ?? '').trim();
      if (!promptId) {
        throw new Error('missing promptId');
      }

      // Keep the draft row id aligned with the server/daemon prompt id for better debuggability.
      setDraftChat((prev) => {
        if (!prev?.prompt) return prev;
        return {
          droneName: prev.droneName,
          prompt: {
            ...prev.prompt,
            id: promptId,
            state: 'sent',
            updatedAt: new Date().toISOString(),
          },
        };
      });

      if (opts?.autoRename) {
        setDraftAutoRenaming(true);
        void suggestAndRenameDraftDrone(name, prompt).finally(() => setDraftAutoRenaming(false));
      }
      setDraftCreateOpen(false);
      setDraftCreateName('');
      setDraftCreateGroup('');
      setDraftCreateError(null);
      setDraftNameSuggestionError(null);
      setDraftNameSuggesting(false);
      return true;
    } catch (e: any) {
      const err = e?.message ?? String(e);
      clearQueuedPromptsForDrone(name);
      setStartupSeedByDrone((prev) => {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
      if (preferredSelectedDroneRef.current === name) {
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      }
      setSelectedDrone((prev) => (prev === name ? null : prev));
      setSelectedDroneNames((prev) => prev.filter((n) => n !== name));
      setDraftCreateError(err);
      return false;
    } finally {
      setDraftCreating(false);
    }
  }

  function updateCreateNameRow(index: number, value: string) {
    const rows = createNameRows.slice();
    if (index < 0 || index >= rows.length) return;
    rows[index] = value;
    setCreateName(rows.join('\n'));
  }

  function appendCreateNameRow() {
    const rows = createNameRows.slice();
    rows.push('');
    setCreateName(rows.join('\n'));
    setCreateMessageSuffixRows((prev) => [...prev, '']);
  }

  function removeCreateNameRow(index: number) {
    const rows = createNameRows.slice();
    if (index < 0 || index >= rows.length) return;
    if (rows.length <= 1) {
      setCreateName('');
      setCreateMessageSuffixRows(['']);
      return;
    }
    rows.splice(index, 1);
    setCreateName(rows.join('\n'));
    setCreateMessageSuffixRows((prev) => {
      const next = prev.slice();
      next.splice(index, 1);
      return next.length > 0 ? next : [''];
    });
  }

  function updateCreateMessageSuffixRow(index: number, value: string) {
    setCreateMessageSuffixRows((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.slice();
      next[index] = value;
      return next;
    });
  }

  async function openDroneEditor(editor: 'code' | 'cursor') {
    if (!currentDrone) return;
    setOpeningEditor({ editor });
    try {
      const qs = new URLSearchParams();
      qs.set('editor', editor);
      qs.set('cwd', droneHomePath(currentDrone));
      const url = `/api/drones/${encodeURIComponent(currentDrone.name)}/open-editor?${qs.toString()}`;
      const r = await fetch(url, { method: 'POST' });
      const text = await r.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // ignore
      }

      const cmd = String(data?.manualCommand ?? data?.command ?? '');
      const launcher = typeof data?.launcher === 'string' ? data.launcher : undefined;
      if (!r.ok) {
        const msg = data?.error ?? `${r.status} ${r.statusText}`;
        if (cmd) {
          try {
            await navigator.clipboard.writeText(cmd);
            setLaunchHint({ context: editor, command: cmd, launcher, kind: 'copied' });
            setTimeout(() => setLaunchHint(null), 12_000);
          } catch {
            // ignore
          }
        }
        console.error('[DroneHub] open editor failed', {
          editor,
          drone: currentDrone.name,
          status: r.status,
          statusText: r.statusText,
          msg,
          command: cmd || null,
          launcher: launcher || null,
        });
        return;
      }
    } catch (e: any) {
      console.error('[DroneHub] open editor request errored', {
        editor,
        drone: currentDrone?.name ?? null,
        error: e,
      });
    } finally {
      setOpeningEditor(null);
    }
  }

  const [repoOp, setRepoOp] = React.useState<null | { kind: 'pull' | 'reseed' }>(null);
  const [repoOpError, setRepoOpError] = React.useState<string | null>(null);
  const [repoOpErrorMeta, setRepoOpErrorMeta] = React.useState<RepoOpErrorMeta | null>(null);

  async function postJson(url: string, body: any): Promise<{ ok: boolean; status: number; data: any }> {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const text = await r.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: r.ok, status: r.status, data };
  }

  async function pullRepoChanges() {
    if (!currentDrone) return;
    const name = String(currentDrone.name ?? '').trim();
    if (!name) return;
    setRepoOpError(null);
    setRepoOpErrorMeta(null);
    setRepoOp({ kind: 'pull' });
    try {
      const url = `/api/drones/${encodeURIComponent(name)}/repo/pull`;
      const throwRepoPullError = (data: any, fallback: string): never => {
        const message = String(data?.error ?? fallback);
        const code = String(data?.code ?? '').trim();
        const patchName = String(data?.patchName ?? '').trim();
        const conflictFiles = Array.isArray(data?.conflictFiles)
          ? data.conflictFiles.map((f: any) => String(f ?? '').trim()).filter(Boolean)
          : [];
        setRepoOpErrorMeta({
          code: code || null,
          patchName: patchName || null,
          conflictFiles,
        });
        throw new Error(message);
      };
      const response = await postJson(url, {});
      if (!response.ok) throwRepoPullError(response.data, 'Repo pull failed.');
    } catch (e: any) {
      setRepoOpError(e?.message ?? String(e));
    } finally {
      setRepoOp(null);
    }
  }

  async function reseedRepo() {
    if (!currentDrone) return;
    const name = String(currentDrone.name ?? '').trim();
    if (!name) return;
    setRepoOpError(null);
    setRepoOpErrorMeta(null);
    setRepoOp({ kind: 'reseed' });
    try {
      const url = `/api/drones/${encodeURIComponent(name)}/repo/reseed`;
      const r = await postJson(url, {});
      if (!r.ok) throw new Error(String(r.data?.error ?? 'Repo reseed failed.'));
    } catch (e: any) {
      setRepoOpError(e?.message ?? String(e));
    } finally {
      setRepoOp(null);
    }
  }

  const [sendingPromptCount, setSendingPromptCount] = React.useState(0);
  const sendingPrompt = sendingPromptCount > 0;
  const [promptError, setPromptError] = React.useState<string | null>(null);
  const [cliTyping, setCliTyping] = React.useState(false);
  const cliTypingTimerRef = React.useRef<any>(null);

  function bumpCliTyping() {
    setCliTyping(true);
    if (cliTypingTimerRef.current) clearTimeout(cliTypingTimerRef.current);
    cliTypingTimerRef.current = setTimeout(() => setCliTyping(false), 1400);
  }

  React.useEffect(() => {
    return () => {
      if (cliTypingTimerRef.current) clearTimeout(cliTypingTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    // Clear any local optimistic entries when switching chats/drones.
    setOptimisticPendingPrompts([]);
  }, [selectedDrone, selectedChat]);

  function enqueueQueuedPrompt(droneNameRaw: string, chatNameRaw: string, promptRaw: string): PendingPrompt | null {
    const droneName = String(droneNameRaw ?? '').trim();
    const chatName = String(chatNameRaw ?? '').trim() || 'default';
    const prompt = String(promptRaw ?? '').trim();
    if (!droneName || !prompt) return null;
    const item: PendingPrompt = {
      id: `queued-${makeId()}`,
      at: new Date().toISOString(),
      prompt,
      state: 'queued',
    };
    const key = droneChatQueueKey(droneName, chatName);
    setQueuedPromptsByDroneChat((prev) => {
      const cur = prev[key] ?? [];
      return { ...prev, [key]: [...cur, item] };
    });
    return item;
  }

  function patchQueuedPrompt(key: string, id: string, patch: Partial<PendingPrompt>) {
    setQueuedPromptsByDroneChat((prev) => {
      const cur = prev[key];
      if (!cur || cur.length === 0) return prev;
      const idx = cur.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      const nextArr = cur.slice();
      nextArr[idx] = { ...nextArr[idx], ...patch, updatedAt: new Date().toISOString() };
      return { ...prev, [key]: nextArr };
    });
  }

  function removeQueuedPrompt(key: string, id: string) {
    setQueuedPromptsByDroneChat((prev) => {
      const cur = prev[key];
      if (!cur || cur.length === 0) return prev;
      const nextArr = cur.filter((p) => p.id !== id);
      if (nextArr.length === cur.length) return prev;
      if (nextArr.length === 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: nextArr };
    });
  }

  function clearQueuedPromptsForDrone(droneNameRaw: string) {
    const droneName = String(droneNameRaw ?? '').trim();
    if (!droneName) return;
    setQueuedPromptsByDroneChat((prev) => {
      let changed = false;
      const next: Record<string, PendingPrompt[]> = {};
      for (const [k, v] of Object.entries(prev)) {
        const parsed = parseDroneChatQueueKey(k);
        if (parsed && parsed.droneName === droneName) {
          changed = true;
          continue;
        }
        next[k] = v;
      }
      return changed ? next : prev;
    });
  }

  async function sendPromptText(promptRaw: string): Promise<boolean> {
    if (!currentDrone) return false;
    const prompt = String(promptRaw || '').trim();
    if (!prompt) return false;
    if (currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding') {
      enqueueQueuedPrompt(currentDrone.name, selectedChat || 'default', prompt);
      setPromptError(null);
      return true;
    }
    setSendingPromptCount((c) => c + 1);
    setPromptError(null);
    try {
      const data = await requestJson<{ ok: true; accepted: true; promptId: string }>(
        `/api/drones/${encodeURIComponent(currentDrone.name)}/chats/${encodeURIComponent(selectedChat || 'default')}/prompt`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt }),
        },
      );
      if (chatUiMode === 'cli') bumpCliTyping();
      const id = String((data as any)?.promptId ?? '').trim();
      if (chatUiMode === 'transcript' && id) {
        setOptimisticPendingPrompts((prev) => {
          if (prev.some((p) => p.id === id)) return prev;
          return [...prev, { id, at: new Date().toISOString(), prompt, state: 'sending' }];
        });
      }
      return true;
    } catch (e: any) {
      const errText = e?.message ?? String(e);
      setPromptError(errText);
      return false;
    } finally {
      setSendingPromptCount((c) => Math.max(0, c - 1));
    }
  }

  function chatUiModeForAgent(agent: ChatAgentConfig | null | undefined): 'transcript' | 'cli' {
    if (!agent) return 'transcript';
    return agent.kind === 'builtin' ? 'transcript' : 'cli';
  }

  const selectedDroneIdentity = React.useMemo(() => {
    if (!selectedDrone) return '';
    const ids = droneIdentityByNameRef.current;
    if (!ids[selectedDrone]) ids[selectedDrone] = makeId();
    return ids[selectedDrone];
  }, [selectedDrone]);

  const selectedDroneSummary = React.useMemo(
    () => (selectedDrone ? drones.find((x) => x.name === selectedDrone) ?? null : null),
    [drones, selectedDrone],
  );
  const startupSeedForSelectedDrone = React.useMemo(
    () => (selectedDrone ? startupSeedByDrone[selectedDrone] ?? null : null),
    [selectedDrone, startupSeedByDrone],
  );
  const startupAgentForSelectedDrone =
    selectedDroneSummary &&
    (selectedDroneSummary.hubPhase === 'starting' || selectedDroneSummary.hubPhase === 'seeding') &&
    startupSeedForSelectedDrone?.agent
      ? startupSeedForSelectedDrone.agent
      : null;
  const chatUiMode = chatUiModeForAgent(chatInfo?.agent ?? startupAgentForSelectedDrone ?? null);
  const nowMs = useNowMs(1000, chatUiMode === 'transcript');

  React.useEffect(() => {
    chatUiModeRef.current = chatUiMode;
  }, [chatUiMode]);

  React.useEffect(() => {
    const keys = Object.keys(queuedPromptsByDroneChat);
    if (keys.length === 0) return;

    for (const key of keys) {
      const parsed = parseDroneChatQueueKey(key);
      if (!parsed) continue;
      const drone = drones.find((d) => d.name === parsed.droneName) ?? null;
      if (!drone) continue;
      if (drone.hubPhase === 'starting' || drone.hubPhase === 'seeding' || drone.hubPhase === 'error') continue;
      if (flushingQueuedKeysRef.current.has(key)) continue;
      flushingQueuedKeysRef.current.add(key);

      void (async () => {
        while (true) {
          const latest = queuedPromptsByDroneChatRef.current[key] ?? [];
          const head = latest[0] ?? null;
          if (!head) return;
          // Preserve strict FIFO ordering: if the head failed (or is mid-send), don't send later items.
          if (head.state !== 'queued') return;

          patchQueuedPrompt(key, head.id, { state: 'sending', error: undefined });
          try {
            const data = await requestJson<{ ok: true; accepted: true; promptId: string }>(
              `/api/drones/${encodeURIComponent(parsed.droneName)}/chats/${encodeURIComponent(parsed.chatName)}/prompt`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ prompt: head.prompt }),
              },
            );

            const id = String((data as any)?.promptId ?? '').trim();
            removeQueuedPrompt(key, head.id);

            // If the flushed prompt is for the currently visible chat, mirror the optimistic UX.
            const selectedKeyMatches =
              parsed.droneName === String(selectedDrone ?? '').trim() &&
              parsed.chatName === (String(selectedChat ?? '').trim() || 'default');
            if (selectedKeyMatches) {
              if (chatUiMode === 'cli') bumpCliTyping();
              if (chatUiMode === 'transcript' && id) {
                setOptimisticPendingPrompts((prev) => {
                  if (prev.some((p) => p.id === id)) return prev;
                  return [...prev, { id, at: new Date().toISOString(), prompt: head.prompt, state: 'sending' }];
                });
              }
            }
          } catch (e: any) {
            const errText = e?.message ?? String(e);
            patchQueuedPrompt(key, head.id, { state: 'failed', error: errText });
            return;
          }
        }
      })().finally(() => {
        flushingQueuedKeysRef.current.delete(key);
      });
    }
  }, [chatUiMode, drones, queuedPromptsByDroneChat, selectedChat, selectedDrone]);

  const { value: pendingResp } = usePoll<{ ok: true; pending: PendingPrompt[] }>(
    async () => {
      if (chatUiMode !== 'transcript') return { ok: true, pending: [] };
      if (!selectedDrone || !selectedChat) return { ok: true, pending: [] };
      const d = drones.find((x) => x.name === selectedDrone) ?? null;
      if (d?.hubPhase === 'starting' || d?.hubPhase === 'seeding') return { ok: true, pending: [] };
      try {
        return await fetchJson<{ ok: true; pending: PendingPrompt[] }>(
          `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat || 'default')}/pending`,
        );
      } catch {
        return { ok: true, pending: [] };
      }
    },
    1000,
    [chatUiMode, drones, selectedDrone, selectedChat],
  );

  const pendingPrompts: PendingPrompt[] = React.useMemo(() => {
    const server = Array.isArray(pendingResp?.pending) ? pendingResp.pending : [];
    const byId = new Map<string, PendingPrompt>();
    for (const p of server) {
      if (p?.id) byId.set(p.id, p);
    }
    for (const p of optimisticPendingPrompts) {
      if (p?.id && !byId.has(p.id)) byId.set(p.id, p);
    }
    return Array.from(byId.values()).slice(-60);
  }, [optimisticPendingPrompts, pendingResp]);

  const visiblePendingPrompts = React.useMemo(() => {
    if (chatUiMode !== 'transcript') return [];
    const ts = Array.isArray(transcripts) ? transcripts : [];
    const ids = new Set(ts.map((t) => String((t as any)?.id ?? '')).filter(Boolean));
    return pendingPrompts.filter((p) => p.state === 'failed' || !ids.has(p.id));
  }, [chatUiMode, pendingPrompts, transcripts]);

  const startupPendingPrompt = React.useMemo((): PendingPrompt | null => {
    if (chatUiMode !== 'transcript') return null;
    if (!selectedDroneSummary) return null;
    if (selectedDroneSummary.hubPhase !== 'starting' && selectedDroneSummary.hubPhase !== 'seeding') return null;
    const seed = selectedDroneSummary.name ? startupSeedByDrone[selectedDroneSummary.name] : null;
    if (!seed) return null;
    const prompt = String(seed.prompt ?? '').trim();
    if (!prompt) return null;
    return {
      id: `seed-${selectedDroneSummary.name}-${seed.chatName}`,
      at: seed.at || new Date().toISOString(),
      prompt,
      state: 'sending',
      updatedAt: seed.at || undefined,
    };
  }, [chatUiMode, selectedDroneSummary, startupSeedByDrone]);

  const localQueuedPromptsForSelected = React.useMemo((): PendingPrompt[] => {
    if (!selectedDrone) return [];
    const key = droneChatQueueKey(selectedDrone, selectedChat || 'default');
    return queuedPromptsByDroneChat[key] ?? [];
  }, [queuedPromptsByDroneChat, selectedChat, selectedDrone]);

  const visiblePendingPromptsWithStartup = React.useMemo(() => {
    const base = (() => {
      if (!startupPendingPrompt) return visiblePendingPrompts;
      const startupPrompt = String(startupPendingPrompt.prompt ?? '').trim();
      if (
        visiblePendingPrompts.some((p) => {
          if (p.id === startupPendingPrompt.id) return true;
          const prompt = String(p?.prompt ?? '').trim();
          return Boolean(startupPrompt) && Boolean(prompt) && prompt === startupPrompt;
        })
      ) {
        return visiblePendingPrompts;
      }
      return [startupPendingPrompt, ...visiblePendingPrompts];
    })();

    if (chatUiMode !== 'transcript' || localQueuedPromptsForSelected.length === 0) return base;
    const ids = new Set(base.map((p) => p.id));
    const extra = localQueuedPromptsForSelected.filter((p) => !ids.has(p.id));
    return extra.length > 0 ? [...base, ...extra] : base;
  }, [chatUiMode, localQueuedPromptsForSelected, startupPendingPrompt, visiblePendingPrompts]);

  const selectedIsResponding = React.useMemo(() => {
    if (selectedDrone) {
      if (sendingPrompt) return true; // request in flight
      if (chatUiMode === 'cli' && cliTyping) return true; // best-effort signal for custom agents
    }
    return visiblePendingPromptsWithStartup.some((p) => p.state !== 'failed');
  }, [chatUiMode, cliTyping, sendingPrompt, selectedDrone, visiblePendingPromptsWithStartup]);

  async function setChatAgent(agent: ChatAgentConfig) {
    if (!selectedDrone) return;
    const chat = selectedChat || 'default';
    await requestJson(`/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chat)}/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    setChatInfo((prev) => ({
      name: selectedDrone,
      chat,
      agent,
      model: prev?.model ?? null,
      sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
    }));
    setChatInfoError(null);
  }

  async function setChatModel(model: string | null) {
    if (!selectedDrone) return;
    const chat = selectedChat || 'default';
    const normalized = String(model ?? '').trim() || null;
    await requestJson(`/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chat)}/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: normalized }),
    });
    setChatInfo((prev) => ({
      name: selectedDrone,
      chat,
      agent: prev?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig),
      model: normalized,
      sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
    }));
    setManualChatModelInput(normalized ?? '');
    setChatInfoError(null);
  }

  function handleSetAgentFailure(prefix: string, err: any) {
    const msg = err?.message ?? String(err);
    console.error(prefix, err);
    setChatInfoError(msg);
  }

  React.useEffect(() => {
    const valid = new Set(sidebarDronesFilteredByRepo.map((d) => d.name));
    setSelectedDroneNames((prev) => {
      const next = prev.filter((name) => valid.has(name));
      if (selectedDrone && valid.has(selectedDrone) && !next.includes(selectedDrone)) {
        next.push(selectedDrone);
      }
      if (next.length === prev.length && next.every((name, idx) => name === prev[idx])) return prev;
      return next;
    });
  }, [selectedDrone, sidebarDronesFilteredByRepo]);

  React.useEffect(() => {
    setStartupSeedByDrone((prev) => {
      const next = { ...prev };
      let changed = false;
      const byName = new Map(drones.map((d) => [d.name, d]));
      const nowMs = Date.now();
      for (const [name, seed] of Object.entries(next)) {
        const summary = byName.get(name);
        if (!summary) {
          if (!isStartupSeedFresh(seed, nowMs)) {
            delete next[name];
            changed = true;
          }
          continue;
        }
        const isStarting = summary.hubPhase === 'starting' || summary.hubPhase === 'seeding';
        if (!isStarting && !summary.busy) {
          delete next[name];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [drones]);

  // Auto-select first drone (and recover from deletions).
  React.useEffect(() => {
    if (draftChat) {
      if (!draftChat.prompt) {
        if (selectedDrone) setSelectedDrone(null);
        setSelectedDroneNames((prev) => (prev.length === 0 ? prev : []));
        selectionAnchorRef.current = null;
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      }
      return;
    }
    if (dronesFilteredByRepo.length === 0) {
      if (selectedDrone) setSelectedDrone(null);
      setSelectedDroneNames([]);
      setDraggingDroneNames(null);
      setDragOverGroup(null);
      setDragOverUngrouped(false);
      setGroupMoveError(null);
      selectionAnchorRef.current = null;
      preferredSelectedDroneRef.current = null;
      preferredSelectedDroneHoldUntilRef.current = 0;
      return;
    }
    const preferred = preferredSelectedDroneRef.current;
    if (preferred) {
      const preferredExists = dronesFilteredByRepo.some((d) => d.name === preferred);
      if (preferredExists) {
        if (selectedDrone !== preferred) {
          setSelectedDrone(preferred);
          setSelectedDroneNames((prev) => (prev.length === 1 && prev[0] === preferred ? prev : [preferred]));
          selectionAnchorRef.current = preferred;
          return;
        }
        // Preferred selection is only a temporary "land on this drone" hint.
        // Clear it once satisfied so manual navigation can switch away.
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      }
      const holdActive = Date.now() < preferredSelectedDroneHoldUntilRef.current;
      const seed = startupSeedByDrone[preferred] ?? null;
      if (!holdActive && !isStartupSeedFresh(seed)) {
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      } else if (!selectedDrone || !dronesFilteredByRepo.some((d) => d.name === selectedDrone)) {
        // Keep current state while waiting for preferred startup/rename to appear.
        return;
      }
    }
    if (!selectedDrone || !dronesFilteredByRepo.some((d) => d.name === selectedDrone)) {
      const first = dronesFilteredByRepo[0].name;
      setSelectedDrone(first);
      setSelectedDroneNames((prev) => (prev.length === 1 && prev[0] === first ? prev : [first]));
      selectionAnchorRef.current = first;
    }
  }, [activeRepoPath, draftChat, dronesFilteredByRepo, selectedDrone, startupSeedByDrone]);

  // Reset output buffer on effective selection/chat change.
  // Use stable drone identity so in-place renames don't wipe the current chat/output pane.
  React.useEffect(() => {
    sessionOffsetRef.current = null;
    screenLoadedRef.current = false;
    setSessionOffsetBytes(null);
    setSessionText('');
    setSessionError(null);
    setLoadingSession(false);
    setTranscripts(null);
    setTranscriptError(null);
    setLoadingTranscript(false);
    // pending prompts are chat-scoped and loaded in the chat selection effect
  }, [outputView, selectedChat, selectedDroneIdentity]);

  // Fall back if selected chat disappears.
  React.useEffect(() => {
    if (!selectedDrone) return;
    const d = drones.find((x) => x.name === selectedDrone);
    const chats = d?.chats ?? [];
    if (chats.length === 0) return;
    if (selectedChat && chats.includes(selectedChat)) return;
    setSelectedChat(chats.includes('default') ? 'default' : chats[0]);
  }, [drones, selectedDrone, selectedChat]);

  // Poll transcript (builtin agents).
  React.useEffect(() => {
    if (chatUiMode !== 'transcript') return;
    let mounted = true;
    let timer: any = null;
    let busy = false;
    const load = async () => {
      if (!selectedDrone || !selectedChat || busy) return;
      const summary = drones.find((x) => x.name === selectedDrone) ?? null;
        if (summary?.hubPhase === 'starting' || summary?.hubPhase === 'seeding') return;
      // Avoid 404 spam: don't poll transcript until the chat exists.
      const chatExists = Boolean(summary && Array.isArray(summary.chats) && summary.chats.includes(selectedChat));
      if (!chatExists) {
        if (mounted) {
          setTranscripts([]);
          setTranscriptError(null);
          setLoadingTranscript(false);
        }
        return;
      }
      busy = true;
      const initial = transcriptsRef.current === null && !transcriptErrorRef.current;
      if (initial && mounted) setLoadingTranscript(true);
      try {
        const data = await fetchJson<{ ok: true; transcripts: TranscriptItem[] }>(
          `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}/transcript?turn=all`,
        );
        if (!mounted) return;
        setTranscripts(data.transcripts ?? []);
        setTranscriptError(null);
      } catch (e: any) {
        if (!mounted) return;
        if (isNotFoundError(e)) {
          // Treat 404 as "no transcript yet" to avoid a scary error state for brand new chats.
          setTranscripts([]);
          setTranscriptError(null);
        } else {
          setTranscriptError(e?.message ?? String(e));
        }
      } finally {
        if (mounted) setLoadingTranscript(false);
        busy = false;
      }
    };
    load();
    timer = setInterval(load, 2000);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [chatUiMode, drones, selectedDrone, selectedChat]);

  // Auto-scroll on new transcript turns.
  React.useEffect(() => {
    if (chatUiMode !== 'transcript') return;
    const len = (transcripts?.length ?? 0) + visiblePendingPromptsWithStartup.length;
    if (len > 0 && len !== prevChatItemsLenRef.current) {
      prevChatItemsLenRef.current = len;
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [chatUiMode, transcripts, visiblePendingPromptsWithStartup.length]);

  // Poll session output.
  React.useEffect(() => {
    if (chatUiMode !== 'cli') return;
    let mounted = true;
    let timer: any = null;
    let busy = false;
    const load = async () => {
      if (!selectedDrone || !selectedChat || busy) return;
      busy = true;
      const d = drones.find((x) => x.name === selectedDrone) ?? null;
      if (d?.hubPhase === 'starting' || d?.hubPhase === 'seeding') {
        if (mounted) {
          sessionOffsetRef.current = null;
          screenLoadedRef.current = false;
          setSessionOffsetBytes(null);
          setSessionText('');
          setSessionError(null);
          setLoadingSession(false);
        }
        busy = false;
        return;
      }
      const chatExists = Boolean(d && Array.isArray(d.chats) && d.chats.includes(selectedChat));
      if (!chatExists) {
        if (mounted) {
          sessionOffsetRef.current = null;
          screenLoadedRef.current = false;
          setSessionOffsetBytes(null);
          setSessionText('');
          setSessionError(null);
          setLoadingSession(false);
        }
        busy = false;
        return;
      }
      const initial = outputView === 'log' ? sessionOffsetRef.current == null : !screenLoadedRef.current;
      if (initial && mounted) setLoadingSession(true);
      try {
        const qs = new URLSearchParams();
        if (outputView === 'screen') {
          qs.set('view', 'screen');
          qs.set('tail', '2000');
          const data = await fetchJson<{ ok: true; text: string }>(
            `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}/output?${qs.toString()}`,
          );
          if (!mounted) return;
          const nextText = typeof data?.text === 'string' ? data.text : '';
          const nextPlain = stripAnsi(nextText);
          if (sessionTextRef.current && nextPlain !== sessionTextRef.current) bumpCliTyping();
          screenLoadedRef.current = true;
          sessionOffsetRef.current = null;
          setSessionOffsetBytes(null);
          setSessionError(null);
          setSessionText((prev) => (prev === nextPlain ? prev : nextPlain));
        } else {
          if (initial) {
            qs.set('tail', '200');
          } else {
            qs.set('since', String(sessionOffsetRef.current));
            qs.set('maxBytes', '200000');
          }
          const data = await fetchJson<{ ok: true; offsetBytes: number; text: string }>(
            `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}/output?${qs.toString()}`,
          );
          if (!mounted) return;
          const nextOffset =
            typeof data?.offsetBytes === 'number' && Number.isFinite(data.offsetBytes)
              ? data.offsetBytes
              : sessionOffsetRef.current ?? 0;
          const chunk = typeof data?.text === 'string' ? data.text : '';
          const chunkPlain = chunk ? stripAnsi(chunk) : '';
          sessionOffsetRef.current = nextOffset;
          setSessionOffsetBytes(nextOffset);
          setSessionError(null);
          if (initial) {
            setSessionText(chunkPlain);
          } else if (chunkPlain) {
            bumpCliTyping();
            setSessionText((prev) => {
              const next = prev + chunkPlain;
              return next.length > 800_000 ? next.slice(-800_000) : next;
            });
          }
        }
      } catch (e: any) {
        if (!mounted) return;
        setSessionError(e?.message ?? String(e));
      } finally {
        if (mounted) setLoadingSession(false);
        busy = false;
      }
    };
    load();
    timer = setInterval(load, 1000);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [chatUiMode, drones, selectedDrone, selectedChat, outputView]);

  // Auto-scroll on new output.
  React.useEffect(() => {
    if (chatUiMode !== 'cli') return;
    const len = sessionText.length;
    if (len > 0 && len !== prevOutputLenRef.current) {
      prevOutputLenRef.current = len;
      if (pinnedToBottomRef.current) {
        requestAnimationFrame(() => {
          const el = outputScrollRef.current;
          if (!el) return;
          el.scrollTop = el.scrollHeight;
          updatePinned(el);
        });
      }
    }
  }, [sessionText]);

  const currentDrone = selectedDrone ? drones.find((d) => d.name === selectedDrone) ?? null : null;
  const currentDroneRepoAttached = Boolean(currentDrone?.repoAttached ?? Boolean(String(currentDrone?.repoPath ?? '').trim()));
  const currentDroneRepoPath = String(currentDrone?.repoPath ?? '').trim();
  React.useEffect(() => {
    const pending = draftChat?.prompt ?? null;
    const prompt = String(pending?.prompt ?? '').trim();
    if (!pending || !prompt || draftCreating || draftAutoRenaming) return;
    if (!selectedDrone || !currentDrone) return;
    if (chatUiMode === 'cli') {
      setDraftChat(null);
      return;
    }
    const promptInTranscript = Boolean(transcripts?.some((item) => String(item?.prompt ?? '').trim() === prompt));
    const promptInPending = visiblePendingPromptsWithStartup.some((item) => String(item?.prompt ?? '').trim() === prompt);
    if (!promptInTranscript && !promptInPending) return;
    setDraftChat(null);
  }, [
    chatUiMode,
    currentDrone,
    draftAutoRenaming,
    draftChat?.prompt,
    draftCreating,
    selectedDrone,
    transcripts,
    visiblePendingPromptsWithStartup,
  ]);
  const currentGroup = currentDrone?.group ? groups.find((g) => g.group === currentDrone.group) ?? null : null;
  const defaultFsPathForCurrentDrone = React.useMemo(() => {
    if (!currentDrone) return '/dvm-data/home';
    return droneHomePath(currentDrone);
  }, [currentDrone?.name, currentDrone?.repoAttached, currentDrone?.repoPath]);
  const currentFsPath = React.useMemo(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return '/dvm-data/home';
    const saved = fsPathByDrone[droneName];
    return normalizeContainerPathInput(saved || defaultFsPathForCurrentDrone);
  }, [currentDrone?.name, defaultFsPathForCurrentDrone, fsPathByDrone]);
  const setCurrentFsPath = React.useCallback(
    (nextPath: string) => {
      const droneName = String(currentDrone?.name ?? '').trim();
      if (!droneName) return;
      const normalized = normalizeContainerPathInput(nextPath);
      setFsPathByDrone((prev) => {
        if ((prev[droneName] ?? '') === normalized) return prev;
        return { ...prev, [droneName]: normalized };
      });
    },
    [currentDrone?.name],
  );
  const refreshFsList = React.useCallback(() => {
    setFsRefreshNonce((n) => n + 1);
  }, []);
  const fsPollIntervalMs = currentDrone ? 8000 : 60000;
  const {
    value: fsResp,
    error: fsError,
    loading: fsLoading,
  } = usePoll<DroneFsListPayload>(
    () =>
      currentDrone
        ? requestJson(`/api/drones/${encodeURIComponent(currentDrone.name)}/fs/list?path=${encodeURIComponent(currentFsPath)}`)
        : Promise.resolve({ ok: true, name: '', path: '/', entries: [] }),
    fsPollIntervalMs,
    [currentDrone?.name, currentFsPath, fsRefreshNonce],
  );
  const fsPayloadError =
    fsResp && (fsResp as any).ok === false ? String((fsResp as any)?.error ?? 'filesystem request failed') : null;
  const fsErrorCombined = fsError ?? fsPayloadError;
  const fsEntries = fsResp && (fsResp as any).ok === true ? (((fsResp as any).entries as DroneFsEntry[]) ?? []) : [];

  const filesPane = usePaneReadiness({
    hubPhase: currentDrone?.hubPhase,
    resetKey: `${currentDrone?.name ?? ''}\u0000files`,
    timeoutMs: 18_000,
  });
  const fsOkForCurrentDrone = Boolean(
    currentDrone &&
      (fsResp as any)?.ok === true &&
      String((fsResp as any)?.name ?? '').trim() === String(currentDrone.name ?? '').trim(),
  );
  React.useEffect(() => {
    if (fsOkForCurrentDrone) filesPane.markReady();
  }, [fsOkForCurrentDrone, filesPane.markReady]);
  const fsErrorUi = filesPane.suppressErrors ? null : fsErrorCombined;

  const portsPollIntervalMs = currentDrone ? 5000 : 60000;
  const {
    value: portsResp,
    error: portsError,
    loading: portsLoading,
  } = usePoll<DronePortsPayload>(
    () =>
      currentDrone
        ? fetchJson(`/api/drones/${encodeURIComponent(currentDrone.name)}/ports`)
        : Promise.resolve({ ok: true, name: '', ports: [] }),
    portsPollIntervalMs,
    [currentDrone?.name],
  );
  const ports = portsResp && (portsResp as any).ok === true ? ((portsResp as any).ports as DronePortMapping[]) : null;
  const portsPayloadError =
    portsResp && (portsResp as any).ok === false ? String((portsResp as any)?.error ?? 'ports request failed') : null;
  const portsErrorCombined = portsError ?? portsPayloadError;

  const portsPane = usePaneReadiness({
    hubPhase: currentDrone?.hubPhase,
    resetKey: `${currentDrone?.name ?? ''}\u0000ports`,
    timeoutMs: 18_000,
  });
  const portsOkForCurrentDrone = Boolean(
    currentDrone &&
      (portsResp as any)?.ok === true &&
      String((portsResp as any)?.name ?? '').trim() === String(currentDrone.name ?? '').trim(),
  );
  React.useEffect(() => {
    if (portsOkForCurrentDrone) portsPane.markReady();
  }, [portsOkForCurrentDrone, portsPane.markReady]);
  const portsErrorUi = portsPane.suppressErrors ? null : portsErrorCombined;
  const portRows = React.useMemo(
    () =>
      normalizePortRows(
        ports,
        typeof currentDrone?.hostPort === 'number' && Number.isFinite(currentDrone.hostPort) ? currentDrone.hostPort : null,
        typeof currentDrone?.containerPort === 'number' && Number.isFinite(currentDrone.containerPort) ? currentDrone.containerPort : null,
      ),
    [ports, currentDrone?.hostPort, currentDrone?.containerPort],
  );
  const [portPreviewByDrone, setPortPreviewByDrone] = React.useState<PortPreviewByDrone>(() => readPortPreviewByDrone());
  const [previewUrlByDrone, setPreviewUrlByDrone] = React.useState<PreviewUrlByDrone>(() => readPreviewUrlByDrone());
  const [portReachabilityByDrone, setPortReachabilityByDrone] = React.useState<PortReachabilityByDrone>({});
  usePersistedLocalStorageItem(PORT_PREVIEW_STORAGE_KEY, JSON.stringify(portPreviewByDrone));
  usePersistedLocalStorageItem(PREVIEW_URL_STORAGE_KEY, JSON.stringify(previewUrlByDrone));

  const selectedPreviewPort = React.useMemo(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return null;
    const saved = portPreviewByDrone[droneName];
    if (!saved) return null;
    return (
      portRows.find((p) => p.containerPort === saved.containerPort && p.hostPort === saved.hostPort) ??
      portRows.find((p) => p.containerPort === saved.containerPort) ??
      portRows.find((p) => p.hostPort === saved.hostPort) ??
      null
    );
  }, [currentDrone?.name, portPreviewByDrone, portRows]);
  const portRowsSignature = React.useMemo(
    () => portRows.map((p) => `${p.containerPort}:${p.hostPort}`).join(','),
    [portRows],
  );

  const setSelectedPreviewPort = React.useCallback(
    (port: DronePortMapping | null) => {
      const droneName = String(currentDrone?.name ?? '').trim();
      if (!droneName) return;
      if (port) {
        // Selecting a port should make preview follow that port URL.
        setPreviewUrlByDrone((prev) => {
          if (!prev[droneName]) return prev;
          const next = { ...prev };
          delete next[droneName];
          return next;
        });
      }
      setPortPreviewByDrone((prev) => {
        const next = { ...prev };
        if (!port) {
          if (!next[droneName]) return prev;
          delete next[droneName];
          return next;
        }
        const prevSel = next[droneName];
        if (prevSel && prevSel.hostPort === port.hostPort && prevSel.containerPort === port.containerPort) return prev;
        next[droneName] = { hostPort: port.hostPort, containerPort: port.containerPort };
        return next;
      });
    },
    [currentDrone?.name],
  );
  const selectedPreviewDefaultUrl = React.useMemo(
    () =>
      selectedPreviewPort && currentDrone?.name
        ? buildContainerPreviewUrl(currentDrone.name, selectedPreviewPort.containerPort)
        : null,
    [currentDrone?.name, selectedPreviewPort],
  );
  const selectedPreviewUrlOverride = React.useMemo(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return null;
    return previewUrlByDrone[droneName] ?? null;
  }, [currentDrone?.name, previewUrlByDrone]);
  const setSelectedPreviewUrlOverride = React.useCallback(
    (nextUrl: string | null) => {
      const droneName = String(currentDrone?.name ?? '').trim();
      if (!droneName) return;
      setPreviewUrlByDrone((prev) => {
        const next = { ...prev };
        const normalized = nextUrl ? normalizePreviewUrl(nextUrl) : null;
        if (!normalized) {
          if (!next[droneName]) return prev;
          delete next[droneName];
          return next;
        }
        const rewritten = rewriteLoopbackUrlToContainerPreview(normalized, droneName, portRows);
        const finalUrl = normalizePreviewUrl(rewritten || normalized) ?? (rewritten || normalized);
        const defaultUrl = selectedPreviewDefaultUrl
          ? normalizePreviewUrl(selectedPreviewDefaultUrl) ?? selectedPreviewDefaultUrl
          : null;
        if (defaultUrl && finalUrl === defaultUrl) {
          if (!next[droneName]) return prev;
          delete next[droneName];
          return next;
        }
        if (next[droneName] === finalUrl) return prev;
        next[droneName] = finalUrl;
        return next;
      });
    },
    [currentDrone?.name, portRows, selectedPreviewDefaultUrl],
  );

  React.useEffect(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return;
    const currentOverride = previewUrlByDrone[droneName];
    if (!currentOverride) return;
    const rewritten = rewriteLoopbackUrlToContainerPreview(currentOverride, droneName, portRows);
    if (!rewritten) return;
    const rewrittenNormalized = normalizePreviewUrl(rewritten) ?? rewritten;
    const defaultUrl = selectedPreviewDefaultUrl
      ? normalizePreviewUrl(selectedPreviewDefaultUrl) ?? selectedPreviewDefaultUrl
      : null;
    const nextValue = defaultUrl && rewrittenNormalized === defaultUrl ? null : rewrittenNormalized;
    setPreviewUrlByDrone((prev) => {
      if (prev[droneName] !== currentOverride) return prev;
      const next = { ...prev };
      if (!nextValue) {
        delete next[droneName];
      } else {
        next[droneName] = nextValue;
      }
      return next;
    });
  }, [currentDrone?.name, portRows, previewUrlByDrone, selectedPreviewDefaultUrl]);

  React.useEffect(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName || portRows.length === 0) return;
    let mounted = true;
    let timer: any = null;

    const warmStatuses = () => {
      setPortReachabilityByDrone((prev) => {
        const current = prev[droneName] ?? {};
        const nextForDrone: PortReachabilityByHostPort = {};
        for (const p of portRows) {
          const key = String(p.hostPort);
          nextForDrone[key] = current[key] ?? 'checking';
        }
        if (sameReachabilityMap(current, nextForDrone)) return prev;
        return { ...prev, [droneName]: nextForDrone };
      });
    };

    const probe = async () => {
      const checks = await Promise.all(
        portRows.map(async (p) => ({
          hostPort: p.hostPort,
          state: (await probeLocalhostPort(p.hostPort)) ? ('up' as const) : ('down' as const),
        })),
      );
      if (!mounted) return;
      setPortReachabilityByDrone((prev) => {
        const current = prev[droneName] ?? {};
        const nextForDrone: PortReachabilityByHostPort = {};
        for (const c of checks) nextForDrone[String(c.hostPort)] = c.state;
        if (sameReachabilityMap(current, nextForDrone)) return prev;
        return { ...prev, [droneName]: nextForDrone };
      });
    };

    warmStatuses();
    void probe();
    timer = setInterval(() => {
      void probe();
    }, PORT_STATUS_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [currentDrone?.name, portRowsSignature]);

  const currentPortReachability = React.useMemo(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return {};
    return portReachabilityByDrone[droneName] ?? {};
  }, [currentDrone?.name, portReachabilityByDrone]);
  const startupSeedForCurrentDrone =
    currentDrone && (currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding')
      ? startupSeedByDrone[currentDrone.name] ?? null
      : null;
  const effectiveChatInfo = chatInfo
    ? chatInfo
    : currentDrone && startupSeedForCurrentDrone?.agent
      ? {
          name: currentDrone.name,
          chat: startupSeedForCurrentDrone.chatName || selectedChat || 'default',
          agent: startupSeedForCurrentDrone.agent,
          model: startupSeedForCurrentDrone.model ?? null,
          sessionName: `drone-hub-chat-${startupSeedForCurrentDrone.chatName || selectedChat || 'default'}`,
          createdAt: startupSeedForCurrentDrone.at || new Date().toISOString(),
        }
      : null;
  const builtinAgentOptions: Array<{ key: string; label: string; agent: ChatAgentConfig }> = BUILTIN_AGENT_OPTIONS;
  const currentAgent = effectiveChatInfo?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig);
  const currentModel = String(chatInfo?.model ?? effectiveChatInfo?.model ?? '').trim() || null;
  const currentAgentKey =
    currentAgent.kind === 'builtin'
      ? `builtin:${currentAgent.id}`
      : `custom:${currentAgent.id}`;
  const currentDroneBusy =
    currentDrone && currentDrone.hubPhase !== 'starting' && currentDrone.hubPhase !== 'seeding'
      ? Boolean(currentDrone.busy) || selectedIsResponding
      : false;
  const showRespondingAsStatusInHeader =
    Boolean(currentDroneBusy) && Boolean(currentDrone?.statusOk) && currentDrone?.hubPhase !== 'error';
  const currentCustomAgentMissing = currentAgent.kind === 'custom' && !customAgents.some((a) => a.id === currentAgent.id);
  const agentDisabled =
    loadingChatInfo ||
    Boolean(openingTerminal) ||
    Boolean(openingEditor) ||
    currentDrone?.hubPhase === 'starting' ||
    currentDrone?.hubPhase === 'seeding';
  const modelControlEnabled = currentAgent.kind === 'builtin';
  const modelDisabled = agentDisabled || !modelControlEnabled;
  const availableChatModels = React.useMemo(() => {
    const map = new Map<string, ChatModelOption>();
    for (const m of chatModels) {
      const id = String(m.id ?? '').trim();
      if (!id) continue;
      map.set(id, m);
    }
    if (currentModel && !map.has(currentModel)) {
      map.set(currentModel, { id: currentModel, label: `${currentModel} (custom)` });
    }
    return Array.from(map.values());
  }, [chatModels, currentModel]);
  const modelMenuEntries = React.useMemo(
    () => [
      { value: '', label: 'Default model' },
      ...availableChatModels.map((m) => ({
        value: m.id,
        label: `${m.label}${m.isDefault ? ' (default)' : ''}${m.isCurrent ? ' (current)' : ''}`,
      })),
    ],
    [availableChatModels]
  );
  const modelLabel = React.useMemo(() => {
    const active = modelMenuEntries.find((entry) => entry.value === (currentModel ?? ''));
    return String(active?.label ?? 'Default model');
  }, [currentModel, modelMenuEntries]);
  const createRepoMenuEntries = React.useMemo(
    () => [
      { value: '', label: 'No repo' },
      ...registeredRepoPaths.map((path) => ({ value: path, label: path, title: path, className: 'font-mono truncate' })),
    ],
    [registeredRepoPaths]
  );
  const spawnAgentMenuEntries = React.useMemo(
    () => [
      ...BUILTIN_AGENT_OPTIONS.map((o) => ({ value: o.key, label: o.label })),
      ...(customAgents.length > 0
        ? [
            { kind: 'separator' as const },
            ...customAgents.map((a) => ({ value: `custom:${a.id}`, label: `Custom: ${a.label}` })),
          ]
        : []),
    ],
    [customAgents]
  );
  const spawnAgentLabel = React.useMemo(() => {
    const builtin = BUILTIN_AGENT_OPTIONS.find((o) => o.key === spawnAgentKey);
    if (builtin) return builtin.label;
    if (spawnAgentKey.startsWith('custom:')) {
      const id = spawnAgentKey.slice('custom:'.length);
      const custom = customAgents.find((a) => a.id === id);
      if (custom) return `Custom: ${custom.label}`;
    }
    return 'Agent';
  }, [customAgents, spawnAgentKey]);
  const toolbarAgentMenuEntries = React.useMemo(() => {
    const entries: Array<
      | { value: string; label: string; title?: string; inactiveClassName?: string }
      | { kind: 'separator' }
    > = [...builtinAgentOptions.map((o) => ({ value: o.key, label: o.label }))];
    entries.push({ kind: 'separator' });
    if (currentCustomAgentMissing && currentAgent.kind === 'custom') {
      entries.push({
        value: `custom:${currentAgent.id}`,
        label: `Custom: ${currentAgent.label}`,
        title: 'This custom agent is configured on the drone but not saved locally.',
      });
    }
    for (const a of customAgents) {
      entries.push({ value: `custom:${a.id}`, label: `Custom: ${a.label}` });
    }
    entries.push({ kind: 'separator' });
    entries.push({
      value: '__add_custom__',
      label: 'Add custom...',
      inactiveClassName: 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]',
    });
    return entries;
  }, [builtinAgentOptions, currentAgent, currentCustomAgentMissing, customAgents]);
  const agentLabel = (() => {
    const builtin = builtinAgentOptions.find((o) => o.key === currentAgentKey);
    if (builtin) return builtin.label;
    if (currentAgent.kind === 'custom') return `Custom: ${currentAgent.label}`;
    return currentAgentKey;
  })();
  const rightPanelDefaultWidth = clampRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  const rightPanelWidthIsDefault = Math.abs(rightPanelWidth - rightPanelDefaultWidth) <= 1;
  const rightPanelWidthMax = rightPanelMaxWidthPx(viewportWidthPx());

  function pickAgentValue(v: string) {
    if (v === '__add_custom__') {
      setCustomAgentError(null);
      setNewCustomAgentLabel('');
      setNewCustomAgentCommand('');
      setCustomAgentModalOpen(true);
      return;
    }
    const builtin = builtinAgentOptions.find((o) => o.key === v);
    if (builtin) {
      void setChatAgent(builtin.agent).catch((err: any) => handleSetAgentFailure('[DroneHub] set agent failed', err));
      return;
    }
    if (v.startsWith('custom:')) {
      const id = v.slice('custom:'.length);
      const local = customAgents.find((a) => a.id === id) ?? null;
      const fallback = currentAgent?.kind === 'custom' && currentAgent.id === id ? currentAgent : null;
      const agent: ChatAgentConfig | null = local
        ? { kind: 'custom', id: local.id, label: local.label, command: local.command }
        : fallback
          ? fallback
          : null;
      if (agent) {
        void setChatAgent(agent).catch((err: any) => handleSetAgentFailure('[DroneHub] set custom agent failed', err));
      }
    }
  }

  function applyManualChatModel() {
    if (modelDisabled) return;
    const next = String(manualChatModelInput ?? '').trim();
    void setChatModel(next || null).catch((err: any) => {
      const msg = err?.message ?? String(err);
      setChatInfoError(msg);
    });
  }

  function setRightPanelSplitMode(next: boolean) {
    setRightPanelSplit((prev) => {
      if (prev === next) return prev;
      if (next && rightPanelBottomTab === rightPanelTab) {
        const fallback = RIGHT_PANEL_TABS.find((tab) => tab !== rightPanelTab) ?? rightPanelTab;
        setRightPanelBottomTab(fallback);
      }
      return next;
    });
  }

  const resetRightPanelWidth = React.useCallback(() => {
    setRightPanelWidth(clampRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX));
  }, []);

  const startRightPanelResize = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!rightPanelOpen) return;
      event.preventDefault();
      event.stopPropagation();
      rightPanelResizeRef.current = { startX: event.clientX, startWidth: rightPanelWidth };
      setRightPanelResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (moveEvent: MouseEvent) => {
        const state = rightPanelResizeRef.current;
        if (!state) return;
        const delta = state.startX - moveEvent.clientX;
        setRightPanelWidth(clampRightPanelWidthPx(state.startWidth + delta));
      };

      const onMouseUp = () => {
        rightPanelResizeRef.current = null;
        setRightPanelResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [rightPanelOpen, rightPanelWidth],
  );

  function renderRightPanelTabContent(
    drone: DroneSummary,
    tab: RightPanelTab,
    paneKey: 'top' | 'bottom' | 'single',
  ): React.ReactNode {
    const disabled = drone.hubPhase === 'starting' || drone.hubPhase === 'seeding';
    const chatName = selectedChat || 'default';
    const isCurrent = Boolean(currentDrone && String(currentDrone.name) === String(drone.name));
    const contentByTab: Record<RightPanelTab, React.ReactNode> = {
      terminal: (
        <DroneTerminalDock
          key={`${paneKey}-terminal`}
          droneName={drone.name}
          chatName={chatName}
          defaultCwd={defaultFsPathForCurrentDrone}
          disabled={disabled}
          hubPhase={drone.hubPhase}
          hubMessage={drone.hubMessage}
        />
      ),
      files: (
        <DroneFilesDock
          key={`${paneKey}-files`}
          droneName={drone.name}
          path={currentFsPath}
          homePath={defaultFsPathForCurrentDrone}
          entries={fsEntries}
          loading={fsLoading}
          error={isCurrent ? fsErrorUi : fsError}
          startup={
            isCurrent
              ? {
                  waiting: filesPane.waiting,
                  timedOut: filesPane.timedOut,
                  hubPhase: drone.hubPhase,
                  hubMessage: drone.hubMessage,
                }
              : null
          }
          viewMode={fsExplorerView}
          onSetViewMode={setFsExplorerView}
          onOpenPath={setCurrentFsPath}
          onRefresh={refreshFsList}
        />
      ),
      preview: (
        <DronePreviewDock
          key={`${paneKey}-preview`}
          selectedPort={selectedPreviewPort}
          portReachabilityByHostPort={currentPortReachability}
          portsLoading={portsLoading}
          portsError={isCurrent ? portsErrorUi : portsError}
          startup={
            isCurrent
              ? {
                  waiting: portsPane.waiting,
                  timedOut: portsPane.timedOut,
                  hubPhase: drone.hubPhase,
                  hubMessage: drone.hubMessage,
                }
              : null
          }
          defaultPreviewUrl={selectedPreviewDefaultUrl}
          previewUrlOverride={selectedPreviewUrlOverride}
          onSetPreviewUrlOverride={setSelectedPreviewUrlOverride}
        />
      ),
      links: (
        <DroneLinksDock
          key={`${paneKey}-links`}
          droneName={drone.name}
          agentLabel={agentLabel}
          chatName={chatName}
          portRows={portRows}
          selectedPort={selectedPreviewPort}
          portReachabilityByHostPort={currentPortReachability}
          onSelectPort={setSelectedPreviewPort}
          portsLoading={portsLoading}
          portsError={isCurrent ? portsErrorUi : portsError}
        />
      ),
      changes: (
        <DroneChangesDock
          key={`${paneKey}-changes`}
          droneName={drone.name}
          repoAttached={drone.repoAttached ?? Boolean(String(drone.repoPath ?? '').trim())}
          repoPath={drone.repoPath}
          disabled={disabled}
          hubPhase={drone.hubPhase}
          hubMessage={drone.hubMessage}
        />
      ),
    };
    return contentByTab[tab];
  }

  return (
    <div className="flex h-screen overflow-hidden fixed inset-0">
      {/* ── Sidebar ── */}
      <aside
        className="bg-[var(--panel-alt)] border-r border-[var(--border)] flex flex-col min-h-0 relative dh-dot-grid flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
        style={{ width: sidebarCollapsed ? 0 : 280 }}
      >
        {/* Sidebar header */}
        <div className="flex-shrink-0 px-3 py-3 border-b border-[var(--border)] relative">
          {/* Accent bar at top of sidebar */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="font-semibold text-[13px] text-[var(--fg)] whitespace-nowrap"
                style={{ fontFamily: 'var(--display)' }}
              >
                Drone Hub
              </span>
              {selectedDroneNames.length > 1 && (
                <span className="text-[10px] text-[var(--accent)] whitespace-nowrap" title={`${selectedDroneNames.length} drones selected`}>
                  {selectedDroneNames.length} selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={openDraftChatComposer}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  draftChat
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title="Create drone (A)"
                aria-label="Create drone"
              >
                <IconPlus className="opacity-80" />
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                title="Create multiple drones (S)"
                aria-label="Create multiple drones"
              >
                <IconPlusDouble className="opacity-80" />
              </button>
              <button
                type="button"
                onClick={() => setAppView(appView === 'settings' ? 'workspace' : 'settings')}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  appView === 'settings'
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title={appView === 'settings' ? 'Back to workspace' : 'Open settings'}
                aria-label={appView === 'settings' ? 'Back to workspace' : 'Open settings'}
              >
                <IconSettings className="opacity-80" />
              </button>
              <button
                onClick={() => setViewMode(viewMode === 'grouped' ? 'flat' : 'grouped')}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-semibold text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-all"
                title={viewMode === 'grouped' ? 'Switch to flat list' : 'Switch to grouped folders'}
              >
                <IconList className="opacity-60" />
                {viewMode === 'grouped' ? 'Grp' : 'Flat'}
              </button>
            </div>
          </div>
        </div>

        {/* Drone list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {dronesError && (
            <div className="mx-2 mb-2 p-3 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-xs text-[var(--red)]">
              Failed to load drones: {dronesError}
            </div>
          )}
          {groupMoveError && (
            <div className="mx-2 mb-2 p-2 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-[11px] text-[var(--red)]">
              Group move failed: {groupMoveError}
            </div>
          )}
          {dronesLoading && sidebarDronesFilteredByRepo.length === 0 && !dronesError && (
            <div className="px-3 py-3 flex flex-col gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col gap-2 opacity-30">
                  <SkeletonLine w="65%" />
                  <SkeletonLine w="40%" />
                </div>
              ))}
            </div>
          )}
          {!dronesLoading && sidebarDrones.length === 0 && !dronesError && (
            <div className="px-3 py-10 text-center">
              <div
                className="text-[var(--muted-dim)] text-[11px] tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                No drones registered
              </div>
              <div className="mt-4 mx-auto max-w-[240px] flex flex-col gap-2">
                <button
                  type="button"
                  onClick={openDraftChatComposer}
                  className="w-full inline-flex items-center gap-2 h-[30px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                  title="Create new drone (A)"
                  aria-label="Create new drone"
                >
                  <IconPlus className="opacity-80" />
                  <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Create new drone
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="w-full inline-flex items-center gap-2 h-[30px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                  title="Create multiple drones (S)"
                  aria-label="Create multiple drones"
                >
                  <IconPlusDouble className="opacity-80" />
                  <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Create multiple drones
                  </span>
                </button>
              </div>
              <div className="text-[var(--muted-dim)] text-[10px] mt-4">
                Or run{' '}
                <code className="px-1.5 py-0.5 rounded bg-[rgba(167,139,250,.06)] border border-[rgba(167,139,250,.08)] text-[#C4B5FD] text-[10px]">
                  drone create &lt;name&gt;
                </code>{' '}
                in your terminal.
              </div>
            </div>
          )}
          {!dronesLoading && sidebarDrones.length > 0 && sidebarDronesFilteredByRepo.length === 0 && activeRepoPath && !dronesError && (
            <div className="px-3 py-10 text-center">
              <div
                className="text-[var(--muted-dim)] text-[11px] tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                No drones for selected repo
              </div>
              <div className="text-[var(--muted-dim)] text-[10px] mt-2 font-mono truncate" title={activeRepoPath}>
                {activeRepoPath}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-0.5 select-none">
            {viewMode === 'flat' ? (
              sidebarDronesFilteredByRepo
                .slice()
                .sort(compareDronesByNewestFirst)
                .map((d) => {
                  const isOptimistic = sidebarOptimisticDroneNameSet.has(d.name);
                  return (
                    <DroneCard
                      key={d.name}
                      drone={d}
                      statusHint={isOptimistic ? 'queued' : undefined}
                      selected={selectedDroneSet.has(d.name)}
                      busy={
                        d.hubPhase === 'starting' || d.hubPhase === 'seeding'
                          ? false
                          : Boolean(d.busy) || (d.name === selectedDrone && selectedIsResponding)
                      }
                      onClick={(opts) => selectDroneCard(d.name, opts)}
                      onClone={() => openCloneModal(d)}
                      onRename={() => renameDrone(d.name)}
                      onDelete={() => deleteDrone(d.name)}
                      onErrorClick={openDroneErrorModal}
                      cloneDisabled={isOptimistic || Boolean(deletingDrones[d.name]) || Boolean(renamingDrones[d.name])}
                      renameDisabled={isOptimistic || Boolean(deletingDrones[d.name]) || Boolean(renamingDrones[d.name])}
                      renameBusy={Boolean(renamingDrones[d.name])}
                      deleteDisabled={isOptimistic || Boolean(deletingDrones[d.name]) || Boolean(renamingDrones[d.name])}
                      deleteBusy={Boolean(deletingDrones[d.name])}
                    />
                  );
                })
            ) : (
              <div
                className="flex flex-col gap-1.5"
                onDragOver={onUngroupedDragOver}
                onDragLeave={onUngroupedDragLeave}
                onDrop={onUngroupedDrop}
              >
                <div className="px-1">
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void createGroupFromDraft();
                    }}
                  >
                    <input
                      value={createGroupDraft}
                      onChange={(e) => {
                        setCreateGroupDraft(e.target.value);
                        if (createGroupError) setCreateGroupError(null);
                      }}
                      placeholder="New group"
                      className="flex-1 min-w-0 px-2 py-1.5 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] text-[11px] text-[var(--fg-secondary)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)]"
                    />
                    <button
                      type="submit"
                      disabled={creatingGroup}
                      aria-busy={creatingGroup}
                      className={`inline-flex items-center justify-center w-8 h-8 rounded border transition-all ${
                        creatingGroup
                          ? 'opacity-60 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                          : 'bg-[rgba(167,139,250,.08)] border-[rgba(167,139,250,.18)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.12)]'
                      }`}
                      title="Create group"
                      aria-label="Create group"
                    >
                      {creatingGroup ? <IconSpinner className="opacity-90" /> : <IconPlus className="opacity-90" />}
                    </button>
                  </form>
                  {createGroupError && <div className="px-0.5 pt-1 text-[10px] text-[var(--red)]">{createGroupError}</div>}
                </div>
                {sidebarGroups.map(({ group, items }) => {
                  const collapsed = !!collapsedGroups[group];
                  const isDeletingGroup = Boolean(deletingGroups[group]);
                  const isRenamingGroup = Boolean(renamingGroups[group]);
                  const isDropTarget = dragOverGroup === group;
                  const canRenameGroup = !isUngroupedGroupName(group);
                  return (
                    <div
                      key={group}
                      className={`rounded-md border bg-[rgba(0,0,0,.15)] overflow-hidden transition-colors ${
                        isDropTarget ? 'border-[var(--accent-muted)] ring-1 ring-[var(--accent-muted)]' : 'border-[var(--border-subtle)]'
                      }`}
                      onDragOver={(event) => onGroupDragOver(group, event)}
                      onDragLeave={(event) => onGroupDragLeave(group, event)}
                      onDrop={(event) => onGroupDrop(group, event)}
                    >
                      <div
                        className={`group/group-header w-full px-3 py-2 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] transition-colors ${
                          isDropTarget ? 'bg-[var(--accent-subtle)]' : 'hover:bg-[var(--hover)]'
                        }`}
                      >
                        <button
                          onClick={() =>
                            setCollapsedGroups((prev) => ({
                              ...prev,
                              [group]: !prev[group],
                            }))
                          }
                          className="flex items-center gap-2 min-w-0 text-left flex-1"
                          title={collapsed ? 'Expand group' : 'Collapse group'}
                        >
                          <IconChevron down={!collapsed} className="text-[var(--muted-dim)]" />
                          <IconFolder className="text-[var(--muted-dim)] opacity-50" />
                          <span
                            className="text-[11px] font-semibold text-[var(--fg-secondary)] truncate tracking-wide uppercase"
                            style={{ fontFamily: 'var(--display)' }}
                          >
                            {group}
                          </span>
                        </button>
                        <div className="flex items-center justify-end flex-shrink-0 min-w-[148px]">
                          <div className="relative w-full flex justify-end">
                            <div
                              className={`flex items-center gap-2 text-[10px] font-mono text-[var(--muted-dim)] transition-opacity duration-150 ${
                                isDeletingGroup || isRenamingGroup
                                  ? 'opacity-0 pointer-events-none'
                                  : 'group-hover/group-header:opacity-0 group-hover/group-header:pointer-events-none'
                              }`}
                            >
                              <span>
                                {items.length} drone{items.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            {canRenameGroup && (
                              <button
                                onClick={() => void renameGroup(group)}
                                disabled={isDeletingGroup || isRenamingGroup}
                                aria-busy={isRenamingGroup}
                                className={`absolute right-8 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                                  isDeletingGroup || isRenamingGroup
                                    ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                                    : 'opacity-0 pointer-events-none group-hover/group-header:opacity-100 group-hover/group-header:pointer-events-auto bg-[rgba(167,139,250,.08)] border-[rgba(167,139,250,.18)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.12)]'
                                }`}
                                title={isRenamingGroup ? `Renaming group "${group}"…` : `Rename group "${group}"`}
                                aria-label={isRenamingGroup ? `Renaming group "${group}"` : `Rename group "${group}"`}
                              >
                                {isRenamingGroup ? <IconSpinner className="opacity-90" /> : <IconPencil className="opacity-90" />}
                              </button>
                            )}
                            <button
                              onClick={() => deleteGroup(group, items.length)}
                              disabled={isDeletingGroup || isRenamingGroup}
                              aria-busy={isDeletingGroup}
                              className={`absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                                isDeletingGroup || isRenamingGroup
                                  ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                                  : 'opacity-0 pointer-events-none group-hover/group-header:opacity-100 group-hover/group-header:pointer-events-auto bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)] hover:bg-[rgba(255,90,90,.15)]'
                              }`}
                              title={
                                isDeletingGroup
                                  ? `Deleting group "${group}"…`
                                  : `Delete group "${group}" (and all drones inside)`
                              }
                              aria-label={
                                isDeletingGroup
                                  ? `Deleting group "${group}"`
                                  : `Delete group "${group}" (and all drones inside)`
                              }
                            >
                              {isDeletingGroup ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      {!collapsed && (
                        <div className="px-1.5 py-1.5 flex flex-col gap-0.5">
                          {items.map((d) => {
                            const isOptimistic = sidebarOptimisticDroneNameSet.has(d.name);
                            return (
                              <DroneCard
                                key={d.name}
                                drone={d}
                                statusHint={isOptimistic ? 'queued' : undefined}
                                selected={selectedDroneSet.has(d.name)}
                                busy={
                                  d.hubPhase === 'starting' || d.hubPhase === 'seeding'
                                    ? false
                                    : Boolean(d.busy) || (d.name === selectedDrone && selectedIsResponding)
                                }
                                showGroup={false}
                                onClick={(opts) => selectDroneCard(d.name, opts)}
                                draggable={!movingDroneGroups && !isOptimistic}
                                onDragStart={(event) => onDroneDragStart(d.name, event)}
                                onDragEnd={onDroneDragEnd}
                                onClone={() => openCloneModal(d)}
                                onRename={() => renameDrone(d.name)}
                                onDelete={() => deleteDrone(d.name)}
                                onErrorClick={openDroneErrorModal}
                                cloneDisabled={isOptimistic || Boolean(deletingDrones[d.name]) || Boolean(renamingDrones[d.name])}
                                renameDisabled={isOptimistic || Boolean(deletingDrones[d.name]) || Boolean(renamingDrones[d.name])}
                                renameBusy={Boolean(renamingDrones[d.name])}
                                deleteDisabled={isOptimistic || Boolean(deletingDrones[d.name]) || Boolean(renamingDrones[d.name])}
                                deleteBusy={Boolean(deletingDrones[d.name])}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!sidebarHasUngroupedGroup && draggingDroneNames && draggingDroneNames.length > 0 && (
                  <div
                    className={`rounded-md border border-dashed px-3 py-2 text-[10px] font-semibold tracking-wide uppercase transition-colors ${
                      dragOverUngrouped
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Drop here to move to Ungrouped
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar repos list */}
        <div className="flex-shrink-0 border-t border-[var(--border)] bg-[rgba(0,0,0,.12)]">
          <div className="px-2.5 py-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSidebarReposCollapsed((v) => !v)}
              className="flex-1 min-w-0 inline-flex items-center gap-2 px-1.5 py-1 rounded text-left text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] transition-all"
              style={{ fontFamily: 'var(--display)' }}
              title={sidebarReposCollapsed ? 'Expand repos list' : 'Collapse repos list'}
              aria-label={sidebarReposCollapsed ? 'Expand repos list' : 'Collapse repos list'}
            >
              <IconChevron down={!sidebarReposCollapsed} className="opacity-70" />
              <IconFolder className="opacity-60 w-3 h-3" />
              <span className="truncate">Repos {repos.length > 0 ? repos.length : ''}</span>
              {activeRepoPath ? (
                <span className="ml-auto px-1.5 py-0.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[9px] text-[var(--accent)]">
                  Filtered
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setReposModalOpen(true)}
              className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all"
              title={`Manage repos (${repos.length})`}
              aria-label="Manage repos"
            >
              <IconSettings className="opacity-70" />
            </button>
          </div>
          {!sidebarReposCollapsed && (
            <div className="max-h-[190px] overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setActiveRepoPath('')}
                className={`w-full text-left px-2.5 py-2 rounded border transition-all ${
                  !activeRepoPath
                    ? 'bg-[var(--selected)] border-[var(--accent-muted)]'
                    : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                }`}
                title="Show drones from all repos"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--fg-secondary)]">All repos</span>
                  <span className="text-[10px] font-mono text-[var(--muted-dim)]">{drones.length}</span>
                </div>
              </button>
              {repos
                .slice()
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((r) => {
                  const p = String(r.path ?? '').trim();
                  if (!p) return null;
                  const selected = p === activeRepoPath;
                  const base = r.github
                    ? `${r.github.owner}/${r.github.repo}`
                    : p.split(/[\\/]/).filter(Boolean).pop() || p;
                  const droneCount = droneCountByRepoPath.get(p) ?? 0;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setActiveRepoPath((prev) => (prev === p ? '' : p))}
                      className={`w-full text-left px-2.5 py-2 rounded border transition-all ${
                        selected
                          ? 'bg-[var(--selected)] border-[var(--accent-muted)] shadow-[0_0_8px_rgba(167,139,250,.06)]'
                          : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                      }`}
                      title={p}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--fg-secondary)] truncate">{base}</div>
                          <div className="text-[10px] text-[var(--muted-dim)] truncate font-mono mt-0.5">{p}</div>
                        </div>
                        <span className="text-[10px] font-mono text-[var(--muted-dim)] mt-0.5">{droneCount}</span>
                      </div>
                    </button>
                  );
                })}
              {!reposLoading && repos.length === 0 && !reposError && (
                <div className="px-2.5 py-3 text-[10px] text-[var(--muted-dim)]">
                  No repos registered yet.
                </div>
              )}
              {reposError && (
                <div className="px-2.5 py-3 text-[10px] text-[var(--red)]">
                  Failed to load repos.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar footer */}
        <div className="flex-shrink-0 px-3 py-2.5 border-t border-[var(--border)] flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 select-none cursor-pointer group">
            <input
              type="checkbox"
              className="accent-[var(--accent)] w-3.5 h-3.5"
              checked={autoDelete}
              onChange={(e) => setAutoDelete(e.target.checked)}
            />
            <span className="text-[10px] text-[var(--muted-dim)] group-hover:text-[var(--muted)] transition-colors" title="When enabled, deletes won't ask for confirmation.">
              Auto-delete
            </span>
          </label>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] transition-all"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3L6 8l5 5" /><line x1="3" y1="3" x2="3" y2="13" /></svg>
          </button>
        </div>
      </aside>

      {/* Sidebar expand button (shown when collapsed) */}
      {sidebarCollapsed && (
        <div className="flex-shrink-0 w-10 bg-[var(--panel-alt)] border-r border-[var(--border)] flex flex-col items-center pt-3 gap-2">
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--muted-dim)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l5 5-5 5" /><line x1="13" y1="3" x2="13" y2="13" /></svg>
          </button>
          <button
            type="button"
            onClick={() => { setSidebarCollapsed(false); openDraftChatComposer(); }}
            className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
              draftChat
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
            }`}
            title="Create drone (A)"
            aria-label="Create drone"
          >
            <IconPlus className="opacity-80" />
          </button>
          <button
            type="button"
            onClick={() => { setSidebarCollapsed(false); openCreateModal(); }}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
            title="Create multiple drones (S)"
            aria-label="Create multiple drones"
          >
            <IconPlusDouble className="opacity-80" />
          </button>
        </div>
      )}

      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-[760px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
            <form
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;

                // Submit only on Ctrl+Enter (or Cmd+Enter).
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (creating) return;
                  void createDrone();
                  return;
                }

                // Prevent accidental submits on plain Enter.
                // Allow normal Enter behavior in textarea/select.
                const t = e.target as unknown;
                if (t instanceof HTMLTextAreaElement) return;
                if (t instanceof HTMLSelectElement) return;
                e.preventDefault();
                e.stopPropagation();
              }}
              onSubmit={(e) => {
                e.preventDefault();
                if (creating) return;
                void createDrone();
              }}
            >
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    {createMode === 'clone' ? 'Clone drones' : 'Create drones'}
                  </div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5 font-mono">
                    {createNameEntries.length} drone{createNameEntries.length === 1 ? '' : 's'} ready
                  </div>
                  {createMode === 'clone' && cloneSourceName && (
                    <div className="text-[10px] text-[var(--muted)] mt-1 truncate font-mono" title={`Source: ${cloneSourceName}`}>
                      source: {cloneSourceName}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={creating || createNameEntries.length === 0}
                    className={`h-8 px-4 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                      creating || createNameEntries.length === 0
                        ? 'opacity-70 cursor-wait bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                        : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title={createMode === 'clone' ? 'Clone all drones in this list' : 'Create all drones in this list'}
                  >
                    {creating ? (
                      <span className="inline-flex items-center gap-2">
                        <IconSpinner className="w-3.5 h-3.5" />
                        {createMode === 'clone' ? 'Cloning…' : 'Creating…'}
                      </span>
                    ) : (
                      createMode === 'clone' ? 'Clone all' : 'Create all'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (creating) return;
                      setCreateOpen(false);
                    }}
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] transition-colors"
                    title="Close"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="px-5 py-4 max-h-[70vh] overflow-auto">
                {createError && (
                  <div className="mb-4 p-3 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-xs text-[var(--red)] whitespace-pre-wrap">
                    {createError}
                  </div>
                )}
                <div className="mb-4">
                  <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Group for created drones
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={createGroup}
                      onChange={(e) => setCreateGroup(e.target.value)}
                      className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors"
                      placeholder="e.g. auth, billing, frontend"
                      disabled={creating}
                    />
                    <button
                      type="button"
                      onClick={() => setCreateGroup('')}
                      className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
                      style={{ fontFamily: 'var(--display)' }}
                      title="Clear group"
                      disabled={creating}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Repo path for created drones (optional)
                  </div>
                  <div className="flex items-center gap-2">
                    <UiMenuSelect
                      variant="form"
                      value={createRepoPath}
                      onValueChange={setCreateRepoPath}
                      entries={createRepoMenuEntries}
                      open={createRepoMenuOpen}
                      onOpenChange={setCreateRepoMenuOpen}
                      disabled={creating}
                      triggerClassName="flex-1"
                      panelClassName="right-auto w-[720px] max-w-[calc(100vw-3rem)]"
                      title={createRepoPath || 'No repo'}
                      triggerLabel={createRepoPath || 'No repo'}
                      triggerLabelClassName={createRepoPath ? 'font-mono text-[12px]' : undefined}
                      chevron={(open) => <IconChevron down={!open} className="text-[var(--muted-dim)] opacity-70 flex-shrink-0" />}
                      menuClassName="max-h-[220px] overflow-y-auto"
                    />
                    <button
                      type="button"
                      onClick={() => setCreateRepoPath('')}
                      className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
                      style={{ fontFamily: 'var(--display)' }}
                      title="Clear repo path"
                      disabled={creating}
                    >
                      Clear
                    </button>
                  </div>
                  {registeredRepoPaths.length === 0 ? (
                    <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                      No repos registered yet. Add one from the Repos menu in the sidebar.
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                      Choose a registered repo, or leave this set to No repo.
                    </span>
                  )}
                  {createMode === 'create' && String(activeRepoPath ?? '').trim() && !String(createRepoPath ?? '').trim() && (
                    <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                      Tip: you have an active repo selected in the sidebar. Click it again to unselect.
                    </span>
                  )}
                </div>

                {createMode === 'clone' && (
                  <div className="mb-4">
                    <label className="flex items-center gap-2 select-none">
                      <input
                        type="checkbox"
                        className="accent-[var(--accent)]"
                        checked={cloneIncludeChats}
                        onChange={(e) => setCloneIncludeChats(e.target.checked)}
                        disabled={creating}
                      />
                      <span className="text-[11px] text-[var(--muted)]">Include chats (copy transcript history)</span>
                    </label>
                  </div>
                )}

                <div className="mb-4">
                  <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Agent for created drones
                  </div>
                  <div className="flex items-center gap-2">
                    <UiMenuSelect
                      variant="form"
                      value={spawnAgentKey}
                      onValueChange={setSpawnAgentKey}
                      entries={spawnAgentMenuEntries}
                      disabled={creating || (createMode === 'clone' && cloneIncludeChats)}
                      triggerClassName="flex-1"
                      panelClassName="right-auto w-[460px] max-w-[calc(100vw-3rem)]"
                      title="Choose which agent implementation to use for the default chat in all created drones."
                      chevron={(open) => <IconChevron down={!open} className="text-[var(--muted-dim)] opacity-70 flex-shrink-0" />}
                    />
                    <button
                      type="button"
                      onClick={() => setCustomAgentModalOpen(true)}
                      disabled={creating || (createMode === 'clone' && cloneIncludeChats)}
                      className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                        creating || (createMode === 'clone' && cloneIncludeChats)
                          ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                          : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                      title="Manage saved custom agents"
                    >
                      Custom…
                    </button>
                  </div>
                  <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                    {createMode === 'clone' && cloneIncludeChats
                      ? 'When cloning chats, agents are copied from the source chats.'
                      : 'Used for the default chat. You can change per-chat later.'}
                  </span>
                </div>

                <div className="mb-4">
                  <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Model for created drones (optional)
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={spawnModel}
                      onChange={(e) => setSpawnModel(e.target.value)}
                      className={`h-9 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] font-mono text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none ${
                        creating || (createMode === 'clone' && cloneIncludeChats) || spawnAgentConfig.kind !== 'builtin'
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                      placeholder="Default model"
                      disabled={creating || (createMode === 'clone' && cloneIncludeChats) || spawnAgentConfig.kind !== 'builtin'}
                    />
                    <button
                      type="button"
                      onClick={() => setSpawnModel('')}
                      disabled={creating || (createMode === 'clone' && cloneIncludeChats) || spawnAgentConfig.kind !== 'builtin' || !spawnModel.trim()}
                      className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                        creating || (createMode === 'clone' && cloneIncludeChats) || spawnAgentConfig.kind !== 'builtin' || !spawnModel.trim()
                          ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                          : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      Clear
                    </button>
                  </div>
                  <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                    {createMode === 'clone' && cloneIncludeChats
                      ? 'When cloning chats, model settings are copied from the source chats.'
                      : spawnAgentConfig.kind === 'builtin'
                        ? 'Leave empty to use each agent’s default model.'
                        : 'Custom agents manage model selection in their own CLI.'}
                  </span>
                </div>

                <div className="mb-4">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-[var(--muted)]">
                      Initial message (sent to every created drone before any per-drone suffix)
                    </div>
                    <button
                      type="button"
                      onClick={() => setCreateInitialMessage('')}
                      className="text-[11px] font-semibold text-[var(--accent)] hover:text-[var(--fg)] hover:underline underline-offset-2 transition-colors disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                      title="Clear initial message"
                      disabled={creating}
                    >
                      Clear
                    </button>
                  </div>
                  <textarea
                    value={createInitialMessage}
                    onChange={(e) => setCreateInitialMessage(e.target.value)}
                    rows={2}
                    className="w-full min-h-[56px] resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 py-2 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                    placeholder="If provided, it will be sent once each drone is ready."
                    disabled={creating}
                  />
                </div>

                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Drones to create
                  </div>
                  <button
                    type="button"
                    onClick={appendCreateNameRow}
                    disabled={creating}
                    className="h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
                    style={{ fontFamily: 'var(--display)' }}
                    title="Add another drone"
                  >
                    Add drone
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {createNameRows.map((nameRaw, idx) => {
                    const rawName = String(nameRaw ?? '');
                    const name = rawName.trim();
                    const messageSuffix = String(createMessageSuffixRows[idx] ?? '');
                    const invalidName = Boolean(rawName) && (droneNameHasWhitespace(rawName) || !isValidDroneNameDashCase(name));
                    const dupName = Boolean(name) && (createNameCounts.get(name) ?? 0) > 1;
                    return (
                      <div key={`create-row-${idx}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] font-semibold text-[var(--muted-dim)]">Drone name (dash-case)</span>
                              <input
                                ref={idx === 0 ? createNameRef : null}
                                autoFocus={idx === 0}
                                value={nameRaw}
                                onChange={(e) => updateCreateNameRow(idx, e.target.value)}
                                className={`w-full h-9 rounded-lg border bg-[var(--panel-raised)] px-3 text-[13px] font-mono text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none ${
                                  invalidName || dupName ? 'border-[rgba(248,81,73,.35)]' : 'border-[var(--border-subtle)]'
                                }`}
                                placeholder="e.g. split-server-app"
                                disabled={creating}
                              />
                              {(invalidName || dupName) && (
                                <span className="text-[10px] text-[var(--red)]">
                                  {dupName ? 'Duplicate name in list.' : 'Invalid name. Use dash-case with no spaces, max 48 chars.'}
                                </span>
                              )}
                            </label>
                            <label className="flex flex-col gap-1 mt-2">
                              <span className="text-[10px] font-semibold text-[var(--muted-dim)]">
                                Per-drone message suffix (optional)
                              </span>
                              <textarea
                                value={messageSuffix}
                                onChange={(e) => updateCreateMessageSuffixRow(idx, e.target.value)}
                                rows={2}
                                className="w-full min-h-[56px] resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 py-2 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                                placeholder="Appended after the initial message for this drone."
                                disabled={creating}
                              />
                            </label>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeCreateNameRow(idx)}
                            disabled={creating || createNameRows.length <= 1}
                            className={`flex-shrink-0 h-8 px-3 rounded-lg text-[12px] font-semibold border transition-colors ${
                              creating || createNameRows.length <= 1
                                ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                                : 'bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                            }`}
                            title={createNameRows.length <= 1 ? 'At least one row is required' : 'Remove row'}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <IconTrash className="w-3.5 h-3.5 opacity-90" />
                              Remove
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {createNameEntries.length === 0 && (
                  <div className="mt-2 text-[11px] text-[var(--muted-dim)]">Add at least one valid drone name.</div>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {draftCreateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-[420px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (draftCreating) return;
                void createDroneFromDraft();
              }}
            >
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Name this drone
                  </div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">
                    Press Enter to create and continue.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (draftCreating) return;
                    setDraftCreateOpen(false);
                  }}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
                  title="Close"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="px-5 py-4">
                {draftCreateError && (
                  <div className="mb-3 p-2 rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] text-[11px] text-[var(--red)] whitespace-pre-wrap">
                    {draftCreateError}
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-[var(--muted)]">Drone name (dash-case)</span>
                    <input
                      ref={draftCreateNameRef}
                      autoFocus
                      value={draftCreateName}
                      onChange={(e) => setDraftCreateName(e.target.value)}
                      className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] font-mono text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                      placeholder="e.g. auth-bugfix"
                      disabled={draftCreating}
                    />
                    {draftNameSuggesting && (
                      <span
                        className="inline-flex items-center gap-2 self-start rounded-md border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1 text-[10px] font-semibold tracking-wide uppercase text-[var(--accent)]"
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        <IconSpinner className="w-3.5 h-3.5 text-[var(--accent)]" />
                        Generating name suggestion
                      </span>
                    )}
                    {!draftNameSuggesting && draftSuggestedName && (
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="text-[var(--muted-dim)] truncate" title={draftSuggestedName}>
                          Suggested: <span className="font-mono text-[var(--fg-secondary)]">{draftSuggestedName}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setDraftCreateName(draftSuggestedName)}
                          disabled={draftCreating || draftCreateName.trim() === draftSuggestedName}
                          className={`h-6 px-2 rounded border font-semibold tracking-wide uppercase transition-all ${
                            draftCreating || draftCreateName.trim() === draftSuggestedName
                              ? 'opacity-50 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)] hover:brightness-110'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          {draftCreateName.trim() === draftSuggestedName ? 'Applied' : 'Use suggestion'}
                        </button>
                      </div>
                    )}
                    {!draftNameSuggesting && draftNameSuggestionError && (
                      <span className="text-[10px] text-[var(--muted-dim)]" title={draftNameSuggestionError}>
                        Name suggestion unavailable.
                      </span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-[var(--muted)]">Group (optional)</span>
                    <input
                      value={draftCreateGroup}
                      onChange={(e) => setDraftCreateGroup(e.target.value)}
                      className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                      placeholder="e.g. auth, backend, infra"
                      disabled={draftCreating}
                    />
                  </label>
                </div>
              </div>
              <div className="px-5 py-4 border-t border-[var(--border)] bg-[var(--panel-alt)] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDraftCreateOpen(false)}
                  disabled={draftCreating}
                  className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                    draftCreating
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={draftCreating || !draftCreateName.trim()}
                  className={`h-9 px-4 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                    draftCreating || !draftCreateName.trim()
                      ? 'opacity-50 cursor-not-allowed bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                      : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {draftCreating ? 'Creating…' : 'Create drone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {customAgentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[640px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
              <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Custom agents</div>
              <button
                type="button"
                onClick={() => setCustomAgentModalOpen(false)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
                title="Close"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4">
              {customAgentError && (
                <div className="mb-3 p-3 rounded-lg bg-[var(--red-subtle)] border border-[rgba(248,81,73,.2)] text-xs text-[var(--red)]">
                  {customAgentError}
                </div>
              )}

              {customAgents.length > 0 && (
                <div className="mb-4">
                  <div className="text-[11px] font-semibold text-[var(--muted)] mb-2">Saved</div>
                  <div className="flex flex-col gap-2">
                    {customAgents.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-[var(--fg-secondary)] truncate">{a.label}</div>
                          <div className="text-[11px] text-[var(--muted-dim)] truncate font-mono" title={a.command}>
                            {a.command}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCustomAgents((prev) => prev.filter((x) => x.id !== a.id))}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md border bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--red)] hover:border-[rgba(248,81,73,.35)] hover:bg-[var(--red-subtle)] transition-colors"
                          title={`Delete custom agent "${a.label}"`}
                          aria-label={`Delete custom agent "${a.label}"`}
                        >
                          <IconTrash className="opacity-80" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[var(--muted)]">Name</span>
                  <input
                    value={newCustomAgentLabel}
                    onChange={(e) => setNewCustomAgentLabel(e.target.value)}
                    className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)]"
                    placeholder="e.g. My Agent CLI"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[var(--muted)]">Command (runs inside tmux in the drone)</span>
                  <input
                    value={newCustomAgentCommand}
                    onChange={(e) => setNewCustomAgentCommand(e.target.value)}
                    className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)] font-mono"
                    placeholder="e.g. agent --approve-mcps  (or: codex)"
                  />
                </label>
                <div className="text-[10px] text-[var(--muted-dim)]">
                  Custom agents always use CLI mode (full tmux output). Built-in Cursor, Codex, Claude Code, and OpenCode use transcript mode by default.
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[var(--border)] bg-[var(--panel-alt)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustomAgentModalOpen(false)}
                className="h-9 px-3 rounded-lg text-[12px] font-semibold border transition-colors bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const label = newCustomAgentLabel.trim();
                  const command = newCustomAgentCommand.trim();
                  if (!label) {
                    setCustomAgentError('Name is required.');
                    return;
                  }
                  if (!command) {
                    setCustomAgentError('Command is required.');
                    return;
                  }
                  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
                  const rand = Math.random().toString(16).slice(2, 8);
                  const id = `${base}-${rand}`;
                  setCustomAgents((prev) => [{ id, label, command }, ...prev]);
                  setCustomAgentError(null);
                  setNewCustomAgentLabel('');
                  setNewCustomAgentCommand('');
                  setCustomAgentModalOpen(false);
                }}
                disabled={!newCustomAgentLabel.trim() || !newCustomAgentCommand.trim()}
                className={`h-9 px-4 rounded-lg text-[12px] font-semibold border transition-colors ${
                  !newCustomAgentLabel.trim() || !newCustomAgentCommand.trim()
                    ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                    : 'bg-[var(--accent)] border-[var(--accent-muted)] text-[white] hover:brightness-110'
                }`}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {nameSuggestToast && (
        <div
          className={`fixed right-4 z-50 max-w-[420px] rounded-lg border border-[rgba(255,90,90,.2)] bg-[var(--panel-alt)] shadow-[0_16px_48px_rgba(0,0,0,.3)] px-4 py-3 animate-slide-up ${
            jobsModalError && !jobsModal ? 'bottom-[98px]' : 'bottom-4'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold text-[var(--red)] mb-1 tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Name suggestion failed
              </div>
              <div className="text-[11px] text-[var(--muted)] whitespace-pre-wrap">{nameSuggestToast.message}</div>
            </div>
            <button
              type="button"
              onClick={() => setNameSuggestToast(null)}
              className="inline-flex items-center justify-center w-6 h-6 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:border-[var(--border)] transition-all"
              title="Dismiss"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {jobsModalError && !jobsModal && (
        <div className="fixed bottom-4 right-4 z-50 max-w-[420px] rounded-lg border border-[rgba(255,90,90,.2)] bg-[var(--panel-alt)] shadow-[0_16px_48px_rgba(0,0,0,.3)] px-4 py-3 animate-slide-up">
          <div className="text-[10px] font-semibold text-[var(--red)] mb-1 tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Failed to create jobs</div>
          <div className="text-[11px] text-[var(--muted)] whitespace-pre-wrap">{jobsModalError}</div>
        </div>
      )}

      <CreateDronesFromAgentMessageModal
        jobsModal={jobsModal}
        builtinAgentOptions={BUILTIN_AGENT_OPTIONS}
        customAgents={customAgents}
        spawningAllJobs={spawningAllJobs}
        spawningJobById={spawningJobById}
        spawnedJobById={spawnedJobById}
        spawnJobErrorById={spawnJobErrorById}
        detailsOpenByJobId={detailsOpenByJobId}
        isValidDroneName={isValidDroneNameDashCase}
        onClose={() => {
          setJobsModal(null);
        }}
        onSpawnAll={spawnAllFromJobsModal}
        onSpawnOne={spawnOneFromJobsModal}
        onSpawnJob={(job, group, prefix, agentKey) => void spawnDroneForJob(job, group, prefix, agentKey, jobsModal?.sourceRepoPath)}
        onOpenCustomAgents={() => setCustomAgentModalOpen(true)}
        onChangeGroup={(value) => setJobsModal((cur) => (cur ? { ...cur, group: value } : cur))}
        onClearGroup={() => setJobsModal((cur) => (cur ? { ...cur, group: '' } : cur))}
        onChangeAgentKey={(value) => {
          setSpawnAgentKey(value);
          setJobsModal((cur) => (cur ? { ...cur, agentKey: value } : cur));
        }}
        onChangePrefix={(value) => setJobsModal((cur) => (cur ? { ...cur, prefix: value } : cur))}
        onClearPrefix={() => setJobsModal((cur) => (cur ? { ...cur, prefix: '' } : cur))}
        onUpdateJob={(jobId, patch) =>
          setJobsModal((cur) =>
            !cur
              ? cur
              : {
                  ...cur,
                  jobs: cur.jobs.map((x) => (x.id === jobId ? { ...x, ...patch } : x)),
                },
          )
        }
        onToggleDetails={(jobId) =>
          setDetailsOpenByJobId((prev) => ({
            ...prev,
            [jobId]: !Boolean(prev[jobId]),
          }))
        }
      />

      {/* ── Repos modal ── */}
      {reposModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-[560px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
              <div
                className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                Repos ({repos.length})
              </div>
              <button
                type="button"
                onClick={() => setReposModalOpen(false)}
                className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:border-[var(--border)] transition-all"
                title="Close"
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {reposError && (
                <div className="mx-4 mt-3 p-2 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-[11px] text-[var(--red)]">
                  Failed to load repos: {reposError}
                </div>
              )}
              {!reposLoading && repos.length === 0 && !reposError && (
                <div className="px-5 py-10 text-center">
                  <div className="text-[var(--muted-dim)] text-[11px]">
                    No repos registered. Run <code className="px-1.5 py-0.5 rounded bg-[rgba(167,139,250,.06)] border border-[rgba(167,139,250,.08)] text-[#C4B5FD] text-[10px]">drone repo</code> to add one.
                  </div>
                </div>
              )}
              {repos.length > 0 && (
                <div className="px-3 py-3 flex flex-col gap-0.5 select-none">
                  {repos
                    .slice()
                    .sort((a, b) => a.path.localeCompare(b.path))
                    .map((r) => {
                      const githubUrl = githubUrlForRepo(r);
                      const base = r.github ? `${r.github.owner}/${r.github.repo}` : r.path.split(/[\\/]/).filter(Boolean).pop() || r.path;
                      const selected = String(r.path) === String(activeRepoPath);
                      return (
                        <div
                          key={r.path}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            const p = String(r.path ?? '').trim();
                            if (!p) return;
                            setActiveRepoPath((prev) => (prev === p ? '' : p));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              const p = String(r.path ?? '').trim();
                              if (!p) return;
                              setActiveRepoPath((prev) => (prev === p ? '' : p));
                            }
                          }}
                          className={`group/repo px-3 py-2.5 rounded border transition-all flex items-start justify-between gap-2 ${
                            selected
                              ? 'bg-[var(--selected)] border-[var(--accent-muted)] shadow-[0_0_8px_rgba(167,139,250,.06)]'
                              : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                          }`}
                          title={r.path}
                        >
                          <div className="min-w-0">
                            {githubUrl ? (
                              <a
                                href={githubUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => { e.stopPropagation(); }}
                                className="text-[12px] text-[var(--fg-secondary)] truncate hover:underline"
                                title={githubUrl}
                              >
                                {base}
                              </a>
                            ) : (
                              <div className="text-[12px] text-[var(--fg-secondary)] truncate">{base}</div>
                            )}
                            <div className="text-[10px] text-[var(--muted-dim)] truncate font-mono mt-0.5">{r.path}</div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {githubUrl && (
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copyText(githubUrl); }}
                                className="opacity-0 pointer-events-none group-hover/repo:opacity-100 group-hover/repo:pointer-events-auto inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
                                title="Copy GitHub URL"
                                aria-label="Copy GitHub URL"
                              >
                                <IconCopy className="opacity-80" />
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={Boolean(deletingRepos[r.path])}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void deleteRepo(r.path); }}
                              className={`opacity-0 pointer-events-none group-hover/repo:opacity-100 group-hover/repo:pointer-events-auto inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors ${
                                deletingRepos[r.path]
                                  ? 'opacity-60 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                                  : 'bg-[var(--red-subtle)] border-[rgba(248,81,73,.25)] text-[var(--red)] hover:bg-[rgba(248,81,73,.16)]'
                              }`}
                              title="Remove repo"
                              aria-label="Remove repo"
                            >
                              {deletingRepos[r.path] ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {droneErrorModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Error details for ${droneErrorModal.droneName}`}
        >
          <div className="w-full max-w-[720px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--red)] via-[rgba(255,140,140,.7)] to-transparent opacity-60" />
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase truncate" style={{ fontFamily: 'var(--display)' }}>
                  Drone error
                </div>
                <div className="text-[10px] text-[var(--muted)] mt-1 truncate font-mono" title={droneErrorModal.droneName}>
                  {droneErrorModal.droneName}
                </div>
              </div>
              <button
                type="button"
                onClick={closeDroneErrorModal}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
                title="Close"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="px-5 py-4">
              {droneErrorModal.conflict.isConflict && (
                <div className="mb-3 p-3 rounded border border-[rgba(255,90,90,.18)] bg-[rgba(255,90,90,.08)]">
                  <div className="text-[10px] font-semibold text-[var(--red)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Pull conflict detected
                  </div>
                  {droneErrorModal.conflict.patchName && (
                    <div className="mt-1 text-[11px] text-[var(--muted)] font-mono truncate" title={droneErrorModal.conflict.patchName}>
                      patch: {droneErrorModal.conflict.patchName}
                    </div>
                  )}
                  {droneErrorModal.conflict.files.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[10px] text-[var(--muted-dim)] mb-1">Files</div>
                      <div className="max-h-20 overflow-y-auto rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] p-2 font-mono text-[10px] text-[var(--fg-secondary)]">
                        {droneErrorModal.conflict.files.map((file) => (
                          <div key={file} className="truncate" title={file}>{file}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 text-[10px] text-[var(--muted-dim)] leading-relaxed">
                    Conflict markers: <span className="font-mono text-[var(--fg-secondary)]">&lt;&lt;&lt;&lt;&lt;&lt;&lt; ours</span> is your host branch, and{' '}
                    <span className="font-mono text-[var(--fg-secondary)]">&gt;&gt;&gt;&gt;&gt;&gt;&gt; theirs</span> is the pulled drone patch.
                  </div>
                </div>
              )}
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase mb-2" style={{ fontFamily: 'var(--display)' }}>
                Full message
              </div>
              <textarea
                readOnly
                value={droneErrorModal.message}
                className="w-full min-h-[220px] max-h-[55vh] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] font-mono resize-y focus:outline-none"
              />
            </div>
            <div className="px-5 py-4 border-t border-[var(--border)] bg-[rgba(0,0,0,.1)] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void clearDroneHubError(droneErrorModal.droneName)}
                disabled={clearingDroneError}
                className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                  clearingDroneError
                    ? 'opacity-50 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Clear this drone error badge"
              >
                {clearingDroneError ? 'Clearing...' : 'Clear error'}
              </button>
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copyText(droneErrorModal.message)}
                className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] transition-all inline-flex items-center gap-1.5"
                style={{ fontFamily: 'var(--display)' }}
              >
                <IconCopy className="opacity-70" />
                Copy
              </button>
              <button
                type="button"
                onClick={closeDroneErrorModal}
                className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] transition-all"
                style={{ fontFamily: 'var(--display)' }}
              >
                Close
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Onboarding tour ── */}
      {onboardingOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(0,0,0,.65)] backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Onboarding tour"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeOnboarding('dismiss');
          }}
        >
          <div className="w-full max-w-[560px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.55)] overflow-hidden animate-slide-up relative">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[rgba(167,139,250,.55)] to-transparent opacity-70" />
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
                  Onboarding
                </div>
                <h2 className="text-[16px] font-semibold text-[var(--fg)] mt-1" style={{ fontFamily: 'var(--display)' }}>
                  {safeOnboardingStep?.title ?? 'Tour'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => closeOnboarding('dismiss')}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
                title="Dismiss"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <div className="px-5 py-4 text-[13px] text-[var(--fg-secondary)] leading-relaxed">
              {safeOnboardingStep?.body ?? null}
            </div>
            <div className="px-5 py-4 border-t border-[var(--border)] bg-[rgba(0,0,0,.10)] flex items-center justify-between gap-2">
              <div className="text-[11px] text-[var(--muted-dim)]">
                Step {safeOnboardingStepIndex + 1} of {onboardingTotal}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goPrevOnboardingStep}
                  disabled={onboardingIsFirst}
                  className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                    onboardingIsFirst
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => closeOnboarding('dismiss')}
                  className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onboardingIsLast) closeOnboarding('complete');
                    else goNextOnboardingStep();
                  }}
                  className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {onboardingIsLast ? 'Finish' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Content area (header + body row) ── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--panel)]">
        {appView === 'settings' ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-[820px] mx-auto px-5 py-6 sm:py-8">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden">
                <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
                      Settings
                    </div>
                    <h1 className="text-[18px] font-semibold text-[var(--fg)] mt-1" style={{ fontFamily: 'var(--display)' }}>
                      LLM providers
                    </h1>
                    <p className="text-[12px] text-[var(--muted)] mt-1">
                      Configure OpenAI and Gemini API keys, then choose which provider powers job parsing and drone-name suggestions.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void loadLlmSettings();
                      void loadHubLogs();
                    }}
                    disabled={
                      hubLogsLoading ||
                      llmSettingsLoading ||
                      savingOpenAiSettings ||
                      clearingOpenAiSettings ||
                      savingGeminiSettings ||
                      clearingGeminiSettings ||
                      savingLlmProvider
                    }
                    className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                      hubLogsLoading ||
                      llmSettingsLoading ||
                      savingOpenAiSettings ||
                      clearingOpenAiSettings ||
                      savingGeminiSettings ||
                      clearingGeminiSettings ||
                      savingLlmProvider
                        ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Refresh settings and logs"
                  >
                    Refresh
                  </button>
                </div>

                <div className="px-5 py-4 flex flex-col gap-4">
                  {llmSettingsError && (
                    <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
                      {llmSettingsError}
                    </div>
                  )}
                  {llmSettingsNotice && (
                    <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399]">
                      {llmSettingsNotice}
                    </div>
                  )}

                  <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3">
                    {llmSettingsLoading && !llmSettings ? (
                      <div className="text-[12px] text-[var(--muted-dim)]">Loading settings…</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="text-[12px] text-[var(--fg-secondary)]">
                          Active provider: {llmSettings?.provider.selected === 'gemini' ? 'Gemini' : 'OpenAI'}
                        </div>
                        <div className="text-[11px] text-[var(--muted-dim)]">
                          Provider source:{' '}
                          {llmSettings?.provider.source === 'settings'
                            ? 'Settings'
                            : llmSettings?.provider.source === 'environment'
                              ? 'Environment variable'
                              : 'Default'}
                        </div>
                        <div className="text-[11px] text-[var(--muted-dim)]">
                          OpenAI: {llmSettings?.openai.hasKey ? `configured (${llmSettings.openai.keyHint ?? 'hidden'})` : 'not configured'} • Gemini:{' '}
                          {llmSettings?.gemini.hasKey ? `configured (${llmSettings.gemini.keyHint ?? 'hidden'})` : 'not configured'}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3">
                    <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase mb-2" style={{ fontFamily: 'var(--display)' }}>
                      Active provider
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setLlmProviderDraft('openai')}
                        disabled={savingLlmProvider || llmSettingsLoading}
                        className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                          llmProviderDraft === 'openai'
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                            : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                        } ${savingLlmProvider || llmSettingsLoading ? 'opacity-40 cursor-not-allowed' : ''}`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        OpenAI
                      </button>
                      <button
                        type="button"
                        onClick={() => setLlmProviderDraft('gemini')}
                        disabled={savingLlmProvider || llmSettingsLoading}
                        className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                          llmProviderDraft === 'gemini'
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                            : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                        } ${savingLlmProvider || llmSettingsLoading ? 'opacity-40 cursor-not-allowed' : ''}`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        Gemini
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveLlmProviderSettings()}
                        disabled={savingLlmProvider || llmSettingsLoading || llmProviderDraft === (llmSettings?.provider.selected ?? 'openai')}
                        className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                          savingLlmProvider || llmSettingsLoading || llmProviderDraft === (llmSettings?.provider.selected ?? 'openai')
                            ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                            : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {savingLlmProvider ? 'Saving…' : 'Save provider'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
                      <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                        OpenAI API key
                      </div>
                      {llmSettings?.openai.hasKey ? (
                        <div className="text-[11px] text-[var(--muted-dim)]">
                          {llmSettings.openai.keyHint ?? 'hidden'}
                          {llmSettings.openai.updatedAt ? ` • Updated ${new Date(llmSettings.openai.updatedAt).toLocaleString()}` : ''}
                        </div>
                      ) : (
                        <div className="text-[11px] text-[var(--muted-dim)]">No OpenAI key configured.</div>
                      )}
                      <div className="flex items-center gap-2">
                        <input
                          value={openAiSettingsDraft}
                          onChange={(e) => setOpenAiSettingsDraft(maybeExtractApiKey(e.target.value, 'openai'))}
                          type="text"
                          autoComplete="off"
                          name="openai-api-key"
                          spellCheck={false}
                          style={(showOpenAiKey ? {} : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties))}
                          className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors font-mono"
                          placeholder="sk-..."
                          disabled={savingOpenAiSettings || clearingOpenAiSettings}
                        />
                        <button
                          type="button"
                          onClick={() => setShowOpenAiKey((v) => !v)}
                          disabled={savingOpenAiSettings || clearingOpenAiSettings}
                          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                            savingOpenAiSettings || clearingOpenAiSettings
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          {showOpenAiKey ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void mutateApiKeySettings('openai', 'save')}
                          disabled={!openAiSettingsDraft.trim() || savingOpenAiSettings || clearingOpenAiSettings}
                          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                            !openAiSettingsDraft.trim() || savingOpenAiSettings || clearingOpenAiSettings
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          {savingOpenAiSettings ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void mutateApiKeySettings('openai', 'clear')}
                          disabled={clearingOpenAiSettings || savingOpenAiSettings || !llmSettings?.openai.hasKey}
                          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                            clearingOpenAiSettings || savingOpenAiSettings || !llmSettings?.openai.hasKey
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          {clearingOpenAiSettings ? 'Clearing…' : 'Clear'}
                        </button>
                      </div>
                    </div>

                    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
                      <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                        Gemini API key
                      </div>
                      {llmSettings?.gemini.hasKey ? (
                        <div className="text-[11px] text-[var(--muted-dim)]">
                          {llmSettings.gemini.keyHint ?? 'hidden'}
                          {llmSettings.gemini.updatedAt ? ` • Updated ${new Date(llmSettings.gemini.updatedAt).toLocaleString()}` : ''}
                        </div>
                      ) : (
                        <div className="text-[11px] text-[var(--muted-dim)]">No Gemini key configured.</div>
                      )}
                      <div className="flex items-center gap-2">
                        <input
                          value={geminiSettingsDraft}
                          onChange={(e) => setGeminiSettingsDraft(maybeExtractApiKey(e.target.value, 'gemini'))}
                          type="text"
                          autoComplete="off"
                          name="gemini-api-key"
                          spellCheck={false}
                          style={(showGeminiKey ? {} : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties))}
                          className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors font-mono"
                          placeholder="AIza..."
                          disabled={savingGeminiSettings || clearingGeminiSettings}
                        />
                        <button
                          type="button"
                          onClick={() => setShowGeminiKey((v) => !v)}
                          disabled={savingGeminiSettings || clearingGeminiSettings}
                          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                            savingGeminiSettings || clearingGeminiSettings
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          {showGeminiKey ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void mutateApiKeySettings('gemini', 'save')}
                          disabled={!geminiSettingsDraft.trim() || savingGeminiSettings || clearingGeminiSettings}
                          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                            !geminiSettingsDraft.trim() || savingGeminiSettings || clearingGeminiSettings
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          {savingGeminiSettings ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void mutateApiKeySettings('gemini', 'clear')}
                          disabled={clearingGeminiSettings || savingGeminiSettings || !llmSettings?.gemini.hasKey}
                          className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                            clearingGeminiSettings || savingGeminiSettings || !llmSettings?.gemini.hasKey
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          {clearingGeminiSettings ? 'Clearing…' : 'Clear'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setHubLogsExpanded((v) => !v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setHubLogsExpanded((v) => !v);
                        }
                      }}
                      className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-[var(--hover)] transition-colors cursor-pointer"
                      aria-expanded={hubLogsExpanded}
                      aria-label={hubLogsExpanded ? 'Collapse hub logs' : 'Expand hub logs'}
                    >
                      <div className="inline-flex items-center gap-2 min-w-0">
                        <IconChevron down={hubLogsExpanded} className="text-[var(--muted-dim)] opacity-80" />
                        <div>
                          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                            Hub logs
                          </div>
                          <div className="text-[11px] text-[var(--muted-dim)] mt-1">
                            Recent output from the Drone Hub process log.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void loadHubLogs();
                          }}
                          disabled={hubLogsLoading}
                          className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                            hubLogsLoading
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                          title="Refresh hub logs"
                        >
                          {hubLogsLoading ? 'Refreshing…' : 'Refresh'}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyHubLogs();
                          }}
                          disabled={hubLogsLoading || !String(hubLogs?.text ?? '').trim()}
                          className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all inline-flex items-center gap-1.5 ${
                            hubLogsLoading || !String(hubLogs?.text ?? '').trim()
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                          title="Copy hub logs"
                        >
                          <IconCopy className="opacity-80" />
                          Copy
                        </button>
                      </div>
                    </div>

                    {hubLogsExpanded && (
                      <>
                        {hubLogsError && (
                          <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
                            {hubLogsError}
                          </div>
                        )}
                        {hubLogsNotice && (
                          <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399]">
                            {hubLogsNotice}
                          </div>
                        )}

                        <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
                          {hubLogs?.logPath ? (
                            <>
                              <span className="font-mono text-[var(--fg-secondary)]">{hubLogs.logPath}</span>
                              {hubLogs.updatedAt ? ` • Updated ${new Date(hubLogs.updatedAt).toLocaleString()}` : ''}
                              {hubLogs.truncated ? ' • Tail view (truncated)' : ''}
                            </>
                          ) : (
                            'No hub log file found yet.'
                          )}
                        </div>

                        <textarea
                          ref={hubLogsTextareaRef}
                          readOnly
                          value={hubLogs?.text ?? ''}
                          onScroll={handleHubLogsScroll}
                          placeholder={hubLogsLoading ? 'Loading logs…' : 'No hub logs available yet.'}
                          className="w-full min-h-[220px] max-h-[55vh] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] font-mono resize-y focus:outline-none"
                        />
                        <div className="text-[10px] text-[var(--muted-dim)]">
                          Showing up to {(hubLogs?.tailLines ?? HUB_LOGS_TAIL_LINES).toLocaleString()} lines and{' '}
                          {(hubLogs?.maxBytes ?? HUB_LOGS_MAX_BYTES).toLocaleString()} bytes.
                        </div>
                      </>
                    )}
                  </div>

                  <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
                    <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                      Onboarding
                    </div>
                    <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
                      Reset the onboarding dismissal state and replay the tour from step 1.
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const ok = window.confirm('Replay onboarding from the beginning? This will clear onboarding state.');
                          if (!ok) return;
                          replayOnboarding();
                        }}
                        className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110"
                        style={{ fontFamily: 'var(--display)' }}
                        title="Reset onboarding and replay"
                      >
                        Replay onboarding
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const ok = window.confirm('Clear onboarding state?');
                          if (!ok) return;
                          clearLocalStorageKeysByPrefix(ONBOARDING_STORAGE_PREFIX);
                        }}
                        className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                        style={{ fontFamily: 'var(--display)' }}
                        title="Clear onboarding keys without opening the tour"
                      >
                        Reset only
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setAppView('workspace')}
                      className="ml-auto h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      Back to drones
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : draftChat ? (
            <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
              <div className="flex-shrink-0 bg-[var(--panel-alt)] border-b border-[var(--border)] relative">
                <div className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border bg-[var(--yellow-subtle)] border-[rgba(255,178,36,.15)]">
                        <IconChat className="text-[var(--yellow)]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold text-sm tracking-tight" style={{ fontFamily: 'var(--display)' }}>
                            New chat
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--muted)] mt-0.5">
                          {draftChat.prompt
                            ? 'Creating your drone. Any new messages you send will queue and auto-send when it’s ready.'
                            : 'Send your first message to create a new drone instantly.'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (draftChat?.droneName) clearQueuedPromptsForDrone(draftChat.droneName);
                          setDraftChat(null);
                          setDraftCreateOpen(false);
                          setDraftCreateError(null);
                          setDraftAutoRenaming(false);
                        }}
                        className="inline-flex items-center justify-center h-7 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all text-[10px] font-semibold tracking-wide uppercase"
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                        Agent
                      </span>
                      <UiMenuSelect
                        variant="toolbar"
                        value={spawnAgentKey}
                        onValueChange={setSpawnAgentKey}
                        entries={spawnAgentMenuEntries}
                        disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)}
                        triggerClassName="min-w-[170px] max-w-[240px]"
                        panelClassName="w-[320px]"
                        title="Choose agent for this new drone."
                        chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                      />
                      <button
                        type="button"
                        onClick={() => setCustomAgentModalOpen(true)}
                        disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)}
                        className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                          draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)
                            ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                            : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                        title="Manage custom agents"
                      >
                        Custom
                      </button>
                    </div>
                    {spawnAgentConfig.kind === 'builtin' && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                          Model
                        </span>
                        <input
                          value={spawnModel}
                          onChange={(e) => setSpawnModel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') e.currentTarget.blur();
                          }}
                          disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)}
                          placeholder="Default model"
                          className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
                            draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)
                              ? 'opacity-40 cursor-not-allowed'
                              : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
                          }`}
                          title="Set default model for this new drone chat."
                        />
                        <button
                          type="button"
                          onClick={() => setSpawnModel('')}
                          disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt) || !spawnModel.trim()}
                          className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                            draftCreating || draftAutoRenaming || Boolean(draftChat.prompt) || !spawnModel.trim()
                              ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                              : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                          title="Clear model override"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                        Repo
                      </span>
                      <UiMenuSelect
                        variant="toolbar"
                        value={chatHeaderRepoPath}
                        onValueChange={setChatHeaderRepoPath}
                        entries={createRepoMenuEntries}
                        disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)}
                        triggerClassName="min-w-[220px] max-w-[420px]"
                        panelClassName="w-[720px] max-w-[calc(100vw-3rem)]"
                        menuClassName="max-h-[240px] overflow-y-auto"
                        title={chatHeaderRepoPath || 'No repo'}
                        triggerLabel={chatHeaderRepoPath || 'No repo'}
                        triggerLabelClassName={chatHeaderRepoPath ? 'font-mono text-[11px]' : undefined}
                        chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                {draftChat.prompt ? (
                  <div className="px-5 py-5">
                    <div className="mx-auto max-w-[980px] space-y-5">
                      <PendingTranscriptTurn item={draftChat.prompt} nowMs={nowMs} />
                      {(queuedPromptsByDroneChat[droneChatQueueKey(draftChat.droneName, 'default')] ?? []).map((p) => (
                        <PendingTranscriptTurn key={`draft-queued-${p.id}`} item={p} nowMs={nowMs} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
                    title="Start with a message"
                    description="Sending creates a new untitled drone immediately, then auto-renames it."
                  />
                )}
              </div>
              <ChatInput
                resetKey={`draft:${draftChat.prompt?.id ?? ''}:${spawnAgentKey}`}
                droneName="new drone"
                promptError={draftCreateError}
                sending={draftCreating || draftAutoRenaming}
                waiting={Boolean(draftChat.prompt)}
                autoFocus={!draftCreating && !draftAutoRenaming && !draftChat.prompt}
                onSend={async (prompt) => {
                  if (!draftChat.prompt) return await startDraftPrompt(prompt);
                  const name = String(draftChat.droneName ?? '').trim();
                  if (!name) return false;
                  enqueueQueuedPrompt(name, 'default', prompt);
                  setDraftCreateError(null);
                  return true;
                }}
              />
            </div>
          ) : !currentDrone ? (
            !dronesLoading && sidebarDrones.length === 0 && !dronesError ? (
              <EmptyState
                icon={<IconDrone className="w-8 h-8 text-[var(--muted-dim)]" />}
                title="No drones yet"
                description="Create your first drone to get started."
                actions={
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={openDraftChatComposer}
                      className="w-full inline-flex items-center gap-2 h-[32px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                      title="Create new drone (A)"
                      aria-label="Create new drone"
                    >
                      <IconPlus className="opacity-80" />
                      <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                        Create new drone
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={openCreateModal}
                      className="w-full inline-flex items-center gap-2 h-[32px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                      title="Create multiple drones (S)"
                      aria-label="Create multiple drones"
                    >
                      <IconPlusDouble className="opacity-80" />
                      <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                        Create multiple drones
                      </span>
                    </button>
                  </div>
                }
              />
            ) : (
              <EmptyState
                icon={<IconDrone className="w-8 h-8 text-[var(--muted-dim)]" />}
                title="Select a drone"
                description="Choose a drone from the sidebar to view its session output."
              />
            )
          ) : (
          <>
            {/* Header — spans full width (chat + right panel) */}
            <div className="flex-shrink-0 bg-[var(--panel-alt)] border-b border-[var(--border)] relative">
              <div className="px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {sidebarCollapsed && (
                      <button
                        type="button"
                        onClick={() => setSidebarCollapsed(false)}
                        className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--muted-dim)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all flex-shrink-0 mr-1"
                        title="Expand sidebar"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l5 5-5 5" /><line x1="13" y1="3" x2="13" y2="13" /></svg>
                      </button>
                    )}
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border ${
                      currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding'
                        ? 'bg-[var(--yellow-subtle)] border-[rgba(255,178,36,.15)]'
                        : currentDrone.statusOk
                          ? 'bg-[var(--accent-subtle)] border-[rgba(167,139,250,.15)] shadow-[0_0_12px_rgba(167,139,250,.08)]'
                          : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.15)]'
                    }`}>
                      <IconDrone
                        className={
                          currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding'
                            ? 'text-[var(--yellow)]'
                            : currentDrone.statusOk
                              ? 'text-[var(--accent)]'
                              : 'text-[var(--red)]'
                        }
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-sm tracking-tight" style={{ fontFamily: 'var(--display)' }}>
                          {currentDrone.name}
                        </span>
                        {showRespondingAsStatusInHeader ? (
                          <span className="inline-flex items-center" title="Agent responding">
                            <TypingDots color="var(--yellow)" />
                          </span>
                        ) : (
                          <StatusBadge ok={currentDrone.statusOk} error={currentDrone.statusError} hubPhase={currentDrone.hubPhase} hubMessage={currentDrone.hubMessage} />
                        )}
                        {currentDrone.group && <GroupBadge group={currentDrone.group} />}
                      </div>
                      {String(currentDrone.repoPath ?? '').trim() ? (
                        <div className="text-[10px] text-[var(--muted)] truncate flex items-center gap-1.5 font-mono mt-0.5" title={currentDrone.repoPath}>
                          <IconFolder className="flex-shrink-0 opacity-40 w-3 h-3" />
                          {currentDrone.repoPath}
                        </div>
                      ) : (
                        <div className="text-[10px] text-[var(--muted-dim)] truncate flex items-center gap-1.5 mt-0.5" title="No repo attached">
                          <IconFolder className="flex-shrink-0 opacity-30 w-3 h-3" />
                          No repo attached
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Status indicators + right panel toggle */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {chatUiMode === 'cli' ? (
                      <>
                        {loadingSession && <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />Loading...</span>}
                        {sessionError && !loadingSession && <span className="text-[11px] text-[var(--red)] flex items-center gap-1" title={sessionError}><span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />Error</span>}
                      </>
                    ) : (
                      <>
                        {loadingTranscript && <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />Loading...</span>}
                        {transcriptError && !loadingTranscript && <span className="text-[11px] text-[var(--red)] flex items-center gap-1" title={transcriptError}><span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />Error</span>}
                      </>
                    )}
                    {chatInfoError && !loadingChatInfo && <span className="text-[11px] text-[var(--red)] flex items-center gap-1" title={chatInfoError}><span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />Agent error</span>}
                    {repoOpError && (
                      <button
                        type="button"
                        className="text-[11px] text-[var(--red)] inline-flex items-center gap-1 hover:underline focus:outline-none"
                        title={repoOpError}
                        onClick={() => openDroneErrorModal(currentDrone, repoOpError, repoOpErrorMeta)}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                        Repo error
                      </button>
                    )}
                    {launchHint?.kind === 'copied' && (
                      <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] font-mono" title={launchHint.launcher ? `Launched: ${launchHint.launcher}` : 'Paste the copied command into a terminal.'}>
                        Command copied{launchHint.launcher ? ` • ${launchHint.launcher.split(' ')[0]}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {/* Tier 2: Toolbar */}
              <div className="px-5 pb-2.5 flex items-center gap-2 flex-wrap">
                {/* Agent selector */}
                <div data-onboarding-id="chat.toolbar.agent" className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Agent</span>
                  <UiMenuSelect
                    variant="toolbar"
                    value={currentAgentKey}
                    onValueChange={pickAgentValue}
                    entries={toolbarAgentMenuEntries}
                    open={agentMenuOpen}
                    onOpenChange={(open) => {
                      if (open) {
                        setTerminalMenuOpen(false);
                        setHeaderOverflowOpen(false);
                      }
                      setAgentMenuOpen(open);
                    }}
                    disabled={agentDisabled}
                    title="Choose agent implementation for this chat."
                    triggerLabel={agentLabel}
                    chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                    panelClassName="w-[260px]"
                    header="Choose agent"
                    headerStyle={{ fontFamily: 'var(--display)' }}
                  />
                </div>
                {modelControlEnabled && (
                  <div data-onboarding-id="chat.toolbar.model" className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Model</span>
                    {availableChatModels.length > 0 ? (
                      <UiMenuSelect
                        variant="toolbar"
                        value={currentModel ?? ''}
                        onValueChange={(next) => {
                          void setChatModel(next || null).catch((err: any) => setChatInfoError(err?.message ?? String(err)));
                        }}
                        entries={modelMenuEntries}
                        disabled={modelDisabled}
                        triggerClassName="min-w-[170px] max-w-[240px]"
                        title="Choose model for this chat."
                        triggerLabel={modelLabel}
                        chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                        panelClassName="w-[260px]"
                      />
                    ) : (
                      <>
                        <input
                          value={manualChatModelInput}
                          onChange={(e) => setManualChatModelInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            applyManualChatModel();
                          }}
                          disabled={modelDisabled}
                          placeholder="Model id (optional)"
                          className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all ${modelDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'}`}
                          title="Type a model id and press Enter."
                        />
                        <button
                          type="button"
                          onClick={applyManualChatModel}
                          disabled={modelDisabled}
                          className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${modelDisabled ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]' : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'}`}
                          style={{ fontFamily: 'var(--display)' }}
                          title="Apply typed model for this chat"
                        >
                          Set
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setChatModelsRefreshNonce((n) => n + 1)}
                      disabled={modelDisabled || loadingChatModels}
                      className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${modelDisabled || loadingChatModels ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]' : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'}`}
                      style={{ fontFamily: 'var(--display)' }}
                      title="Refresh model list from the agent CLI in this drone"
                    >
                      {loadingChatModels ? 'Loading' : 'Refresh'}
                    </button>
                    {chatModelsError && (
                      <span className="text-[10px] text-[var(--muted-dim)]" title={chatModelsError}>
                        unavailable
                      </span>
                    )}
                    {!chatModelsError && chatModelsDiscoveredAt && (
                      <span className="text-[10px] text-[var(--muted-dim)]" title={chatModelsDiscoveredAt}>
                        {chatModelsSource}
                      </span>
                    )}
                  </div>
                )}
                {/* Repo (read-only for repo-attached drones only) */}
                {currentDroneRepoAttached && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                      Repo
                    </span>
                    <UiMenuSelect
                      variant="toolbar"
                      value={currentDroneRepoPath}
                      onValueChange={() => {}}
                      entries={createRepoMenuEntries}
                      disabled={true}
                      triggerClassName="min-w-[220px] max-w-[420px]"
                      panelClassName="w-[720px] max-w-[calc(100vw-3rem)]"
                      menuClassName="max-h-[240px] overflow-y-auto"
                      title={currentDroneRepoPath || 'No repo'}
                      triggerLabel={currentDroneRepoPath || 'No repo'}
                      triggerLabelClassName={currentDroneRepoPath ? 'font-mono text-[11px]' : undefined}
                      chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                    />
                  </div>
                )}
                {/* View mode */}
                {chatUiMode === 'cli' ? (
                  <button onClick={() => setOutputView(outputView === 'screen' ? 'log' : 'screen')} className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]" style={{ fontFamily: 'var(--display)' }} title={outputView === 'screen' ? 'Click for raw log view' : 'Click for screen capture view'}>{outputView === 'screen' ? 'Screen' : 'Log'}</button>
                ) : null}
                {/* Separator */}
                <div className="w-px h-4 bg-[var(--border-subtle)]" />
                {/* Chat tabs (inline) */}
                {currentDrone.chats.length > 0 && (
                  <ChatTabs chats={currentDrone.chats} selected={selectedChat} onSelect={setSelectedChat} />
                )}
                {/* Spacer */}
                <div className="flex-1" />
                {/* Primary actions */}
                <button onClick={() => openDroneTerminal('ssh')} disabled={currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding' || openingTerminal?.mode === 'ssh' || openingTerminal?.mode === 'agent'} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${openingTerminal ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]' : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'}`} style={{ fontFamily: 'var(--display)' }} title={`SSH into "${currentDrone.name}"`}>SSH</button>
                <button onClick={() => openDroneEditor('cursor')} disabled={currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding' || Boolean(openingEditor) || Boolean(openingTerminal)} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${openingEditor || openingTerminal ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]' : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)]'}`} style={{ fontFamily: 'var(--display)' }} title={`Open Cursor attached to "${currentDrone.name}"`}><IconCursorApp className="opacity-70" />Cursor</button>
                {(currentDrone.repoAttached ?? Boolean(String(currentDrone.repoPath ?? '').trim())) && (
                  <button
                    type="button"
                    onClick={() => void pullRepoChanges()}
                    disabled={currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding' || Boolean(openingEditor) || Boolean(openingTerminal) || Boolean(repoOp)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding' || Boolean(openingEditor) || Boolean(openingTerminal) || Boolean(repoOp) ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]' : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'}`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Pull repo changes from the drone container into your local repo"
                  >
                    {repoOp?.kind === 'pull' ? 'Pulling...' : 'Pull changes'}
                  </button>
                )}
                {/* Overflow menu */}
                <div ref={headerOverflowRef} className="relative">
                  <button
                    type="button"
                    onClick={() => { setAgentMenuOpen(false); setTerminalMenuOpen(false); setHeaderOverflowOpen((v) => !v); }}
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all"
                    title="More actions"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={headerOverflowOpen}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="12" cy="8" r="1.5" /></svg>
                  </button>
                  {headerOverflowOpen && (
                    <div className={cn('absolute right-0 mt-2 w-[220px] z-50', dropdownPanelBaseClass)} role="menu">
                      <div className="py-1">
                        <button
                          type="button"
                          onClick={() => {
                            setHeaderOverflowOpen(false);
                            openDroneTerminal('agent');
                          }}
                          disabled={currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding' || Boolean(openingTerminal)}
                          className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed')}
                          role="menuitem"
                        >
                          SSH + Agent session
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setHeaderOverflowOpen(false);
                            openDroneEditor('code');
                          }}
                          disabled={currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding' || Boolean(openingEditor) || Boolean(openingTerminal)}
                          className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed')}
                          role="menuitem"
                        >
                          Open VS Code
                        </button>
                        {(currentDrone.repoAttached ?? Boolean(String(currentDrone.repoPath ?? '').trim())) && (
                          <>
                            <div className="my-1 border-t border-[var(--border-subtle)]" />
                            <button
                              type="button"
                              onClick={() => {
                                setHeaderOverflowOpen(false);
                                void reseedRepo();
                              }}
                              disabled={currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding' || Boolean(openingEditor) || Boolean(openingTerminal) || Boolean(repoOp)}
                              className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed')}
                              role="menuitem"
                            >
                              Reseed repo
                            </button>
                          </>
                        )}
                        <div className="my-1 border-t border-[var(--border-subtle)]" />
                        <div ref={terminalMenuRef} className="relative">
                          <button
                            type="button"
                            onClick={() => setTerminalMenuOpen((v) => !v)}
                            className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] flex items-center justify-between')}
                            role="menuitem"
                          >
                            <span>Terminal: {terminalLabel}</span>
                            <IconChevron down={!terminalMenuOpen} className="text-[var(--muted-dim)] opacity-60" />
                          </button>
                          {terminalMenuOpen && (
                            <div className="border-t border-[var(--border-subtle)]">
                              {terminalOptions.map((opt) => {
                                const active = opt.id === terminalEmulator;
                                return (
                                  <button key={opt.id} type="button" onClick={() => { setTerminalEmulator(opt.id); setTerminalMenuOpen(false); setHeaderOverflowOpen(false); }} className={`w-full text-left pl-6 pr-3 py-1.5 text-[11px] transition-colors ${active ? 'bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold' : 'text-[var(--muted)] hover:bg-[var(--hover)]'}`} role="menuitem">{opt.label}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {/* Panel tabs (right side of toolbar) */}
                {rightPanelOpen && (
                  <>
                    <div className="w-px h-4 bg-[var(--border-subtle)] ml-1" />
                    <div
                      className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-0.5"
                      style={{ fontFamily: 'var(--display)' }}
                      title="Choose right panel layout mode."
                    >
                      <button
                        type="button"
                        onClick={() => setRightPanelSplitMode(false)}
                        className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase transition-all border ${
                          rightPanelSplit
                            ? 'text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border-transparent'
                            : 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-muted)]'
                        }`}
                        title="Use one right panel pane"
                      >
                        Single
                      </button>
                      <button
                        type="button"
                        onClick={() => setRightPanelSplitMode(true)}
                        className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase transition-all border ${
                          rightPanelSplit
                            ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-muted)]'
                            : 'text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border-transparent'
                        }`}
                        title="Split right panel into top and bottom panes"
                      >
                        Split
                      </button>
                    </div>
                    {!rightPanelSplit && (
                      <div className="flex items-center gap-0.5">
                        {RIGHT_PANEL_TABS.map((tab) => {
                          const active = rightPanelTab === tab;
                          return (
                            <button
                              key={tab}
                              type="button"
                              onClick={() => setRightPanelTab(tab)}
                              data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}
                              className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase transition-all ${
                                active
                                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-muted)]'
                                  : 'text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border border-transparent'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                            >
                              {RIGHT_PANEL_TAB_LABELS[tab]}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
                {rightPanelOpen && (
                  <button
                    type="button"
                    onClick={resetRightPanelWidth}
                    disabled={rightPanelWidthIsDefault}
                    className={`inline-flex items-center h-7 px-2 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                      rightPanelWidthIsDefault
                        ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-40 cursor-not-allowed'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Reset right panel width"
                    aria-label="Reset right panel width"
                  >
                    Reset size
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRightPanelOpen((v) => !v)}
                  data-onboarding-id="rightPanel.toggle"
                  className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ml-1 ${
                    rightPanelOpen
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  title={rightPanelOpen ? 'Hide panel' : 'Show panel'}
                  aria-label="Toggle right panel"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="12" height="12" rx="2" /><line x1="10" y1="2" x2="10" y2="14" /></svg>
                </button>
              </div>
            </div>

            {/* Body row: chat + right panel */}
            <div className="flex-1 flex min-h-0">
            {/* Chat area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative">
              <div className="flex-1 min-h-0 relative">
              {chatUiMode === 'transcript' ? (
                <div className="h-full min-w-0 min-h-0 overflow-auto">
                  {loadingTranscript && !transcripts && visiblePendingPromptsWithStartup.length === 0 ? (
                    <TranscriptSkeleton />
                  ) : (transcripts && transcripts.length > 0) || visiblePendingPromptsWithStartup.length > 0 ? (
                    <div className="max-w-[900px] mx-auto px-6 py-5 flex flex-col gap-6">
                      {(transcripts ?? []).map((t) => {
                        const messageId = transcriptMessageId(t);
                        return (
                          <TranscriptTurn
                            key={`${t.turn}-${t.at}`}
                            item={t}
                            nowMs={nowMs}
                            parsingJobs={Boolean(parsingJobsByTurn[t.turn])}
                            onCreateJobs={parseJobsFromAgentMessage}
                            messageId={messageId}
                            tldr={tldrByMessageId[messageId] ?? null}
                            showTldr={Boolean(showTldrByMessageId[messageId])}
                            onToggleTldr={toggleTldrForAgentMessage}
                            onHoverAgentMessage={handleAgentMessageHover}
                          />
                        );
                      })}
                      {visiblePendingPromptsWithStartup.map((p) => (
                        <PendingTranscriptTurn key={`pending-${p.id}`} item={p} nowMs={nowMs} />
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                  ) : (
                    <EmptyState
                      icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
                      title="No messages yet"
                      description={
                        transcriptError
                          ? `Error: ${transcriptError}`
                          : `Send a prompt to ${currentDrone.name} to see the conversation here.`
                      }
                    />
                  )}
                </div>
              ) : (
                <div
                  ref={outputScrollRef}
                  onScroll={(e) => updatePinned(e.currentTarget)}
                  className="h-full min-w-0 min-h-0 overflow-auto relative"
                >
                  {(currentDrone.hubPhase === 'starting' || currentDrone.hubPhase === 'seeding') && String(startupSeedForCurrentDrone?.prompt ?? '').trim() && (
                    <div className="max-w-[900px] mx-auto px-6 pt-2">
                      <div className="rounded-md border border-[rgba(148,163,184,.2)] bg-[var(--user-dim)] px-3 py-2 text-[12px] text-[var(--fg-secondary)] whitespace-pre-wrap">
                        {String(startupSeedForCurrentDrone?.prompt ?? '').trim()}
                      </div>
                    </div>
                  )}
                  {loadingSession && !sessionText ? (
                    <TranscriptSkeleton />
                  ) : sessionText ? (
                    <div className="max-w-[900px] mx-auto px-6 py-6">
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.1)] px-4 py-3">
                        <CollapsibleOutput text={sessionText} ok={!sessionError} />
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
                      title="No output yet"
                      description={
                        sessionError ? `Error: ${sessionError}` : `Send a prompt to ${currentDrone.name} to see the session output here.`
                      }
                    />
                  )}

                  {!pinnedToBottom && sessionText && (
                    <div className="pointer-events-none sticky bottom-4 flex justify-center px-6">
                      <button
                        type="button"
                        onClick={() => {
                          const el = outputScrollRef.current;
                          if (!el) return;
                          el.scrollTop = el.scrollHeight;
                          updatePinned(el);
                        }}
                        className="pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 rounded text-[10px] font-semibold tracking-wide uppercase border border-[var(--accent-muted)] bg-[var(--panel-raised)] text-[var(--accent)] hover:shadow-[var(--glow-accent)] shadow-[0_8px_24px_rgba(0,0,0,.25)] transition-all"
                        style={{ fontFamily: 'var(--display)' }}
                        title="Scroll to bottom"
                      >
                        New output ↓
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Chat input */}
            <ChatInput
              resetKey={`${selectedDroneIdentity}:${selectedChat ?? ''}`}
              droneName={currentDrone.name}
              promptError={promptError}
              sending={sendingPrompt}
              waiting={chatUiMode === 'transcript' && visiblePendingPromptsWithStartup.some((p) => p.state !== 'failed')}
              onSend={async (prompt) => {
                try {
                  return await sendPromptText(prompt);
                } catch {
                  return false;
                }
              }}
            />
            </div>

            {/* Right panel content (tabs are in the header toolbar) */}
            {rightPanelOpen && (
              <aside
                className="relative flex-shrink-0 bg-[var(--panel-alt)] border-l border-[var(--border)] flex flex-col min-h-0 overflow-hidden"
                style={{ width: rightPanelWidth, minWidth: RIGHT_PANEL_MIN_WIDTH_PX, maxWidth: rightPanelWidthMax }}
              >
                <div
                  role="separator"
                  aria-label="Resize right panel"
                  aria-orientation="vertical"
                  onMouseDown={startRightPanelResize}
                  onDoubleClick={resetRightPanelWidth}
                  className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 z-30 cursor-col-resize group"
                  title="Drag to resize panel. Double-click to reset."
                >
                  <div
                    className={`absolute left-1/2 top-0 h-full -translate-x-1/2 w-px transition-colors ${
                      rightPanelResizing
                        ? 'bg-[var(--accent)]'
                        : 'bg-transparent group-hover:bg-[var(--accent-muted)]'
                    }`}
                  />
                </div>
                {rightPanelSplit ? (
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                      <div className="flex-shrink-0 px-2 py-1 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] flex items-center gap-2">
                        <span className="text-[9px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                          Top Pane
                        </span>
                        <div className="w-[2px] h-3.5 rounded-full bg-[var(--muted)] opacity-65 shadow-[0_0_0_1px_rgba(255,255,255,.05)]" />
                        <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto pr-1">
                          {RIGHT_PANEL_TABS.map((tab) => {
                            const active = rightPanelTab === tab;
                            return (
                              <button
                                key={`top-pane-${tab}`}
                                type="button"
                                onClick={() => setRightPanelTab(tab)}
                                data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide uppercase whitespace-nowrap transition-all ${
                                  active
                                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-muted)]'
                                    : 'text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent'
                                }`}
                                style={{ fontFamily: 'var(--display)' }}
                              >
                                {RIGHT_PANEL_TAB_LABELS[tab]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        {renderRightPanelTabContent(currentDrone, rightPanelTab, 'top')}
                      </div>
                    </div>
                    <div className="h-px bg-[var(--border)]" />
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                      <div className="flex-shrink-0 px-2 py-1 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] flex items-center gap-2">
                        <span className="text-[9px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                          Bottom Pane
                        </span>
                        <div className="w-[2px] h-3.5 rounded-full bg-[var(--muted)] opacity-65 shadow-[0_0_0_1px_rgba(255,255,255,.05)]" />
                        <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto pr-1">
                          {RIGHT_PANEL_TABS.map((tab) => {
                            const active = rightPanelBottomTab === tab;
                            return (
                              <button
                                key={`bottom-pane-${tab}`}
                                type="button"
                                onClick={() => setRightPanelBottomTab(tab)}
                                data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide uppercase whitespace-nowrap transition-all ${
                                  active
                                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-muted)]'
                                    : 'text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent'
                                }`}
                                style={{ fontFamily: 'var(--display)' }}
                              >
                                {RIGHT_PANEL_TAB_LABELS[tab]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        {renderRightPanelTabContent(currentDrone, rightPanelBottomTab, 'bottom')}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {renderRightPanelTabContent(currentDrone, rightPanelTab, 'single')}
                  </div>
                )}
              </aside>
            )}
            </div>
          </>
        )}
      </div>
      <GuidedOnboarding />
    </div>
  );
}
