import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
  AgentRunFileChangeStatus,
  AgentRunFileChangeWorkspace,
} from '@blip/protocol';

import { dvmExec } from '../host/dvm';
import { normalizeDroneRuntime } from '../host/runtime';
import { ensureAssistantArtifactsRoot } from './assistant-artifacts';
import {
  persistAgentRunDiffArtifact,
  type AgentRunDiffArtifactOwner,
} from './agent-run-diff-artifacts';

const MAX_PERSISTED_FILES_PER_WORKSPACE = 200;

type GitResult = { code: number; stdout: string; stderr: string };
type GitRunner = (args: string[], env?: Record<string, string>) => Promise<GitResult>;

export type AgentRunFileChangesBaseline = {
  version: 1;
  capturedAt: string;
  targetId: string;
  droneId?: string;
  label: string;
  repoRoot: string;
  treeOid: string;
  owner: AgentRunDiffArtifactOwner;
};

export type AssistantArtifactRunFileChangesBaseline = AgentRunFileChangesBaseline & {
  threadId: string;
  temporaryGitDir: string;
};

function isRepoAttachedDrone(drone: any): boolean {
  if (!drone || typeof drone !== 'object') return false;
  if (typeof drone.repoAttached === 'boolean') return drone.repoAttached;
  return Boolean(
    String(drone.repoPath ?? '').trim() ||
      String(drone.repo?.dest ?? '').trim() ||
      String(drone.repo?.seededAt ?? '').trim(),
  );
}

function gitError(args: string[], result: GitResult): Error {
  return new Error(
    String(result.stderr || result.stdout || `git ${args.join(' ')} failed (${result.code})`).trim(),
  );
}

async function gitOrThrow(runGit: GitRunner, args: string[], env?: Record<string, string>) {
  const result = await runGit(args, env);
  if (result.code !== 0) throw gitError(args, result);
  return result.stdout;
}

async function runHostCommand(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<GitResult> {
  return await new Promise<GitResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: Number(code ?? 1), stdout, stderr }));
  });
}

function hostGitRunner(repoPath: string): GitRunner {
  return (args, env) => runHostCommand('git', ['-C', repoPath, ...args], env);
}

function droneGitRunner(container: string, repoPath: string): GitRunner {
  return async (args, env) => {
    const environment = Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`);
    return await dvmExec(
      container,
      environment.length > 0 ? 'env' : 'git',
      environment.length > 0
        ? [...environment, 'git', '-C', repoPath, ...args]
        : ['-C', repoPath, ...args],
    );
  };
}

async function captureTree(
  runGit: GitRunner,
  indexPath: string,
  cleanup: () => Promise<void>,
): Promise<{ repoRoot: string; treeOid: string }> {
  const indexEnv = { GIT_INDEX_FILE: indexPath };
  try {
    const repoRoot = (await gitOrThrow(runGit, ['rev-parse', '--show-toplevel'])).trim();
    const readHead = await runGit(['read-tree', 'HEAD'], indexEnv);
    if (readHead.code !== 0) await gitOrThrow(runGit, ['read-tree', '--empty'], indexEnv);
    await gitOrThrow(runGit, ['add', '-A', '--', ':/'], indexEnv);
    const treeOid = (await gitOrThrow(runGit, ['write-tree'], indexEnv)).trim().toLowerCase();
    if (!/^[0-9a-f]{40,64}$/.test(treeOid)) throw new Error('git returned an invalid tree id');
    return { repoRoot: repoRoot || '.', treeOid };
  } finally {
    await cleanup().catch(() => undefined);
  }
}

function parseNameStatus(raw: string): Array<{
  path: string;
  originalPath: string | null;
  status: AgentRunFileChangeStatus;
}> {
  const fields = raw.split('\0');
  const entries: Array<{
    path: string;
    originalPath: string | null;
    status: AgentRunFileChangeStatus;
  }> = [];
  for (let index = 0; index < fields.length; ) {
    const code = String(fields[index++] ?? '').trim();
    if (!code) continue;
    const firstPath = String(fields[index++] ?? '');
    if (!firstPath) continue;
    const marker = code[0] ?? '';
    const originalPath = marker === 'R' || marker === 'C' ? firstPath : null;
    const nextPath = originalPath ? String(fields[index++] ?? '') : firstPath;
    if (!nextPath) continue;
    const status: AgentRunFileChangeStatus =
      marker === 'A'
        ? 'added'
        : marker === 'M'
          ? 'modified'
          : marker === 'D'
            ? 'deleted'
            : marker === 'R'
              ? 'renamed'
              : marker === 'C'
                ? 'copied'
                : marker === 'T'
                  ? 'type-changed'
                  : marker === 'U'
                    ? 'unmerged'
                    : 'unknown';
    entries.push({ path: nextPath, originalPath, status });
  }
  return entries;
}

function parseNumstat(raw: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const fields = raw.split('\0');
  const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (let index = 0; index < fields.length; ) {
    const header = String(fields[index++] ?? '');
    if (!header) continue;
    const firstTab = header.indexOf('\t');
    const secondTab = firstTab < 0 ? -1 : header.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const additionsRaw = header.slice(0, firstTab);
    const deletionsRaw = header.slice(firstTab + 1, secondTab);
    let filePath = header.slice(secondTab + 1);
    if (!filePath) {
      index += 1; // original path for a rename/copy
      filePath = String(fields[index++] ?? '');
    }
    if (!filePath) continue;
    const binary = additionsRaw === '-' || deletionsRaw === '-';
    stats.set(filePath, {
      additions: binary ? 0 : Math.max(0, Number(additionsRaw) || 0),
      deletions: binary ? 0 : Math.max(0, Number(deletionsRaw) || 0),
      binary,
    });
  }
  return stats;
}

function splitGitPatches(raw: string): string[] {
  const starts: number[] = [];
  if (raw.startsWith('diff --git ')) starts.push(0);
  let cursor = 0;
  while (cursor < raw.length) {
    const next = raw.indexOf('\ndiff --git ', cursor);
    if (next < 0) break;
    starts.push(next + 1);
    cursor = next + 1;
  }
  return starts.map((start, index) => raw.slice(start, starts[index + 1] ?? raw.length));
}

async function summarizeTrees(input: {
  baseline: AgentRunFileChangesBaseline;
  currentTreeOid: string;
  runGit: GitRunner;
  repoRoot: string;
}): Promise<AgentRunFileChangeWorkspace | null> {
  if (input.baseline.treeOid === input.currentTreeOid) return null;
  const revisionArgs = [input.baseline.treeOid, input.currentTreeOid];
  const [nameStatusRaw, numstatRaw, patchRaw] = await Promise.all([
    gitOrThrow(input.runGit, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--find-renames',
      '--name-status',
      '-z',
      ...revisionArgs,
    ]),
    gitOrThrow(input.runGit, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--find-renames',
      '--numstat',
      '-z',
      ...revisionArgs,
    ]),
    gitOrThrow(input.runGit, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--find-renames',
      '--unified=3',
      ...revisionArgs,
    ]),
  ]);
  const statusEntries = parseNameStatus(nameStatusRaw);
  if (statusEntries.length === 0) return null;
  const patchChunks = splitGitPatches(patchRaw);
  const patchesByPath =
    patchChunks.length === statusEntries.length
      ? new Map(statusEntries.map((entry, index) => [entry.path, patchChunks[index]!]))
      : null;
  const stats = parseNumstat(numstatRaw);
  const entries: AgentRunFileChangeEntry[] = statusEntries.map((entry) => {
    const stat = stats.get(entry.path) ?? { additions: 0, deletions: 0, binary: false };
    return {
      path: entry.path,
      ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
      status: entry.status,
      additions: stat.additions,
      deletions: stat.deletions,
      ...(stat.binary ? { binary: true } : {}),
    };
  });
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
  const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);
  const truncated = entries.length > MAX_PERSISTED_FILES_PER_WORKSPACE;
  const persistedEntries = entries.slice(0, MAX_PERSISTED_FILES_PER_WORKSPACE);
  const diffArtifactId = await persistAgentRunDiffArtifact({
    owner: input.baseline.owner ?? { droneId: input.baseline.droneId },
    targetId: input.baseline.targetId,
    label: input.baseline.label,
    entries: persistedEntries,
    readPatch: async (entry) => {
      const combinedPatch = patchesByPath?.get(entry.path);
      if (combinedPatch != null) return combinedPatch;
      const paths = [
        ...new Set(
          [entry.originalPath, entry.path].filter((value): value is string => Boolean(value)),
        ),
      ];
      return await gitOrThrow(input.runGit, [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--find-renames',
        '--unified=3',
        ...revisionArgs,
        '--',
        ...paths,
      ]);
    },
  }).catch(() => null);
  return {
    targetId: input.baseline.targetId,
    ...(input.baseline.droneId ? { droneId: input.baseline.droneId } : {}),
    label: input.baseline.label,
    repoRoot: input.repoRoot,
    ...(diffArtifactId ? { diffArtifactId } : {}),
    counts: { changed: entries.length, additions, deletions },
    entries: persistedEntries,
    ...(truncated ? { truncated: true } : {}),
  };
}

function droneCaptureTarget(droneId: string, drone: any): {
  label: string;
  repoPath: string;
  indexPath: string;
  runGit: GitRunner;
  cleanup: () => Promise<void>;
} | null {
  if (!isRepoAttachedDrone(drone)) return null;
  const label = String(drone?.name ?? droneId).trim() || droneId;
  const token = crypto.randomUUID();
  if (normalizeDroneRuntime(drone?.runtime) === 'host') {
    const repoPath = String(drone?.repoPath ?? '').trim();
    if (!repoPath || !path.isAbsolute(repoPath)) return null;
    const indexPath = path.join(os.tmpdir(), `drone-run-changes-${token}.index`);
    return {
      label,
      repoPath,
      indexPath,
      runGit: hostGitRunner(repoPath),
      cleanup: async () => {
        await Promise.all(
          [indexPath, `${indexPath}.lock`].map(async (filePath) => {
            await fs.unlink(filePath).catch((error: any) => {
              if (error?.code !== 'ENOENT') throw error;
            });
          }),
        );
      },
    };
  }
  const container = String(drone?.containerName ?? drone?.name ?? droneId).trim() || droneId;
  const repoPath = String(drone?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
  const indexPath = `/tmp/drone-run-changes-${token}.index`;
  return {
    label,
    repoPath,
    indexPath,
    runGit: droneGitRunner(container, repoPath),
    cleanup: async () => {
      await dvmExec(container, 'rm', ['-f', '--', indexPath, `${indexPath}.lock`]);
    },
  };
}

export async function captureDroneRunFileChangesBaseline(input: {
  droneId: string;
  drone: any;
  owner?: Omit<AgentRunDiffArtifactOwner, 'droneId'>;
}): Promise<AgentRunFileChangesBaseline | null> {
  const droneId = String(input.droneId ?? '').trim();
  const target = droneId ? droneCaptureTarget(droneId, input.drone) : null;
  if (!target) return null;
  const snapshot = await captureTree(target.runGit, target.indexPath, target.cleanup);
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    targetId: `drone:${droneId}`,
    droneId,
    label: target.label,
    repoRoot: snapshot.repoRoot,
    treeOid: snapshot.treeOid,
    owner: { droneId, ...(input.owner ?? {}) },
  };
}

export async function finalizeDroneRunFileChanges(input: {
  baseline: AgentRunFileChangesBaseline;
  drone: any;
}): Promise<AgentRunFileChanges | null> {
  if (input.baseline?.version !== 1) return null;
  const droneId = String(input.baseline.droneId ?? '').trim();
  if (!droneId) return null;
  const target = droneCaptureTarget(droneId, input.drone);
  if (!target) return null;
  const current = await captureTree(target.runGit, target.indexPath, target.cleanup);
  const workspace = await summarizeTrees({
    baseline: input.baseline,
    currentTreeOid: current.treeOid,
    runGit: target.runGit,
    repoRoot: current.repoRoot,
  });
  return workspace ? combineAgentRunFileChanges([workspace]) : null;
}

function assistantArtifactGitRunner(gitDir: string, workTree: string): GitRunner {
  return (args, env) =>
    runHostCommand('git', ['--git-dir', gitDir, '--work-tree', workTree, ...args], env);
}

async function captureAssistantArtifactTree(runGit: GitRunner): Promise<string> {
  await gitOrThrow(runGit, ['add', '-A', '--', ':/']);
  const treeOid = (await gitOrThrow(runGit, ['write-tree'])).trim().toLowerCase();
  if (!/^[0-9a-f]{40,64}$/.test(treeOid)) throw new Error('git returned an invalid tree id');
  return treeOid;
}

export async function captureAssistantArtifactRunFileChangesBaseline(input: {
  threadId: string;
  turnId: string;
}): Promise<AssistantArtifactRunFileChangesBaseline> {
  const threadId = String(input.threadId ?? '').trim();
  const turnId = String(input.turnId ?? '').trim();
  if (!threadId || !turnId) throw new Error('threadId and turnId are required');
  const repoRoot = await ensureAssistantArtifactsRoot(threadId);
  const temporaryGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-artifact-run-changes-'));
  try {
    await gitOrThrow((args) => runHostCommand('git', args), [
      'init',
      '--bare',
      '--quiet',
      temporaryGitDir,
    ]);
    await fs.writeFile(path.join(temporaryGitDir, 'info', 'exclude'), '.*\n**/.*\n', 'utf8');
    const runGit = assistantArtifactGitRunner(temporaryGitDir, repoRoot);
    await gitOrThrow(runGit, ['read-tree', '--empty']);
    const treeOid = await captureAssistantArtifactTree(runGit);
    return {
      version: 1,
      capturedAt: new Date().toISOString(),
      targetId: `artifacts:${threadId}`,
      label: 'Artifacts',
      repoRoot,
      treeOid,
      owner: { threadId, turnId },
      threadId,
      temporaryGitDir,
    };
  } catch (error) {
    await fs.rm(temporaryGitDir, { recursive: true, force: true });
    throw error;
  }
}

export async function finalizeAssistantArtifactRunFileChanges(input: {
  baseline: AssistantArtifactRunFileChangesBaseline;
}): Promise<AgentRunFileChangeWorkspace | null> {
  const baseline = input.baseline;
  try {
    const runGit = assistantArtifactGitRunner(baseline.temporaryGitDir, baseline.repoRoot);
    const currentTreeOid = await captureAssistantArtifactTree(runGit);
    return await summarizeTrees({
      baseline,
      currentTreeOid,
      runGit,
      repoRoot: baseline.repoRoot,
    });
  } finally {
    await fs.rm(baseline.temporaryGitDir, { recursive: true, force: true });
  }
}

export async function discardAssistantArtifactRunFileChangesBaseline(
  baseline: AssistantArtifactRunFileChangesBaseline,
): Promise<void> {
  await fs.rm(baseline.temporaryGitDir, { recursive: true, force: true });
}

export function combineAgentRunFileChanges(
  workspaces: AgentRunFileChangeWorkspace[],
): AgentRunFileChanges | null {
  const visible = workspaces.filter((workspace) => workspace.counts.changed > 0);
  if (visible.length === 0) return null;
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    counts: {
      changed: visible.reduce((sum, workspace) => sum + workspace.counts.changed, 0),
      additions: visible.reduce((sum, workspace) => sum + workspace.counts.additions, 0),
      deletions: visible.reduce((sum, workspace) => sum + workspace.counts.deletions, 0),
    },
    workspaces: visible,
    ...(visible.some((workspace) => workspace.truncated) ? { truncated: true } : {}),
  };
}

export async function finalizeDroneRunFileChangesWorkspace(input: {
  baseline: AgentRunFileChangesBaseline;
  drone: any;
}): Promise<AgentRunFileChangeWorkspace | null> {
  return (await finalizeDroneRunFileChanges(input))?.workspaces[0] ?? null;
}

export function isMutatingWorkspaceTool(toolNameRaw: unknown): boolean {
  const toolName = String(toolNameRaw ?? '').trim();
  return (
    toolName === 'bash' ||
    toolName === 'write_file' ||
    toolName === 'apply_patch' ||
    toolName === 'delete_file' ||
    toolName === 'move_path' ||
    toolName === 'move_file' ||
    toolName === 'create_directory' ||
    toolName === 'delete_directory' ||
    toolName === 'transfer_mkdir' ||
    toolName === 'transfer_prepare' ||
    toolName === 'transfer_write' ||
    toolName === 'transfer_commit'
  );
}
