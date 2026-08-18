import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { RunResult } from '../../host/dvm';
import { ChangeRequestError } from './change-request-error';
import { ChangeRequestObjectStore } from './change-request-object-store';
import {
  normalizeChangeRequestBranch,
  resolveChangeRequestBranch,
  runChangeRequestGit,
  safeChangeRequestRefSegment,
  type RunHostCommand,
} from './change-request-git';
import type { ChangeRequestRecord } from './change-request-types';

export type ResolvedChangeRequestDrone =
  | { kind: 'real'; id: string; drone: any }
  | { kind: 'pending'; id: string; pending: any }
  | null;

type LockedDroneContext = {
  containerName: string;
  droneEntry: any;
};

export type ChangeRequestSnapshotDependencies = {
  resolveDrone: (ref: string) => Promise<ResolvedChangeRequestDrone>;
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
  dvmRepoHeadSha: (input: { container: string; repoPathInContainer?: string }) => Promise<string>;
  runGitInDrone: (input: {
    container: string;
    repoPathInContainer: string;
    args: string[];
  }) => Promise<RunResult>;
  runHostCommand: RunHostCommand;
  storagePath: (...segments: string[]) => string;
};

export type ChangeRequestSnapshotSource = {
  droneId: string;
  droneName: string;
  chatId: string | null;
  chatName: string;
  drone: any;
  repoRoot: string;
  baseBranch: string;
  baseSha: string | null;
  sourceHeadSha: string;
};

export type ChangeRequestSnapshot = Omit<ChangeRequestSnapshotSource, 'baseSha'> & {
  baseSha: string;
  snapshotRef: string;
  snapshotSha: string;
  sourceRef: string;
  objectStorePath: string;
};

export class ChangeRequestSnapshotService {
  private readonly objectStore: ChangeRequestObjectStore;

  constructor(private readonly deps: ChangeRequestSnapshotDependencies) {
    this.objectStore = new ChangeRequestObjectStore(deps);
  }

  async captureSource(
    droneRefRaw: string,
    chatNameRaw?: string,
    existing?: ChangeRequestRecord,
  ): Promise<ChangeRequestSnapshotSource> {
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
    await this.fetchOriginIfPresent(repoRoot);
    const chatName = String(chatNameRaw ?? '').trim() || 'default';
    const chat = drone?.chats?.[chatName] ?? null;
    const droneName = String(drone?.name ?? resolved.id).trim() || resolved.id;
    const baseBranch = existing?.baseBranch || normalizeChangeRequestBranch(drone?.repo?.baseRef);
    if (!baseBranch) {
      throw new ChangeRequestError(
        'The drone does not have a base branch. Reseed it before creating a change request.',
        409,
        'base_branch_missing',
      );
    }
    const shared = {
      droneId: resolved.id,
      droneName,
      chatId: typeof chat?.id === 'string' ? chat.id : null,
      chatName,
      drone,
      repoRoot,
      baseBranch,
    };
    const runtime = String(drone?.runtime ?? 'container')
      .trim()
      .toLowerCase();
    if (runtime === 'host') {
      const status = await this.git(repoRoot, [
        'status',
        '--porcelain',
        '--untracked-files=all',
      ]);
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
      const baseRef = await resolveChangeRequestBranch(
        this.deps.runHostCommand,
        repoRoot,
        baseBranch,
      );
      if (!baseRef)
        throw new ChangeRequestError(
          `Base branch is unavailable: ${baseBranch}`,
          409,
          'base_branch_missing',
        );
      const baseSha = (await this.git(repoRoot, ['merge-base', baseRef, sourceHeadSha])).stdout
        .trim()
        .toLowerCase();
      return { ...shared, baseSha, sourceHeadSha };
    }
    const repoPathInContainer = String(drone?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
    return await this.deps.withLockedDroneContainer(
      { requestedDroneName: droneName, droneEntry: drone },
      async ({ containerName }) => {
        const status = await this.deps.runGitInDrone({
          container: containerName,
          repoPathInContainer,
          args: ['status', '--porcelain', '--untracked-files=all'],
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
        return { ...shared, baseSha: null, sourceHeadSha };
      },
    );
  }

  async capture(
    id: string,
    revision: number,
    source: ChangeRequestSnapshotSource,
  ): Promise<ChangeRequestSnapshot> {
    const permanentRef = snapshotRef(id, revision);
    const permanentSourceRef = sourceRevisionRef(id, revision);
    const importRef = temporaryImportRef(id);
    const runtime = String(source.drone?.runtime ?? 'container')
      .trim()
      .toLowerCase();
    if (runtime === 'host') {
      const resolvedSource = this.requireResolvedBase(source);
      try {
        await this.deps.updateHostRef({
          repoRoot: source.repoRoot,
          refName: permanentSourceRef,
          target: source.sourceHeadSha,
        });
        const snapshotSha = await this.createSnapshotCommit(id, resolvedSource, permanentSourceRef);
        await this.deps.updateHostRef({
          repoRoot: source.repoRoot,
          refName: permanentRef,
          target: snapshotSha,
        });
        const objectStorePath = await this.objectStore.importRevision({
          requestId: id,
          sourceRepoRoot: source.repoRoot,
          sourceRef: permanentSourceRef,
          snapshotRef: permanentRef,
        });
        return {
          ...resolvedSource,
          snapshotRef: permanentRef,
          snapshotSha,
          sourceRef: permanentSourceRef,
          objectStorePath,
        };
      } catch (error) {
        await this.cleanupFailedRevision(id, source.repoRoot, permanentSourceRef, permanentRef);
        throw error;
      }
    }
    const repoPathInContainer =
      String(source.drone?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
    let bundlePath = '';
    try {
      const exported = await this.deps.withLockedDroneContainer(
        { requestedDroneName: source.droneName, droneEntry: source.drone },
        ({ containerName }) =>
          this.deps.exportFullHeadBundleFromDrone({
            containerName,
            repoPathInContainer,
            outDir: this.deps.storagePath('change-request-exports'),
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
      const resolvedSource = source.baseSha
        ? this.requireResolvedBase(source)
        : await this.resolveBaseFromImportedHead(source, importRef);
      await this.deps.updateHostRef({
        repoRoot: source.repoRoot,
        refName: permanentSourceRef,
        target: importedHead,
      });
      const snapshotSha = await this.createSnapshotCommit(id, resolvedSource, permanentSourceRef);
      await this.deps.updateHostRef({
        repoRoot: source.repoRoot,
        refName: permanentRef,
        target: snapshotSha,
      });
      const objectStorePath = await this.objectStore.importRevision({
        requestId: id,
        sourceRepoRoot: source.repoRoot,
        sourceRef: permanentSourceRef,
        snapshotRef: permanentRef,
      });
      return {
        ...resolvedSource,
        snapshotRef: permanentRef,
        snapshotSha,
        sourceRef: permanentSourceRef,
        objectStorePath,
      };
    } catch (error) {
      await this.cleanupFailedRevision(id, source.repoRoot, permanentSourceRef, permanentRef);
      throw error;
    } finally {
      await this.deps.deleteHostRefBestEffort({ repoRoot: source.repoRoot, refName: importRef });
      if (bundlePath) await fs.rm(bundlePath, { force: true }).catch(() => {});
    }
  }

  async discard(requestId: string, snapshot: ChangeRequestSnapshot): Promise<void> {
    await this.cleanupFailedRevision(
      requestId,
      snapshot.repoRoot,
      snapshot.sourceRef,
      snapshot.snapshotRef,
    );
  }

  private async cleanupFailedRevision(
    requestId: string,
    repoRoot: string,
    sourceRef: string,
    snapshotRefName: string,
  ): Promise<void> {
    await Promise.all([
      this.deps.deleteHostRefBestEffort({ repoRoot, refName: sourceRef }),
      this.deps.deleteHostRefBestEffort({ repoRoot, refName: snapshotRefName }),
      this.objectStore.deleteRevisionRefsBestEffort(requestId, [sourceRef, snapshotRefName]),
    ]);
  }

  private async createSnapshotCommit(
    id: string,
    source: ChangeRequestSnapshotSource & { baseSha: string },
    sourceRef: string,
  ): Promise<string> {
    const snapshotSha = await this.deps.createHostAuthoredMirrorCommit({
      repoRoot: source.repoRoot,
      sourceRef,
      parentRef: source.baseSha,
      message: `chore(drone): snapshot change request ${id}`,
    });
    await this.assertHasChanges(source.repoRoot, source.baseSha, snapshotSha);
    return snapshotSha;
  }

  private requireResolvedBase(
    source: ChangeRequestSnapshotSource,
  ): ChangeRequestSnapshotSource & { baseSha: string } {
    if (!source.baseSha) {
      throw new ChangeRequestError(
        'The change request base commit could not be resolved.',
        409,
        'base_commit_missing',
      );
    }
    return source as ChangeRequestSnapshotSource & { baseSha: string };
  }

  private async resolveBaseFromImportedHead(
    source: ChangeRequestSnapshotSource,
    importedHeadRef: string,
  ): Promise<ChangeRequestSnapshotSource & { baseSha: string }> {
    const baseRef = await resolveChangeRequestBranch(
      this.deps.runHostCommand,
      source.repoRoot,
      source.baseBranch,
    );
    if (!baseRef) {
      throw new ChangeRequestError(
        `Base branch is unavailable: ${source.baseBranch}`,
        409,
        'base_branch_missing',
      );
    }
    const baseSha = (
      await this.git(source.repoRoot, ['merge-base', baseRef, importedHeadRef])
    ).stdout
      .trim()
      .toLowerCase();
    return { ...source, baseSha };
  }

  private async fetchOriginIfPresent(repoRoot: string): Promise<void> {
    const remotes = (await this.git(repoRoot, ['remote'])).stdout
      .split(/\r?\n/)
      .map((remote) => remote.trim())
      .filter(Boolean);
    if (!remotes.includes('origin')) return;
    await this.git(repoRoot, ['fetch', 'origin', '--prune'], 120_000);
  }

  private async assertHasChanges(
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

  private git(repoRoot: string, args: string[], timeoutMs?: number): Promise<RunResult> {
    return runChangeRequestGit(this.deps.runHostCommand, repoRoot, args, timeoutMs);
  }
}

function snapshotRef(id: string, revision: number): string {
  return `refs/drone/change-requests/${safeChangeRequestRefSegment(id)}/snapshots/${revision}`;
}

function sourceRevisionRef(id: string, revision: number): string {
  return `refs/drone/change-requests/${safeChangeRequestRefSegment(id)}/sources/${revision}`;
}

function temporaryImportRef(id: string): string {
  return `refs/drone/change-requests/${safeChangeRequestRefSegment(id)}/import-${crypto.randomBytes(5).toString('hex')}`;
}
