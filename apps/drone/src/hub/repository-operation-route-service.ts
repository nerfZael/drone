import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

import type { RepoPullChangeEntry } from './drone-repo';
import { normalizeContainerPath } from './hub-format';
import { LanguageServiceError } from './language-service';
import { readJsonBody, sendJson as json } from './hub-http';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './routes/legacy-route';

import type { RepositoryRouteDependencies } from './routes/repository-operation-routes';

export class RepositoryOperationService {
  readonly handle: LegacyRouteHandler;

  constructor(deps: RepositoryRouteDependencies) {
    this.handle = createRepositoryOperationServiceHandler(deps);
  }
}

function createRepositoryOperationServiceHandler(
  deps: RepositoryRouteDependencies,
): LegacyRouteHandler {
  const {
    GITHUB_PULL_REQUEST_LIST_CACHE_TTL_MS,
    PULL_PREVIEW_HOST_MERGE_CACHE_TTL_MS,
    applyBranchMergeNoCommitToMainWorkingTree,
    attachReviewMetadataToPullEntries,
    buildReviewScopeId,
    clearGithubPullRequestListCache,
    closeGithubPullRequestForRepoRoot,
    commitDroneMetadataPatch,
    createHostAuthoredMirrorCommit,
    defaultRepoSeedTimeoutMs,
    deleteHostRefBestEffort,
    droneRepoBaseSha,
    droneRepoChangesSummary,
    droneRepoCommitDetails,
    droneRepoCommitDiffForPath,
    droneRepoCommitList,
    droneRepoDiffForPath,
    droneRepoPathInContainer,
    droneRepoPullChangesSummary,
    droneRepoPullDiffForPath,
    droneRootPath,
    droneRuntime,
    droneUnmergedFiles,
    dvmExec,
    dvmRepoExport,
    dvmRepoHeadSha,
    dvmRepoSeed,
    dvmRepoSetBaseSha,
    exportFullHeadBundleFromDrone,
    findDroneIdByRef,
    getGithubPullRequestCommitForRepoRoot,
    gitCurrentBranchOrSha,
    gitIsAncestor,
    gitIsClean,
    gitMergeBase,
    gitMergePreviewNameStatusEntries,
    gitRepoChangesSummary,
    gitRepoCommitDetails,
    gitRepoCommitDiffForPath,
    gitRepoCommitList,
    gitRepoDiffForPath,
    gitResolveCommitSha,
    gitTopLevel,
    githubPullRequestListCache,
    hubLog,
    importBundleHeadToDroneRef,
    importBundleHeadToHostRef,
    inspectGithubRepoForRepoRoot,
    isGithubPullRequestError,
    isRepoAttachedDrone,
    isRepoPatchApplyError,
    listGithubPullRequestChangesForRepoRoot,
    listGithubPullRequestCommitsForRepoRoot,
    listGithubPullRequestsForRepoRoot,
    loadRegistry,
    looksLikeBundleMissingPrerequisiteError,
    looksLikeEmptyBundleExportError,
    looksLikeMissingContainerError,
    looksLikeRepoUnavailableError,
    looksLikeUnrelatedHistoriesError,
    mergeGithubPullRequestForRepoRoot,
    nameStatusCharToType,
    normalizeGithubPullRequestListState,
    normalizeGithubPullRequestMergeMethod,
    nowIso,
    parseMergeConflictFilesFromText,
    parseShaFromText,
    pullPreviewHostMergeCache,
    reconcilePendingHostMirrorApply,
    repoBaseRefMatchesCurrentHostBranch,
    repoChangesScanCache,
    resolveDroneOrRespond,
    resolveLanguageDefinition,
    resolveLanguageReferences,
    createDroneDaemonGitRunner,
    createDroneDaemonWorktreeHasher,
    runGitInDrone,
    runGitInDroneOrThrow,
    runHostCommand,
    safeDroneRefSegment,
    setDroneHubMetaByIdentity,
    syncRepoAgentsInstructionsForDrone,
    updateHostRef,
    withLockedDroneContainer,
    withLockedDroneContainers,
  } = deps;
  const containerNameForDrone = (drone: any, fallback: string) =>
    String(drone?.containerName ?? drone?.name ?? fallback).trim() || fallback;
  const daemonError = (error: any) =>
    error?.code === 'daemon_unavailable'
      ? {
          status: 503,
          error: 'Drone daemon is unavailable. Check that the drone is running and try again.',
          code: 'daemon_unavailable',
        }
      : null;
  const repositoryReadFailure = (error: any, runtime: 'host' | 'container') => {
    const daemonFailure = runtime === 'host' ? null : daemonError(error);
    const message = error?.message ?? String(error);
    const missingContainer = looksLikeMissingContainerError(message);
    const repoUnavailable = looksLikeRepoUnavailableError(message);
    const rawStatus = Number(error?.statusCode);
    const explicitStatus =
      Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus <= 599
        ? Math.floor(rawStatus)
        : null;
    const status =
      daemonFailure?.status ??
      explicitStatus ??
      (runtime === 'host'
        ? repoUnavailable
          ? 409
          : 500
        : missingContainer
          ? 404
          : repoUnavailable
            ? 409
            : 500);
    return {
      status,
      response: {
        error: daemonFailure?.error ?? (repoUnavailable ? 'repository is not ready yet' : message),
        ...(daemonFailure
          ? { code: daemonFailure.code }
          : repoUnavailable
            ? { code: 'repo_unavailable' }
            : {}),
      },
    };
  };
  return async ({ req, res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // GET /api/drones/:name/repo/changes
      // Returns repo status in a machine-friendly shape for source-control style UIs.
      if (
        method !== 'GET' &&
        parts.length >= 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo'
      ) {
        // Repo mutations are comparatively rare. Clearing the tiny scan cache
        // here keeps every mutation route coherent, including future routes.
        repoChangesScanCache.invalidate();
      }
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'changes'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        try {
          if (runtime === 'host') {
            const repoPathRaw = String(d?.repoPath ?? '').trim();
            if (!repoPathRaw) {
              json(res, 400, { ok: false, error: 'drone host repo path is not configured' });
              return;
            }
            const repoRoot = await gitTopLevel(repoPathRaw);
            const summary = await repoChangesScanCache.getOrLoad(`host\0${repoRoot}`, () =>
              gitRepoChangesSummary(repoRoot),
            );
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot,
              reviewScopeId: buildReviewScopeId('working-tree', [repoRoot, droneId]),
              branch: summary.branch,
              counts: summary.counts,
              entries: summary.entries,
            });
            return;
          } else {
            const repoPathInContainer = droneRepoPathInContainer(d);
            const containerName = containerNameForDrone(d, droneName);
            const startedAt = performance.now();
            const { repoRoot, summary } = await repoChangesScanCache.getOrLoad(
              `container\0${droneId}\0${repoPathInContainer}`,
              () =>
                droneRepoChangesSummary({
                  container: containerName,
                  repoPathInContainer,
                  runGit: createDroneDaemonGitRunner(d),
                  hashWorktreeFiles: createDroneDaemonWorktreeHasher(d),
                }),
            );
            res.setHeader(
              'server-timing',
              `repo-changes;dur=${(performance.now() - startedAt).toFixed(1)}`,
            );
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot,
              reviewScopeId: buildReviewScopeId('working-tree', [repoRoot, droneId]),
              branch: summary.branch,
              counts: summary.counts,
              entries: summary.entries,
            });
            return;
          }
        } catch (e: any) {
          const failure = repositoryReadFailure(e, runtime);
          json(res, failure.status, {
            ok: false,
            ...failure.response,
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/language/definition?path=<path>&line=<1-based>&column=<1-based>
      // GET /api/drones/:name/language/references?path=<path>&line=<1-based>&column=<1-based>
      // Limited project-aware language intelligence. TypeScript/JavaScript is supported first.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'language' &&
        (parts[4] === 'definition' || parts[4] === 'references')
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, {
            ok: false,
            error: 'drone has no repo attached',
            id: droneId,
            name: droneName,
          });
          return;
        }
        const filePath = String(u.searchParams.get('path') ?? '').trim();
        if (!filePath) {
          json(res, 400, { ok: false, error: 'missing file path', id: droneId, name: droneName });
          return;
        }
        const line = Number(u.searchParams.get('line') ?? 1);
        const column = Number(u.searchParams.get('column') ?? 1);
        const limit = Number(u.searchParams.get('limit') ?? 100);

        try {
          const repoPathRaw = String(d?.repoPath ?? '').trim();
          if (!repoPathRaw) {
            json(res, 409, {
              ok: false,
              error: 'language intelligence needs a host-visible repo path for this drone',
              code: 'language_runtime_not_supported',
              id: droneId,
              name: droneName,
            });
            return;
          }
          const repoRoot = await gitTopLevel(repoPathRaw);
          const runtimeRepoRoot = runtime === 'host' ? repoRoot : droneRepoPathInContainer(d);
          if (parts[4] === 'definition') {
            const target = resolveLanguageDefinition({
              repoRoot,
              runtimeRepoRoot,
              path: filePath,
              line,
              column,
            });
            json(res, 200, { ok: true, id: droneId, name: droneName, repoRoot, target });
            return;
          }
          const normalizedLimit =
            Number.isFinite(limit) && limit > 0 ? Math.min(500, Math.floor(limit)) : 100;
          const references = resolveLanguageReferences({
            repoRoot,
            runtimeRepoRoot,
            path: filePath,
            line,
            column,
            limit: normalizedLimit + 1,
          });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            references: references.slice(0, normalizedLimit),
            truncated: references.length > normalizedLimit,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const repoUnavailable = looksLikeRepoUnavailableError(msg);
          const languageStatus =
            e instanceof LanguageServiceError && Number.isFinite(e.statusCode)
              ? Math.max(400, Math.floor(e.statusCode))
              : 0;
          json(res, languageStatus || (repoUnavailable ? 409 : 500), {
            ok: false,
            error: repoUnavailable ? 'repository is not ready yet' : msg,
            ...(e instanceof LanguageServiceError ? { code: e.code } : {}),
            ...(repoUnavailable ? { code: 'repo_unavailable' } : {}),
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/source?path=<repo-relative>&source=index|head|sha&sha=<40-hex>
      // Returns raw file text from the "old" side of a diff so the client can expand hidden unchanged blocks inline.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'source'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached =
          Boolean(String(d?.repo?.dest ?? '').trim()) ||
          Boolean(String(d?.repo?.seededAt ?? '').trim());
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathInContainer = droneRepoPathInContainer(d);

        const filePath = String(u.searchParams.get('path') ?? '').trim();
        if (!filePath) {
          json(res, 400, { ok: false, error: 'missing source path' });
          return;
        }
        const sourceMode = String(u.searchParams.get('source') ?? 'head')
          .trim()
          .toLowerCase();
        const sha = String(u.searchParams.get('sha') ?? '')
          .trim()
          .toLowerCase();
        const objectish =
          sourceMode === 'index'
            ? `:${filePath}`
            : sourceMode === 'sha' && /^[0-9a-f]{40}$/.test(sha)
              ? `${sha}:${filePath}`
              : sourceMode === 'head'
                ? `HEAD:${filePath}`
                : null;
        if (!objectish) {
          json(res, 400, { ok: false, error: 'invalid source selector' });
          return;
        }

        try {
          const containerName = containerNameForDrone(d, droneName);
          const runGit = createDroneDaemonGitRunner(d);
          const repoRootRaw = await runGitInDroneOrThrow({
            container: containerName,
            repoPathInContainer,
            args: ['rev-parse', '--show-toplevel'],
            runGit,
          });
          const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;
          const file = await runGit({
            container: containerName,
            repoPathInContainer,
            args: ['show', objectish],
          });
          const text = String(file.stdout ?? '');
          const maxChars = 1_000_000;
          const truncated = text.length > maxChars;
          const source =
            file.code === 128
              ? { repoRoot, source: '', exists: false, truncated: false }
              : {
                  repoRoot,
                  source: truncated ? text.slice(0, maxChars) : text,
                  exists: true,
                  truncated,
                };
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot: source.repoRoot,
            path: filePath,
            source: source.source,
            exists: source.exists,
            truncated: Boolean((source as any).truncated),
          });
          return;
        } catch (e: any) {
          const failure = repositoryReadFailure(e, 'container');
          json(res, failure.status, {
            ok: false,
            ...failure.response,
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/diff?path=<repo-relative>&kind=staged|unstaged
      // Returns unified diff text for a single file path.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'diff'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }

        const filePath = String(u.searchParams.get('path') ?? '').trim();
        if (!filePath) {
          json(res, 400, { ok: false, error: 'missing diff path' });
          return;
        }
        const rawKind = String(u.searchParams.get('kind') ?? 'unstaged')
          .trim()
          .toLowerCase();
        const kind = rawKind === 'staged' ? 'staged' : 'unstaged';
        const requestedContextLines = Number(u.searchParams.get('contextLines') ?? 3);
        const contextLines =
          Number.isFinite(requestedContextLines) && requestedContextLines >= 0
            ? Math.min(2000, Math.floor(requestedContextLines))
            : 3;

        try {
          if (runtime === 'host') {
            const repoPathRaw = String(d?.repoPath ?? '').trim();
            if (!repoPathRaw) {
              json(res, 400, { ok: false, error: 'drone host repo path is not configured' });
              return;
            }
            const repoRoot = await gitTopLevel(repoPathRaw);
            const diff = await gitRepoDiffForPath({
              repoRoot,
              filePath,
              kind,
              contextLines,
            });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot,
              path: diff.path,
              kind: diff.kind,
              diff: diff.diff,
              truncated: diff.truncated,
              fromUntracked: diff.fromUntracked,
            });
          } else {
            const repoPathInContainer = droneRepoPathInContainer(d);
            const containerName = containerNameForDrone(d, droneName);
            const runGit = createDroneDaemonGitRunner(d);
            const repoRootRaw = await runGitInDroneOrThrow({
              container: containerName,
              repoPathInContainer,
              args: ['rev-parse', '--show-toplevel'],
              runGit,
            });
            const repoRoot = String(repoRootRaw.stdout ?? '').trim() || repoPathInContainer;
            const diff = await droneRepoDiffForPath({
              container: containerName,
              repoPathInContainer,
              filePath,
              kind,
              contextLines,
              runGit,
            });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot,
              path: diff.path,
              kind: diff.kind,
              diff: diff.diff,
              truncated: diff.truncated,
              fromUntracked: diff.fromUntracked,
            });
          }
          return;
        } catch (e: any) {
          const failure = repositoryReadFailure(e, runtime);
          json(res, failure.status, {
            ok: false,
            ...failure.response,
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/commits
      // Lists recent commits for the current branch context.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'commits'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const requestedLimit = Number(u.searchParams.get('limit') ?? 100);
        const limit =
          Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(200, Math.floor(requestedLimit))
            : 100;
        try {
          if (runtime === 'host') {
            const repoPathRaw = String(d?.repoPath ?? '').trim();
            if (!repoPathRaw) {
              json(res, 400, { ok: false, error: 'drone host repo path is not configured' });
              return;
            }
            const repoRoot = await gitTopLevel(repoPathRaw);
            const summary = await gitRepoChangesSummary(repoRoot);
            const baseRef = summary.branch.upstream
              ? await gitMergeBase(repoRoot, 'HEAD', summary.branch.upstream)
              : null;
            const commits = await gitRepoCommitList({ repoRoot, headRef: 'HEAD', baseRef, limit });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot,
              branch: summary.branch,
              baseRef,
              commits,
            });
            return;
          }
          const repoPathInContainer = droneRepoPathInContainer(d);
          const containerName = containerNameForDrone(d, droneName);
          const runGit = createDroneDaemonGitRunner(d);
          const [baseRef, summary] = await Promise.all([
            droneRepoBaseSha({ container: containerName, repoPathInContainer, runGit }),
            droneRepoChangesSummary({
              container: containerName,
              repoPathInContainer,
              runGit,
              hashWorktreeFiles: createDroneDaemonWorktreeHasher(d),
            }),
          ]);
          const commits = await droneRepoCommitList({
            container: containerName,
            repoPathInContainer,
            headRef: 'HEAD',
            baseRef,
            limit,
            runGit,
          });
          const listed = {
            repoRoot: commits.repoRoot,
            branch: summary.summary.branch,
            baseRef,
            commits: commits.commits,
          };
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot: listed.repoRoot,
            branch: listed.branch,
            baseRef: listed.baseRef,
            commits: listed.commits,
          });
          return;
        } catch (e: any) {
          const failure = repositoryReadFailure(e, runtime);
          json(res, failure.status, {
            ok: false,
            ...failure.response,
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/commits/:sha/changes
      if (
        method === 'GET' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'commits' &&
        parts[6] === 'changes'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const sha = String(parts[5] ?? '')
          .trim()
          .toLowerCase();
        if (!/^[0-9a-f]{40}$/.test(sha)) {
          json(res, 400, {
            ok: false,
            error: 'invalid commit sha',
            code: 'invalid_commit_sha',
            id: droneId,
            name: droneName,
          });
          return;
        }
        try {
          if (runtime === 'host') {
            const repoPathRaw = String(d?.repoPath ?? '').trim();
            if (!repoPathRaw) {
              json(res, 400, { ok: false, error: 'drone host repo path is not configured' });
              return;
            }
            const repoRoot = await gitTopLevel(repoPathRaw);
            const detail = await gitRepoCommitDetails({ repoRoot, sha });
            json(res, 200, { ok: true, id: droneId, name: droneName, ...detail });
            return;
          }
          const repoPathInContainer = droneRepoPathInContainer(d);
          const detail = await droneRepoCommitDetails({
            container: containerNameForDrone(d, droneName),
            repoPathInContainer,
            sha,
            runGit: createDroneDaemonGitRunner(d),
          });
          json(res, 200, { ok: true, id: droneId, name: droneName, ...detail });
          return;
        } catch (e: any) {
          const failure = repositoryReadFailure(e, runtime);
          json(res, failure.status, {
            ok: false,
            ...failure.response,
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/commits/:sha/diff?path=<repo-relative>
      if (
        method === 'GET' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'commits' &&
        parts[6] === 'diff'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const sha = String(parts[5] ?? '')
          .trim()
          .toLowerCase();
        const filePath = String(u.searchParams.get('path') ?? '').trim();
        if (!/^[0-9a-f]{40}$/.test(sha)) {
          json(res, 400, {
            ok: false,
            error: 'invalid commit sha',
            code: 'invalid_commit_sha',
            id: droneId,
            name: droneName,
          });
          return;
        }
        if (!filePath) {
          json(res, 400, { ok: false, error: 'missing diff path', id: droneId, name: droneName });
          return;
        }
        const requestedContextLines = Number(u.searchParams.get('contextLines') ?? 3);
        const contextLines =
          Number.isFinite(requestedContextLines) && requestedContextLines >= 0
            ? Math.min(2000, Math.floor(requestedContextLines))
            : 3;
        try {
          if (runtime === 'host') {
            const repoPathRaw = String(d?.repoPath ?? '').trim();
            if (!repoPathRaw) {
              json(res, 400, { ok: false, error: 'drone host repo path is not configured' });
              return;
            }
            const repoRoot = await gitTopLevel(repoPathRaw);
            const diff = await gitRepoCommitDiffForPath({ repoRoot, sha, filePath, contextLines });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot: diff.repoRoot,
              sha: diff.sha,
              path: diff.path,
              diff: diff.diff,
              truncated: diff.truncated,
              isBinary: false,
            });
            return;
          }
          const repoPathInContainer = droneRepoPathInContainer(d);
          const diff = await droneRepoCommitDiffForPath({
            container: containerNameForDrone(d, droneName),
            repoPathInContainer,
            sha,
            filePath,
            contextLines,
            runGit: createDroneDaemonGitRunner(d),
          });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot: diff.repoRoot,
            sha: diff.sha,
            path: diff.path,
            diff: diff.diff,
            truncated: diff.truncated,
            isBinary: false,
          });
          return;
        } catch (e: any) {
          const failure = repositoryReadFailure(e, runtime);
          json(res, failure.status, {
            ok: false,
            ...failure.response,
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull/changes
      // "PR perspective": committed delta between dvm.baseSha..HEAD in the container repo.
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull' &&
        parts[5] === 'changes'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        const configuredDroneBranch = String(d?.repo?.branch ?? '').trim() || null;
        const droneFromRef = String(d?.repo?.baseRef ?? '').trim() || null;
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        if (runtime === 'host') {
          const repoPathRaw = String(d?.repoPath ?? '').trim();
          if (!repoPathRaw) {
            json(res, 400, { ok: false, error: 'drone has no repo attached' });
            return;
          }
          try {
            const repoRoot = await gitTopLevel(repoPathRaw);
            const hostSummary = await gitRepoChangesSummary(repoRoot);
            const hostHeadSha = String(hostSummary.branch.oid ?? '')
              .trim()
              .toLowerCase();
            const normalizedHeadSha = /^[0-9a-f]{40}$/.test(hostHeadSha) ? hostHeadSha : '';
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot,
              reviewScopeId: buildReviewScopeId('pull-preview', [
                repoRoot,
                droneId,
                normalizedHeadSha,
                normalizedHeadSha,
                normalizedHeadSha,
              ]),
              baseSha: normalizedHeadSha,
              headSha: normalizedHeadSha,
              counts: { changed: 0 },
              entries: [],
              mode: 'host-same-repo',
              branchContext: {
                hostCurrent: String(hostSummary.branch.head ?? '').trim() || null,
                droneCurrent: String(hostSummary.branch.head ?? '').trim() || null,
                droneConfigured: configuredDroneBranch,
                droneFromRef,
              },
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            const repoUnavailable = looksLikeRepoUnavailableError(msg);
            json(res, repoUnavailable ? 409 : 500, {
              ok: false,
              error: repoUnavailable ? 'repository is not ready yet' : msg,
              ...(repoUnavailable ? { code: 'repo_unavailable' } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
        }
        const repoPathInContainer = droneRepoPathInContainer(d);
        const containerName = containerNameForDrone(d, droneName);
        const runGit = createDroneDaemonGitRunner(d);
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        let hostBranchHead: string | null = null;
        let hostHeadShaForReview: string | null = null;
        let pullPreviewBaseSha: string | undefined;
        const lastPullAny =
          d?.repo?.lastPull && typeof d.repo.lastPull === 'object' ? d.repo.lastPull : null;
        const lastPullMode = String((lastPullAny as any)?.mode ?? '')
          .trim()
          .toLowerCase();
        const lastExportedHeadSha = String((lastPullAny as any)?.exportedHeadSha ?? '')
          .trim()
          .toLowerCase();
        if (
          lastPullMode === 'host-conflicts-ready' &&
          /^[0-9a-f]{40}$/.test(lastExportedHeadSha) &&
          repoPathRaw
        ) {
          try {
            const repoRoot = await gitTopLevel(repoPathRaw);
            const clean = await gitIsClean(repoRoot);
            const currentHostRef = clean
              ? await gitCurrentBranchOrSha(repoRoot).catch(() => '')
              : '';
            if (clean && repoBaseRefMatchesCurrentHostBranch(droneFromRef, currentHostRef)) {
              // Match pull behavior: once host conflicts are fully resolved and committed,
              // preview from the last exported drone head so counts align with the next pull.
              pullPreviewBaseSha = lastExportedHeadSha;
            }
          } catch {
            // ignore and fall back to repo-configured dvm.baseSha
          }
        }
        try {
          let reconciledHostMirrorRef: string | null = null;
          let reconciledHostMirrorSha: string | null = null;
          let reconciledHostMirrorCacheState = '';
          if (repoPathRaw) {
            try {
              const repoRoot = await gitTopLevel(repoPathRaw);
              const reconciled = await reconcilePendingHostMirrorApply({
                droneId,
                droneName,
                droneEntry: d,
                repoRoot,
                repoPathInContainer,
              });
              reconciledHostMirrorRef = reconciled.hostMirrorRef;
              reconciledHostMirrorSha = reconciled.hostMirrorSha;
              reconciledHostMirrorCacheState = [
                reconciled.promoted ? 'promoted' : '',
                reconciled.cleanedAbortedCandidate ? 'aborted' : '',
                reconciled.hostMirrorRef ?? '',
                reconciled.hostMirrorSha ?? '',
                reconciled.droneHeadSha ?? '',
              ].join('\u0000');
            } catch (e: any) {
              hubLog(
                'warn',
                'Pull preview pending mirror reconciliation failed; using current drone base',
                {
                  droneName,
                  repoPathRaw,
                  error: e?.message ?? String(e),
                },
              );
            }
          }
          let summary = await droneRepoPullChangesSummary({
            container: containerName,
            repoPathInContainer,
            baseSha: pullPreviewBaseSha,
            runGit,
          });
          if (repoPathRaw) {
            try {
              const lastPullAny =
                d?.repo?.lastPull && typeof d.repo.lastPull === 'object' ? d.repo.lastPull : null;
              const lastPullMode = String((lastPullAny as any)?.mode ?? '')
                .trim()
                .toLowerCase();
              const lastExportedHeadSha = String((lastPullAny as any)?.exportedHeadSha ?? '')
                .trim()
                .toLowerCase();
              if (
                (lastPullMode === 'bundle-merge-no-commit' ||
                  lastPullMode === 'bundle-apply-no-commit') &&
                /^[0-9a-f]{40}$/.test(lastExportedHeadSha) &&
                summary.baseSha === lastExportedHeadSha &&
                /^[0-9a-f]{40}$/.test(summary.headSha)
              ) {
                const repoRoot = await gitTopLevel(repoPathRaw);
                const hostSummary = await gitRepoChangesSummary(repoRoot);
                hostBranchHead = String(hostSummary.branch.head ?? '').trim() || hostBranchHead;
                const hostHeadSha = String(hostSummary.branch.oid ?? '')
                  .trim()
                  .toLowerCase();
                if (/^[0-9a-f]{40}$/.test(hostHeadSha)) {
                  hostHeadShaForReview = hostHeadSha;
                  const hostContainsLastExport = await gitIsAncestor(
                    repoRoot,
                    lastExportedHeadSha,
                    'HEAD',
                  );
                  if (!hostContainsLastExport) {
                    const recoveryBaseSha = await gitMergeBase(
                      repoRoot,
                      'HEAD',
                      lastExportedHeadSha,
                    );
                    if (recoveryBaseSha && recoveryBaseSha !== summary.baseSha) {
                      summary = await droneRepoPullChangesSummary({
                        container: containerName,
                        repoPathInContainer,
                        baseSha: recoveryBaseSha,
                        runGit,
                      });
                    }
                  }
                }
              }
            } catch (e: any) {
              hubLog(
                'warn',
                'Pull preview recovery-base calculation failed; using container base',
                {
                  droneName,
                  repoPathRaw,
                  error: e?.message ?? String(e),
                },
              );
            }
          }
          let entriesForPreview: RepoPullChangeEntry[] = summary.entries;
          if (repoPathRaw && summary.entries.length > 0) {
            try {
              const repoRoot = await gitTopLevel(repoPathRaw);
              const hostSummary = await gitRepoChangesSummary(repoRoot);
              hostBranchHead = String(hostSummary.branch.head ?? '').trim() || hostBranchHead;
              const hostHeadSha = String(hostSummary.branch.oid ?? '')
                .trim()
                .toLowerCase();
              if (/^[0-9a-f]{40}$/.test(hostHeadSha)) {
                hostHeadShaForReview = hostHeadSha;
                const mirrorCacheState = [
                  String((lastPullAny as any)?.mode ?? '')
                    .trim()
                    .toLowerCase(),
                  String((lastPullAny as any)?.hostMirrorRef ?? '').trim(),
                  String((lastPullAny as any)?.hostMirrorSha ?? '')
                    .trim()
                    .toLowerCase(),
                  String((lastPullAny as any)?.hostMirrorCandidateRef ?? '').trim(),
                  String((lastPullAny as any)?.hostMirrorCandidateSha ?? '')
                    .trim()
                    .toLowerCase(),
                  reconciledHostMirrorCacheState,
                ].join('\u0000');
                const cacheKey = [
                  droneId,
                  repoRoot,
                  hostHeadSha,
                  summary.baseSha,
                  summary.headSha,
                  mirrorCacheState,
                ].join('\u0000');
                const now = Date.now();
                const cached = pullPreviewHostMergeCache.get(cacheKey);
                if (cached && now - cached.atMs < PULL_PREVIEW_HOST_MERGE_CACHE_TTL_MS) {
                  entriesForPreview = cached.entries;
                } else {
                  let exportPath = '';
                  let importRefName = '';
                  let mirrorPreviewRefName = '';
                  try {
                    const patchesOutRoot = droneRootPath('repo-exports');
                    await fs.mkdir(patchesOutRoot, { recursive: true });
                    const safeDroneRefSeg = safeDroneRefSegment(droneName);
                    const importRunId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
                    importRefName = `refs/drone/imports/${safeDroneRefSeg}/preview-${importRunId}`;
                    mirrorPreviewRefName = `refs/drone/mirrors/${safeDroneRefSeg}/preview/${importRunId}`;
                    try {
                      const exported = await withLockedDroneContainer(
                        { requestedDroneName: droneName, droneEntry: d },
                        async ({ containerName }: any) => {
                          return await exportFullHeadBundleFromDrone({
                            repoPathInContainer,
                            outDir: patchesOutRoot,
                            containerName,
                            label: droneName,
                          });
                        },
                      );
                      exportPath = exported.exportedPath;
                    } catch (e: any) {
                      const msg = e?.message ?? String(e);
                      if (looksLikeEmptyBundleExportError(msg)) {
                        entriesForPreview = [];
                      } else {
                        throw e;
                      }
                    }

                    if (exportPath) {
                      await importBundleHeadToHostRef({
                        repoRoot,
                        bundlePath: exportPath,
                        refName: importRefName,
                      });
                      const storedMirrorRef =
                        reconciledHostMirrorRef ||
                        String((lastPullAny as any)?.hostMirrorRef ?? '').trim();
                      const storedMirrorSha =
                        reconciledHostMirrorSha ||
                        String((lastPullAny as any)?.hostMirrorSha ?? '')
                          .trim()
                          .toLowerCase();
                      const mirrorParentRef =
                        storedMirrorRef &&
                        /^[0-9a-f]{40}$/.test(storedMirrorSha) &&
                        (await gitResolveCommitSha(repoRoot, storedMirrorRef))
                          ? storedMirrorRef
                          : summary.baseSha;
                      const mirrorParentSha =
                        (await gitResolveCommitSha(repoRoot, mirrorParentRef)) ?? '';
                      if (!mirrorParentSha)
                        throw new Error('Host repo is missing the mirror parent for pull preview.');
                      const mirrorPreviewSha = await createHostAuthoredMirrorCommit({
                        repoRoot,
                        sourceRef: importRefName,
                        parentRef: mirrorParentSha,
                        message: `chore(drone): preview ${droneName} changes for host apply`,
                      });
                      await updateHostRef({
                        repoRoot,
                        refName: mirrorPreviewRefName,
                        target: mirrorPreviewSha,
                      });
                      const mergedNameStatus = await gitMergePreviewNameStatusEntries({
                        repoRoot,
                        oursRef: 'HEAD',
                        theirsRef: mirrorPreviewRefName,
                      });
                      entriesForPreview = mergedNameStatus.map((entry: any) => ({
                        path: entry.path,
                        originalPath: entry.originalPath,
                        statusChar: entry.statusChar,
                        statusType: nameStatusCharToType(entry.statusChar),
                      }));
                    }

                    if (pullPreviewHostMergeCache.size > 200) pullPreviewHostMergeCache.clear();
                    pullPreviewHostMergeCache.set(cacheKey, {
                      atMs: now,
                      entries: entriesForPreview,
                    });
                  } finally {
                    if (exportPath) {
                      try {
                        await fs.rm(exportPath, { recursive: true, force: true });
                      } catch {
                        // ignore
                      }
                    }
                    if (importRefName) {
                      await deleteHostRefBestEffort({ repoRoot, refName: importRefName });
                    }
                    if (mirrorPreviewRefName) {
                      await deleteHostRefBestEffort({ repoRoot, refName: mirrorPreviewRefName });
                    }
                  }
                }
              }
            } catch (e: any) {
              hubLog(
                'warn',
                'Pull preview host-merge calculation failed; using container-range fallback',
                {
                  droneName,
                  repoPathRaw,
                  error: e?.message ?? String(e),
                },
              );
            }
          }
          if (repoPathRaw && !hostBranchHead) {
            try {
              const repoRoot = await gitTopLevel(repoPathRaw);
              const hostSummary = await gitRepoChangesSummary(repoRoot);
              hostBranchHead = String(hostSummary.branch.head ?? '').trim() || null;
            } catch {
              // Ignore metadata-only failures.
            }
          }
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot: summary.repoRoot,
            reviewScopeId: buildReviewScopeId('pull-preview', [
              summary.repoRoot,
              droneId,
              hostHeadShaForReview ?? '',
              summary.baseSha,
              summary.headSha,
            ]),
            baseSha: summary.baseSha,
            headSha: summary.headSha,
            counts: { changed: summary.entries.length },
            entries: attachReviewMetadataToPullEntries(summary.entries),
            applyPreview: {
              mode: repoPathRaw ? 'host-merge' : 'drone-range',
              counts: { changed: entriesForPreview.length },
              entries: attachReviewMetadataToPullEntries(entriesForPreview),
            },
            branchContext: {
              hostCurrent: hostBranchHead,
              droneCurrent: summary.branchHead,
              droneConfigured: configuredDroneBranch,
              droneFromRef,
            },
          });
          return;
        } catch (e: any) {
          const daemonFailure = daemonError(e);
          const msg = e?.message ?? String(e);
          const missingBase = /missing dvm\.baseSha/i.test(msg);
          json(res, daemonFailure?.status ?? (missingBase ? 409 : 500), {
            ok: false,
            error:
              daemonFailure?.error ??
              (missingBase
                ? 'Drone repo is missing its base SHA. Re-seed the drone to enable pull preview.'
                : msg),
            ...(daemonFailure
              ? { code: daemonFailure.code }
              : missingBase
                ? { code: 'missing_base' }
                : {}),
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull/diff?path=<repo-relative>&base=<sha>&head=<sha>
      // Unified diff for a single file between base..head (defaults to base=dvm.baseSha and head=HEAD).
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull' &&
        parts[5] === 'diff'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const filePath = String(u.searchParams.get('path') ?? '').trim();
        if (!filePath) {
          json(res, 400, { ok: false, error: 'missing diff path' });
          return;
        }
        const baseSha = String(u.searchParams.get('base') ?? '')
          .trim()
          .toLowerCase();
        const headSha = String(u.searchParams.get('head') ?? '')
          .trim()
          .toLowerCase();
        const requestedContextLines = Number(u.searchParams.get('contextLines') ?? 3);
        const contextLines =
          Number.isFinite(requestedContextLines) && requestedContextLines >= 0
            ? Math.min(2000, Math.floor(requestedContextLines))
            : 3;
        if (runtime === 'host') {
          const repoPathRaw = String(d?.repoPath ?? '').trim();
          if (!repoPathRaw) {
            json(res, 400, { ok: false, error: 'drone has no repo attached' });
            return;
          }
          try {
            const repoRoot = await gitTopLevel(repoPathRaw);
            const hostSummary = await gitRepoChangesSummary(repoRoot);
            const hostHeadSha = String(hostSummary.branch.oid ?? '')
              .trim()
              .toLowerCase();
            const normalizedHeadSha = /^[0-9a-f]{40}$/.test(hostHeadSha) ? hostHeadSha : '';
            const validBaseSha = /^[0-9a-f]{40}$/.test(baseSha) ? baseSha : normalizedHeadSha;
            const validHeadSha = /^[0-9a-f]{40}$/.test(headSha) ? headSha : normalizedHeadSha;
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot,
              baseSha: validBaseSha,
              headSha: validHeadSha,
              path: filePath,
              diff: '',
              truncated: false,
              mode: 'host-same-repo',
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            const repoUnavailable = looksLikeRepoUnavailableError(msg);
            json(res, repoUnavailable ? 409 : 500, {
              ok: false,
              error: repoUnavailable ? 'repository is not ready yet' : msg,
              ...(repoUnavailable ? { code: 'repo_unavailable' } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
        }
        const repoPathInContainer = droneRepoPathInContainer(d);

        try {
          const diff = await droneRepoPullDiffForPath({
            container: containerNameForDrone(d, droneName),
            repoPathInContainer,
            filePath,
            baseSha: /^[0-9a-f]{40}$/.test(baseSha) ? baseSha : undefined,
            headSha: /^[0-9a-f]{40}$/.test(headSha) ? headSha : undefined,
            contextLines,
            runGit: createDroneDaemonGitRunner(d),
          });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot: diff.repoRoot,
            baseSha: diff.baseSha,
            headSha: diff.headSha,
            path: diff.path,
            diff: diff.diff,
            truncated: diff.truncated,
          });
          return;
        } catch (e: any) {
          const daemonFailure = daemonError(e);
          const msg = e?.message ?? String(e);
          const missingBase = /missing dvm\.baseSha/i.test(msg);
          json(res, daemonFailure?.status ?? (missingBase ? 409 : 500), {
            ok: false,
            error:
              daemonFailure?.error ??
              (missingBase
                ? 'Drone repo is missing its base SHA. Re-seed the drone to enable pull preview.'
                : msg),
            ...(daemonFailure
              ? { code: daemonFailure.code }
              : missingBase
                ? { code: 'missing_base' }
                : {}),
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull-requests?state=open|closed|all
      // Lists pull requests for the host repo's GitHub remote.
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, {
            ok: false,
            error: 'host repo path is unavailable for this drone',
            code: 'repo_path_missing',
            id: droneId,
            name: droneName,
          });
          return;
        }
        const state = normalizeGithubPullRequestListState(u.searchParams.get('state'), 'open');

        let repoRoot = '';
        try {
          repoRoot = await gitTopLevel(repoPathRaw);
          const cacheKey = `${repoRoot}\u0000${state}`;
          const now = Date.now();
          const cached = githubPullRequestListCache.get(cacheKey);
          let payload =
            cached && now - cached.atMs < GITHUB_PULL_REQUEST_LIST_CACHE_TTL_MS
              ? cached.payload
              : null;

          if (!payload) {
            const listed = await listGithubPullRequestsForRepoRoot({ repoRoot, state });
            payload = {
              repoRoot,
              state,
              github: listed.repo,
              count: listed.pullRequests.length,
              pullRequests: listed.pullRequests,
            };
            if (githubPullRequestListCache.size > 400) githubPullRequestListCache.clear();
            githubPullRequestListCache.set(cacheKey, { atMs: now, payload });
          }

          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            ...payload,
          });
          return;
        } catch (e: any) {
          let diagnostics: {
            repoRoot: string | null;
            origin: string | null;
            github: { owner: string; repo: string } | null;
          } | null = null;
          if (repoRoot) {
            try {
              const debug = await inspectGithubRepoForRepoRoot(repoRoot);
              diagnostics = {
                repoRoot,
                origin: debug.remoteUrl ? String(debug.remoteUrl).trim() : null,
                github: debug.parsedRepo ?? null,
              };
            } catch {
              diagnostics = {
                repoRoot,
                origin: null,
                github: null,
              };
            }
          }
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              ...(diagnostics ? { diagnostics } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, {
            ok: false,
            error: msg,
            ...(diagnostics ? { diagnostics } : {}),
            id: droneId,
            name: droneName,
          });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull-requests/:number/changes
      // Lists exact GitHub PR file changes/diffs for a specific PR number.
      if (
        method === 'GET' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests' &&
        parts[6] === 'changes'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, {
            ok: false,
            error: 'host repo path is unavailable for this drone',
            code: 'repo_path_missing',
            id: droneId,
            name: droneName,
          });
          return;
        }
        const pullNumber = Number.parseInt(String(parts[5] ?? '').trim(), 10);
        if (
          !Number.isFinite(pullNumber) ||
          pullNumber <= 0 ||
          Math.floor(pullNumber) !== pullNumber
        ) {
          json(res, 400, {
            ok: false,
            error: 'invalid pull request number',
            code: 'invalid_pull_number',
            id: droneId,
            name: droneName,
          });
          return;
        }

        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const pr = await listGithubPullRequestChangesForRepoRoot({ repoRoot, pullNumber });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            reviewScopeId: buildReviewScopeId('pull-request', [
              pr.repo.owner,
              pr.repo.repo,
              pr.pullRequest.number,
              pr.pullRequest.baseSha,
              pr.pullRequest.headSha,
            ]),
            github: pr.repo,
            pullRequest: pr.pullRequest,
            counts: pr.counts,
            entries: attachReviewMetadataToPullEntries(pr.entries),
          });
          return;
        } catch (e: any) {
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull-requests/:number/commits
      if (
        method === 'GET' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests' &&
        parts[6] === 'commits'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, {
            ok: false,
            error: 'host repo path is unavailable for this drone',
            code: 'repo_path_missing',
            id: droneId,
            name: droneName,
          });
          return;
        }
        const pullNumber = Number.parseInt(String(parts[5] ?? '').trim(), 10);
        if (
          !Number.isFinite(pullNumber) ||
          pullNumber <= 0 ||
          Math.floor(pullNumber) !== pullNumber
        ) {
          json(res, 400, {
            ok: false,
            error: 'invalid pull request number',
            code: 'invalid_pull_number',
            id: droneId,
            name: droneName,
          });
          return;
        }
        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const listed = await listGithubPullRequestCommitsForRepoRoot({ repoRoot, pullNumber });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            github: listed.repo,
            pullNumber: listed.pullNumber,
            commits: listed.commits,
          });
          return;
        } catch (e: any) {
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull-requests/:number/commits/:sha/changes
      if (
        method === 'GET' &&
        parts.length === 9 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests' &&
        parts[6] === 'commits' &&
        parts[8] === 'changes'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, {
            ok: false,
            error: 'host repo path is unavailable for this drone',
            code: 'repo_path_missing',
            id: droneId,
            name: droneName,
          });
          return;
        }
        const pullNumber = Number.parseInt(String(parts[5] ?? '').trim(), 10);
        const sha = String(parts[7] ?? '')
          .trim()
          .toLowerCase();
        if (
          !Number.isFinite(pullNumber) ||
          pullNumber <= 0 ||
          Math.floor(pullNumber) !== pullNumber
        ) {
          json(res, 400, {
            ok: false,
            error: 'invalid pull request number',
            code: 'invalid_pull_number',
            id: droneId,
            name: droneName,
          });
          return;
        }
        if (!/^[0-9a-f]{40}$/.test(sha)) {
          json(res, 400, {
            ok: false,
            error: 'invalid commit sha',
            code: 'invalid_commit_sha',
            id: droneId,
            name: droneName,
          });
          return;
        }
        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const detail = await getGithubPullRequestCommitForRepoRoot({ repoRoot, pullNumber, sha });
          json(res, 200, { ok: true, id: droneId, name: droneName, ...detail });
          return;
        } catch (e: any) {
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
          return;
        }
      }

      // GET /api/drones/:name/repo/pull-requests/:number/commits/:sha/diff?path=<repo-relative>
      if (
        method === 'GET' &&
        parts.length === 9 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests' &&
        parts[6] === 'commits' &&
        parts[8] === 'diff'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, {
            ok: false,
            error: 'host repo path is unavailable for this drone',
            code: 'repo_path_missing',
            id: droneId,
            name: droneName,
          });
          return;
        }
        const pullNumber = Number.parseInt(String(parts[5] ?? '').trim(), 10);
        const sha = String(parts[7] ?? '')
          .trim()
          .toLowerCase();
        const filePath = String(u.searchParams.get('path') ?? '').trim();
        if (
          !Number.isFinite(pullNumber) ||
          pullNumber <= 0 ||
          Math.floor(pullNumber) !== pullNumber
        ) {
          json(res, 400, {
            ok: false,
            error: 'invalid pull request number',
            code: 'invalid_pull_number',
            id: droneId,
            name: droneName,
          });
          return;
        }
        if (!/^[0-9a-f]{40}$/.test(sha)) {
          json(res, 400, {
            ok: false,
            error: 'invalid commit sha',
            code: 'invalid_commit_sha',
            id: droneId,
            name: droneName,
          });
          return;
        }
        if (!filePath) {
          json(res, 400, { ok: false, error: 'missing diff path', id: droneId, name: droneName });
          return;
        }
        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const detail = await getGithubPullRequestCommitForRepoRoot({ repoRoot, pullNumber, sha });
          const entry =
            detail.entries.find(
              (candidate: any) =>
                candidate.path === filePath || candidate.originalPath === filePath,
            ) ?? null;
          if (!entry) {
            json(res, 404, {
              ok: false,
              error: `File ${filePath} was not found in commit ${sha.slice(0, 12)}.`,
              code: 'file_not_found',
              id: droneId,
              name: droneName,
            });
            return;
          }
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            sha,
            path: entry.path,
            diff: entry.patch ?? '',
            truncated: entry.truncated,
            isBinary: entry.isBinary,
          });
          return;
        } catch (e: any) {
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
          return;
        }
      }

      // POST /api/drones/:name/repo/pull-requests/:number/merge
      // Merges a pull request on GitHub.
      if (
        method === 'POST' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests' &&
        parts[6] === 'merge'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, {
            ok: false,
            error: 'host repo path is unavailable for this drone',
            code: 'repo_path_missing',
            id: droneId,
            name: droneName,
          });
          return;
        }

        const pullNumber = Number.parseInt(String(parts[5] ?? '').trim(), 10);
        if (
          !Number.isFinite(pullNumber) ||
          pullNumber <= 0 ||
          Math.floor(pullNumber) !== pullNumber
        ) {
          json(res, 400, {
            ok: false,
            error: 'invalid pull request number',
            code: 'invalid_pull_number',
            id: droneId,
            name: droneName,
          });
          return;
        }

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, {
            ok: false,
            error: e?.message ?? String(e),
            id: droneId,
            name: droneName,
          });
          return;
        }
        const mergeMethod = normalizeGithubPullRequestMergeMethod(body?.method, 'merge');

        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const merged = await mergeGithubPullRequestForRepoRoot({
            repoRoot,
            pullNumber,
            method: mergeMethod,
          });
          clearGithubPullRequestListCache(repoRoot);
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            github: merged.repo,
            number: merged.number,
            merged: merged.merged,
            message: merged.message,
            sha: merged.sha,
            method: mergeMethod,
          });
          return;
        } catch (e: any) {
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
          return;
        }
      }

      // POST /api/drones/:name/repo/pull-requests/:number/close
      // Closes a pull request on GitHub without merging.
      if (
        method === 'POST' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-requests' &&
        parts[6] === 'close'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const repoAttached = isRepoAttachedDrone(d);
        if (!repoAttached) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 409, {
            ok: false,
            error: 'host repo path is unavailable for this drone',
            code: 'repo_path_missing',
            id: droneId,
            name: droneName,
          });
          return;
        }

        const pullNumber = Number.parseInt(String(parts[5] ?? '').trim(), 10);
        if (
          !Number.isFinite(pullNumber) ||
          pullNumber <= 0 ||
          Math.floor(pullNumber) !== pullNumber
        ) {
          json(res, 400, {
            ok: false,
            error: 'invalid pull request number',
            code: 'invalid_pull_number',
            id: droneId,
            name: droneName,
          });
          return;
        }

        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const closed = await closeGithubPullRequestForRepoRoot({ repoRoot, pullNumber });
          clearGithubPullRequestListCache(repoRoot);
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            repoRoot,
            github: closed.repo,
            number: closed.number,
            state: closed.state,
            title: closed.title,
            htmlUrl: closed.htmlUrl,
          });
          return;
        } catch (e: any) {
          if (isGithubPullRequestError(e)) {
            json(res, e.statusCode, {
              ok: false,
              error: e.message,
              ...(e.code ? { code: e.code } : {}),
              id: droneId,
              name: droneName,
            });
            return;
          }
          const msg = e?.message ?? String(e);
          json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
          return;
        }
      }

      // POST /api/drones/:name/repo/reseed
      // Re-seed the container repo from the host repo (offline, no bind mount).
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'reseed'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const d = resolved.drone;
        const droneId = resolved.id;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        if (runtime === 'host') {
          const repoPathRaw = String(d?.repoPath ?? '').trim();
          if (!repoPathRaw) {
            json(res, 400, { ok: false, error: 'drone has no repo attached' });
            return;
          }
          try {
            const repoRoot = await gitTopLevel(repoPathRaw);
            const baseRef = await gitCurrentBranchOrSha(repoRoot);
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              repoRoot,
              baseRef,
              mode: 'host-noop',
              message: 'host runtime uses the host repository directly; reseed is not required',
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
            return;
          }
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        await setDroneHubMetaByIdentity({
          droneId,
          hub: { phase: 'seeding', message: 'Seeding repo…' },
        });
        try {
          const repoRoot = await gitTopLevel(repoPathRaw);
          const baseRef = await gitCurrentBranchOrSha(repoRoot);
          await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: d },
            async ({ containerName }: any) => {
              await dvmRepoSeed({
                container: containerName,
                hostPath: repoRoot,
                dest: '/work/repo',
                baseRef: 'HEAD',
                branch: 'dvm/work',
                clean: true,
                timeoutMs: defaultRepoSeedTimeoutMs(),
              });
            },
          );
          await commitDroneMetadataPatch({
            droneId,
            state: 'real',
            eventType: 'drone.repo.reseeded',
            transform: (dd: any) => {
              dd.repoPath = repoRoot;
              dd.cwd = '/work/repo';
              dd.repo = dd.repo ?? {};
              dd.repo.dest = '/work/repo';
              dd.repo.branch = 'dvm/work';
              dd.repo.baseRef = baseRef;
              dd.repo.seededAt = nowIso();
              dd.repo.lastSeedError = null;
              return dd;
            },
          });
          const regAfterReseed: any = await loadRegistry();
          const reseededDrone = regAfterReseed?.drones?.[droneId] ?? d;
          await syncRepoAgentsInstructionsForDrone({ droneId, droneEntry: reseededDrone });
          await setDroneHubMetaByIdentity({ droneId, hub: null });
          json(res, 200, { ok: true, id: droneId, name: droneName, repoRoot, baseRef });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          await commitDroneMetadataPatch({
            droneId,
            state: 'real',
            eventType: 'drone.repo-reseed.failed',
            transform: (dd: any) => {
              dd.repo = dd.repo ?? {};
              dd.repo.lastSeedError = msg;
              return dd;
            },
          });
          await setDroneHubMetaByIdentity({
            droneId,
            hub: { phase: 'error', message: `Repo seed failed: ${msg}` },
          });
          json(res, 500, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/repo/push
      // Merge the host branch into the drone repo branch as a normal commit.
      // On conflict, leave the drone repo in merge-conflict state for manual/agent resolution.
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'push'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const d = resolved.drone;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        if (runtime === 'host') {
          const repoPathRaw = String(d?.repoPath ?? '').trim();
          if (!repoPathRaw) {
            json(res, 400, { ok: false, error: 'drone has no repo attached' });
            return;
          }
          try {
            const repoRoot = await gitTopLevel(repoPathRaw);
            const hostRef = await gitCurrentBranchOrSha(repoRoot);
            const hostRefShaRaw = await runHostCommand('git', [
              '-C',
              repoRoot,
              'rev-parse',
              hostRef,
            ]);
            const hostRefSha =
              hostRefShaRaw.code === 0 ? (parseShaFromText(hostRefShaRaw.stdout) ?? null) : null;
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              mode: 'host-noop',
              repoRoot,
              hostRef,
              hostRefSha,
              message: 'host runtime uses the host repository directly; push is not required',
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
            return;
          }
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }

        await setDroneHubMetaByIdentity({
          droneId,
          hub: { phase: 'seeding', message: 'Pulling host changes into drone…' },
        });

        let repoRoot = '';
        let fromRef = '';
        let fromRefSha = '';
        let importRefName = '';
        let importRefSha = '';
        let mergeCommitSha = '';
        let mergeCommitSubject = '';
        let hostBundlePath = '';
        let containerBundlePath = '';
        let baseAdvanced = false;
        let baseAdvanceError: string | null = null;
        const repoPathInContainer = String(d?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
        const safeDroneRefSeg =
          String(droneName ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9_.-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'drone';
        const importRunId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
        importRefName = `refs/drone/imports/host/${safeDroneRefSeg}/${importRunId}`;
        containerBundlePath = normalizeContainerPath(
          `/tmp/drone-hub/imports/${safeDroneRefSeg}-${importRunId}.bundle`,
        );

        try {
          repoRoot = await gitTopLevel(repoPathRaw);
          fromRef = await gitCurrentBranchOrSha(repoRoot);

          const hostRefSha = await runHostCommand('git', ['-C', repoRoot, 'rev-parse', fromRef]);
          if (hostRefSha.code !== 0) {
            const details =
              `${String(hostRefSha.stderr ?? '')}\n${String(hostRefSha.stdout ?? '')}`.trim();
            throw new Error(
              `Failed resolving host ref ${fromRef}.${details ? `\n\n${details}` : ''}`,
            );
          }
          fromRefSha = parseShaFromText(hostRefSha.stdout) ?? '';
          if (!/^[0-9a-f]{40}$/.test(fromRefSha)) {
            throw new Error(`Could not parse host ref SHA for ${fromRef}.`);
          }

          const bundlesRoot = droneRootPath('repo-imports');
          await fs.mkdir(bundlesRoot, { recursive: true });
          hostBundlePath = path.join(bundlesRoot, `${safeDroneRefSeg}-${importRunId}.bundle`);

          const bundle = await runHostCommand('git', [
            '-C',
            repoRoot,
            'bundle',
            'create',
            hostBundlePath,
            fromRef,
          ]);
          if (bundle.code !== 0) {
            const details = `${String(bundle.stderr ?? '')}\n${String(bundle.stdout ?? '')}`.trim();
            throw new Error(
              `Failed creating host bundle from ${fromRef}.${details ? `\n\n${details}` : ''}`,
            );
          }

          const mergeResult = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: d },
            async ({ containerName }: any) => {
              const cleanStatus = await runGitInDroneOrThrow({
                container: containerName,
                repoPathInContainer,
                args: ['status', '--porcelain'],
              });
              if (String(cleanStatus.stdout ?? '').trim()) {
                return {
                  ok: false as const,
                  looksLikeConflict: false,
                  code: 'drone_repo_dirty' as const,
                  details:
                    'Drone repo has local changes. Commit or stash them before pulling host changes.',
                  conflictFiles: [] as string[],
                };
              }

              importRefSha = await importBundleHeadToDroneRef({
                containerName,
                repoPathInContainer,
                hostBundlePath,
                containerBundlePath,
                refName: importRefName,
              });

              const merge = await runGitInDrone({
                container: containerName,
                repoPathInContainer,
                args: ['merge', '--no-ff', importRefName],
              });

              if (merge.code === 0) {
                const head = await runGitInDroneOrThrow({
                  container: containerName,
                  repoPathInContainer,
                  args: ['rev-parse', 'HEAD'],
                });
                mergeCommitSha = parseShaFromText(head.stdout) ?? '';
                const subject = await runGitInDrone({
                  container: containerName,
                  repoPathInContainer,
                  args: ['log', '-1', '--format=%s', 'HEAD'],
                });
                if (subject.code === 0) {
                  mergeCommitSubject = String(subject.stdout ?? '')
                    .trim()
                    .split(/\r?\n/, 1)[0]
                    ?.trim();
                }
                try {
                  await dvmRepoSetBaseSha({
                    container: containerName,
                    repoPathInContainer,
                    baseSha: fromRefSha,
                  });
                  baseAdvanced = true;
                } catch (e: any) {
                  baseAdvanceError = e?.message ?? String(e);
                }
                return {
                  ok: true as const,
                };
              }

              const combined =
                `${String(merge.stderr ?? '')}\n${String(merge.stdout ?? '')}`.trim();
              const conflictFiles = Array.from(
                new Set([
                  ...parseMergeConflictFilesFromText(combined),
                  ...(await droneUnmergedFiles({ containerName, repoPathInContainer })),
                ]),
              ).sort((a, b) => a.localeCompare(b));
              const looksLikeConflict =
                conflictFiles.length > 0 ||
                /CONFLICT|Automatic merge failed|Merge conflict/i.test(combined);
              const details = (
                merge.stderr ||
                merge.stdout ||
                `git merge failed (exit ${merge.code})`
              ).trim();

              if (!looksLikeConflict) {
                try {
                  await runGitInDrone({
                    container: containerName,
                    repoPathInContainer,
                    args: ['merge', '--abort'],
                  });
                } catch {
                  // ignore cleanup failure
                }
              }

              return {
                ok: false as const,
                looksLikeConflict,
                code: null,
                details,
                conflictFiles,
              };
            },
          );

          if (mergeResult.ok) {
            await commitDroneMetadataPatch({
              droneId,
              state: 'real',
              eventType: 'drone.repo-push.completed',
              transform: (dd: any) => {
                dd.repo = dd.repo ?? {};
                dd.repo.baseRef = fromRef;
                dd.repo.lastPushAt = nowIso();
                dd.repo.lastPushError = null;
                dd.repo.lastPush = {
                  mode: 'host-merge-commit',
                  hostRef: fromRef,
                  hostRefSha: fromRefSha || null,
                  importedRef: importRefName || null,
                  importedRefSha: importRefSha || null,
                  mergeCommitSha: mergeCommitSha || null,
                  mergeCommitSubject: mergeCommitSubject || null,
                  baseAdvanced,
                  baseAdvanceError,
                };
                return dd;
              },
            });
            await setDroneHubMetaByIdentity({ droneId, hub: null });
            json(res, 200, {
              ok: true,
              name: droneName,
              mode: 'host-merge-commit',
              repoRoot,
              hostRef: fromRef,
              hostRefSha: fromRefSha || null,
              importedRef: importRefName,
              importedRefSha: importRefSha || null,
              mergeCommitSha: mergeCommitSha || null,
              mergeCommitSubject: mergeCommitSubject || null,
              baseAdvanced,
              baseAdvanceError,
            });
            return;
          }

          if (mergeResult.code === 'drone_repo_dirty') {
            await setDroneHubMetaByIdentity({ droneId, hub: null });
            json(res, 409, {
              ok: false,
              error: mergeResult.details,
              code: mergeResult.code,
            });
            return;
          }

          if (mergeResult.looksLikeConflict) {
            const guidance = [
              'Conflicts were left in the drone repo as a normal Git merge conflict state.',
              'Conflict marker mapping: <<<<<<< ours is the current drone branch; >>>>>>> theirs is the pulled host branch.',
              'Resolve conflicts inside the drone, then stage and commit to finish the merge.',
            ].join(' ');
            const fullMsg = `${mergeResult.details}\n\n${guidance}`;
            hubLog('warn', 'Repo push produced drone merge conflicts', {
              droneName,
              repoRoot,
              fromRef,
              importRefName,
            });
            await commitDroneMetadataPatch({
              droneId,
              state: 'real',
              eventType: 'drone.repo-push.conflicted',
              transform: (dd: any) => {
                dd.repo = dd.repo ?? {};
                dd.repo.lastPushAt = nowIso();
                dd.repo.lastPushError = fullMsg;
                dd.repo.lastPush = {
                  mode: 'drone-conflicts-ready',
                  hostRef: fromRef,
                  hostRefSha: fromRefSha || null,
                  importedRef: importRefName || null,
                  importedRefSha: importRefSha || null,
                  mergeCommitSha: null,
                  mergeCommitSubject: null,
                  baseAdvanced,
                  baseAdvanceError,
                };
                return dd;
              },
            });
            await setDroneHubMetaByIdentity({
              droneId,
              hub: {
                phase: 'error',
                message: 'Repo push conflict: resolve conflicts in drone repo',
              },
            });
            json(res, 409, {
              ok: false,
              error: fullMsg,
              code: 'drone_conflicts_ready',
              patchName: importRefName || null,
              conflictFiles: mergeResult.conflictFiles,
              importedRef: importRefName || null,
              importedRefSha: importRefSha || null,
              hostRef: fromRef,
              hostRefSha: fromRefSha || null,
            });
            return;
          }

          throw new Error(mergeResult.details || 'Repo push failed.');
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          hubLog('error', 'Repo push failed', {
            droneName,
            repoRoot,
            fromRef,
            importRefName,
            error: msg,
          });
          await commitDroneMetadataPatch({
            droneId,
            state: 'real',
            eventType: 'drone.repo-push.failed',
            transform: (dd: any) => {
              dd.repo = dd.repo ?? {};
              dd.repo.lastPushAt = nowIso();
              dd.repo.lastPushError = msg;
              dd.repo.lastPush = {
                mode: 'push-failed',
                hostRef: fromRef || null,
                hostRefSha: fromRefSha || null,
                importedRef: importRefName || null,
                importedRefSha: importRefSha || null,
                mergeCommitSha: null,
                mergeCommitSubject: null,
                baseAdvanced,
                baseAdvanceError,
              };
              return dd;
            },
          });
          await setDroneHubMetaByIdentity({
            droneId,
            hub: { phase: 'error', message: `Repo push failed: ${msg}` },
          });
          json(res, 500, {
            ok: false,
            error: msg,
            code: null,
            patchName: null,
            conflictFiles: [],
          });
          return;
        } finally {
          if (hostBundlePath) {
            try {
              await fs.rm(hostBundlePath, { recursive: true, force: true });
            } catch (e: any) {
              hubLog('warn', 'Repo push host bundle cleanup failed', {
                droneName,
                hostBundlePath,
                error: e?.message ?? String(e),
              });
            }
          }

          if (importRefName || containerBundlePath) {
            try {
              await withLockedDroneContainer(
                { requestedDroneName: droneName, droneEntry: d },
                async ({ containerName }: any) => {
                  if (importRefName) {
                    await runGitInDrone({
                      container: containerName,
                      repoPathInContainer,
                      args: ['update-ref', '-d', importRefName],
                    });
                  }
                  if (containerBundlePath) {
                    await dvmExec(containerName, 'bash', [
                      '-lc',
                      `rm -f ${JSON.stringify(containerBundlePath)} || true`,
                    ]);
                  }
                },
              );
            } catch (e: any) {
              hubLog('warn', 'Repo push drone cleanup failed', {
                droneName,
                importRefName,
                containerBundlePath,
                error: e?.message ?? String(e),
              });
            }
          }
        }
      }

      // POST /api/drones/:id/repo/pull
      // Pull container repo changes onto the host repo without creating a merge commit.
      // Exports a bundle from the container, imports it to a temporary host ref, then
      // applies the imported branch diff onto the host worktree/index.
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const d = resolved.drone;
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;
        const runtime = droneRuntime(d);
        if (runtime === 'host') {
          const repoPathRaw = String(d?.repoPath ?? '').trim();
          if (!repoPathRaw) {
            json(res, 400, { ok: false, error: 'drone has no repo attached' });
            return;
          }
          try {
            const repoRoot = await gitTopLevel(repoPathRaw);
            const fromRef =
              String(d?.repo?.baseRef ?? '').trim() || (await gitCurrentBranchOrSha(repoRoot));
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              mode: 'host-noop',
              repoRoot,
              fromRef,
              message: 'host runtime uses the host repository directly; pull is not required',
            });
            return;
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            json(res, 500, { ok: false, error: msg, id: droneId, name: droneName });
            return;
          }
        }
        const repoPathRaw = String(d?.repoPath ?? '').trim();
        if (!repoPathRaw) {
          json(res, 400, { ok: false, error: 'drone has no repo attached' });
          return;
        }
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, {
            ok: false,
            error: e?.message ?? String(e),
            id: droneId,
            name: droneName,
          });
          return;
        }
        const commitDirtyRaw = (body as any)?.commitDirty;
        const commitDirty =
          commitDirtyRaw === true ||
          commitDirtyRaw === 1 ||
          String(commitDirtyRaw ?? '')
            .trim()
            .toLowerCase() === 'true';
        const allowDirtyRaw = (body as any)?.allowDirty;
        const allowDirty =
          allowDirtyRaw === true ||
          allowDirtyRaw === 1 ||
          String(allowDirtyRaw ?? '')
            .trim()
            .toLowerCase() === 'true';
        const applyConflictsToHostRaw = (body as any)?.applyConflictsToHost;
        const applyConflictsToHost =
          applyConflictsToHostRaw === true ||
          applyConflictsToHostRaw === 1 ||
          String(applyConflictsToHostRaw ?? '')
            .trim()
            .toLowerCase() === 'true';
        const defaultAutoCommitMessage = 'chore(drone): snapshot working tree before apply changes';
        const requestedAutoCommitMessage = String((body as any)?.commitMessage ?? '').trim();
        const autoCommitMessage = requestedAutoCommitMessage || defaultAutoCommitMessage;

        let repoRoot = '';
        let fromRef = '';
        let exportPath = '';
        let importRefName = '';
        let importRefSha = '';
        let mirrorParentRef = '';
        let mirrorParentSha = '';
        let mirrorCandidateRef = '';
        let mirrorCandidateSha = '';
        let mirrorAppliedToHost = false;
        let pendingMirrorPromoted = false;
        const repoPathInContainer = String(d?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
        const containerName =
          String((d as any)?.containerName ?? (d as any)?.name ?? droneName).trim() || droneName;
        let stashed = false;
        let stashPopOk: boolean | null = null;
        let stashPopText: string | null = null;
        let exportedHeadSha: string | null = null;
        let droneBaseShaForApply: string | null = null;
        let baseAdvanced = false;
        let baseAdvanceError: string | null = null;
        let prePullBaseSha: string | null = null;
        let prePullBaseAdvanced = false;
        let prePullBaseAdvanceError: string | null = null;
        let hostConflictState = false;
        let noChangesToPull = false;
        let droneDirtyFileCount = 0;
        let droneAutoCommitSha: string | null = null;
        let droneAutoCommitMessage: string | null = null;

        const tryAdvanceContainerExportBase = async () => {
          if (!exportedHeadSha) return;
          try {
            await dvmRepoSetBaseSha({
              container: containerName,
              repoPathInContainer,
              baseSha: exportedHeadSha,
            });
            baseAdvanced = true;
          } catch (e: any) {
            baseAdvanceError = e?.message ?? String(e);
          }
        };

        try {
          repoRoot = await gitTopLevel(repoPathRaw);
          fromRef =
            String(d?.repo?.baseRef ?? '').trim() || (await gitCurrentBranchOrSha(repoRoot));

          // Guard host repo before modifying it.
          const clean = await gitIsClean(repoRoot);
          if (!clean) {
            hubLog('warn', 'Repo pull blocked by local host changes', { droneName, repoRoot });
            json(res, 409, {
              ok: false,
              error:
                'Host repo has local changes. Please stash or commit them before pulling changes.',
            });
            return;
          }

          const lastPullBeforeApply =
            d?.repo?.lastPull && typeof d.repo.lastPull === 'object' ? d.repo.lastPull : null;
          const mirrorReconcile = await reconcilePendingHostMirrorApply({
            droneId,
            droneName,
            droneEntry: d,
            repoRoot,
            repoPathInContainer,
          });
          pendingMirrorPromoted = mirrorReconcile.promoted;
          if (mirrorReconcile.promoted && mirrorReconcile.droneHeadSha) {
            prePullBaseSha = mirrorReconcile.droneHeadSha;
            prePullBaseAdvanced = true;
          }
          if (mirrorReconcile.error) {
            prePullBaseAdvanceError = mirrorReconcile.error;
          }

          const dronePrepare = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: d },
            async ({ containerName }: any) => {
              const status = await runGitInDroneOrThrow({
                container: containerName,
                repoPathInContainer,
                args: ['status', '--porcelain'],
              });
              const changedLines = String(status.stdout ?? '')
                .split(/\r?\n/)
                .map((line) => line.trimEnd())
                .filter((line) => line.length > 0);
              const dirtyFileCount = changedLines.length;
              if (dirtyFileCount <= 0) {
                return { dirtyFileCount: 0, autoCommitSha: null as string | null };
              }
              if (!commitDirty) {
                return { dirtyFileCount, autoCommitSha: null as string | null };
              }
              await runGitInDroneOrThrow({
                container: containerName,
                repoPathInContainer,
                args: ['add', '-A'],
              });
              const commit = await runGitInDrone({
                container: containerName,
                repoPathInContainer,
                args: [
                  '-c',
                  'user.name=Drone Hub',
                  '-c',
                  'user.email=drone-hub@local',
                  'commit',
                  '-m',
                  autoCommitMessage,
                ],
              });
              if (commit.code !== 0) {
                const details =
                  `${String(commit.stderr ?? '')}\n${String(commit.stdout ?? '')}`.trim();
                throw new Error(
                  `Failed to create placeholder drone commit before apply.${details ? `\n\n${details}` : ''}`,
                );
              }
              const headRaw = await runGitInDroneOrThrow({
                container: containerName,
                repoPathInContainer,
                args: ['rev-parse', 'HEAD'],
              });
              const autoCommitSha = String(headRaw.stdout ?? '')
                .trim()
                .toLowerCase();
              return {
                dirtyFileCount,
                autoCommitSha: /^[0-9a-f]{40}$/.test(autoCommitSha) ? autoCommitSha : null,
              };
            },
          );
          droneDirtyFileCount = Math.max(0, Number(dronePrepare.dirtyFileCount) || 0);
          if (droneDirtyFileCount > 0 && !commitDirty && !allowDirty) {
            hubLog('warn', 'Repo pull blocked by uncommitted drone changes', {
              droneName,
              repoPathInContainer,
              dirtyFileCount: droneDirtyFileCount,
            });
            json(res, 409, {
              ok: false,
              error:
                'Drone repo has uncommitted changes. Cancel apply or auto-commit all changes before continuing.',
              code: 'drone_dirty',
              dirtyFileCount: droneDirtyFileCount,
              autoCommitMessage,
            });
            return;
          }
          if (droneDirtyFileCount > 0 && commitDirty) {
            droneAutoCommitSha = dronePrepare.autoCommitSha;
            droneAutoCommitMessage = autoCommitMessage;
            hubLog('info', 'Repo pull auto-committed drone working tree', {
              droneName,
              repoPathInContainer,
              dirtyFileCount: droneDirtyFileCount,
              autoCommitSha: droneAutoCommitSha,
            });
          }
          if (droneDirtyFileCount > 0 && allowDirty && !commitDirty) {
            hubLog('info', 'Repo pull proceeding with dirty drone working tree kept intact', {
              droneName,
              repoPathInContainer,
              dirtyFileCount: droneDirtyFileCount,
            });
          }
          if (clean) {
            const lastPullAny =
              d?.repo?.lastPull && typeof d.repo.lastPull === 'object' ? d.repo.lastPull : null;
            const lastMode = String((lastPullAny as any)?.mode ?? '')
              .trim()
              .toLowerCase();
            const lastExportedHeadSha = String((lastPullAny as any)?.exportedHeadSha ?? '')
              .trim()
              .toLowerCase();
            const currentHostRef = await gitCurrentBranchOrSha(repoRoot).catch(() => '');
            if (
              lastMode === 'host-conflicts-ready' &&
              /^[0-9a-f]{40}$/.test(lastExportedHeadSha) &&
              repoBaseRefMatchesCurrentHostBranch(fromRef, currentHostRef)
            ) {
              prePullBaseSha = lastExportedHeadSha;
              try {
                await dvmRepoSetBaseSha({
                  container: containerName,
                  repoPathInContainer,
                  baseSha: lastExportedHeadSha,
                });
                prePullBaseAdvanced = true;
              } catch (e: any) {
                prePullBaseAdvanceError = e?.message ?? String(e);
              }
            } else if (
              (lastMode === 'bundle-merge-no-commit' || lastMode === 'bundle-apply-no-commit') &&
              /^[0-9a-f]{40}$/.test(lastExportedHeadSha)
            ) {
              try {
                const hostContainsLastExport = await gitIsAncestor(
                  repoRoot,
                  lastExportedHeadSha,
                  'HEAD',
                );
                if (!hostContainsLastExport) {
                  const recoveryBaseSha = await gitMergeBase(repoRoot, 'HEAD', lastExportedHeadSha);
                  if (recoveryBaseSha && recoveryBaseSha !== lastExportedHeadSha) {
                    prePullBaseSha = recoveryBaseSha;
                    try {
                      await dvmRepoSetBaseSha({
                        container: containerName,
                        repoPathInContainer,
                        baseSha: recoveryBaseSha,
                      });
                      prePullBaseAdvanced = true;
                    } catch (e: any) {
                      prePullBaseAdvanceError = e?.message ?? String(e);
                    }
                  }
                }
              } catch (e: any) {
                if (!prePullBaseAdvanceError) prePullBaseAdvanceError = e?.message ?? String(e);
              }
            }
          }

          try {
            exportedHeadSha = await dvmRepoHeadSha({
              container: containerName,
              repoPathInContainer,
            });
          } catch (e: any) {
            baseAdvanceError = e?.message ?? String(e);
          }
          try {
            droneBaseShaForApply = await droneRepoBaseSha({
              container: containerName,
              repoPathInContainer,
            });
          } catch (e: any) {
            if (!baseAdvanceError) baseAdvanceError = e?.message ?? String(e);
          }

          if (
            exportedHeadSha &&
            droneBaseShaForApply &&
            exportedHeadSha.toLowerCase() === droneBaseShaForApply.toLowerCase()
          ) {
            noChangesToPull = true;
          }

          // Export the full container repo HEAD as a git bundle, then import to a
          // temporary host ref. The host-authored mirror commit uses only the
          // imported tree, so original drone commits are not kept in host history.
          const patchesOutRoot = droneRootPath('repo-exports');
          await fs.mkdir(patchesOutRoot, { recursive: true });
          if (!noChangesToPull) {
            try {
              const exported = await exportFullHeadBundleFromDrone({
                containerName,
                repoPathInContainer,
                outDir: patchesOutRoot,
                label: droneName,
              });
              exportPath = exported.exportedPath;
            } catch (e: any) {
              throw e;
            }
          }

          if (noChangesToPull) {
            await tryAdvanceContainerExportBase();
            await commitDroneMetadataPatch({
              droneId,
              state: 'real',
              eventType: 'drone.repo-pull.no-changes',
              transform: (dd: any) => {
                dd.repo = dd.repo ?? {};
                dd.repo.baseRef = fromRef;
                dd.repo.dest = dd.repo.dest ?? '/work/repo';
                dd.repo.branch = dd.repo.branch ?? 'dvm/work';
                dd.repo.lastPullAt = nowIso();
                dd.repo.lastPullError = null;
                dd.repo.lastPull = {
                  mode: 'no-changes',
                  exportFormat: 'bundle',
                  exportPath: null,
                  importedRef: null,
                  importedRefSha: null,
                  mergeSourceRef: null,
                  hostMirrorRef: pendingMirrorPromoted
                    ? mirrorReconcile.hostMirrorRef
                    : String((lastPullBeforeApply as any)?.hostMirrorRef ?? '').trim() || null,
                  hostMirrorSha: pendingMirrorPromoted
                    ? mirrorReconcile.hostMirrorSha
                    : String((lastPullBeforeApply as any)?.hostMirrorSha ?? '').trim() || null,
                  stashed,
                  stashPopOk,
                  stashPopText,
                  exportedHeadSha,
                  baseAdvanced,
                  baseAdvanceError,
                  prePullBaseSha,
                  prePullBaseAdvanced,
                  prePullBaseAdvanceError,
                  droneDirtyFileCount,
                  droneAutoCommitSha,
                  droneAutoCommitMessage,
                };
                return dd;
              },
            });
            hubLog('info', 'Repo pull completed with no new commits', {
              droneName,
              repoRoot,
              fromRef,
              exportedHeadSha,
            });
            json(res, 200, {
              ok: true,
              name: droneName,
              mode: 'no-changes',
              repoRoot,
              fromRef,
              noChanges: true,
              stashed,
              stashPopOk,
              stashPopText,
              exportedHeadSha,
              baseAdvanced,
              baseAdvanceError,
              prePullBaseSha,
              prePullBaseAdvanced,
              prePullBaseAdvanceError,
              droneDirtyFileCount,
              droneAutoCommitSha,
              droneAutoCommitMessage,
            });
            return;
          }

          const safeDroneRefSeg =
            String(droneName ?? '')
              .toLowerCase()
              .replace(/[^a-z0-9_.-]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'drone';
          const importRunId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
          importRefName = `refs/drone/imports/${safeDroneRefSeg}/${importRunId}`;
          try {
            importRefSha = await importBundleHeadToHostRef({
              repoRoot,
              bundlePath: exportPath,
              refName: importRefName,
            });
          } catch (e: any) {
            const importMsg = e?.message ?? String(e);
            if (looksLikeBundleMissingPrerequisiteError(importMsg)) {
              const userMsg =
                'Host repo is missing prerequisite commits for this drone export. Re-seed the drone and pull again.';
              hubLog('error', 'Repo pull bundle import missing prerequisites', {
                droneName,
                repoRoot,
                fromRef,
                importRefName,
                error: importMsg,
              });
              await commitDroneMetadataPatch({
                droneId,
                state: 'real',
                eventType: 'drone.repo-pull.missing-prerequisite',
                transform: (dd: any) => {
                  dd.repo = dd.repo ?? {};
                  dd.repo.lastPullAt = nowIso();
                  dd.repo.lastPullError = `${userMsg}\n\n${importMsg}`;
                  dd.repo.lastPull = {
                    mode: 'bundle-import-missing-prereq',
                    exportFormat: 'bundle',
                    exportPath: exportPath || null,
                    importedRef: importRefName || null,
                    importedRefSha: null,
                    mergeSourceRef: importRefName || null,
                    stashed,
                    stashPopOk,
                    stashPopText,
                    exportedHeadSha,
                    baseAdvanced,
                    baseAdvanceError,
                    prePullBaseSha,
                    prePullBaseAdvanced,
                    prePullBaseAdvanceError,
                  };
                  return dd;
                },
              });
              json(res, 409, {
                ok: false,
                error: userMsg,
                code: 'bundle_missing_prereq',
                reseedRequired: true,
                stashed,
                stashPopOk,
                stashPopText,
                exportedHeadSha,
                baseAdvanced,
                baseAdvanceError,
                prePullBaseSha,
                prePullBaseAdvanced,
                prePullBaseAdvanceError,
              });
              return;
            }
            throw e;
          }

          const lastPullForMirror =
            d?.repo?.lastPull && typeof d.repo.lastPull === 'object' ? d.repo.lastPull : null;
          const storedMirrorRef = pendingMirrorPromoted
            ? String(mirrorReconcile.hostMirrorRef ?? '').trim()
            : String((lastPullForMirror as any)?.hostMirrorRef ?? '').trim();
          const storedMirrorSha = pendingMirrorPromoted
            ? String(mirrorReconcile.hostMirrorSha ?? '')
                .trim()
                .toLowerCase()
            : String((lastPullForMirror as any)?.hostMirrorSha ?? '')
                .trim()
                .toLowerCase();
          mirrorParentRef =
            storedMirrorRef &&
            /^[0-9a-f]{40}$/.test(storedMirrorSha) &&
            (await gitResolveCommitSha(repoRoot, storedMirrorRef))
              ? storedMirrorRef
              : String(droneBaseShaForApply ?? '').trim();
          mirrorParentSha = (await gitResolveCommitSha(repoRoot, mirrorParentRef)) ?? '';
          if (!mirrorParentSha) {
            throw new Error(
              'Host repo is missing the mirror parent for this drone apply. Re-seed the drone and apply again.',
            );
          }

          mirrorCandidateRef = `refs/drone/mirrors/${safeDroneRefSeg}/candidate/${importRunId}`;
          mirrorCandidateSha = await createHostAuthoredMirrorCommit({
            repoRoot,
            sourceRef: importRefName,
            parentRef: mirrorParentSha,
            message: `chore(drone): mirror ${droneName} changes for host apply`,
          });
          await updateHostRef({
            repoRoot,
            refName: mirrorCandidateRef,
            target: mirrorCandidateSha,
          });

          // Preview the host-authored mirror in a temp worktree first. Clean merges
          // are left as a real pending merge in the host repo; conflicts only touch
          // host when explicitly requested.
          await applyBranchMergeNoCommitToMainWorkingTree({
            repoRoot,
            branch: mirrorCandidateRef,
            applyConflictsToHost,
          });
          mirrorAppliedToHost = true;

          await commitDroneMetadataPatch({
            droneId,
            state: 'real',
            eventType: 'drone.repo-pull.pending',
            transform: (dd: any) => {
              dd.repo = dd.repo ?? {};
              dd.repo.baseRef = fromRef;
              dd.repo.dest = dd.repo.dest ?? '/work/repo';
              dd.repo.branch = dd.repo.branch ?? 'dvm/work';
              dd.repo.lastPullAt = nowIso();
              dd.repo.lastPullError = null;
              dd.repo.lastPull = {
                mode: 'host-mirror-merge-pending',
                exportFormat: 'bundle',
                exportPath,
                importedRef: null,
                importedRefSha: importRefSha || null,
                mergeSourceRef: mirrorCandidateRef,
                hostMirrorParentRef: mirrorParentRef,
                hostMirrorParentSha: mirrorParentSha || null,
                hostMirrorCandidateRef: mirrorCandidateRef,
                hostMirrorCandidateSha: mirrorCandidateSha || null,
                quarantineBranch: null,
                worktreePath: null,
                stashed,
                stashPopOk,
                stashPopText,
                exportedHeadSha,
                baseAdvanced,
                baseAdvanceError,
                prePullBaseSha,
                prePullBaseAdvanced,
                prePullBaseAdvanceError,
                droneDirtyFileCount,
                droneAutoCommitSha,
                droneAutoCommitMessage,
              };
              return dd;
            },
          });

          json(res, 200, {
            ok: true,
            name: droneName,
            mode: 'host-mirror-merge-pending',
            repoRoot,
            fromRef,
            exportFormat: 'bundle',
            exportPath,
            importedRef: null,
            importedRefSha: importRefSha || null,
            mergeSourceRef: mirrorCandidateRef,
            hostMirrorParentRef: mirrorParentRef,
            hostMirrorParentSha: mirrorParentSha || null,
            hostMirrorCandidateRef: mirrorCandidateRef,
            hostMirrorCandidateSha: mirrorCandidateSha || null,
            stashed,
            stashPopOk,
            stashPopText,
            exportedHeadSha,
            baseAdvanced,
            baseAdvanceError,
            prePullBaseSha,
            prePullBaseAdvanced,
            prePullBaseAdvanceError,
            droneDirtyFileCount,
            droneAutoCommitSha,
            droneAutoCommitMessage,
          });
          return;
        } catch (e: any) {
          let msg = e?.message ?? String(e);
          let patchErr = isRepoPatchApplyError(e) ? e : null;
          hostConflictState = patchErr?.appliedToHost === true;

          if (patchErr?.kind === 'patch_apply_conflict') {
            if (!hostConflictState) {
              const guidance = [
                'Host repo was not modified.',
                'Review the conflicting files in pull preview, or re-run apply and choose to project conflicts onto the host repo for manual resolution.',
              ].join(' ');
              const fullMsg = `${msg}\n\n${guidance}`;
              hubLog('warn', 'Repo pull found host conflicts before apply state', {
                droneName,
                repoRoot,
                fromRef,
                importRefName,
                error: msg,
              });
              await commitDroneMetadataPatch({
                droneId,
                state: 'real',
                eventType: 'drone.repo-pull.prepare-conflicted',
                transform: (dd: any) => {
                  dd.repo = dd.repo ?? {};
                  dd.repo.lastPullAt = nowIso();
                  dd.repo.lastPullError = fullMsg;
                  dd.repo.lastPull = {
                    mode: 'bundle-prepare-conflict',
                    exportFormat: 'bundle',
                    exportPath: exportPath || null,
                    importedRef: null,
                    importedRefSha: importRefSha || null,
                    mergeSourceRef: mirrorCandidateRef || null,
                    hostMirrorParentRef: mirrorParentRef || null,
                    hostMirrorParentSha: mirrorParentSha || null,
                    hostMirrorCandidateRef: mirrorCandidateRef || null,
                    hostMirrorCandidateSha: mirrorCandidateSha || null,
                    quarantineBranch: null,
                    worktreePath: null,
                    stashed,
                    stashPopOk,
                    stashPopText,
                    exportedHeadSha,
                    baseAdvanced,
                    baseAdvanceError,
                    prePullBaseSha,
                    prePullBaseAdvanced,
                    prePullBaseAdvanceError,
                  };
                  return dd;
                },
              });
              json(res, 409, {
                ok: false,
                error: fullMsg,
                code: patchErr.kind,
                patchName: patchErr.patchName ?? null,
                conflictFiles: patchErr.conflictFiles ?? [],
                hostConflictState: false,
                canApplyConflictsToHost: true,
                stashed,
                stashPopOk,
                stashPopText,
                exportedHeadSha,
                baseAdvanced,
                baseAdvanceError,
                prePullBaseSha,
                prePullBaseAdvanced,
                prePullBaseAdvanceError,
              });
              return;
            }

            const guidance = [
              'Conflicts were applied to your host repo as normal Git conflict markers.',
              'Conflict marker mapping: <<<<<<< ours is your current host branch; >>>>>>> theirs is the host-authored drone mirror.',
              'Resolve conflicts in your current branch, then stage and commit as usual.',
              stashed
                ? 'Your previous local changes were auto-stashed and left in stash. After resolving pull conflicts, run `git stash pop` when ready.'
                : '',
            ]
              .filter(Boolean)
              .join(' ');
            const fullMsg = `${msg}\n\n${guidance}`;
            hubLog('warn', 'Repo pull produced host apply conflicts', {
              droneName,
              repoRoot,
              fromRef,
              importRefName,
            });
            await commitDroneMetadataPatch({
              droneId,
              state: 'real',
              eventType: 'drone.repo-pull.conflicted',
              transform: (dd: any) => {
                dd.repo = dd.repo ?? {};
                dd.repo.lastPullAt = nowIso();
                dd.repo.lastPullError = fullMsg;
                dd.repo.lastPull = {
                  mode: 'host-conflicts-ready',
                  exportFormat: 'bundle',
                  exportPath: exportPath || null,
                  importedRef: null,
                  importedRefSha: importRefSha || null,
                  mergeSourceRef: mirrorCandidateRef || null,
                  hostMirrorParentRef: mirrorParentRef || null,
                  hostMirrorParentSha: mirrorParentSha || null,
                  hostMirrorCandidateRef: mirrorCandidateRef || null,
                  hostMirrorCandidateSha: mirrorCandidateSha || null,
                  patchesDir: null,
                  diffPath: null,
                  quarantineBranch: null,
                  worktreePath: null,
                  stashed,
                  stashPopOk,
                  stashPopText,
                  exportedHeadSha,
                  baseAdvanced,
                  baseAdvanceError,
                  prePullBaseSha,
                  prePullBaseAdvanced,
                  prePullBaseAdvanceError,
                };
                return dd;
              },
            });
            json(res, 409, {
              ok: false,
              error: fullMsg,
              code: 'host_conflicts_ready',
              patchName: patchErr.patchName ?? null,
              conflictFiles: patchErr.conflictFiles ?? [],
              diffPath: null,
              hostConflictState: true,
              stashed,
              stashPopOk,
              stashPopText,
              exportedHeadSha,
              baseAdvanced,
              baseAdvanceError,
              prePullBaseSha,
              prePullBaseAdvanced,
              prePullBaseAdvanceError,
            });
            return;
          }

          const statusCode = 500;
          hubLog('error', 'Repo pull failed', {
            droneName,
            repoRoot,
            fromRef,
            importRefName,
            error: msg,
          });
          await commitDroneMetadataPatch({
            droneId,
            state: 'real',
            eventType: 'drone.repo-pull.failed',
            transform: (dd: any) => {
              dd.repo = dd.repo ?? {};
              dd.repo.lastPullAt = nowIso();
              dd.repo.lastPullError = msg;
              dd.repo.lastPull = {
                mode: 'pull-failed',
                exportFormat: 'bundle',
                exportPath: exportPath || null,
                importedRef: importRefName || null,
                importedRefSha: importRefSha || null,
                mergeSourceRef: importRefName || null,
                stashed,
                stashPopOk,
                stashPopText,
                exportedHeadSha,
                baseAdvanced,
                baseAdvanceError,
                prePullBaseSha,
                prePullBaseAdvanced,
                prePullBaseAdvanceError,
              };
              return dd;
            },
          });
          json(res, statusCode, {
            ok: false,
            error: msg,
            code: patchErr?.kind ?? null,
            patchName: patchErr?.patchName ?? null,
            conflictFiles: patchErr?.conflictFiles ?? [],
          });
          return;
        } finally {
          if (exportPath) {
            try {
              await fs.rm(exportPath, { recursive: true, force: true });
            } catch (e: any) {
              hubLog('warn', 'Repo pull export cleanup failed', {
                droneName,
                exportPath,
                error: e?.message ?? String(e),
              });
            }
          }
          if (repoRoot && importRefName) {
            await deleteHostRefBestEffort({ repoRoot, refName: importRefName });
          }
          if (repoRoot && mirrorCandidateRef && !mirrorAppliedToHost && !hostConflictState) {
            await deleteHostRefBestEffort({ repoRoot, refName: mirrorCandidateRef });
          }
        }
      }

      // POST /api/drones/:id/repo/pull-from-drone
      // Pull committed repo changes from one container drone into another as a normal git merge commit in the target drone repo.
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'repo' &&
        parts[4] === 'pull-from-drone'
      ) {
        const targetDroneRef = decodeURIComponent(parts[2]);
        const resolvedTarget = await resolveDroneOrRespond(res, targetDroneRef);
        if (!resolvedTarget) return;
        const targetDroneId = resolvedTarget.id;
        const targetEntry = resolvedTarget.drone;
        const targetDroneName =
          String(targetEntry?.name ?? targetDroneRef).trim() || targetDroneRef;
        const targetRuntime = droneRuntime(targetEntry);

        if (targetRuntime === 'host') {
          json(res, 409, {
            ok: false,
            error: 'peer repo sync is only supported between container drones',
            code: 'peer_sync_unsupported_runtime',
          });
          return;
        }

        const targetRepoPathRaw = String(targetEntry?.repoPath ?? '').trim();
        if (!targetRepoPathRaw) {
          json(res, 400, { ok: false, error: 'target drone has no repo attached' });
          return;
        }

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, {
            ok: false,
            error: e?.message ?? String(e),
            id: targetDroneId,
            name: targetDroneName,
          });
          return;
        }

        const sourceDroneRef = String(body?.sourceDroneId ?? '').trim();
        if (!sourceDroneRef) {
          json(res, 400, {
            ok: false,
            error: 'missing sourceDroneId',
            id: targetDroneId,
            name: targetDroneName,
          });
          return;
        }

        const regAny: any = await loadRegistry();
        const foundSource = findDroneIdByRef(regAny, sourceDroneRef);
        if (!foundSource || foundSource.kind !== 'real') {
          json(res, 404, {
            ok: false,
            error: `unknown source drone: ${sourceDroneRef}`,
            id: targetDroneId,
            name: targetDroneName,
          });
          return;
        }
        const sourceDroneId = foundSource.id;
        if (sourceDroneId === targetDroneId) {
          json(res, 409, {
            ok: false,
            error: 'source and target drones must be different',
            code: 'same_drone',
          });
          return;
        }
        const sourceEntry = regAny?.drones?.[sourceDroneId] ?? null;
        if (!sourceEntry) {
          json(res, 404, {
            ok: false,
            error: `unknown source drone: ${sourceDroneRef}`,
            id: targetDroneId,
            name: targetDroneName,
          });
          return;
        }
        const sourceDroneName =
          String(sourceEntry?.name ?? sourceDroneRef).trim() || sourceDroneRef;
        const sourceRuntime = droneRuntime(sourceEntry);
        if (sourceRuntime === 'host') {
          json(res, 409, {
            ok: false,
            error: 'peer repo sync is only supported between container drones',
            code: 'peer_sync_unsupported_runtime',
            sourceDroneId,
            sourceDroneName,
            targetDroneId,
            targetDroneName,
          });
          return;
        }
        const sourceRepoPathRaw = String(sourceEntry?.repoPath ?? '').trim();
        if (!sourceRepoPathRaw) {
          json(res, 400, {
            ok: false,
            error: 'source drone has no repo attached',
            sourceDroneId,
            sourceDroneName,
            targetDroneId,
            targetDroneName,
          });
          return;
        }

        const commitDirtyRaw = body?.commitDirty;
        const commitDirty =
          commitDirtyRaw === true ||
          commitDirtyRaw === 1 ||
          String(commitDirtyRaw ?? '')
            .trim()
            .toLowerCase() === 'true';
        const probeOnlyRaw = body?.probeOnly;
        const probeOnly =
          probeOnlyRaw === true ||
          probeOnlyRaw === 1 ||
          String(probeOnlyRaw ?? '')
            .trim()
            .toLowerCase() === 'true';
        const defaultAutoCommitMessage = 'chore(drone): snapshot working tree before drone sync';
        const requestedAutoCommitMessage = String(body?.commitMessage ?? '').trim();
        const autoCommitMessage = requestedAutoCommitMessage || defaultAutoCommitMessage;

        if (!probeOnly) {
          await setDroneHubMetaByIdentity({
            droneId: targetDroneId,
            hub: { phase: 'seeding', message: `Pulling repo changes from ${sourceDroneName}…` },
          });
        }

        let sourceRepoRoot = '';
        let targetRepoRoot = '';
        let exportPath = '';
        let importRefName = '';
        let importRefSha = '';
        let containerBundlePath = '';
        let mergeCommitSha = '';
        let mergeCommitSubject = '';
        let sourceDirtyFileCount = 0;
        let sourceAutoCommitSha: string | null = null;
        let sourceAutoCommitMessage: string | null = null;
        const sourceSafeSeg =
          String(sourceDroneName ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9_.-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'source';
        const targetSafeSeg =
          String(targetDroneName ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9_.-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'target';
        const importRunId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

        try {
          sourceRepoRoot = await gitTopLevel(sourceRepoPathRaw);
          targetRepoRoot = await gitTopLevel(targetRepoPathRaw);
          if (sourceRepoRoot !== targetRepoRoot) {
            if (!probeOnly) {
              await setDroneHubMetaByIdentity({ droneId: targetDroneId, hub: null });
            }
            json(res, 409, {
              ok: false,
              error: 'source and target drones are not attached to the same host repo',
              code: 'repo_mismatch',
              sourceDroneId,
              sourceDroneName,
              targetDroneId,
              targetDroneName,
            });
            return;
          }

          const sourceRepoPathInContainer =
            String(sourceEntry?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
          const targetRepoPathInContainer =
            String(targetEntry?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
          const patchesOutRoot = droneRootPath('repo-exports');
          await fs.mkdir(patchesOutRoot, { recursive: true });
          importRefName = `refs/drone/imports/peer/${sourceSafeSeg}/${targetSafeSeg}/${importRunId}`;
          containerBundlePath = normalizeContainerPath(
            `/tmp/drone-hub/imports/${sourceSafeSeg}-${targetSafeSeg}-${importRunId}.bundle`,
          );

          const transferResult = await withLockedDroneContainers(
            { requestedDroneName: sourceDroneName, droneEntry: sourceEntry },
            { requestedDroneName: targetDroneName, droneEntry: targetEntry },
            async ({ source, target }: any) => {
              const targetStatus = await runGitInDroneOrThrow({
                container: target.containerName,
                repoPathInContainer: targetRepoPathInContainer,
                args: ['status', '--porcelain'],
              });
              if (String(targetStatus.stdout ?? '').trim()) {
                return {
                  ok: false as const,
                  code: 'target_drone_dirty' as const,
                  details:
                    'Target drone repo has local changes. Commit or stash them before pulling from another drone.',
                  conflictFiles: [] as string[],
                  looksLikeConflict: false,
                };
              }

              const sourceStatus = await runGitInDroneOrThrow({
                container: source.containerName,
                repoPathInContainer: sourceRepoPathInContainer,
                args: ['status', '--porcelain'],
              });
              const changedLines = String(sourceStatus.stdout ?? '')
                .split(/\r?\n/)
                .map((line) => line.trimEnd())
                .filter((line) => line.length > 0);
              sourceDirtyFileCount = changedLines.length;
              if (sourceDirtyFileCount > 0) {
                if (!commitDirty) {
                  return {
                    ok: false as const,
                    code: 'source_drone_dirty' as const,
                    details:
                      'Source drone repo has uncommitted changes. Commit or auto-commit them before syncing.',
                    conflictFiles: [] as string[],
                    looksLikeConflict: false,
                  };
                }
                await runGitInDroneOrThrow({
                  container: source.containerName,
                  repoPathInContainer: sourceRepoPathInContainer,
                  args: ['add', '-A'],
                });
                const commit = await runGitInDrone({
                  container: source.containerName,
                  repoPathInContainer: sourceRepoPathInContainer,
                  args: [
                    '-c',
                    'user.name=Drone Hub',
                    '-c',
                    'user.email=drone-hub@local',
                    'commit',
                    '-m',
                    autoCommitMessage,
                  ],
                });
                if (commit.code !== 0) {
                  const details =
                    `${String(commit.stderr ?? '')}\n${String(commit.stdout ?? '')}`.trim();
                  throw new Error(
                    `Failed to create placeholder source drone commit before sync.${details ? `\n\n${details}` : ''}`,
                  );
                }
                const headRaw = await runGitInDroneOrThrow({
                  container: source.containerName,
                  repoPathInContainer: sourceRepoPathInContainer,
                  args: ['rev-parse', 'HEAD'],
                });
                const autoSha = String(headRaw.stdout ?? '')
                  .trim()
                  .toLowerCase();
                sourceAutoCommitSha = /^[0-9a-f]{40}$/.test(autoSha) ? autoSha : null;
                sourceAutoCommitMessage = autoCommitMessage;
              }

              try {
                const exported = await dvmRepoExport({
                  container: source.containerName,
                  repoPathInContainer: sourceRepoPathInContainer,
                  outDir: patchesOutRoot,
                  format: 'bundle',
                });
                exportPath = exported.exportedPath;
              } catch (e: any) {
                const exportMsg = e?.message ?? String(e);
                if (looksLikeEmptyBundleExportError(exportMsg)) {
                  return { ok: true as const, noChanges: true as const };
                }
                throw e;
              }

              if (probeOnly) {
                return { ok: true as const, noChanges: false as const };
              }

              let usedFullBundleFallback = false;
              try {
                importRefSha = await importBundleHeadToDroneRef({
                  containerName: target.containerName,
                  repoPathInContainer: targetRepoPathInContainer,
                  hostBundlePath: exportPath,
                  containerBundlePath,
                  refName: importRefName,
                });
              } catch (e: any) {
                const importMsg = e?.message ?? String(e);
                if (!looksLikeBundleMissingPrerequisiteError(importMsg)) {
                  throw e;
                }

                hubLog(
                  'warn',
                  'Peer sync bundle import missing prerequisites; retrying with full source bundle',
                  {
                    sourceDroneName,
                    targetDroneName,
                    importRefName,
                    error: importMsg,
                  },
                );

                const deltaExportPath = exportPath;
                const fullExported = await exportFullHeadBundleFromDrone({
                  containerName: source.containerName,
                  repoPathInContainer: sourceRepoPathInContainer,
                  outDir: patchesOutRoot,
                  label: sourceDroneName,
                });
                exportPath = fullExported.exportedPath;
                usedFullBundleFallback = true;

                try {
                  await fs.rm(deltaExportPath, { recursive: true, force: true });
                } catch {
                  // ignore cleanup failure
                }

                importRefSha = await importBundleHeadToDroneRef({
                  containerName: target.containerName,
                  repoPathInContainer: targetRepoPathInContainer,
                  hostBundlePath: exportPath,
                  containerBundlePath,
                  refName: importRefName,
                });
              }

              const merge = await runGitInDrone({
                container: target.containerName,
                repoPathInContainer: targetRepoPathInContainer,
                args: ['merge', '--no-ff', importRefName],
              });

              if (merge.code === 0) {
                const head = await runGitInDroneOrThrow({
                  container: target.containerName,
                  repoPathInContainer: targetRepoPathInContainer,
                  args: ['rev-parse', 'HEAD'],
                });
                mergeCommitSha = parseShaFromText(head.stdout) ?? '';
                const subject = await runGitInDrone({
                  container: target.containerName,
                  repoPathInContainer: targetRepoPathInContainer,
                  args: ['log', '-1', '--format=%s', 'HEAD'],
                });
                if (subject.code === 0) {
                  mergeCommitSubject = String(subject.stdout ?? '')
                    .trim()
                    .split(/\r?\n/, 1)[0]
                    ?.trim();
                }
                return { ok: true as const, noChanges: false as const };
              }

              const combined =
                `${String(merge.stderr ?? '')}\n${String(merge.stdout ?? '')}`.trim();
              const conflictFiles = Array.from(
                new Set([
                  ...parseMergeConflictFilesFromText(combined),
                  ...(await droneUnmergedFiles({
                    containerName: target.containerName,
                    repoPathInContainer: targetRepoPathInContainer,
                  })),
                ]),
              ).sort((a, b) => a.localeCompare(b));
              const looksLikeUnrelatedHistories = looksLikeUnrelatedHistoriesError(combined);
              const looksLikeConflict =
                conflictFiles.length > 0 ||
                /CONFLICT|Automatic merge failed|Merge conflict/i.test(combined);
              const details = (
                merge.stderr ||
                merge.stdout ||
                `git merge failed (exit ${merge.code})`
              ).trim();

              if (looksLikeUnrelatedHistories) {
                return {
                  ok: false as const,
                  code: 'target_unrelated_history' as const,
                  details:
                    `${details}\n\n` +
                    (usedFullBundleFallback
                      ? 'The source bundle was imported with a full-history fallback, but Git found no shared history with the target drone. '
                      : 'Git found no shared history between the source and target drone branches. ') +
                    'Re-seed the target drone, or use an explicit patch/unrelated-history workflow.',
                  conflictFiles: [] as string[],
                  looksLikeConflict: false,
                  usedFullBundleFallback,
                };
              }

              if (!looksLikeConflict) {
                try {
                  await runGitInDrone({
                    container: target.containerName,
                    repoPathInContainer: targetRepoPathInContainer,
                    args: ['merge', '--abort'],
                  });
                } catch {
                  // ignore cleanup failure
                }
              }

              return {
                ok: false as const,
                code: null,
                details,
                conflictFiles,
                looksLikeConflict,
                usedFullBundleFallback,
              };
            },
          );

          if (transferResult.ok && transferResult.noChanges) {
            if (!probeOnly) {
              await setDroneHubMetaByIdentity({ droneId: targetDroneId, hub: null });
            }
            json(res, 200, {
              ok: true,
              mode: 'no-changes',
              noChanges: true,
              sourceDroneId,
              sourceDroneName,
              targetDroneId,
              targetDroneName,
              sourceDirtyFileCount,
              sourceAutoCommitSha,
              sourceAutoCommitMessage,
            });
            return;
          }

          if (!transferResult.ok && transferResult.code === 'source_drone_dirty') {
            if (!probeOnly) {
              await setDroneHubMetaByIdentity({ droneId: targetDroneId, hub: null });
            }
            json(res, 409, {
              ok: false,
              error: transferResult.details,
              code: transferResult.code,
              dirtyFileCount: sourceDirtyFileCount,
              autoCommitMessage,
              sourceDroneId,
              sourceDroneName,
              targetDroneId,
              targetDroneName,
            });
            return;
          }

          if (!transferResult.ok && transferResult.code === 'target_drone_dirty') {
            if (!probeOnly) {
              await setDroneHubMetaByIdentity({ droneId: targetDroneId, hub: null });
            }
            json(res, 409, {
              ok: false,
              error: transferResult.details,
              code: transferResult.code,
              sourceDroneId,
              sourceDroneName,
              targetDroneId,
              targetDroneName,
            });
            return;
          }

          if (!transferResult.ok && transferResult.code === 'target_unrelated_history') {
            if (!probeOnly) {
              await setDroneHubMetaByIdentity({
                droneId: targetDroneId,
                hub: { phase: 'error', message: 'Peer sync stopped: unrelated Git histories' },
              });
            }
            json(res, 409, {
              ok: false,
              error: transferResult.details,
              code: transferResult.code,
              usedFullBundleFallback: transferResult.usedFullBundleFallback,
              sourceDroneId,
              sourceDroneName,
              targetDroneId,
              targetDroneName,
            });
            return;
          }

          if (transferResult.ok) {
            if (!probeOnly) {
              await setDroneHubMetaByIdentity({ droneId: targetDroneId, hub: null });
            }
            json(res, 200, {
              ok: true,
              mode: probeOnly ? 'ready' : 'peer-merge-commit',
              sourceDroneId,
              sourceDroneName,
              targetDroneId,
              targetDroneName,
              importedRef: importRefName || null,
              importedRefSha: importRefSha || null,
              mergeCommitSha: mergeCommitSha || null,
              mergeCommitSubject: mergeCommitSubject || null,
              sourceDirtyFileCount,
              sourceAutoCommitSha,
              sourceAutoCommitMessage,
            });
            return;
          }

          if (transferResult.looksLikeConflict) {
            const guidance = [
              'Conflicts were left in the target drone repo as a normal Git merge conflict state.',
              'Conflict marker mapping: <<<<<<< ours is the current target drone branch; >>>>>>> theirs is the pulled source drone branch.',
              'Resolve conflicts inside the target drone, then stage and commit to finish the merge.',
            ].join(' ');
            const fullMsg = `${transferResult.details}\n\n${guidance}`;
            if (!probeOnly) {
              await setDroneHubMetaByIdentity({
                droneId: targetDroneId,
                hub: {
                  phase: 'error',
                  message: `Peer sync conflict${importRefName ? ` (${importRefName})` : ''}: resolve conflicts in target drone`,
                },
              });
            }
            json(res, 409, {
              ok: false,
              error: fullMsg,
              code: 'target_conflicts_ready',
              patchName: importRefName || null,
              conflictFiles: transferResult.conflictFiles,
              importedRef: importRefName || null,
              importedRefSha: importRefSha || null,
              sourceDroneId,
              sourceDroneName,
              targetDroneId,
              targetDroneName,
            });
            return;
          }

          throw new Error(transferResult.details || 'peer repo sync failed');
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (looksLikeBundleMissingPrerequisiteError(msg)) {
            if (!probeOnly) {
              await setDroneHubMetaByIdentity({
                droneId: targetDroneId,
                hub: { phase: 'error', message: 'Peer sync needs reseed (history mismatch)' },
              });
            }
            json(res, 409, {
              ok: false,
              error:
                'Target drone is missing prerequisite commits for this source export. Re-seed or re-clone the target drone and sync again.',
              code: 'bundle_missing_prereq',
              reseedRequired: true,
              sourceDroneId,
              sourceDroneName,
              targetDroneId,
              targetDroneName,
            });
            return;
          }

          if (!probeOnly) {
            await setDroneHubMetaByIdentity({
              droneId: targetDroneId,
              hub: { phase: 'error', message: `Peer sync failed: ${msg}` },
            });
          }
          json(res, 500, {
            ok: false,
            error: msg,
            code: null,
            patchName: null,
            conflictFiles: [],
            sourceDroneId,
            sourceDroneName,
            targetDroneId,
            targetDroneName,
          });
          return;
        } finally {
          if (exportPath) {
            try {
              await fs.rm(exportPath, { recursive: true, force: true });
            } catch {
              // ignore cleanup failure
            }
          }

          if (importRefName || containerBundlePath) {
            try {
              await withLockedDroneContainer(
                { requestedDroneName: targetDroneName, droneEntry: targetEntry },
                async ({ containerName }: any) => {
                  const targetRepoPathInContainer =
                    String(targetEntry?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
                  if (importRefName) {
                    await runGitInDrone({
                      container: containerName,
                      repoPathInContainer: targetRepoPathInContainer,
                      args: ['update-ref', '-d', importRefName],
                    });
                  }
                  if (containerBundlePath) {
                    await dvmExec(containerName, 'bash', [
                      '-lc',
                      `rm -f ${JSON.stringify(containerBundlePath)} || true`,
                    ]);
                  }
                },
              );
            } catch {
              // ignore cleanup failure
            }
          }
        }
      }

      return false;
    })();
    return handled !== false;
  };
}
