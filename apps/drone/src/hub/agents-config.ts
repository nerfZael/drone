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
