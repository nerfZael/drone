import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { RunResult } from '../../host/dvm';
import type { ChangeRequestRepository } from './change-request-repository';
import { ChangeRequestOperationLock } from './change-request-operation-lock';
import type {
  ChangeRequestActor,
  ChangeRequestChanges,
  ChangeRequestCreateInput,
  ChangeRequestFileChange,
  ChangeRequestRecord,
  ChangeRequestStatus,
  ChangeRequestUpdateInput,
  ChangeRequestView,
} from './change-request-types';

type ResolvedDrone =
  | { kind: 'real'; id: string; drone: any }
  | { kind: 'pending'; id: string; pending: any }
  | null;

type LockedDroneContext = {
  containerName: string;
  droneEntry: any;
};

export type ChangeRequestServiceDependencies = {
  repository: ChangeRequestRepository;
  resolveDrone: (ref: string) => Promise<ResolvedDrone>;
  withLockedDroneContainer: <T>(
    input: { requestedDroneName: string; droneEntry: any },
    operation: (context: LockedDroneContext) => Promise<T>,
  ) => Promise<T>;
  exportFullHeadBundleFromDrone: (input: {
    containerName: string;
    repoPathInContainer: string;
    outDir: string;
    label?: string;
  }) => Promise<{ exportedPath: string }>;
  importBundleHeadToHostRef: (input: {
    repoRoot: string;
    bundlePath: string;
    refName: string;
  }) => Promise<string>;
  createHostAuthoredMirrorCommit: (input: {
    repoRoot: string;
    sourceRef: string;
    parentRef: string;
    message?: string;
  }) => Promise<string>;
  updateHostRef: (input: { repoRoot: string; refName: string; target: string }) => Promise<void>;
  deleteHostRefBestEffort: (input: { repoRoot: string; refName: string }) => Promise<void>;
  gitTopLevel: (repoPath: string) => Promise<string>;
  droneRepoBaseSha: (input: {
    container: string;
    repoPathInContainer: string;
  }) => Promise<string | null>;
  dvmRepoHeadSha: (input: { container: string; repoPathInContainer?: string }) => Promise<string>;
  runGitInDrone: (input: {
    container: string;
    repoPathInContainer: string;
    args: string[];
  }) => Promise<RunResult>;
  runHostCommand: (
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ) => Promise<RunResult>;
  storagePath: (...segments: string[]) => string;
  now: () => string;
  operationLock?: ChangeRequestOperationLock;
  githubMirrorLifecycle?: {
    syncAfterNativeUpdate: (record: ChangeRequestRecord) => Promise<void>;
    closeAfterNativeCompletion: (record: ChangeRequestRecord) => Promise<void>;
    refreshAfterNativeAssessment: (record: ChangeRequestRecord) => Promise<void>;
  };
};

type SnapshotSource = {
  droneId: string;
  droneName: string;
  chatId: string | null;
  chatName: string;
  drone: any;
  repoRoot: string;
  baseBranch: string;
  baseSha: string;
  sourceHeadSha: string;
};

type SnapshotResult = SnapshotSource & {
  snapshotRef: string;
  snapshotSha: string;
};

export class ChangeRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code: string | null = null,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ChangeRequestError';
  }
}

const MAX_TITLE_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MERGE_TIMEOUT_MS = 120_000;

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new ChangeRequestError(`${label} is required`);
  if (text.length > maxLength) throw new ChangeRequestError(`${label} is too long`);
  return text;
}

function optionalText(value: unknown, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw new ChangeRequestError('description is too long');
  return text;
}

function normalizeBaseBranch(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/origin\//, '')
    .replace(/^origin\//, '');
}

function statusType(statusCharRaw: string): ChangeRequestFileChange['statusType'] {
  const statusChar = statusCharRaw.slice(0, 1).toUpperCase();
  if (statusChar === 'A') return 'added';
  if (statusChar === 'M') return 'modified';
  if (statusChar === 'D') return 'deleted';
  if (statusChar === 'R') return 'renamed';
  if (statusChar === 'C') return 'copied';
  if (statusChar === 'T') return 'type-changed';
  return 'unknown';
}

function safeRefSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'request'
  );
}

function snapshotRef(id: string): string {
  return `refs/drone/change-requests/${safeRefSegment(id)}/snapshot`;
}

function temporaryImportRef(id: string): string {
  return `refs/drone/change-requests/${safeRefSegment(id)}/import-${crypto.randomBytes(5).toString('hex')}`;
}

function conflictFiles(text: string): string[] {
  const files = new Set<string>();
  const patterns = [
    /CONFLICT\s+\([^)]+\):\s+.*\s+in\s+(.+)$/gim,
    /CONFLICT\s+\([^)]+\):\s+(.+)$/gim,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(text))) {
      const file = String(match[1] ?? '').trim();
      if (file) files.add(file);
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function actor(value: ChangeRequestActor): ChangeRequestActor {
  return {
    kind: value.kind === 'chat' || value.kind === 'system' ? value.kind : 'user',
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : null,
    label: String(value.label ?? '').trim() || 'Unknown actor',
  };
}

export class ChangeRequestService {
  private readonly operationLock: ChangeRequestOperationLock;

  constructor(private readonly deps: ChangeRequestServiceDependencies) {
    this.operationLock = deps.operationLock ?? new ChangeRequestOperationLock();
  }

  async create(input: ChangeRequestCreateInput): Promise<ChangeRequestView> {
    const id = crypto.randomUUID();
    const title = requiredText(input.title, 'title', MAX_TITLE_LENGTH);
    const description = optionalText(input.description, MAX_DESCRIPTION_LENGTH);
    const source = await this.captureSnapshotSource(input.droneRef, input.chatName);
    const destinationBranch = await this.validBranch(
      source.repoRoot,
      input.destinationBranch || source.baseBranch,
    );
    const snapshot = await this.captureSnapshot(id, source);
    const now = this.deps.now();
    let created: ChangeRequestRecord;
    try {
      created = await this.deps.repository.insert({
        id,
        status: 'open',
        droneId: snapshot.droneId,
        droneName: snapshot.droneName,
        chatId: input.chatId ?? snapshot.chatId,
        chatName: snapshot.chatName,
        repoRoot: snapshot.repoRoot,
        baseBranch: snapshot.baseBranch,
        baseSha: snapshot.baseSha,
        destinationBranch,
        snapshotRef: snapshot.snapshotRef,
        snapshotSha: snapshot.snapshotSha,
        sourceHeadSha: snapshot.sourceHeadSha,
        revision: 1,
        title,
        description,
        createdBy: actor(input.actor),
        mergedBy: null,
        mergeCommitSha: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        mergedAt: null,
        closedAt: null,
        githubMirror: null,
      });
    } catch (error) {
      await this.deps.deleteHostRefBestEffort({
        repoRoot: snapshot.repoRoot,
        refName: snapshot.snapshotRef,
      });
      throw error;
    }
    return await this.view(created);
  }

  async get(idRaw: string): Promise<ChangeRequestView> {
    return await this.view(this.requiredRecord(idRaw));
  }

  async list(
    filters: {
      droneId?: string;
      chatName?: string;
      status?: ChangeRequestStatus;
    } = {},
  ): Promise<ChangeRequestView[]> {
    return await Promise.all(this.deps.repository.list(filters).map((record) => this.view(record)));
  }

  async refreshAssessment(idRaw: string): Promise<ChangeRequestView> {
    const id = String(idRaw ?? '').trim();
    return await this.withLock(id, async () => {
      const current = this.requiredRecord(id);
      if (current.status === 'open') {
        await this.git(current.repoRoot, ['fetch', 'origin', '--prune'], MERGE_TIMEOUT_MS);
      }
      await this.deps.githubMirrorLifecycle?.refreshAfterNativeAssessment(this.requiredRecord(id));
      return await this.view(this.requiredRecord(id));
    });
  }

  async update(idRaw: string, input: ChangeRequestUpdateInput): Promise<ChangeRequestView> {
    const id = String(idRaw ?? '').trim();
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      const destinationBranch = input.destinationBranch
        ? await this.validBranch(current.repoRoot, input.destinationBranch)
        : current.destinationBranch;
      let snapshotPatch: Partial<ChangeRequestRecord> = {};
      if (input.refreshSnapshot !== false) {
        const source = await this.captureSnapshotSource(current.droneId, current.chatName, current);
        const snapshot = await this.captureSnapshot(id, source);
        snapshotPatch = {
          snapshotRef: snapshot.snapshotRef,
          snapshotSha: snapshot.snapshotSha,
          sourceHeadSha: snapshot.sourceHeadSha,
          revision: current.revision + 1,
        };
      }
      let updated: ChangeRequestRecord;
      try {
        updated = await this.deps.repository.update(id, {
          ...snapshotPatch,
          destinationBranch,
          ...(input.title === undefined
            ? {}
            : { title: requiredText(input.title, 'title', MAX_TITLE_LENGTH) }),
          ...(input.description === undefined
            ? {}
            : { description: optionalText(input.description, MAX_DESCRIPTION_LENGTH) }),
          lastError: null,
          updatedAt: this.deps.now(),
        });
      } catch (error) {
        if (snapshotPatch.snapshotSha && current.snapshotRef && current.snapshotSha) {
          await this.deps.updateHostRef({
            repoRoot: current.repoRoot,
            refName: current.snapshotRef,
            target: current.snapshotSha,
          });
        }
        throw error;
      }
      await this.deps.githubMirrorLifecycle?.syncAfterNativeUpdate(updated);
      updated = this.requiredRecord(id);
      return await this.view(updated);
    });
  }

  async close(idRaw: string): Promise<ChangeRequestView> {
    const id = String(idRaw ?? '').trim();
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      const now = this.deps.now();
      const closed = await this.deps.repository.update(id, {
        status: 'closed',
        snapshotRef: null,
        lastError: null,
        updatedAt: now,
        closedAt: now,
      });
      if (current.snapshotRef) {
        await this.deps.deleteHostRefBestEffort({
          repoRoot: current.repoRoot,
          refName: current.snapshotRef,
        });
      }
      await this.deps.githubMirrorLifecycle?.closeAfterNativeCompletion(closed);
      return await this.view(this.requiredRecord(id));
    });
  }

  async merge(
    idRaw: string,
    input: { actor: ChangeRequestActor; commitMessage?: string },
  ): Promise<ChangeRequestView> {
    const id = String(idRaw ?? '').trim();
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      if (!current.snapshotRef || !current.snapshotSha) {
        throw new ChangeRequestError(
          'Change request snapshot is unavailable.',
          409,
          'snapshot_missing',
        );
      }
      try {
        const mergeCommitSha = await this.directSquashMerge(
          current,
          String(input.commitMessage ?? '').trim() || current.title,
        );
        const now = this.deps.now();
        const merged = await this.deps.repository.update(id, {
          status: 'merged',
          snapshotRef: null,
          mergedBy: actor(input.actor),
          mergeCommitSha,
          lastError: null,
          updatedAt: now,
          mergedAt: now,
        });
        await this.deps.deleteHostRefBestEffort({
          repoRoot: current.repoRoot,
          refName: current.snapshotRef,
        });
        await this.deps.githubMirrorLifecycle?.closeAfterNativeCompletion(merged);
        return await this.view(this.requiredRecord(id));
      } catch (error: any) {
        await this.deps.repository.update(id, {
          lastError: error?.message ?? String(error),
          updatedAt: this.deps.now(),
        });
        throw error;
      }
    });
  }

  async changes(idRaw: string): Promise<ChangeRequestChanges> {
    const request = await this.get(idRaw);
    if (!request.snapshotRef || !request.snapshotSha) {
      return {
        request,
        counts: { changed: 0, additions: 0, deletions: 0, modified: 0 },
        entries: [],
      };
    }
    const range = `${request.baseSha}..${request.snapshotRef}`;
    const [names, stats] = await Promise.all([
      this.git(request.repoRoot, ['diff', '--name-status', '-M', range]),
      this.git(request.repoRoot, ['diff', '--numstat', range]),
    ]);
    const statsByPath = new Map<string, { additions: number; deletions: number }>();
    for (const line of stats.stdout.split(/\r?\n/)) {
      if (!line) continue;
      const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
      const filePath = pathParts.at(-1)?.trim() ?? '';
      if (!filePath) continue;
      const additions = /^\d+$/.test(addedRaw ?? '') ? Number(addedRaw) : 0;
      const deletions = /^\d+$/.test(deletedRaw ?? '') ? Number(deletedRaw) : 0;
      statsByPath.set(filePath, { additions, deletions });
    }
    const entries: ChangeRequestFileChange[] = [];
    for (const line of names.stdout.split(/\r?\n/)) {
      if (!line) continue;
      const [statusRaw, firstPathRaw, secondPathRaw] = line.split('\t');
      const statusChar = String(statusRaw ?? '')
        .slice(0, 1)
        .toUpperCase();
      const renamed = statusChar === 'R' || statusChar === 'C';
      const filePath = String(renamed ? secondPathRaw : firstPathRaw).trim();
      if (!filePath) continue;
      const fileStats = statsByPath.get(filePath) ?? { additions: 0, deletions: 0 };
      entries.push({
        path: filePath,
        originalPath: renamed ? String(firstPathRaw ?? '').trim() || null : null,
        statusChar,
        statusType: statusType(statusChar),
        additions: fileStats.additions,
        deletions: fileStats.deletions,
        changes: fileStats.additions + fileStats.deletions,
      });
    }
    entries.sort((left, right) => left.path.localeCompare(right.path));
    const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
    const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);
    return {
      request,
      counts: {
        changed: entries.length,
        additions,
        deletions,
        modified: entries.reduce(
          (sum, entry) => sum + Math.min(entry.additions, entry.deletions),
          0,
        ),
      },
      entries,
    };
  }

  async diff(
    idRaw: string,
    filePathRaw: string,
    contextLinesRaw = 3,
  ): Promise<{
    request: ChangeRequestView;
    path: string;
    diff: string;
    truncated: boolean;
  }> {
    const request = await this.get(idRaw);
    if (!request.snapshotRef || !request.snapshotSha) {
      throw new ChangeRequestError(
        'Change request snapshot is unavailable.',
        409,
        'snapshot_missing',
      );
    }
    const filePath = String(filePathRaw ?? '').trim();
    if (!filePath || path.isAbsolute(filePath) || filePath.split(/[\\/]+/).includes('..')) {
      throw new ChangeRequestError('A valid repository-relative path is required.');
    }
    const contextLines = Math.min(200, Math.max(0, Math.floor(Number(contextLinesRaw) || 3)));
    const result = await this.git(request.repoRoot, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      `-U${contextLines}`,
      `${request.baseSha}..${request.snapshotRef}`,
      '--',
      filePath,
    ]);
    const maxBytes = 2 * 1024 * 1024;
    const bytes = Buffer.from(result.stdout, 'utf8');
    return {
      request,
      path: filePath,
      diff: bytes.length > maxBytes ? bytes.subarray(0, maxBytes).toString('utf8') : result.stdout,
      truncated: bytes.length > maxBytes,
    };
  }

  private requiredRecord(idRaw: string): ChangeRequestRecord {
    const id = String(idRaw ?? '').trim();
    if (!id) throw new ChangeRequestError('change request id is required');
    const record = this.deps.repository.get(id);
    if (!record) throw new ChangeRequestError(`unknown change request: ${id}`, 404, 'not_found');
    return record;
  }

  private requiredOpenRecord(idRaw: string): ChangeRequestRecord {
    const record = this.requiredRecord(idRaw);
    if (record.status !== 'open') {
      throw new ChangeRequestError(`Change request is ${record.status}.`, 409, 'not_open');
    }
    return record;
  }

  private async validBranch(repoRoot: string, value: unknown): Promise<string> {
    const branch = normalizeBaseBranch(value);
    if (!branch) throw new ChangeRequestError('destination branch is required');
    const result = await this.deps.runHostCommand('git', [
      '-C',
      repoRoot,
      'check-ref-format',
      '--branch',
      branch,
    ]);
    if (result.code !== 0) throw new ChangeRequestError(`Invalid destination branch: ${branch}`);
    return branch;
  }

  private async captureSnapshotSource(
    droneRefRaw: string,
    chatNameRaw?: string,
    existing?: ChangeRequestRecord,
  ): Promise<SnapshotSource> {
    const droneRef = String(droneRefRaw ?? '').trim();
    const resolved = await this.deps.resolveDrone(droneRef);
    if (!resolved)
      throw new ChangeRequestError(`unknown drone: ${droneRef}`, 404, 'drone_not_found');
    if (resolved.kind !== 'real') {
      throw new ChangeRequestError(`drone is still starting: ${droneRef}`, 409, 'drone_starting');
    }
    const drone = resolved.drone;
    const repoPath = String(drone?.repoPath ?? '').trim();
    if (!repoPath) throw new ChangeRequestError('drone has no attached repository');
    const repoRoot = await this.deps.gitTopLevel(repoPath);
    if (existing && path.resolve(existing.repoRoot) !== path.resolve(repoRoot)) {
      throw new ChangeRequestError(
        'The drone repository no longer matches this change request.',
        409,
        'repo_changed',
      );
    }
    const chatName = String(chatNameRaw ?? '').trim() || 'default';
    const chat = drone?.chats?.[chatName] ?? null;
    const droneName = String(drone?.name ?? resolved.id).trim() || resolved.id;
    const baseBranch = existing?.baseBranch || normalizeBaseBranch(drone?.repo?.baseRef);
    if (!baseBranch) {
      throw new ChangeRequestError(
        'The drone does not have a base branch. Reseed it before creating a change request.',
        409,
        'base_branch_missing',
      );
    }
    const runtime = String(drone?.runtime ?? 'container')
      .trim()
      .toLowerCase();
    if (runtime === 'host') {
      const status = await this.git(repoRoot, ['status', '--porcelain']);
      if (status.stdout.trim()) {
        throw new ChangeRequestError(
          'Commit the host working tree before creating or updating a change request.',
          409,
          'source_dirty',
        );
      }
      const sourceHeadSha = (await this.git(repoRoot, ['rev-parse', 'HEAD'])).stdout
        .trim()
        .toLowerCase();
      const baseRef = await this.resolveBranchRef(repoRoot, baseBranch);
      if (!baseRef)
        throw new ChangeRequestError(
          `Base branch is unavailable: ${baseBranch}`,
          409,
          'base_branch_missing',
        );
      const baseSha =
        existing?.baseSha ||
        (await this.git(repoRoot, ['merge-base', baseRef, sourceHeadSha])).stdout
          .trim()
          .toLowerCase();
      return {
        droneId: resolved.id,
        droneName,
        chatId: typeof chat?.id === 'string' ? chat.id : null,
        chatName,
        drone,
        repoRoot,
        baseBranch,
        baseSha,
        sourceHeadSha,
      };
    }
    const repoPathInContainer = String(drone?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
    return await this.deps.withLockedDroneContainer(
      { requestedDroneName: droneName, droneEntry: drone },
      async ({ containerName }) => {
        const status = await this.deps.runGitInDrone({
          container: containerName,
          repoPathInContainer,
          args: ['status', '--porcelain'],
        });
        if (status.code !== 0)
          throw new ChangeRequestError(status.stderr || 'Unable to inspect drone repository.', 500);
        if (status.stdout.trim()) {
          throw new ChangeRequestError(
            'Commit the drone working tree before creating or updating a change request.',
            409,
            'source_dirty',
          );
        }
        const sourceHeadSha = await this.deps.dvmRepoHeadSha({
          container: containerName,
          repoPathInContainer,
        });
        const configuredBaseSha = await this.deps.droneRepoBaseSha({
          container: containerName,
          repoPathInContainer,
        });
        const baseSha = existing?.baseSha || configuredBaseSha;
        if (!baseSha) {
          throw new ChangeRequestError(
            'The drone does not have a base commit. Reseed it before creating a change request.',
            409,
            'base_commit_missing',
          );
        }
        return {
          droneId: resolved.id,
          droneName,
          chatId: typeof chat?.id === 'string' ? chat.id : null,
          chatName,
          drone,
          repoRoot,
          baseBranch,
          baseSha,
          sourceHeadSha,
        };
      },
    );
  }

  private async captureSnapshot(id: string, source: SnapshotSource): Promise<SnapshotResult> {
    const permanentRef = snapshotRef(id);
    const importRef = temporaryImportRef(id);
    const runtime = String(source.drone?.runtime ?? 'container')
      .trim()
      .toLowerCase();
    if (runtime === 'host') {
      const snapshotSha = await this.deps.createHostAuthoredMirrorCommit({
        repoRoot: source.repoRoot,
        sourceRef: source.sourceHeadSha,
        parentRef: source.baseSha,
        message: `chore(drone): snapshot change request ${id}`,
      });
      await this.assertSnapshotHasChanges(source.repoRoot, source.baseSha, snapshotSha);
      await this.deps.updateHostRef({
        repoRoot: source.repoRoot,
        refName: permanentRef,
        target: snapshotSha,
      });
      return { ...source, snapshotRef: permanentRef, snapshotSha };
    }
    const repoPathInContainer =
      String(source.drone?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
    const exportRoot = this.deps.storagePath('change-request-exports');
    let bundlePath = '';
    try {
      const exported = await this.deps.withLockedDroneContainer(
        { requestedDroneName: source.droneName, droneEntry: source.drone },
        ({ containerName }) =>
          this.deps.exportFullHeadBundleFromDrone({
            containerName,
            repoPathInContainer,
            outDir: exportRoot,
            label: source.droneName,
          }),
      );
      bundlePath = exported.exportedPath;
      const importedHead = await this.deps.importBundleHeadToHostRef({
        repoRoot: source.repoRoot,
        bundlePath,
        refName: importRef,
      });
      if (importedHead.trim().toLowerCase() !== source.sourceHeadSha.trim().toLowerCase()) {
        throw new ChangeRequestError(
          'The drone repository changed while its snapshot was being captured. Try again.',
          409,
          'source_changed',
        );
      }
      const snapshotSha = await this.deps.createHostAuthoredMirrorCommit({
        repoRoot: source.repoRoot,
        sourceRef: importRef,
        parentRef: source.baseSha,
        message: `chore(drone): snapshot change request ${id}`,
      });
      await this.assertSnapshotHasChanges(source.repoRoot, source.baseSha, snapshotSha);
      await this.deps.updateHostRef({
        repoRoot: source.repoRoot,
        refName: permanentRef,
        target: snapshotSha,
      });
      return { ...source, snapshotRef: permanentRef, snapshotSha };
    } finally {
      await this.deps.deleteHostRefBestEffort({ repoRoot: source.repoRoot, refName: importRef });
      if (bundlePath) await fs.rm(bundlePath, { force: true }).catch(() => {});
    }
  }

  private async assertSnapshotHasChanges(
    repoRoot: string,
    baseSha: string,
    snapshotSha: string,
  ): Promise<void> {
    const result = await this.deps.runHostCommand('git', [
      '-C',
      repoRoot,
      'diff',
      '--quiet',
      baseSha,
      snapshotSha,
    ]);
    if (result.code === 0)
      throw new ChangeRequestError('There are no committed changes to request.', 409, 'no_changes');
    if (result.code !== 1)
      throw new ChangeRequestError(
        result.stderr || 'Unable to compare the change request snapshot.',
        500,
      );
  }

  private async view(record: ChangeRequestRecord): Promise<ChangeRequestView> {
    const githubMirror = record.githubMirror
      ? {
          ...record.githubMirror,
          outOfDate:
            record.githubMirror.syncedRevision !== record.revision ||
            record.githubMirror.syncedNativeUpdatedAt !== record.updatedAt,
        }
      : null;
    if (record.status !== 'open' || !record.snapshotRef || !record.snapshotSha) {
      return {
        ...record,
        githubMirror,
        stale: false,
        conflicted: false,
        destinationExists: record.status === 'merged',
        destinationSha: record.mergeCommitSha,
        conflictFiles: [],
      };
    }
    const snapshot = await this.resolveCommit(record.repoRoot, record.snapshotRef);
    if (!snapshot || snapshot !== record.snapshotSha) {
      return {
        ...record,
        githubMirror,
        stale: false,
        conflicted: false,
        destinationExists: false,
        destinationSha: null,
        conflictFiles: [],
        lastError: 'Change request snapshot is unavailable.',
      };
    }
    const destinationRef = await this.resolveBranchRef(record.repoRoot, record.destinationBranch);
    const baseRef = await this.resolveBranchRef(record.repoRoot, record.baseBranch);
    const targetRef = destinationRef ?? baseRef;
    const destinationSha = targetRef ? await this.resolveCommit(record.repoRoot, targetRef) : null;
    if (!destinationSha) {
      return {
        ...record,
        githubMirror,
        stale: false,
        conflicted: false,
        destinationExists: Boolean(destinationRef),
        destinationSha: null,
        conflictFiles: [],
        lastError: `Base branch is unavailable: ${record.baseBranch}`,
      };
    }
    const mergeTree = await this.deps.runHostCommand(
      'git',
      [
        '-C',
        record.repoRoot,
        'merge-tree',
        '--write-tree',
        '--messages',
        destinationSha,
        record.snapshotRef,
      ],
      { timeoutMs: 30_000 },
    );
    const combined = `${mergeTree.stdout}\n${mergeTree.stderr}`.trim();
    return {
      ...record,
      githubMirror,
      stale: destinationSha !== record.baseSha,
      conflicted: mergeTree.code !== 0,
      destinationExists: Boolean(destinationRef),
      destinationSha,
      conflictFiles: mergeTree.code === 0 ? [] : conflictFiles(combined),
    };
  }

  private async directSquashMerge(
    record: ChangeRequestRecord,
    commitMessage: string,
  ): Promise<string> {
    await this.git(record.repoRoot, ['fetch', 'origin', '--prune'], MERGE_TIMEOUT_MS);
    const destinationRef = await this.resolveBranchRef(record.repoRoot, record.destinationBranch);
    const baseRef = await this.resolveBranchRef(record.repoRoot, record.baseBranch);
    const targetRef = destinationRef ?? baseRef;
    if (!targetRef) {
      throw new ChangeRequestError(
        `Base branch is unavailable: ${record.baseBranch}`,
        409,
        'base_branch_missing',
      );
    }
    const targetSha = await this.resolveCommit(record.repoRoot, targetRef);
    if (!targetSha)
      throw new ChangeRequestError(
        'Unable to resolve merge destination.',
        409,
        'destination_missing',
      );
    const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const worktreePath = this.deps.storagePath(
      'change-request-worktrees',
      `${safeRefSegment(record.id)}-${runId}`,
    );
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    try {
      await this.git(
        record.repoRoot,
        ['worktree', 'add', '--detach', worktreePath, targetSha],
        MERGE_TIMEOUT_MS,
      );
      const merged = await this.deps.runHostCommand(
        'git',
        ['-C', worktreePath, 'merge', '--squash', '--no-commit', record.snapshotRef!],
        { timeoutMs: MERGE_TIMEOUT_MS },
      );
      if (merged.code !== 0) {
        const combined = `${merged.stdout}\n${merged.stderr}`.trim();
        throw new ChangeRequestError(
          'The change request conflicts with its destination.',
          409,
          'merge_conflict',
          { conflictFiles: conflictFiles(combined) },
        );
      }
      const staged = await this.deps.runHostCommand('git', [
        '-C',
        worktreePath,
        'diff',
        '--cached',
        '--quiet',
      ]);
      let mergeCommitSha = targetSha;
      if (staged.code === 1) {
        await this.git(
          worktreePath,
          ['commit', '-m', requiredText(commitMessage, 'commit message', 10_000)],
          MERGE_TIMEOUT_MS,
        );
        mergeCommitSha = (await this.git(worktreePath, ['rev-parse', 'HEAD'])).stdout
          .trim()
          .toLowerCase();
      } else if (staged.code !== 0) {
        throw new ChangeRequestError(staged.stderr || 'Unable to inspect the prepared merge.', 500);
      }
      await this.git(
        worktreePath,
        ['push', 'origin', `HEAD:refs/heads/${record.destinationBranch}`],
        MERGE_TIMEOUT_MS,
      );
      return mergeCommitSha;
    } finally {
      await this.deps.runHostCommand(
        'git',
        ['-C', record.repoRoot, 'worktree', 'remove', '--force', worktreePath],
        {
          timeoutMs: 30_000,
        },
      );
      await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
      await this.deps.runHostCommand('git', ['-C', record.repoRoot, 'worktree', 'prune']);
    }
  }

  private async resolveBranchRef(repoRoot: string, branch: string): Promise<string | null> {
    for (const candidate of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
      if (await this.resolveCommit(repoRoot, candidate)) return candidate;
    }
    return null;
  }

  private async resolveCommit(repoRoot: string, ref: string): Promise<string | null> {
    const result = await this.deps.runHostCommand('git', [
      '-C',
      repoRoot,
      'rev-parse',
      '--verify',
      `${ref}^{commit}`,
    ]);
    if (result.code !== 0) return null;
    const sha = result.stdout.trim().toLowerCase();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  }

  private async git(repoRoot: string, args: string[], timeoutMs = 30_000): Promise<RunResult> {
    const result = await this.deps.runHostCommand('git', ['-C', repoRoot, ...args], { timeoutMs });
    if (result.code !== 0) {
      throw new ChangeRequestError(
        String(result.stderr || result.stdout || `git ${args[0] ?? 'operation'} failed`).trim(),
        409,
        'git_failed',
      );
    }
    return result;
  }

  private async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return await this.operationLock.withLock(id, operation);
  }
}
