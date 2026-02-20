import type {
  DronePortMapping,
  DroneSummary,
  PortPreviewByDrone,
  PortReachabilityByHostPort,
  PreviewUrlByDrone,
} from '../types';

export type RepoOpErrorMeta = {
  code: string | null;
  patchName: string | null;
  conflictFiles: string[];
};

export type RepoPullConflict = {
  isConflict: boolean;
  patchName: string | null;
  files: string[];
};

export function makeId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return String(c.randomUUID());
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isDroneStartingOrSeeding(hubPhase: string | null | undefined): boolean {
  return hubPhase === 'creating' || hubPhase === 'starting' || hubPhase === 'seeding';
}

export function parseConflictFilesFromMessage(message: string): string[] {
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

export function parseIsoTimestampMs(raw: string | null | undefined): number | null {
  const ms = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(ms) ? ms : null;
}

export function compareDronesByNewestFirst(a: DroneSummary, b: DroneSummary): number {
  const aMs = parseIsoTimestampMs(a.createdAt);
  const bMs = parseIsoTimestampMs(b.createdAt);
  if (aMs == null && bMs != null) return 1;
  if (aMs != null && bMs == null) return -1;
  if (aMs != null && bMs != null && aMs !== bMs) return bMs - aMs;
  return a.name.localeCompare(b.name);
}

export function resolveChatNameForDrone(drone: DroneSummary, preferredChat: string): string {
  const chats = Array.isArray(drone.chats) ? drone.chats : [];
  if (preferredChat && chats.includes(preferredChat)) return preferredChat;
  if (chats.includes('default')) return 'default';
  return chats[0] || 'default';
}

export function chatInputDraftKeyForDroneChat(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim() || 'unknown';
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  return `drone:${droneId}:chat:${chatName}`;
}

export function parseRepoPullConflict(message: string, meta?: Partial<RepoOpErrorMeta> | null): RepoPullConflict {
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
    code === 'drone_conflicts_ready' ||
    files.length > 0 ||
    /patch apply conflict|patch does not apply|failed applying patch|could not apply|CONFLICT/i.test(text);
  return { isConflict, patchName: patchName || null, files };
}

export function normalizePortRows(
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

export function normalizePreviewUrl(raw: string): string | null {
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

export function normalizeContainerPathInput(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function maybeExtractApiKey(raw: string, provider: 'openai' | 'gemini'): string {
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

export function droneHomePath(drone: Pick<DroneSummary, 'repoAttached' | 'repoPath'> | null | undefined): string {
  const repoAttached = Boolean(drone?.repoAttached ?? Boolean(String(drone?.repoPath ?? '').trim()));
  return repoAttached ? '/work/repo' : '/dvm-data/home';
}

export function readPortPreviewByDrone(raw: string | null | undefined): PortPreviewByDrone {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: PortPreviewByDrone = {};
    for (const [droneName, value] of Object.entries(parsed as Record<string, any>)) {
      const name = String(droneName ?? '').trim();
      const cp = Number((value as any)?.containerPort ?? value);
      if (!name || !Number.isFinite(cp)) continue;
      out[name] = { containerPort: cp };
    }
    return out;
  } catch {
    return {};
  }
}

export function readPreviewUrlByDrone(raw: string | null | undefined): PreviewUrlByDrone {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: PreviewUrlByDrone = {};
    for (const [droneId, value] of Object.entries(parsed as Record<string, any>)) {
      const name = String(droneId ?? '').trim();
      const normalized = normalizePreviewUrl(String(value ?? ''));
      if (!name || !normalized) continue;
      out[name] = normalized;
    }
    return out;
  } catch {
    return {};
  }
}

export function rewriteLoopbackUrlToHostLoopback(
  rawUrl: string,
  portRows: DronePortMapping[],
): string | null {
  try {
    const u = new URL(String(rawUrl));
    const host = String(u.hostname ?? '').toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return null;
    const loopbackPort = Number(u.port);
    if (!Number.isFinite(loopbackPort) || loopbackPort <= 0 || Math.floor(loopbackPort) !== loopbackPort) return null;
    const mapped =
      portRows.find((p) => p.containerPort === loopbackPort) ??
      portRows.find((p) => p.hostPort === loopbackPort);
    const hostPort = mapped?.hostPort ?? loopbackPort;
    const path = u.pathname && u.pathname.startsWith('/') ? u.pathname : '/';
    return `http://localhost:${hostPort}${path}${u.search || ''}${u.hash || ''}`;
  } catch {
    return null;
  }
}

export function rewriteContainerPreviewUrlToHostLoopback(
  rawUrl: string,
  portRows: DronePortMapping[],
): string | null {
  try {
    const raw = String(rawUrl ?? '').trim();
    if (!raw) return null;
    const parsed = raw.startsWith('/') ? new URL(raw, 'http://local.preview') : new URL(raw);
    const m = parsed.pathname.match(/^\/api\/drones\/[^/]+\/preview(?:-open)?\/(\d+)(\/.*)?$/);
    if (!m) return null;
    const previewPort = Number(m[1]);
    if (!Number.isFinite(previewPort) || previewPort <= 0 || Math.floor(previewPort) !== previewPort) return null;
    const mapped =
      portRows.find((p) => p.containerPort === previewPort) ??
      portRows.find((p) => p.hostPort === previewPort);
    const hostPort = mapped?.hostPort ?? previewPort;
    const tailPath = m[2] && m[2].length > 0 ? m[2] : '/';
    return `http://localhost:${hostPort}${tailPath}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return null;
  }
}

export function sameReachabilityMap(a: PortReachabilityByHostPort, b: PortReachabilityByHostPort): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function droneChatQueueKey(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  return `${droneId}::${chatName}`;
}

export function parseDroneChatQueueKey(key: string): { droneId: string; chatName: string } | null {
  const raw = String(key ?? '');
  const idx = raw.indexOf('::');
  if (idx < 0) return null;
  const droneId = raw.slice(0, idx).trim();
  const chatName = raw.slice(idx + 2).trim() || 'default';
  if (!droneId) return null;
  return { droneId, chatName };
}
