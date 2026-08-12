import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { dvmCopyToContainer, dvmExec } from '../host/dvm';
import { droneRootPath } from '../host/paths';
import { normalizeDroneRuntime } from '../host/runtime';

export type SyncSetSourceType = 'hub-managed' | 'host-path';
export type SyncSetScope = { type: 'all' };
export type SyncSetTargetStatusState = 'idle' | 'synced' | 'error';

export type StoredSyncSetTargetStatus = {
  targetKind: 'drone' | 'host';
  state: SyncSetTargetStatusState;
  appliedVersionId: string | null;
  appliedAt: string | null;
  error: string | null;
};

export type StoredSyncSet = {
  id: string;
  label: string;
  sourceType: SyncSetSourceType;
  sourcePath: string | null;
  targetPath: string;
  applyToHost: boolean;
  scope: SyncSetScope;
  createdAt: string;
  updatedAt: string;
  lastAppliedVersionId: string | null;
  lastAppliedAt: string | null;
  targetStatus: Record<string, StoredSyncSetTargetStatus>;
};

export function syncSetTargetOverlapsRepository(
  targetPathRaw: unknown,
  repositoryPathRaw: unknown,
): boolean {
  const targetPath = path.posix.resolve('/', String(targetPathRaw ?? '').trim());
  const repositoryPath = path.posix.resolve('/', String(repositoryPathRaw ?? '').trim());
  return (
    targetPath === repositoryPath ||
    targetPath.startsWith(`${repositoryPath}/`) ||
    repositoryPath.startsWith(`${targetPath}/`)
  );
}

export type SyncSetTargetStatusView = StoredSyncSetTargetStatus & {
  targetId: string;
  targetName: string;
};

export type SyncSetView = Omit<StoredSyncSet, 'targetStatus'> & {
  managedSourcePath: string;
  effectiveSourcePath: string;
  sourceExists: boolean;
  targetStatus: SyncSetTargetStatusView[];
};

export type SyncSetSourceSnapshot = {
  sourcePath: string;
  sourceKind: 'file' | 'directory';
  versionId: string;
  fileCount: number;
  totalBytes: number;
};

export type ParsedSyncSetMutationInput = {
  label: string;
  sourceType: SyncSetSourceType;
  sourcePath: string | null;
  targetPath: string;
  applyToHost: boolean;
};

const SYNC_SET_SCOPE_ALL: SyncSetScope = { type: 'all' };

function sanitizeTimestamp(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || null;
}

function parseScope(raw: unknown): SyncSetScope {
  const type =
    typeof (raw as any)?.type === 'string'
      ? String((raw as any).type)
          .trim()
          .toLowerCase()
      : '';
  return type === 'all' ? { type: 'all' } : SYNC_SET_SCOPE_ALL;
}

function parseTargetStatusState(raw: unknown): SyncSetTargetStatusState {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'synced' || value === 'error' ? value : 'idle';
}

function normalizeStoredTargetStatus(raw: unknown): StoredSyncSetTargetStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const targetKind = String((raw as any)?.targetKind ?? '')
    .trim()
    .toLowerCase();
  if (targetKind !== 'drone' && targetKind !== 'host') return null;
  return {
    targetKind,
    state: parseTargetStatusState((raw as any)?.state),
    appliedVersionId: sanitizeTimestamp((raw as any)?.appliedVersionId),
    appliedAt: sanitizeTimestamp((raw as any)?.appliedAt),
    error: sanitizeTimestamp((raw as any)?.error),
  };
}

function normalizeTargetStatusMap(raw: unknown): Record<string, StoredSyncSetTargetStatus> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, StoredSyncSetTargetStatus> = {};
  for (const [keyRaw, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(keyRaw ?? '').trim();
    if (!key) continue;
    const normalized = normalizeStoredTargetStatus(value);
    if (!normalized) continue;
    out[key] = normalized;
  }
  return out;
}

export function parseSyncSetSourceType(raw: unknown): SyncSetSourceType | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'hub-managed' || value === 'host-path' ? value : null;
}

export function parseSyncSetLabel(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  return value.slice(0, 120);
}

export function parseSyncSetPath(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  if (!path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) return null;
  return resolved;
}

export function parseSyncSetApplyToHost(raw: unknown): boolean {
  return raw === true;
}

export function parseSyncSetMutationInput(body: any): ParsedSyncSetMutationInput {
  const label = parseSyncSetLabel(body?.label);
  const sourceType = parseSyncSetSourceType(body?.sourceType);
  const targetPath = parseSyncSetPath(body?.targetPath);
  const sourcePath = sourceType === 'host-path' ? parseSyncSetPath(body?.sourcePath) : null;
  const applyToHost =
    sourceType === 'hub-managed' ? parseSyncSetApplyToHost(body?.applyToHost) : false;
  if (!label) throw new Error('label is required');
  if (!sourceType) throw new Error('sourceType must be hub-managed or host-path');
  if (!targetPath) throw new Error('targetPath must be an absolute path');
  if (sourceType === 'host-path' && !sourcePath) {
    throw new Error('sourcePath must be an absolute path for host-path sync sets');
  }
  if (sourceType !== 'hub-managed' && body?.applyToHost === true) {
    throw new Error('applyToHost is only supported for hub-managed sync sets');
  }
  return {
    label,
    sourceType,
    sourcePath,
    targetPath,
    applyToHost,
  };
}

export function hubManagedSyncSetSourcePath(syncSetIdRaw: unknown): string {
  const syncSetId = String(syncSetIdRaw ?? '').trim();
  if (!syncSetId) throw new Error('missing sync set id');
  return droneRootPath('sync-sets', syncSetId, 'source');
}

export async function ensureHubManagedSyncSetSourceDir(syncSetIdRaw: unknown): Promise<string> {
  const targetPath = hubManagedSyncSetSourcePath(syncSetIdRaw);
  await fs.mkdir(targetPath, { recursive: true });
  return targetPath;
}

export async function removeHubManagedSyncSetSourceDir(syncSetIdRaw: unknown): Promise<void> {
  await fs.rm(hubManagedSyncSetSourcePath(syncSetIdRaw), { recursive: true, force: true });
}

export function readStoredSyncSets(regAny: any): StoredSyncSet[] {
  const items = Array.isArray(regAny?.settings?.syncSets?.items)
    ? regAny.settings.syncSets.items
    : [];
  const out: StoredSyncSet[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = typeof (raw as any)?.id === 'string' ? String((raw as any).id).trim() : '';
    const label = parseSyncSetLabel((raw as any)?.label);
    const sourceType = parseSyncSetSourceType((raw as any)?.sourceType);
    const targetPath = parseSyncSetPath((raw as any)?.targetPath);
    if (!id || !label || !sourceType || !targetPath) continue;
    const sourcePath =
      sourceType === 'host-path' ? parseSyncSetPath((raw as any)?.sourcePath) : null;
    if (sourceType === 'host-path' && !sourcePath) continue;
    out.push({
      id,
      label,
      sourceType,
      sourcePath,
      targetPath,
      applyToHost:
        sourceType === 'hub-managed' ? parseSyncSetApplyToHost((raw as any)?.applyToHost) : false,
      scope: parseScope((raw as any)?.scope),
      createdAt: sanitizeTimestamp((raw as any)?.createdAt) ?? new Date(0).toISOString(),
      updatedAt: sanitizeTimestamp((raw as any)?.updatedAt) ?? new Date(0).toISOString(),
      lastAppliedVersionId: sanitizeTimestamp((raw as any)?.lastAppliedVersionId),
      lastAppliedAt: sanitizeTimestamp((raw as any)?.lastAppliedAt),
      targetStatus: normalizeTargetStatusMap((raw as any)?.targetStatus),
    });
  }
  return out;
}

export function findStoredSyncSetIndex(syncSets: StoredSyncSet[], syncSetIdRaw: unknown): number {
  const syncSetId = String(syncSetIdRaw ?? '').trim();
  if (!syncSetId) return -1;
  return syncSets.findIndex((entry) => entry.id === syncSetId);
}

export function writeStoredSyncSets(
  regAny: any,
  syncSets: StoredSyncSet[],
  updatedAtRaw: unknown,
): void {
  regAny.settings = regAny.settings ?? {};
  regAny.settings.syncSets = {
    items: syncSets,
    updatedAt: sanitizeTimestamp(updatedAtRaw),
  };
}

export function syncSetTargetStatusKeyForDrone(droneIdRaw: unknown): string {
  return String(droneIdRaw ?? '').trim();
}

export function syncSetTargetStatusKeyForHost(): string {
  return 'host';
}

export function resolveSyncSetEffectiveSourcePath(
  syncSet: Pick<StoredSyncSet, 'id' | 'sourceType' | 'sourcePath'>,
): string {
  return syncSet.sourceType === 'hub-managed'
    ? hubManagedSyncSetSourcePath(syncSet.id)
    : String(syncSet.sourcePath ?? '').trim();
}

export async function syncSetSourceExists(
  syncSet: Pick<StoredSyncSet, 'id' | 'sourceType' | 'sourcePath'>,
): Promise<boolean> {
  const sourcePath = resolveSyncSetEffectiveSourcePath(syncSet);
  if (!sourcePath) return false;
  try {
    await fs.lstat(sourcePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSyncSetSourceIsReadable(
  syncSet: Pick<ParsedSyncSetMutationInput, 'sourceType' | 'sourcePath'>,
): Promise<void> {
  if (syncSet.sourceType !== 'host-path') return;
  const sourcePath = String(syncSet.sourcePath ?? '').trim();
  if (!sourcePath) throw new Error('sourcePath must be an absolute path for host-path sync sets');
  try {
    const sourceStat = await fs.lstat(sourcePath);
    if (sourceStat.isSymbolicLink()) {
      throw new Error(`symlinks are not supported in sync-set sources: ${sourcePath}`);
    }
  } catch (e: any) {
    const message = String(e?.message ?? e ?? 'sourcePath is not readable').trim();
    if (message.startsWith('symlinks are not supported in sync-set sources:')) throw e;
    throw new Error(`sourcePath is not readable: ${message}`);
  }
}

async function updateHashWithFile(hash: crypto.Hash, filePath: string): Promise<number> {
  const buf = await fs.readFile(filePath);
  hash.update(buf);
  return buf.length;
}

async function walkSnapshotNode(
  hash: crypto.Hash,
  absolutePath: string,
  relativePath: string,
): Promise<{ kind: 'file' | 'directory'; fileCount: number; totalBytes: number }> {
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`symlinks are not supported in sync-set sources: ${absolutePath}`);
  }
  if (stat.isFile()) {
    hash.update(`file:${relativePath}:${stat.size}\n`);
    const totalBytes = await updateHashWithFile(hash, absolutePath);
    return { kind: 'file', fileCount: 1, totalBytes };
  }
  if (!stat.isDirectory()) {
    throw new Error(`unsupported source entry in sync set: ${absolutePath}`);
  }

  hash.update(`dir:${relativePath}\n`);
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  let fileCount = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    const childAbsolutePath = path.join(absolutePath, entry.name);
    const childRelativePath = relativePath ? path.posix.join(relativePath, entry.name) : entry.name;
    const child = await walkSnapshotNode(hash, childAbsolutePath, childRelativePath);
    fileCount += child.fileCount;
    totalBytes += child.totalBytes;
  }
  return { kind: 'directory', fileCount, totalBytes };
}

export async function computeSyncSetSourceSnapshot(
  syncSet: Pick<StoredSyncSet, 'id' | 'sourceType' | 'sourcePath'>,
): Promise<SyncSetSourceSnapshot> {
  const sourcePath = resolveSyncSetEffectiveSourcePath(syncSet);
  if (!sourcePath) throw new Error('sync set source path is missing');
  const resolvedSourcePath = path.resolve(sourcePath);
  const hash = crypto.createHash('sha256');
  const walked = await walkSnapshotNode(hash, resolvedSourcePath, '');
  return {
    sourcePath: resolvedSourcePath,
    sourceKind: walked.kind,
    versionId: hash.digest('hex'),
    fileCount: walked.fileCount,
    totalBytes: walked.totalBytes,
  };
}

export async function mirrorLocalSourceToHostTarget(opts: {
  sourcePath: string;
  sourceKind: 'file' | 'directory';
  targetPath: string;
}): Promise<void> {
  const sourcePath = path.resolve(opts.sourcePath);
  const targetPath = path.resolve(opts.targetPath);
  const relativeSourceToTarget = path.relative(sourcePath, targetPath);
  const relativeTargetToSource = path.relative(targetPath, sourcePath);
  const overlaps =
    sourcePath === targetPath ||
    (!!relativeSourceToTarget &&
      !relativeSourceToTarget.startsWith('..') &&
      !path.isAbsolute(relativeSourceToTarget)) ||
    (!!relativeTargetToSource &&
      !relativeTargetToSource.startsWith('..') &&
      !path.isAbsolute(relativeTargetToSource));
  if (overlaps) {
    throw new Error(`host sync source and target cannot overlap: ${sourcePath} <-> ${targetPath}`);
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rm(targetPath, { recursive: true, force: true });
  if (opts.sourceKind === 'file') {
    await fs.copyFile(sourcePath, targetPath);
    return;
  }
  await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
}

export async function mirrorLocalSourceToContainerTarget(opts: {
  containerName: string;
  sourcePath: string;
  sourceKind: 'file' | 'directory';
  targetPath: string;
  timeoutMs?: number;
}): Promise<void> {
  const targetPath = path.posix.normalize(String(opts.targetPath ?? '').trim());
  if (!targetPath.startsWith('/')) {
    throw new Error(`container sync target must be absolute: ${targetPath || '(empty)'}`);
  }
  const cleanupScript = [
    'set -euo pipefail',
    `target=${JSON.stringify(targetPath)}`,
    'parent=$(dirname -- "$target")',
    'mkdir -p "$parent"',
    'rm -rf -- "$target"',
    ...(opts.sourceKind === 'directory' ? ['mkdir -p "$target"'] : []),
  ].join('\n');
  const cleanup = await dvmExec(opts.containerName, 'bash', ['-lc', cleanupScript], {
    timeoutMs: opts.timeoutMs,
  });
  if (cleanup.code !== 0) {
    throw new Error(
      (cleanup.stderr || cleanup.stdout || 'failed preparing container sync target').trim(),
    );
  }
  if (opts.sourceKind === 'directory') {
    const names = await fs.readdir(opts.sourcePath);
    if (names.length === 0) return;
  }
  await dvmCopyToContainer(opts.containerName, opts.sourcePath, targetPath, {
    clean: false,
    timeoutMs: opts.timeoutMs,
  });
}

export function setStoredSyncSetTargetStatus(
  syncSet: StoredSyncSet,
  targetIdRaw: unknown,
  patch: Partial<StoredSyncSetTargetStatus> &
    Pick<StoredSyncSetTargetStatus, 'targetKind' | 'state'>,
): StoredSyncSet {
  const targetId = String(targetIdRaw ?? '').trim();
  if (!targetId) return syncSet;
  return {
    ...syncSet,
    targetStatus: {
      ...syncSet.targetStatus,
      [targetId]: {
        targetKind: patch.targetKind,
        state: patch.state,
        appliedVersionId: patch.appliedVersionId ?? null,
        appliedAt: patch.appliedAt ?? null,
        error: patch.error ?? null,
      },
    },
  };
}

export function buildSyncSetView(
  syncSet: StoredSyncSet,
  opts: {
    droneNameById?: Record<string, string>;
    includeHostTargetName?: string;
    sourceExists?: boolean;
  },
): SyncSetView {
  const droneNameById = opts.droneNameById ?? {};
  const targetStatus = Object.entries(syncSet.targetStatus)
    .map(([targetId, status]) => ({
      ...status,
      targetId,
      targetName:
        targetId === 'host'
          ? (opts.includeHostTargetName ?? 'Host')
          : (droneNameById[targetId] ?? targetId),
    }))
    .sort((a, b) => a.targetName.localeCompare(b.targetName));
  const managedSourcePath = hubManagedSyncSetSourcePath(syncSet.id);
  return {
    ...syncSet,
    managedSourcePath,
    effectiveSourcePath: resolveSyncSetEffectiveSourcePath(syncSet),
    sourceExists: opts.sourceExists ?? true,
    targetStatus,
  };
}

export function buildStoredSyncSet(input: {
  id: string;
  label: string;
  sourceType: SyncSetSourceType;
  sourcePath: string | null;
  targetPath: string;
  applyToHost: boolean;
  createdAt: string;
  updatedAt: string;
  existing?: StoredSyncSet | null;
}): StoredSyncSet {
  const existing = input.existing ?? null;
  return {
    id: input.id,
    label: input.label,
    sourceType: input.sourceType,
    sourcePath: input.sourceType === 'host-path' ? input.sourcePath : null,
    targetPath: input.targetPath,
    applyToHost: input.sourceType === 'hub-managed' ? input.applyToHost : false,
    scope: existing?.scope ?? SYNC_SET_SCOPE_ALL,
    createdAt: existing?.createdAt ?? input.createdAt,
    updatedAt: input.updatedAt,
    lastAppliedVersionId: existing?.lastAppliedVersionId ?? null,
    lastAppliedAt: existing?.lastAppliedAt ?? null,
    targetStatus: existing?.targetStatus ?? {},
  };
}

export function syncSetAppliesToHost(syncSet: StoredSyncSet): boolean {
  return syncSet.sourceType === 'hub-managed' && syncSet.applyToHost === true;
}

export function droneEntryIsContainerRuntime(droneEntry: any): boolean {
  return normalizeDroneRuntime((droneEntry as any)?.runtime) === 'container';
}
