import crypto from 'node:crypto';

import { canonicalRepositoriesMap } from './groups-repositories';
import { getHubSettingsRepository } from '../host/hub-settings-repository';
import { loadRegistry } from '../host/registry';

const DEFAULT_AGENTS_SETTING_KEY = 'agents.default';
const AGENTS_LIBRARY_SETTING_KEY = 'agents.library';
const MAX_DRONE_AGENTS_OVERRIDE_BYTES = 2 * 1024 * 1024;
const MAX_AGENTS_LIBRARY_FILES = 50;
const MAX_AGENTS_LIBRARY_TOTAL_BYTES = 20 * 1024 * 1024;

export type RepoAgentsMode = 'inherit' | 'override' | 'disabled';

export type ResolvedDefaultAgentsConfig = {
  content: string;
  enabled: boolean;
  updatedAt: string | null;
};

export type ResolvedRepoAgentsConfig = {
  repoPath: string;
  label: string;
  registered: boolean;
  mode: RepoAgentsMode;
  content: string;
  updatedAt: string | null;
  effectiveContent: string | null;
  effectiveSource: 'repo' | 'default' | null;
};

export type AgentsLibraryFile = {
  id: string;
  name: string;
  content: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

type StoredAgentsLibrary = {
  files?: unknown;
};

class AgentsLibraryFileNotFoundError extends Error {}

function pathLabel(repoPathRaw: unknown): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return 'No Repository';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

function normalizeUpdatedAt(raw: unknown): string | null {
  const updatedAt = String(raw ?? '').trim();
  return updatedAt || null;
}

function findRepoEntry(rawRepos: unknown, repoPathRaw: unknown): any | null {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath || !rawRepos || typeof rawRepos !== 'object' || Array.isArray(rawRepos)) return null;
  const repos = rawRepos as Record<string, unknown>;
  if (repos[repoPath] && typeof repos[repoPath] === 'object') return repos[repoPath];
  for (const entry of Object.values(repos)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (String((entry as any)?.path ?? '').trim() === repoPath) return entry;
  }
  return null;
}

export function normalizeAgentsMarkdown(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n') : '';
}

export function parseDroneAgentsMdOverride(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('agentsMd must be a string');
  const normalized = normalizeAgentsMarkdown(raw);
  const managedContent = !normalized || normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  if (Buffer.byteLength(managedContent, 'utf8') > MAX_DRONE_AGENTS_OVERRIDE_BYTES) {
    throw new Error('agentsMd must be at most 2 MiB');
  }
  return managedContent;
}

function normalizeAgentsLibraryFileName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('AGENTS.md file name must be a string');
  const name = raw.trim();
  if (!name) throw new Error('AGENTS.md file name is required');
  if (name.length > 80) throw new Error('AGENTS.md file name must be at most 80 characters');
  if (/[\r\n]/.test(name)) throw new Error('AGENTS.md file name cannot contain newlines');
  return name;
}

function normalizeAgentsLibraryFile(raw: unknown): AgentsLibraryFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = String((raw as any).id ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return null;
  let name: string;
  let content: string;
  try {
    name = normalizeAgentsLibraryFileName((raw as any).name);
    content = parseDroneAgentsMdOverride((raw as any).content);
  } catch {
    return null;
  }
  const createdAt = String((raw as any).createdAt ?? '').trim();
  const updatedAt = String((raw as any).updatedAt ?? '').trim();
  return {
    id,
    name,
    content,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    createdAt: createdAt || updatedAt,
    updatedAt: updatedAt || createdAt,
  };
}

function normalizeAgentsLibrary(raw: unknown): AgentsLibraryFile[] {
  const candidates =
    raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as any).files)
      ? (raw as any).files
      : [];
  const files: AgentsLibraryFile[] = [];
  const ids = new Set<string>();
  for (const candidate of candidates) {
    const file = normalizeAgentsLibraryFile(candidate);
    if (!file || ids.has(file.id)) continue;
    ids.add(file.id);
    files.push(file);
  }
  return files;
}

function ensureAgentsLibraryCapacity(files: AgentsLibraryFile[]): void {
  if (files.length > MAX_AGENTS_LIBRARY_FILES) {
    throw new Error(`AGENTS.md library can contain at most ${MAX_AGENTS_LIBRARY_FILES} files`);
  }
  const totalBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
  if (totalBytes > MAX_AGENTS_LIBRARY_TOTAL_BYTES) {
    throw new Error('AGENTS.md library content must total at most 20 MiB');
  }
}

function ensureUniqueAgentsLibraryName(
  files: AgentsLibraryFile[],
  name: string,
  exceptId?: string,
): void {
  if (
    files.some(
      (file) =>
        file.id !== exceptId &&
        file.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
    )
  ) {
    throw new Error(`An AGENTS.md file named "${name}" already exists`);
  }
}

export async function resolveCanonicalAgentsLibrary(): Promise<AgentsLibraryFile[]> {
  const record = (await getHubSettingsRepository()).get<StoredAgentsLibrary>(
    AGENTS_LIBRARY_SETTING_KEY,
  );
  return normalizeAgentsLibrary(record?.value);
}

export async function resolveCanonicalAgentsLibraryFile(
  fileIdRaw: unknown,
): Promise<AgentsLibraryFile | null> {
  const fileId = String(fileIdRaw ?? '').trim();
  if (!fileId) return null;
  return (await resolveCanonicalAgentsLibrary()).find((file) => file.id === fileId) ?? null;
}

export async function createCanonicalAgentsLibraryFile(input: {
  name?: unknown;
  content?: unknown;
}): Promise<AgentsLibraryFile> {
  const name = normalizeAgentsLibraryFileName(input?.name);
  const content = parseDroneAgentsMdOverride(input?.content);
  const at = new Date().toISOString();
  const created: AgentsLibraryFile = {
    id: crypto.randomUUID(),
    name,
    content,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    createdAt: at,
    updatedAt: at,
  };
  await (
    await getHubSettingsRepository()
  ).update<StoredAgentsLibrary>(AGENTS_LIBRARY_SETTING_KEY, (current) => {
    const files = normalizeAgentsLibrary(current?.value);
    ensureUniqueAgentsLibraryName(files, name);
    const next = [...files, created];
    ensureAgentsLibraryCapacity(next);
    return { files: next };
  });
  return created;
}

export async function updateCanonicalAgentsLibraryFile(
  fileIdRaw: unknown,
  input: { name?: unknown; content?: unknown },
): Promise<AgentsLibraryFile | null> {
  const fileId = String(fileIdRaw ?? '').trim();
  if (!fileId) return null;
  const name = normalizeAgentsLibraryFileName(input?.name);
  const content = parseDroneAgentsMdOverride(input?.content);
  let updated: AgentsLibraryFile | null = null;
  try {
    await (
      await getHubSettingsRepository()
    ).update<StoredAgentsLibrary>(AGENTS_LIBRARY_SETTING_KEY, (current) => {
      const files = normalizeAgentsLibrary(current?.value);
      const index = files.findIndex((file) => file.id === fileId);
      if (index < 0) throw new AgentsLibraryFileNotFoundError();
      ensureUniqueAgentsLibraryName(files, name, fileId);
      updated = {
        ...files[index],
        name,
        content,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        updatedAt: new Date().toISOString(),
      };
      const next = [...files];
      next[index] = updated;
      ensureAgentsLibraryCapacity(next);
      return { files: next };
    });
  } catch (error) {
    if (error instanceof AgentsLibraryFileNotFoundError) return null;
    throw error;
  }
  return updated;
}

export async function deleteCanonicalAgentsLibraryFile(fileIdRaw: unknown): Promise<boolean> {
  const fileId = String(fileIdRaw ?? '').trim();
  if (!fileId) return false;
  try {
    await (
      await getHubSettingsRepository()
    ).update<StoredAgentsLibrary>(AGENTS_LIBRARY_SETTING_KEY, (current) => {
      const files = normalizeAgentsLibrary(current?.value);
      const next = files.filter((file) => file.id !== fileId);
      if (next.length === files.length) throw new AgentsLibraryFileNotFoundError();
      return { files: next };
    });
    return true;
  } catch (error) {
    if (error instanceof AgentsLibraryFileNotFoundError) return false;
    throw error;
  }
}

export function normalizeRepoAgentsMode(raw: unknown): RepoAgentsMode {
  const mode = String(raw ?? '')
    .trim()
    .toLowerCase();
  return mode === 'override' || mode === 'disabled' ? mode : 'inherit';
}

export function normalizeManagedAgentsFileContent(raw: unknown): string | null {
  const normalized = normalizeAgentsMarkdown(raw);
  if (!normalized.trim()) return null;
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

export function resolveDefaultAgentsConfig(regAny: any): ResolvedDefaultAgentsConfig {
  const config = regAny?.settings?.agents ?? {};
  const content = normalizeAgentsMarkdown(config?.content);
  return {
    content,
    enabled: Boolean(content.trim()),
    updatedAt: normalizeUpdatedAt(config?.updatedAt),
  };
}

export async function resolveCanonicalDefaultAgentsConfig(
  registry?: any,
): Promise<ResolvedDefaultAgentsConfig> {
  const repository = await getHubSettingsRepository();
  let record = repository.get<{ content?: string }>(DEFAULT_AGENTS_SETTING_KEY);
  if (!record) {
    const legacyRegistry = registry ?? (await loadRegistry());
    const legacy = resolveDefaultAgentsConfig(legacyRegistry);
    record = await repository.backfillIfAbsent(
      DEFAULT_AGENTS_SETTING_KEY,
      { content: legacy.content },
      legacy.updatedAt,
    );
  }
  const content = normalizeAgentsMarkdown(record.value?.content);
  return {
    content,
    enabled: Boolean(content.trim()),
    updatedAt: record.updatedAt,
  };
}

export async function upsertCanonicalDefaultAgentsConfig(
  contentRaw: unknown,
): Promise<ResolvedDefaultAgentsConfig> {
  const content = normalizeAgentsMarkdown(contentRaw);
  const record = await (await getHubSettingsRepository()).put(
    DEFAULT_AGENTS_SETTING_KEY,
    { content },
  );
  return { content, enabled: Boolean(content.trim()), updatedAt: record.updatedAt };
}

export function resolveRepoAgentsConfig(regAny: any, repoPathRaw: unknown): ResolvedRepoAgentsConfig {
  const repoPath = String(repoPathRaw ?? '').trim();
  const entry = findRepoEntry(regAny?.repos ?? null, repoPath);
  const config = entry?.agents ?? {};
  const mode = normalizeRepoAgentsMode(config?.mode);
  const content = normalizeAgentsMarkdown(config?.content);
  const defaults = resolveDefaultAgentsConfig(regAny);
  const defaultContent = normalizeManagedAgentsFileContent(defaults.content);
  const overrideContent = normalizeManagedAgentsFileContent(content);
  const effectiveContent = mode === 'disabled' ? null : mode === 'override' ? overrideContent : defaultContent;
  const effectiveSource = mode === 'override' ? 'repo' : effectiveContent ? 'default' : null;

  return {
    repoPath,
    label: pathLabel(repoPath),
    registered: Boolean(entry),
    mode,
    content,
    updatedAt: normalizeUpdatedAt(config?.updatedAt),
    effectiveContent,
    effectiveSource,
  };
}

export async function resolveCanonicalRepoAgentsConfig(regAny: any, repoPathRaw: unknown): Promise<ResolvedRepoAgentsConfig> {
  const defaults = await resolveCanonicalDefaultAgentsConfig(regAny);
  return resolveRepoAgentsConfig(
    {
      ...regAny,
      settings: {
        ...(regAny?.settings ?? {}),
        agents: { content: defaults.content, updatedAt: defaults.updatedAt },
      },
      repos: await canonicalRepositoriesMap(),
    },
    repoPathRaw,
  );
}
