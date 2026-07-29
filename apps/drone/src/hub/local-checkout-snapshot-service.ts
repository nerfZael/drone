import fs from 'node:fs/promises';
import {
  LocalCheckoutError,
  normalizedGitSha,
  type LocalSnapshotKind,
  type RunResult,
} from './local-checkout-model';

export type LocalCheckoutSnapshotDependencies = {
  droneRootPath: (...segments: string[]) => string;
  gitResolveCommitSha: (repoRoot: string, ref: string) => Promise<string | null>;
  updateHostRef: (opts: { repoRoot: string; refName: string; target: string }) => Promise<void>;
  importBundleHeadToHostRef: (opts: {
    repoRoot: string;
    bundlePath: string;
    refName: string;
  }) => Promise<string>;
  dvmExec: (container: string, cmd: string, args: string[]) => Promise<RunResult>;
  dvmRepoExport: (opts: {
    container: string;
    repoPathInContainer?: string;
    outDir: string;
    format?: 'patches' | 'bundle' | 'diff';
    base?: string;
    head?: string;
    full?: boolean;
  }) => Promise<{ exportedPath: string }>;
};

export type CapturedLocalSnapshot = {
  containerName: string;
  repoPathInContainer: string;
  containerRef: string;
  baseSha: string | null;
  headSha: string;
  treeSha: string;
  snapshotSha: string;
  kind: LocalSnapshotKind;
  dirtyFileCount: number;
};

function safeRefSegment(value: unknown): string {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'drone'
  );
}

function commandDetails(result: RunResult): string {
  return `${String(result.stderr ?? '')}\n${String(result.stdout ?? '')}`.trim();
}

export class LocalCheckoutSnapshotService {
  private readonly deps: LocalCheckoutSnapshotDependencies;

  constructor(deps: LocalCheckoutSnapshotDependencies) {
    this.deps = deps;
  }

  async captureAndImport(options: {
    droneId: string;
    drone: any;
    repoRoot: string;
    includeDirty: boolean;
  }): Promise<CapturedLocalSnapshot> {
    const snapshot = await this.capture(options);
    const existing = await this.deps.gitResolveCommitSha(options.repoRoot, snapshot.snapshotSha);
    const hostRef = `refs/drone/local/${safeRefSegment(options.droneId)}`;
    if (existing === snapshot.snapshotSha) {
      await this.deps.updateHostRef({
        repoRoot: options.repoRoot,
        refName: hostRef,
        target: snapshot.snapshotSha,
      });
      return snapshot;
    }

    const outDir = this.deps.droneRootPath('repo-exports');
    let exportPath = '';
    try {
      try {
        if (!snapshot.baseSha) throw new Error('missing incremental bundle base');
        const exported = await this.deps.dvmRepoExport({
          container: snapshot.containerName,
          repoPathInContainer: snapshot.repoPathInContainer,
          outDir,
          format: 'bundle',
          base: snapshot.baseSha,
          head: snapshot.containerRef,
        });
        exportPath = exported.exportedPath;
        const importedSha = await this.deps.importBundleHeadToHostRef({
          repoRoot: options.repoRoot,
          bundlePath: exportPath,
          refName: hostRef,
        });
        this.assertImported(snapshot, importedSha);
      } catch {
        if (exportPath) await fs.rm(exportPath, { recursive: true, force: true }).catch(() => {});
        const exported = await this.deps.dvmRepoExport({
          container: snapshot.containerName,
          repoPathInContainer: snapshot.repoPathInContainer,
          outDir,
          format: 'bundle',
          head: snapshot.containerRef,
          full: true,
        });
        exportPath = exported.exportedPath;
        const importedSha = await this.deps.importBundleHeadToHostRef({
          repoRoot: options.repoRoot,
          bundlePath: exportPath,
          refName: hostRef,
        });
        this.assertImported(snapshot, importedSha);
      }
    } finally {
      if (exportPath) await fs.rm(exportPath, { recursive: true, force: true }).catch(() => {});
    }
    return snapshot;
  }

  async capture(options: {
    droneId: string;
    drone: any;
    includeDirty: boolean;
  }): Promise<CapturedLocalSnapshot> {
    const containerName =
      String(options.drone?.containerName ?? options.drone?.name ?? options.droneId).trim() ||
      options.droneId;
    const repoPathInContainer =
      String(options.drone?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
    const refName = `refs/drone/local-snapshots/${safeRefSegment(options.droneId)}`;
    const tempIndex = `/tmp/drone-hub-local-${safeRefSegment(options.droneId)}.index`;
    const script = [
      'set -euo pipefail',
      `cd ${JSON.stringify(repoPathInContainer)}`,
      'head_sha=$(git rev-parse HEAD)',
      'head_tree=$(git rev-parse HEAD^{tree})',
      'base_sha=$(git config --get dvm.baseSha 2>/dev/null || true)',
      'dirty_count=$(git status --porcelain --untracked-files=all | wc -l | tr -d " ")',
      `snapshot_ref=${JSON.stringify(refName)}`,
      options.includeDirty
        ? [
            `tmp_index=${JSON.stringify(tempIndex)}`,
            'rm -f "$tmp_index"',
            'trap \'rm -f "$tmp_index"\' EXIT',
            'GIT_INDEX_FILE="$tmp_index" git read-tree HEAD',
            'GIT_INDEX_FILE="$tmp_index" git add -A -- .',
            'tree_sha=$(GIT_INDEX_FILE="$tmp_index" git write-tree)',
            'if [ "$tree_sha" = "$head_tree" ]; then',
            '  snapshot_sha="$head_sha"',
            'else',
            '  snapshot_sha=$(printf "%s\\n" "chore(drone): local working snapshot" | GIT_AUTHOR_NAME="Drone Hub" GIT_AUTHOR_EMAIL="drone-hub@local" GIT_COMMITTER_NAME="Drone Hub" GIT_COMMITTER_EMAIL="drone-hub@local" GIT_AUTHOR_DATE="2000-01-01T00:00:00Z" GIT_COMMITTER_DATE="2000-01-01T00:00:00Z" git commit-tree "$tree_sha" -p "$head_sha")',
            'fi',
          ].join('\n')
        : ['tree_sha="$head_tree"', 'snapshot_sha="$head_sha"'].join('\n'),
      'git update-ref "$snapshot_ref" "$snapshot_sha"',
      'printf "DRONE_LOCAL_SNAPSHOT\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$head_sha" "$tree_sha" "$snapshot_sha" "$dirty_count" "$base_sha"',
    ].join('\n');
    const result = await this.deps.dvmExec(containerName, 'bash', ['-lc', script]);
    if (result.code !== 0) {
      throw new LocalCheckoutError(
        'snapshot_failed',
        `Could not capture the drone repository state.\n\n${commandDetails(result)}`,
      );
    }
    const marker = String(result.stdout ?? '')
      .split(/\r?\n/)
      .find((line) => line.startsWith('DRONE_LOCAL_SNAPSHOT\t'));
    const fields = marker?.split('\t') ?? [];
    const headSha = normalizedGitSha(fields[1]);
    const treeSha = normalizedGitSha(fields[2]);
    const snapshotSha = normalizedGitSha(fields[3]);
    const baseSha = normalizedGitSha(fields[5]);
    if (!headSha || !treeSha || !snapshotSha) {
      throw new LocalCheckoutError(
        'snapshot_failed',
        'DroneHub could not parse the captured repository snapshot.',
      );
    }
    return {
      containerName,
      repoPathInContainer,
      containerRef: refName,
      baseSha,
      headSha,
      treeSha,
      snapshotSha,
      kind: snapshotSha === headSha ? 'commit' : 'working-tree',
      dirtyFileCount: Math.max(0, Number(fields[4]) || 0),
    };
  }

  async promoteWorkingSnapshot(options: {
    snapshot: CapturedLocalSnapshot;
    expectedTreeSha: string;
  }): Promise<string> {
    const snapshot = options.snapshot;
    const script = [
      'set -euo pipefail',
      `cd ${JSON.stringify(snapshot.repoPathInContainer)}`,
      `expected_head=${JSON.stringify(snapshot.headSha)}`,
      `snapshot_ref=${JSON.stringify(snapshot.containerRef)}`,
      `expected_tree=${JSON.stringify(options.expectedTreeSha)}`,
      'current_head=$(git rev-parse HEAD)',
      '[ "$current_head" = "$expected_head" ] || { echo "Drone HEAD changed before snapshot promotion." >&2; exit 42; }',
      'snapshot_tree=$(git rev-parse "$snapshot_ref^{tree}")',
      '[ "$snapshot_tree" = "$expected_tree" ] || { echo "Drone working tree changed before snapshot promotion." >&2; exit 43; }',
      'commit_sha=$(printf "%s\\n" "chore(drone): snapshot working tree before apply changes" | GIT_AUTHOR_NAME="Drone Hub" GIT_AUTHOR_EMAIL="drone-hub@local" GIT_COMMITTER_NAME="Drone Hub" GIT_COMMITTER_EMAIL="drone-hub@local" git commit-tree "$snapshot_tree" -p "$expected_head")',
      'git update-ref HEAD "$commit_sha" "$expected_head"',
      'git reset --mixed HEAD >/dev/null',
      'test -z "$(git status --porcelain --untracked-files=all)" || { echo "Drone working tree changed while promoting snapshot." >&2; exit 44; }',
      'printf "DRONE_LOCAL_PROMOTED\\t%s\\n" "$commit_sha"',
    ].join('\n');
    const result = await this.deps.dvmExec(snapshot.containerName, 'bash', ['-lc', script]);
    const marker = String(result.stdout ?? '')
      .split(/\r?\n/)
      .find((line) => line.startsWith('DRONE_LOCAL_PROMOTED\t'));
    const sha = normalizedGitSha(marker?.split('\t')[1]);
    if (result.code !== 0 || !sha) {
      throw new LocalCheckoutError(
        'snapshot_promotion_failed',
        `The drone changed before its tested snapshot could be committed.\n\n${commandDetails(result)}`,
      );
    }
    return sha;
  }

  private assertImported(snapshot: CapturedLocalSnapshot, importedSha: string): void {
    if (normalizedGitSha(importedSha) !== snapshot.snapshotSha) {
      throw new LocalCheckoutError(
        'snapshot_import_mismatch',
        'The imported drone snapshot did not match the captured commit.',
        500,
      );
    }
  }
}
