import crypto from 'node:crypto';
import path from 'node:path';

import type { RunResult } from '../../host/dvm';
import {
  ChangeRequestDirectMerger,
  type ChangeRequestDirectMergerDependencies,
} from './change-request-direct-merger';
import { ChangeRequestError } from './change-request-error';
import {
  changeRequestConflictFiles,
  normalizeChangeRequestBranch,
  resolveChangeRequestBranch,
  resolveChangeRequestCommit,
  runChangeRequestGit,
  type RunHostCommand,
} from './change-request-git';
import { ChangeRequestLifecycle, normalizeChangeRequestActor } from './change-request-lifecycle';
import type { ChangeRequestRepository } from './change-request-repository';
import { ChangeRequestOperationLock } from './change-request-operation-lock';
import {
  ChangeRequestSnapshotService,
  type ChangeRequestSnapshotDependencies,
} from './change-request-snapshot-service';
import type {
  ChangeRequestActor,
  ChangeRequestChanges,
  ChangeRequestCreateInput,
  ChangeRequestFileChange,
  ChangeRequestLineStats,
  ChangeRequestRecord,
  ChangeRequestStatus,
  ChangeRequestUpdateInput,
  ChangeRequestView,
} from './change-request-types';

export { ChangeRequestError } from './change-request-error';

export type ChangeRequestServiceDependencies = ChangeRequestSnapshotDependencies &
  ChangeRequestDirectMergerDependencies & {
    repository: ChangeRequestRepository;
    runHostCommand: RunHostCommand;
    now: () => string;
    operationLock?: ChangeRequestOperationLock;
    lifecycle?: ChangeRequestLifecycle;
    githubMirrorLifecycle?: {
      syncAfterNativeUpdate: (record: ChangeRequestRecord) => Promise<void>;
      closeAfterNativeCompletion: (record: ChangeRequestRecord) => Promise<void>;
      refreshAfterNativeAssessment: (record: ChangeRequestRecord) => Promise<void>;
    };
  };

const MAX_TITLE_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MERGE_TIMEOUT_MS = 120_000;
const ASSESSMENT_CONCURRENCY = 4;

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

export class ChangeRequestService {
  private readonly operationLock: ChangeRequestOperationLock;
  private readonly lifecycle: ChangeRequestLifecycle;
  private readonly snapshotService: ChangeRequestSnapshotService;
  private readonly directMerger: ChangeRequestDirectMerger;

  constructor(private readonly deps: ChangeRequestServiceDependencies) {
    this.operationLock = deps.operationLock ?? new ChangeRequestOperationLock();
    this.snapshotService = new ChangeRequestSnapshotService(deps);
    this.directMerger = new ChangeRequestDirectMerger(deps);
    this.lifecycle =
      deps.lifecycle ??
      new ChangeRequestLifecycle({
        repository: deps.repository,
        deleteHostRefBestEffort: deps.deleteHostRefBestEffort,
        now: deps.now,
      });
  }

  async create(input: ChangeRequestCreateInput): Promise<ChangeRequestView> {
    const id = crypto.randomUUID();
    const title = requiredText(input.title, 'title', MAX_TITLE_LENGTH);
    const description = optionalText(input.description, MAX_DESCRIPTION_LENGTH);
    const source = await this.snapshotService.captureSource(input.droneRef, input.chatName);
    const destinationBranch = await this.validBranch(
      source.repoRoot,
      input.destinationBranch || source.baseBranch,
    );
    const snapshot = await this.snapshotService.capture(id, 1, source);
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
        createdBy: normalizeChangeRequestActor(input.actor),
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

  async get(requestNumberRaw: unknown): Promise<ChangeRequestView> {
    return await this.view(this.requiredRecord(requestNumberRaw));
  }

  async getByNumber(numberRaw: unknown, droneIdRaw: unknown): Promise<ChangeRequestView> {
    const number = Number(numberRaw);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new ChangeRequestError('change request number must be a positive integer');
    }
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) throw new ChangeRequestError('droneId is required');
    const record = this.deps.repository.getByNumber(number);
    if (!record || record.droneId !== droneId) {
      throw new ChangeRequestError(`unknown change request: #${number}`, 404, 'not_found');
    }
    return await this.view(record);
  }

  async list(
    filters: {
      droneId?: string;
      chatName?: string;
      status?: ChangeRequestStatus;
    } = {},
  ): Promise<ChangeRequestView[]> {
    return await mapWithConcurrency(
      this.deps.repository.list(filters),
      ASSESSMENT_CONCURRENCY,
      (record) => this.view(record),
    );
  }

  async refreshAssessment(requestNumberRaw: unknown): Promise<ChangeRequestView> {
    const id = this.requiredRecord(requestNumberRaw).id;
    return await this.withLock(id, async () => {
      const current = this.requiredRecord(id);
      if (current.status === 'open') {
        await this.git(current.repoRoot, ['fetch', 'origin', '--prune'], MERGE_TIMEOUT_MS);
      }
      await this.deps.githubMirrorLifecycle?.refreshAfterNativeAssessment(this.requiredRecord(id));
      const updated = await this.deps.repository.emitEvent(
        id,
        'change_request.updated',
        this.deps.now(),
      );
      return await this.view(updated);
    });
  }

  async update(
    requestNumberRaw: unknown,
    input: ChangeRequestUpdateInput,
  ): Promise<ChangeRequestView> {
    const id = this.requiredRecord(requestNumberRaw).id;
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      const destinationBranch = input.destinationBranch
        ? await this.validBranch(current.repoRoot, input.destinationBranch)
        : current.destinationBranch;
      let snapshotPatch: Partial<ChangeRequestRecord> = {};
      if (input.refreshSnapshot !== false) {
        const source = await this.snapshotService.captureSource(
          current.droneId,
          current.chatName,
          current,
        );
        const snapshot = await this.snapshotService.capture(id, current.revision + 1, source);
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
        if (snapshotPatch.snapshotRef) {
          await this.deps.deleteHostRefBestEffort({
            repoRoot: current.repoRoot,
            refName: snapshotPatch.snapshotRef,
          });
        }
        throw error;
      }
      if (
        snapshotPatch.snapshotRef &&
        current.snapshotRef &&
        current.snapshotRef !== snapshotPatch.snapshotRef
      ) {
        await this.deps.deleteHostRefBestEffort({
          repoRoot: current.repoRoot,
          refName: current.snapshotRef,
        });
      }
      await this.deps.githubMirrorLifecycle?.syncAfterNativeUpdate(updated);
      updated = this.requiredRecord(id);
      return await this.view(updated);
    });
  }

  async close(requestNumberRaw: unknown): Promise<ChangeRequestView> {
    const id = this.requiredRecord(requestNumberRaw).id;
    return await this.withLock(id, async () => {
      const current = this.requiredOpenRecord(id);
      const closed = await this.lifecycle.completeClose(current);
      await this.deps.githubMirrorLifecycle?.closeAfterNativeCompletion(closed);
      return await this.view(this.requiredRecord(id));
    });
  }

  async merge(
    requestNumberRaw: unknown,
    input: { actor: ChangeRequestActor; commitMessage?: string },
  ): Promise<ChangeRequestView> {
    const id = this.requiredRecord(requestNumberRaw).id;
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
        const mergeCommitSha = await this.directMerger.merge(
          current,
          String(input.commitMessage ?? '').trim() || current.title,
        );
        const merged = await this.lifecycle.completeMerge(current, {
          actor: input.actor,
          mergeCommitSha,
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

  async changes(requestNumberRaw: unknown): Promise<ChangeRequestChanges> {
    const request = await this.get(requestNumberRaw);
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
    requestNumberRaw: unknown,
    filePathRaw: string,
    contextLinesRaw = 3,
  ): Promise<{
    request: ChangeRequestView;
    path: string;
    diff: string;
    truncated: boolean;
  }> {
    const request = await this.get(requestNumberRaw);
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

  private requiredRecord(requestNumberRaw: unknown): ChangeRequestRecord {
    const reference = String(requestNumberRaw ?? '').trim();
    const number = Number(requestNumberRaw);
    if (Number.isSafeInteger(number) && number > 0) {
      const record = this.deps.repository.getByNumber(number);
      if (record) return record;
      throw new ChangeRequestError(`unknown change request: #${number}`, 404, 'not_found');
    }
    // Internal services may still use the opaque storage key. Public API and MCP
    // callers only receive and submit the integer request number.
    const internalRecord = reference ? this.deps.repository.get(reference) : null;
    if (internalRecord) return internalRecord;
    throw new ChangeRequestError('change request number must be a positive integer');
  }

  private requiredOpenRecord(requestNumberRaw: unknown): ChangeRequestRecord {
    const record = this.requiredRecord(requestNumberRaw);
    if (record.status !== 'open') {
      throw new ChangeRequestError(`Change request is ${record.status}.`, 409, 'not_open');
    }
    return record;
  }

  private async validBranch(repoRoot: string, value: unknown): Promise<string> {
    const branch = normalizeChangeRequestBranch(value);
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

  private async view(record: ChangeRequestRecord): Promise<ChangeRequestView> {
    const { id: _internalId, ...publicRecord } = record;
    const githubMirror = this.githubMirrorView(record);
    const lineStats = await this.lineStats(record);
    if (record.status !== 'open' || !record.snapshotRef || !record.snapshotSha) {
      return {
        ...publicRecord,
        githubMirror,
        lineStats,
        stale: false,
        conflicted: false,
        destinationExists: record.status === 'merged',
        destinationSha: record.mergeCommitSha,
        conflictFiles: [],
      };
    }
    const snapshot = await resolveChangeRequestCommit(
      this.deps.runHostCommand,
      record.repoRoot,
      record.snapshotRef,
    );
    if (!snapshot || snapshot !== record.snapshotSha) {
      return {
        ...publicRecord,
        githubMirror,
        lineStats,
        stale: false,
        conflicted: false,
        destinationExists: false,
        destinationSha: null,
        conflictFiles: [],
        lastError: 'Change request snapshot is unavailable.',
      };
    }
    const destinationRef = await resolveChangeRequestBranch(
      this.deps.runHostCommand,
      record.repoRoot,
      record.destinationBranch,
    );
    const baseRef = await resolveChangeRequestBranch(
      this.deps.runHostCommand,
      record.repoRoot,
      record.baseBranch,
    );
    const targetRef = destinationRef ?? baseRef;
    const destinationSha = targetRef
      ? await resolveChangeRequestCommit(this.deps.runHostCommand, record.repoRoot, targetRef)
      : null;
    if (!destinationSha) {
      return {
        ...publicRecord,
        githubMirror,
        lineStats,
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
      ...publicRecord,
      githubMirror,
      lineStats,
      stale: destinationSha !== record.baseSha,
      conflicted: mergeTree.code !== 0,
      destinationExists: Boolean(destinationRef),
      destinationSha,
      conflictFiles: mergeTree.code === 0 ? [] : changeRequestConflictFiles(combined),
    };
  }

  private async lineStats(record: ChangeRequestRecord): Promise<ChangeRequestLineStats | null> {
    if (!record.snapshotSha) return null;
    try {
      const result = await this.git(record.repoRoot, [
        'diff',
        '--numstat',
        `${record.baseSha}..${record.snapshotSha}`,
      ]);
      if (result.code !== 0) return null;
      let files = 0;
      let additions = 0;
      let modifications = 0;
      let deletions = 0;
      for (const line of result.stdout.split(/\r?\n/)) {
        if (!line) continue;
        const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
        if (!pathParts.some((part) => part.trim())) continue;
        files += 1;
        // Git reports binary files as "-\t-". They still count as changed
        // files even though a meaningful line total is unavailable.
        if (!/^\d+$/.test(addedRaw ?? '') || !/^\d+$/.test(deletedRaw ?? '')) continue;
        const added = Number(addedRaw);
        const deleted = Number(deletedRaw);
        const modified = Math.min(added, deleted);
        additions += added - modified;
        modifications += modified;
        deletions += deleted - modified;
      }
      return {
        files,
        additions,
        modifications,
        deletions,
        total: additions + modifications + deletions,
      };
    } catch {
      return null;
    }
  }

  private githubMirrorView(record: ChangeRequestRecord): ChangeRequestView['githubMirror'] {
    return record.githubMirror
      ? {
          ...record.githubMirror,
          outOfDate:
            record.githubMirror.syncedRevision !== record.revision ||
            record.githubMirror.syncedNativeUpdatedAt !== record.updatedAt,
        }
      : null;
  }

  private async git(repoRoot: string, args: string[], timeoutMs = 30_000): Promise<RunResult> {
    return await runChangeRequestGit(this.deps.runHostCommand, repoRoot, args, timeoutMs);
  }

  private async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return await this.operationLock.withLock(id, operation);
  }
}

async function mapWithConcurrency<T, Result>(
  items: T[],
  limit: number,
  operation: (item: T) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await operation(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
