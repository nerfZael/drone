import { canonicalRepositoriesMap, resolveCanonicalRepository } from './groups-repositories';
import { getHubSettingsRepository } from '../host/hub-settings-repository';
import { loadRegistryCompatibilityBase } from '../host/registry';

const NON_REPO_ENVIRONMENT_SETTING_KEY = 'environment.non-repository';

type EnvVarMap = Record<string, string>;

export type RepoEnvironmentConfig = {
  vars: EnvVarMap;
  autoApplyToNewContainerDrones: boolean;
  updatedAt: string | null;
};

export type DroneEnvironmentConfig = {
  vars: EnvVarMap;
  useRepoVars: boolean;
  disabledRepoKeys: string[];
  updatedAt: string | null;
};

export type ResolvedRepoEnvironmentConfig = RepoEnvironmentConfig & {
  repoPath: string;
  label: string;
  registered: boolean;
};

export type ResolvedDroneEnvironmentConfig = DroneEnvironmentConfig & {
  repo: ResolvedRepoEnvironmentConfig;
  repoVars: EnvVarMap;
  resolvedVars: EnvVarMap;
};

const ENV_VAR_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

export function normalizeEnvVarKey(raw: unknown): string | null {
  const key = String(raw ?? '').trim();
  if (!key || !ENV_VAR_KEY_RE.test(key)) return null;
  return key;
}

export function normalizeEnvVarMap(raw: unknown): EnvVarMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: EnvVarMap = {};
  for (const [keyRaw, valueRaw] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeEnvVarKey(keyRaw);
    if (!key) continue;
    out[key] = typeof valueRaw === 'string' ? valueRaw : valueRaw == null ? '' : String(valueRaw);
  }
  return out;
}

export function normalizeDisabledRepoKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const key = normalizeEnvVarKey(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function buildEnvExportLines(varsRaw: unknown): string[] {
  const vars = normalizeEnvVarMap(varsRaw);
  return Object.entries(vars).map(([key, value]) => `export ${key}='${String(value).replace(/'/g, `'\\''`)}'`);
}

export function resolveRepoEnvironmentConfig(regAny: any, repoPathRaw: unknown): ResolvedRepoEnvironmentConfig {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) {
    const config = regAny?.settings?.nonRepoEnvironment ?? {};
    return {
      repoPath: '',
      label: 'No Repository',
      registered: true,
      vars: normalizeEnvVarMap(config?.vars),
      autoApplyToNewContainerDrones: config?.autoApplyToNewContainerDrones === true,
      updatedAt: normalizeUpdatedAt(config?.updatedAt),
    };
  }

  const entry = findRepoEntry(regAny?.repos ?? null, repoPath);
  const config = entry?.environment ?? {};
  return {
    repoPath,
    label: pathLabel(repoPath),
    registered: Boolean(entry),
    vars: normalizeEnvVarMap(config?.vars),
    autoApplyToNewContainerDrones: config?.autoApplyToNewContainerDrones === true,
    updatedAt: normalizeUpdatedAt(config?.updatedAt),
  };
}

export async function resolveCanonicalNonRepoEnvironmentConfig(
  registry?: any,
): Promise<RepoEnvironmentConfig> {
  const repository = await getHubSettingsRepository();
  let record = repository.get<{
    vars?: unknown;
    autoApplyToNewContainerDrones?: boolean;
  }>(NON_REPO_ENVIRONMENT_SETTING_KEY);
  if (!record) {
    // This is a one-time migration fallback. Do not build the global
    // compatibility projection just to read one legacy setting.
    const legacyRegistry = registry ?? (await loadRegistryCompatibilityBase());
    const legacy = resolveRepoEnvironmentConfig(legacyRegistry, '');
    record = await repository.backfillIfAbsent(
      NON_REPO_ENVIRONMENT_SETTING_KEY,
      {
        vars: legacy.vars,
        autoApplyToNewContainerDrones: legacy.autoApplyToNewContainerDrones,
      },
      legacy.updatedAt,
    );
  }
  return {
    vars: normalizeEnvVarMap(record.value?.vars),
    autoApplyToNewContainerDrones: record.value?.autoApplyToNewContainerDrones === true,
    updatedAt: record.updatedAt,
  };
}

export async function upsertCanonicalNonRepoEnvironmentConfig(opts: {
  vars: unknown;
  autoApplyToNewContainerDrones: boolean;
}): Promise<RepoEnvironmentConfig> {
  const value = {
    vars: normalizeEnvVarMap(opts.vars),
    autoApplyToNewContainerDrones: opts.autoApplyToNewContainerDrones === true,
  };
  const record = await (await getHubSettingsRepository()).put(
    NON_REPO_ENVIRONMENT_SETTING_KEY,
    value,
  );
  return { ...value, updatedAt: record.updatedAt };
}

export async function resolveCanonicalRepoEnvironmentConfig(
  regAny: any,
  repoPathRaw: unknown,
): Promise<ResolvedRepoEnvironmentConfig> {
  const nonRepo = await resolveCanonicalNonRepoEnvironmentConfig(regAny);
  const repoPath = typeof repoPathRaw === 'string' ? repoPathRaw.trim() : '';
  const repository = repoPath ? await resolveCanonicalRepository(repoPath) : null;
  return resolveRepoEnvironmentConfig(
    {
      ...regAny,
      settings: {
        ...(regAny?.settings ?? {}),
        nonRepoEnvironment: {
          vars: nonRepo.vars,
          autoApplyToNewContainerDrones: nonRepo.autoApplyToNewContainerDrones,
          updatedAt: nonRepo.updatedAt,
        },
      },
      repos: repository ? { [repository.path]: repository } : {},
    },
    repoPath,
  );
}

export function resolveDroneEnvironmentConfig(regAny: any, droneEntry: any): ResolvedDroneEnvironmentConfig {
  const repo = resolveRepoEnvironmentConfig(regAny, droneEntry?.repoPath);
  return resolveDroneEnvironmentConfigWithRepo(repo, droneEntry);
}

function resolveDroneEnvironmentConfigWithRepo(
  repo: ResolvedRepoEnvironmentConfig,
  droneEntry: any,
): ResolvedDroneEnvironmentConfig {
  const config = droneEntry?.environment ?? {};
  const vars = normalizeEnvVarMap(config?.vars);
  const useRepoVars = config?.useRepoVars === true;
  const disabledRepoKeys = normalizeDisabledRepoKeys(config?.disabledRepoKeys);
  const disabled = new Set(disabledRepoKeys);
  const repoVars: EnvVarMap = {};
  if (useRepoVars) {
    for (const [key, value] of Object.entries(repo.vars)) {
      if (disabled.has(key)) continue;
      repoVars[key] = value;
    }
  }
  return {
    vars,
    useRepoVars,
    disabledRepoKeys,
    updatedAt: normalizeUpdatedAt(config?.updatedAt),
    repo,
    repoVars,
    resolvedVars: {
      ...repoVars,
      ...vars,
    },
  };
}

/** Resolves one drone's environment from canonical owners without hydrating chat state. */
export async function resolveCanonicalDroneEnvironmentConfig(
  droneEntry: any,
  legacyRegistry?: any,
): Promise<ResolvedDroneEnvironmentConfig> {
  const repo = await resolveCanonicalRepoEnvironmentConfig(legacyRegistry, droneEntry?.repoPath);
  return resolveDroneEnvironmentConfigWithRepo(repo, droneEntry);
}

export function deriveCreatedDroneEnvironmentConfig(regAny: any, opts: {
  repoPath?: string | null;
  runtime?: string | null;
}): DroneEnvironmentConfig {
  const runtime = String(opts.runtime ?? 'container').trim().toLowerCase();
  const repo = resolveRepoEnvironmentConfig(regAny, opts.repoPath);
  const useRepoVars = runtime === 'container' && repo.autoApplyToNewContainerDrones;
  return {
    vars: {},
    useRepoVars,
    disabledRepoKeys: [],
    updatedAt: null,
  };
}

export async function deriveCanonicalCreatedDroneEnvironmentConfig(regAny: any, opts: {
  repoPath?: string | null;
  runtime?: string | null;
}): Promise<DroneEnvironmentConfig> {
  const nonRepo = await resolveCanonicalNonRepoEnvironmentConfig(regAny);
  return deriveCreatedDroneEnvironmentConfig(
    {
      ...regAny,
      settings: {
        ...(regAny?.settings ?? {}),
        nonRepoEnvironment: {
          vars: nonRepo.vars,
          autoApplyToNewContainerDrones: nonRepo.autoApplyToNewContainerDrones,
          updatedAt: nonRepo.updatedAt,
        },
      },
      repos: await canonicalRepositoriesMap(),
    },
    opts,
  );
}
