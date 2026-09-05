import crypto from 'node:crypto';
import path from 'node:path';

import { getCatalogStore, type CatalogGroupRecord, type CatalogRepositoryRecord, type CatalogStore } from '../host/catalog-store';
import { getHubDatabase } from '../host/hub-database';
import { loadRegistry, loadRegistryRawSnapshot, updateRegistry } from '../host/registry';

const repositoriesBackfilled = new WeakSet<CatalogStore>();
const groupsBackfilled = new WeakSet<CatalogStore>();

async function catalogStoreOrCompatibility(): Promise<CatalogStore | null> {
  try {
    return await getCatalogStore();
  } catch (error) {
    if ((globalThis as any).Bun && getHubDatabase() === null) return null;
    throw error;
  }
}

function deterministicLegacyGroupId(repoPath: string, name: string): string {
  return `grp_${crypto.createHash('sha256').update(`drone-group:${repoPath}\0${name}`).digest('hex').slice(0, 32)}`;
}

function groupLabel(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

function legacyGroups(registry: any): CatalogGroupRecord[] {
  const rawByScopeAndName = new Map<string, { raw: any; repoPath: string; name: string }>();
  for (const [key, raw] of Object.entries(registry?.groups ?? {})) {
    const name = String((raw as any)?.name ?? key).trim();
    const repoPath = String((raw as any)?.repoPath ?? '').trim();
    if (name) rawByScopeAndName.set(`${repoPath}\0${name}`, { raw, repoPath, name });
  }
  for (const entry of [...rawByScopeAndName.values()]) {
    const { repoPath, name } = entry;
    const parts = name.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      const ancestor = parts.slice(0, index).join('/');
      const key = `${repoPath}\0${ancestor}`;
      if (!rawByScopeAndName.has(key)) rawByScopeAndName.set(key, { raw: null, repoPath, name: ancestor });
    }
  }

  const now = new Date().toISOString();
  const entries = [...rawByScopeAndName.values()].sort((left, right) =>
    left.repoPath.localeCompare(right.repoPath) || left.name.length - right.name.length || left.name.localeCompare(right.name));
  const idByScopeAndName = new Map(entries.map(({ raw, repoPath, name }) => [
    `${repoPath}\0${name}`,
    String(raw?.id ?? '').trim() || deterministicLegacyGroupId(repoPath, name),
  ]));
  return entries.map(({ raw, repoPath, name }) => {
    const createdAt = String(raw?.createdAt ?? '').trim() || now;
    const parentName = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
    return {
      id: idByScopeAndName.get(`${repoPath}\0${name}`)!,
      repoPath,
      name,
      label: String(raw?.label ?? '').trim() || groupLabel(name),
      parentId: idByScopeAndName.get(`${repoPath}\0${parentName}`) ?? null,
      createdAt,
      updatedAt: String(raw?.updatedAt ?? '').trim() || createdAt,
    };
  });
}

function legacyRepositories(registry: any): CatalogRepositoryRecord[] {
  const out: CatalogRepositoryRecord[] = [];
  for (const [key, raw] of Object.entries(registry?.repos ?? {})) {
    if (!raw || typeof raw !== 'object') continue;
    const repoPath = String((raw as any).path ?? key).trim();
    if (!repoPath || !path.isAbsolute(repoPath)) continue;
    out.push({
      path: repoPath,
      addedAt: String((raw as any).addedAt ?? '').trim() || new Date().toISOString(),
      ...(typeof (raw as any).remoteUrl === 'string' && (raw as any).remoteUrl.trim() ? { remoteUrl: (raw as any).remoteUrl.trim() } : {}),
      ...((raw as any).github?.owner && (raw as any).github?.repo
        ? { github: { owner: String((raw as any).github.owner), repo: String((raw as any).github.repo) } }
        : {}),
      ...((raw as any).environment && typeof (raw as any).environment === 'object' ? { environment: (raw as any).environment } : {}),
      ...((raw as any).agents && typeof (raw as any).agents === 'object' ? { agents: (raw as any).agents } : {}),
    });
  }
  return out;
}

export async function listCanonicalGroups(repoPath?: string): Promise<CatalogGroupRecord[]> {
  const store = await catalogStoreOrCompatibility();
  if (!store) {
    const groups = legacyGroups(await loadRegistry());
    return repoPath === undefined ? groups : groups.filter((group) => group.repoPath === repoPath);
  }
  if (!groupsBackfilled.has(store)) {
    const legacy = legacyGroups(await loadRegistryRawSnapshot());
    await store.backfillGroups(legacy);
    groupsBackfilled.add(store);
  }
  return store.listGroups(repoPath);
}

export async function resolveCanonicalGroupReference(
  refRaw: string,
  repoPathRaw?: string,
): Promise<CatalogGroupRecord | null> {
  const ref = String(refRaw ?? '').trim();
  if (!ref) return null;
  const groups = await listCanonicalGroups();
  const byId = groups.find((group) => group.id === ref);
  if (byId) return byId;
  const repoPath = repoPathRaw === undefined ? undefined : String(repoPathRaw ?? '').trim();
  const matches = groups.filter((group) => group.name === ref && (repoPath === undefined || group.repoPath === repoPath));
  return matches.length === 1 ? matches[0]! : null;
}

export async function ensureCanonicalGroup(
  nameRaw: string,
  repoPathRaw = '',
  at = new Date().toISOString(),
): Promise<CatalogGroupRecord> {
  const name = String(nameRaw ?? '').trim();
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!name) throw new Error('group name cannot be empty');
  const existingGroups = await listCanonicalGroups(repoPath);
  const existing = existingGroups.find((group) => group.name === name);
  if (existing) return existing;
  const paths = name.split('/').filter(Boolean).map((_, index, parts) => parts.slice(0, index + 1).join('/'));
  const store = await catalogStoreOrCompatibility();
  const byName = new Map(existingGroups.map((group) => [group.name, group]));
  if (store) {
    for (const groupPath of paths) {
      if (byName.has(groupPath)) continue;
      const parentName = groupPath.includes('/') ? groupPath.slice(0, groupPath.lastIndexOf('/')) : '';
      const record = await store.putGroup({
        id: `grp_${crypto.randomUUID()}`,
        repoPath,
        name: groupPath,
        label: groupLabel(groupPath),
        parentId: byName.get(parentName)?.id ?? null,
        createdAt: at,
        updatedAt: at,
      });
      byName.set(groupPath, record);
    }
    return byName.get(name)!;
  }
  await updateRegistry((registry: any) => {
    registry.groups ??= {};
    for (const groupPath of paths) {
      const existing = byName.get(groupPath);
      if (existing) continue;
      const parentName = groupPath.includes('/') ? groupPath.slice(0, groupPath.lastIndexOf('/')) : '';
      const parentId = byName.get(parentName)?.id ?? null;
      const id = `grp_${crypto.randomUUID()}`;
      registry.groups[id] = {
        id,
        repoPath,
        name: groupPath,
        label: groupLabel(groupPath),
        parentId,
        createdAt: at,
        updatedAt: at,
      };
      byName.set(groupPath, registry.groups[id]);
    }
  });
  return legacyGroups(await loadRegistry()).find((group) => group.repoPath === repoPath && group.name === name)!;
}

export async function deleteCanonicalGroup(repoPath: string, name: string, at?: string): Promise<boolean> {
  await listCanonicalGroups();
  const store = await catalogStoreOrCompatibility();
  if (store) return await store.deleteGroup(repoPath, name, at);
  return await updateRegistry((registry: any) => {
    const entry = Object.entries(registry?.groups ?? {}).find(([, raw]: [string, any]) =>
      String(raw?.repoPath ?? '').trim() === repoPath && String(raw?.name ?? '').trim() === name);
    return Boolean(entry) && delete registry.groups[entry![0]];
  });
}

export async function deleteCanonicalGroupTree(
  repoPath: string,
  name: string,
  at = new Date().toISOString(),
): Promise<string[]> {
  const groups = (await listCanonicalGroups(repoPath))
    .filter((group) => group.name === name || group.name.startsWith(`${name}/`));
  const names = groups
    .map((group) => group.name)
  if (names.length === 0) return [];
  const store = await catalogStoreOrCompatibility();
  if (store) return await store.deleteGroups(repoPath, names, at);
  return await updateRegistry((registry: any) => {
    const deleted: string[] = [];
    const deletedIds = new Set(groups.map((group) => group.id));
    for (const [key, raw] of Object.entries(registry?.groups ?? {}) as Array<[string, any]>) {
      if (!deletedIds.has(String(raw?.id ?? key))) continue;
      deleted.push(String(raw?.name ?? ''));
      delete registry.groups[key];
    }
    return deleted;
  });
}

export async function renameCanonicalGroupTree(
  repoPath: string,
  oldName: string,
  newName: string,
  at = new Date().toISOString(),
): Promise<number> {
  if (newName === oldName || newName.startsWith(`${oldName}/`)) {
    throw new Error('cannot move a group into itself or its own subtree');
  }
  const groups = await listCanonicalGroups(repoPath);
  const rewrites = groups
    .filter((group) => group.name === oldName || group.name.startsWith(`${oldName}/`))
    .map((group) => ({ id: group.id, from: group.name, to: `${newName}${group.name.slice(oldName.length)}` }));
  if (rewrites.length === 0) throw new Error(`unknown group: ${oldName}`);
  const store = await catalogStoreOrCompatibility();
  if (store) return await store.renameGroups(repoPath, rewrites, at);
  await updateRegistry((registry: any) => {
    registry.groups ??= {};
    for (const item of rewrites) {
      const currentEntry = Object.entries(registry.groups).find(([, raw]: [string, any]) =>
        String(raw?.id ?? '') === item.id);
      const current = currentEntry?.[1] as any;
      if (!current) continue;
      registry.groups[currentEntry![0]] = {
        ...current, id: item.id, repoPath, name: item.to, label: groupLabel(item.to), updatedAt: at,
      };
    }
    const idByName = new Map(
      Object.entries(registry.groups)
        .filter(([, raw]: [string, any]) => String(raw?.repoPath ?? '').trim() === repoPath)
        .map(([key, raw]: [string, any]) => [String(raw?.name ?? key), String(raw?.id ?? '')]),
    );
    for (const [key, raw] of Object.entries(registry.groups) as Array<[string, any]>) {
      if (String(raw?.repoPath ?? '').trim() !== repoPath) continue;
      const groupName = String(raw?.name ?? key).trim();
      const parentName = groupName.includes('/') ? groupName.slice(0, groupName.lastIndexOf('/')) : '';
      raw.parentId = idByName.get(parentName) || null;
    }
  });
  return rewrites.length;
}

export type GroupMembershipCoordinator = {
  renameMemberships(oldName: string, newName: string): Promise<{ movedDrones: number; movedPending: number }>;
  deleteMemberships(groupName: string): Promise<void>;
};

// Cross-domain membership orchestration is intentionally left as this
// dependency contract. Calling it and CatalogStore in separate transactions
// would not be atomic; the lifecycle repository must provide a same-connection
// command hook before the server rename/delete routes can use it safely.

export async function listCanonicalRepositories(): Promise<CatalogRepositoryRecord[]> {
  const store = await catalogStoreOrCompatibility();
  if (!store) return legacyRepositories(await loadRegistry());
  if (!repositoriesBackfilled.has(store)) {
    await store.backfillRepositories(legacyRepositories(await loadRegistryRawSnapshot()));
    repositoriesBackfilled.add(store);
  }
  return store.listRepositories();
}

export async function resolveCanonicalRepository(repoPathRaw: unknown): Promise<CatalogRepositoryRecord | null> {
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!repoPath) return null;
  const store = await catalogStoreOrCompatibility();
  if (!store) {
    return legacyRepositories(await loadRegistry()).find((repo) => repo.path === repoPath) ?? null;
  }
  if (!repositoriesBackfilled.has(store)) {
    await store.backfillRepositories(legacyRepositories(await loadRegistryRawSnapshot()));
    repositoriesBackfilled.add(store);
  }
  return store.getRepository(repoPath);
}

export async function canonicalRepositoriesMap(): Promise<Record<string, CatalogRepositoryRecord>> {
  return Object.fromEntries((await listCanonicalRepositories()).map((repo) => [repo.path, repo]));
}

export async function registerCanonicalRepository(record: CatalogRepositoryRecord): Promise<CatalogRepositoryRecord> {
  await listCanonicalRepositories();
  const store = await catalogStoreOrCompatibility();
  if (!store) {
    await updateRegistry((registry: any) => {
      registry.repos ??= {};
      registry.repos[record.path] = { ...(registry.repos[record.path] ?? {}), ...record };
    });
    return record;
  }
  await store.putRepository(record);
  const stored = store.getRepository(record.path);
  if (!stored) throw new Error(`failed to register repository: ${record.path}`);
  return stored;
}

export async function removeCanonicalRepository(repoPath: string): Promise<boolean> {
  await listCanonicalRepositories();
  const store = await catalogStoreOrCompatibility();
  if (store) return await store.deleteRepository(repoPath);
  return await updateRegistry((registry: any) => Boolean(registry?.repos?.[repoPath]) && delete registry.repos[repoPath]);
}

export async function updateCanonicalRepositoryEnvironment(repoPath: string, environment: unknown, at?: string): Promise<CatalogRepositoryRecord> {
  await listCanonicalRepositories();
  const store = await catalogStoreOrCompatibility();
  if (store) return await store.updateRepositoryEnvironment(repoPath, environment, at);
  const updatedAt = at ?? new Date().toISOString();
  await updateRegistry((registry: any) => {
    registry.repos ??= {};
    registry.repos[repoPath] = { ...(registry.repos[repoPath] ?? { path: repoPath, addedAt: updatedAt }), environment };
  });
  return (await listCanonicalRepositories()).find((repo) => repo.path === repoPath)!;
}

export async function updateCanonicalRepositoryAgents(repoPath: string, agents: unknown, at?: string): Promise<CatalogRepositoryRecord> {
  await listCanonicalRepositories();
  const store = await catalogStoreOrCompatibility();
  if (store) return await store.updateRepositoryAgents(repoPath, agents, at);
  const updatedAt = at ?? new Date().toISOString();
  await updateRegistry((registry: any) => {
    registry.repos ??= {};
    registry.repos[repoPath] = { ...(registry.repos[repoPath] ?? { path: repoPath, addedAt: updatedAt }), agents };
  });
  return (await listCanonicalRepositories()).find((repo) => repo.path === repoPath)!;
}
