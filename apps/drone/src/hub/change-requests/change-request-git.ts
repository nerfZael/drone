import type { RunResult } from '../../host/dvm';
import { ChangeRequestError } from './change-request-error';

export type RunHostCommand = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<RunResult>;

export async function runChangeRequestGit(
  runHostCommand: RunHostCommand,
  repoRoot: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<RunResult> {
  const result = await runHostCommand('git', ['-C', repoRoot, ...args], { timeoutMs });
  if (result.code !== 0) {
    throw new ChangeRequestError(
      String(result.stderr || result.stdout || `git ${args[0] ?? 'operation'} failed`).trim(),
      409,
      'git_failed',
    );
  }
  return result;
}

export async function resolveChangeRequestCommit(
  runHostCommand: RunHostCommand,
  repoRoot: string,
  ref: string,
): Promise<string | null> {
  const result = await runHostCommand('git', [
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

export async function resolveChangeRequestBranch(
  runHostCommand: RunHostCommand,
  repoRoot: string,
  branch: string,
): Promise<string | null> {
  for (const candidate of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    if (await resolveChangeRequestCommit(runHostCommand, repoRoot, candidate)) return candidate;
  }
  return null;
}

export function changeRequestConflictFiles(text: string): string[] {
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

export function safeChangeRequestRefSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'request'
  );
}

export function normalizeChangeRequestBranch(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/origin\//, '')
    .replace(/^origin\//, '');
}
