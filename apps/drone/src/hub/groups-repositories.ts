import path from 'node:path';

import { getCatalogStore, type CatalogGroupRecord, type CatalogRepositoryRecord, type CatalogStore } from '../host/catalog-store';
import { getHubDatabase } from '../host/hub-database';
import { loadRegistry, loadRegistryRawSnapshot, updateRegistry } from '../host/registry';

const groupsBackfilled = new WeakSet<CatalogStore>();
const repositoriesBackfilled = new WeakSet<CatalogStore>();

async function catalogStoreOrCompatibility(): Promise<CatalogStore | null> {
  try {
    return await getCatalogStore();
  } catch (error) {
    if ((globalThis as any).Bun && getHubDatabase() === null) return null;
    throw error;
  }
}

function legacyGroups(registry: any): CatalogGroupRecord[] {
  const out: CatalogGroupRecord[] = [];
  for (const [key, raw] of Object.entries(registry?.groups ?? {})) {
    const name = String((raw as any)?.name ?? key).trim();
    if (!name) continue;
    const createdAt = String((raw as any)?.createdAt ?? '').trim() || new Date().toISOString();
    out.push({ name, createdAt, updatedAt: String((raw as any)?.updatedAt ?? '').trim() || createdAt });
  }
  return out;
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

export async function listCanonicalGroups(): Promise<CatalogGroupRecord[]> {
  const store = await catalogStoreOrCompatibility();
  if (!store) return legacyGroups(await loadRegistry());
  if (!groupsBackfilled.has(store)) {
    await store.backfillGroups(legacyGroups(await loadRegistryRawSnapshot()));
    groupsBackfilled.add(store);
  }
  return store.listGroups();
}

export async function ensureCanonicalGroup(nameRaw: string, at = new Date().toISOString()): Promise<CatalogGroupRecord> {
  const name = String(nameRaw ?? '').trim();
  if (!name) throw new Error('group name cannot be empty');
  const existing = (await listCanonicalGroups()).find((group) => group.name === name);
  if (existing) return existing;
  const store = await catalogStoreOrCompatibility();
  if (store) return await store.putGroup({ name, createdAt: at, updatedAt: at });
  await updateRegistry((registry: any) => {
    registry.groups ??= {};
    registry.groups[name] = { name, createdAt: at, updatedAt: at };
  });
  return { name, createdAt: at, updatedAt: at };
}

export async function deleteCanonicalGroup(name: string, at?: string): Promise<boolean> {
  await listCanonicalGroups();
  const store = await catalogStoreOrCompatibility();
  if (store) return await store.deleteGroup(name, at);
  return await updateRegistry((registry: any) => Boolean(registry?.groups?.[name]) && delete registry.groups[name]);
}

export async function renameCanonicalGroupTree(oldName: string, newName: string, at = new Date().toISOString()): Promise<number> {
  if (newName === oldName || newName.startsWith(`${oldName}/`)) {
    throw new Error('cannot move a group into itself or its own subtree');
  }
  const groups = await listCanonicalGroups();
  const rewrites = groups
    .filter((group) => group.name === oldName || group.name.startsWith(`${oldName}/`))
    .map((group) => ({ from: group.name, to: `${newName}${group.name.slice(oldName.length)}` }));
  if (rewrites.length === 0) throw new Error(`unknown group: ${oldName}`);
  const store = await catalogStoreOrCompatibility();
  if (store) return await store.renameGroups(rewrites, at);
  await updateRegistry((registry: any) => {
    registry.groups ??= {};
    for (const item of rewrites) {
      const current = registry.groups[item.from];
      if (!current) continue;
      delete registry.groups[item.from];
      registry.groups[item.to] = { ...current, name: item.to, updatedAt: at };
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
