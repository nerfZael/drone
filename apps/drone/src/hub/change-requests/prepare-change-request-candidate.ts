import { ChangeRequestError } from './change-request-error';
import { runChangeRequestGit, type RunHostCommand } from './change-request-git';

export type PreparedChangeRequestCandidate =
  | {
      status: 'ready';
      baseSha: string;
      candidateTreeSha: string;
      changed: boolean;
    }
  | {
      status: 'conflicted';
      baseSha: string;
      conflictFiles: string[];
    };

/**
 * Computes the squash candidate as Git trees without touching an index or worktree.
 * Callers choose the base SHA so review/merge can use the destination authority
 * while checkout apply can use the checkout's exact observed HEAD.
 */
export async function prepareChangeRequestCandidate(
  runHostCommand: RunHostCommand,
  input: {
    gitRoot: string;
    baseSha: string;
    snapshotRef: string;
    timeoutMs?: number;
  },
): Promise<PreparedChangeRequestCandidate> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const merged = await runHostCommand(
    'git',
    [
      '-C',
      input.gitRoot,
      'merge-tree',
      '--write-tree',
      '--name-only',
      '-z',
      '--messages',
      input.baseSha,
      input.snapshotRef,
    ],
    { timeoutMs },
  );
  const output = `${merged.stdout}\n${merged.stderr}`.trim();
  const parsed = parseMergeTreeOutput(merged.stdout);
  const candidateTreeSha = parsed.candidateTreeSha;
  if (merged.code === 1 && candidateTreeSha) {
    return {
      status: 'conflicted',
      baseSha: input.baseSha,
      conflictFiles: parsed.conflictFiles,
    };
  }
  if (merged.code !== 0) {
    throw new ChangeRequestError(
      output || 'Unable to prepare the change-request candidate.',
      409,
      'git_failed',
    );
  }

  if (!candidateTreeSha) {
    throw new ChangeRequestError(
      'Git did not return a tree for the prepared change-request candidate.',
      409,
      'git_failed',
    );
  }
  const baseTreeSha = (
    await runChangeRequestGit(
      runHostCommand,
      input.gitRoot,
      ['rev-parse', `${input.baseSha}^{tree}`],
      timeoutMs,
    )
  ).stdout
    .trim()
    .toLowerCase();
  return {
    status: 'ready',
    baseSha: input.baseSha,
    candidateTreeSha,
    changed: candidateTreeSha !== baseTreeSha,
  };
}

function parseMergeTreeOutput(output: string): {
  candidateTreeSha: string | null;
  conflictFiles: string[];
} {
  const fields = output.split('\0');
  const candidateTreeSha = fields[0]?.trim().toLowerCase() ?? '';
  const conflictSectionEnd = fields.indexOf('', 1);
  const conflictFiles = [
    ...new Set(
      fields.slice(1, conflictSectionEnd < 0 ? fields.length : conflictSectionEnd).filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
  return {
    candidateTreeSha: /^[0-9a-f]{40}$/.test(candidateTreeSha) ? candidateTreeSha : null,
    conflictFiles,
  };
}
