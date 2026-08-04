import { describe, expect, test } from 'bun:test';
import {
  appendDiffExpansionRange,
  buildExplorerTree,
  entryPathExistsInCurrentTree,
  estimateExplorerSidebarWidth,
  explorerNodeEntries,
  flattenVisibleExplorerRows,
  pullRequestStateBadge,
  resolveExplorerSidebarWidthBounds,
  scopedChangesStateKey,
  sameRepoChangesPayload,
  sameRepoPullChangesPayload,
  sameRepoPullRequestChangesPayload,
} from '../src/droneHub/changes/helpers';
import type { RepoChangeEntry, RepoChangesPayload, RepoPullChangesPayload, RepoPullRequestChangesPayload } from '../src/droneHub/types';

function change(path: string): RepoChangeEntry {
  return {
    path,
    originalPath: null,
    code: '??',
    stagedChar: '.',
    unstagedChar: '?',
    stagedType: null,
    unstagedType: 'untracked',
    isUntracked: true,
    isIgnored: false,
    isConflicted: false,
  };
}

describe('changes explorer tree', () => {
  test('collapses linear directory chains while keeping files as leaf nodes', () => {
    const tree = buildExplorerTree([change('src/web/index.html'), change('src/web/main.ts')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: 'dir',
      name: 'src/web',
      path: 'src/web',
      count: 2,
    });
    const top = tree[0];
    if (top.kind !== 'dir' || !top.children) throw new Error('expected top-level directory node');
    expect(top.children.map((node) => node.name)).toEqual(['index.html', 'main.ts']);
    expect(top.children.every((node) => node.kind === 'file')).toBe(true);
  });

  test('does not collapse a directory that has both files and subdirectories', () => {
    const tree = buildExplorerTree([change('src/readme.md'), change('src/web/index.html')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: 'dir',
      name: 'src',
      path: 'src',
      count: 2,
    });
    const src = tree[0];
    if (src.kind !== 'dir' || !src.children) throw new Error('expected src directory node');
    expect(src.children.map((node) => node.name)).toEqual(['web', 'readme.md']);
  });

  test('collapses only through non-branching segments', () => {
    const tree = buildExplorerTree([change('a/b/c/one.ts'), change('a/b/d/two.ts')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: 'dir',
      name: 'a/b',
      path: 'a/b',
      count: 2,
    });
    const top = tree[0];
    if (top.kind !== 'dir' || !top.children) throw new Error('expected top-level directory node');
    expect(top.children.map((node) => node.name)).toEqual(['c', 'd']);
  });

  test('flattens only visible rows based on expanded directories', () => {
    const tree = buildExplorerTree([change('src/deep/a/alpha.ts'), change('src/deep/b/bravo.ts'), change('top.ts')]);
    const rows = flattenVisibleExplorerRows(tree, { 'src/deep': false });
    expect(rows.map((row) => `${row.kind}:${row.depth}:${row.name}`)).toEqual(['dir:0:src/deep', 'file:0:top.ts']);
  });

  test('collects every changed file represented by a directory node', () => {
    const entries = [change('src/deep/a.ts'), change('src/deep/b.ts'), change('src/top.ts')];
    const tree = buildExplorerTree(entries);
    expect(tree).toHaveLength(1);
    expect(explorerNodeEntries(tree[0]).map((entry) => entry.path)).toEqual([
      'src/deep/a.ts',
      'src/deep/b.ts',
      'src/top.ts',
    ]);
  });

  test('estimates width and respects ratio + diff-pane constraints', () => {
    const rows = [
      { kind: 'file' as const, depth: 0, name: 'very-long-file-name-that-needs-room.ts', count: 1 },
      { kind: 'dir' as const, depth: 2, name: 'nested/deep/path', count: 4 },
    ];
    const constrained = estimateExplorerSidebarWidth(rows, 700, {
      minWidthPx: 180,
      maxWidthPx: 360,
      maxWidthRatio: 0.36,
      minDiffWidthPx: 420,
    });
    // 700px panel => max by ratio = 252 and max by min-diff = 280, so hard max is 252.
    expect(constrained).toBeLessThanOrEqual(252);
    expect(constrained).toBeGreaterThanOrEqual(180);

    const veryNarrow = estimateExplorerSidebarWidth(rows, 520, {
      minWidthPx: 180,
      maxWidthPx: 360,
      maxWidthRatio: 0.36,
      minDiffWidthPx: 420,
    });
    // 520px panel leaves only 100px by diff budget, and function keeps a hard floor of 120.
    expect(veryNarrow).toBe(120);
  });

  test('resolves manual width bounds from ratio and diff constraints', () => {
    expect(
      resolveExplorerSidebarWidthBounds(700, {
        minWidthPx: 180,
        maxWidthPx: 360,
        maxWidthRatio: 0.36,
        minDiffWidthPx: 420,
      }),
    ).toEqual({ minWidthPx: 180, maxWidthPx: 252 });

    expect(
      resolveExplorerSidebarWidthBounds(520, {
        minWidthPx: 180,
        maxWidthPx: 360,
        maxWidthRatio: 0.36,
        minDiffWidthPx: 420,
      }),
    ).toEqual({ minWidthPx: 120, maxWidthPx: 120 });
  });
});

describe('changes file actions', () => {
  test('uses the shared GitHub state colors for open and merged pull requests', () => {
    expect(pullRequestStateBadge('open')?.className).toContain('green');
    expect(pullRequestStateBadge('merged')?.className).toContain('accent');
    expect(pullRequestStateBadge('closed')?.className).toContain('red');
  });

  test('scopes cached state keys by drone identity', () => {
    expect(scopedChangesStateKey('drone-a', 'wt\u0000unstaged\u0000src/app.ts')).toBe('drone-a\u0000wt\u0000unstaged\u0000src/app.ts');
    expect(scopedChangesStateKey('drone-b', 'wt\u0000unstaged\u0000src/app.ts')).toBe('drone-b\u0000wt\u0000unstaged\u0000src/app.ts');
    expect(scopedChangesStateKey('drone-a', 'wt\u0000unstaged\u0000src/app.ts')).not.toBe(
      scopedChangesStateKey('drone-b', 'wt\u0000unstaged\u0000src/app.ts'),
    );
  });

  test('merges overlapping and adjacent expansion ranges', () => {
    expect(
      appendDiffExpansionRange(
        [
          { start: 10, end: 20 },
          { start: 30, end: 40 },
        ],
        { start: 20, end: 30 },
      ),
    ).toEqual([{ start: 10, end: 40 }]);

    expect(
      appendDiffExpansionRange([{ start: 10, end: 20 }], { start: 12, end: 18 }),
    ).toEqual([{ start: 10, end: 20 }]);
  });

  test('detects whether a changed path still exists for editor open actions', () => {
    const modified: RepoChangeEntry = {
      ...change('src/app.ts'),
      code: ' M',
      unstagedChar: 'M',
      unstagedType: 'modified',
      isUntracked: false,
    };
    expect(entryPathExistsInCurrentTree(modified, 'working-tree')).toBe(true);

    const deletedInWorkingTree: RepoChangeEntry = {
      ...change('src/deleted.ts'),
      code: ' D',
      unstagedChar: 'D',
      unstagedType: 'deleted',
      isUntracked: false,
    };
    expect(entryPathExistsInCurrentTree(deletedInWorkingTree, 'working-tree')).toBe(false);

    const deletedInPull: RepoChangeEntry = {
      ...change('src/pr-deleted.ts'),
      code: 'D',
      stagedChar: 'D',
      stagedType: 'deleted',
      unstagedChar: '.',
      unstagedType: null,
      isUntracked: false,
    };
    expect(entryPathExistsInCurrentTree(deletedInPull, 'pull-preview')).toBe(false);
    expect(entryPathExistsInCurrentTree(deletedInPull, 'pull-request')).toBe(false);
  });
});

describe('changes payload equality', () => {
  test('treats equivalent working-tree payloads as unchanged', () => {
    const payloadA: Extract<RepoChangesPayload, { ok: true }> = {
      ok: true,
      id: 'drone-a',
      name: 'Drone A',
      repoRoot: '/repo',
      reviewScopeId: 'wt-scope',
      branch: { head: 'main', upstream: 'origin/main', ahead: 0, behind: 0 },
      counts: {
        changed: 2,
        staged: 1,
        unstaged: 1,
        untracked: 0,
        conflicted: 0,
        additions: 8,
        deletions: 3,
        modified: 2,
      },
      entries: [
        {
          ...change('src/app.ts'),
          code: ' M',
          unstagedChar: 'M',
          unstagedType: 'modified',
          isUntracked: false,
        },
        {
          ...change('src/other.ts'),
          code: 'M ',
          stagedChar: 'M',
          stagedType: 'modified',
          unstagedChar: '.',
          unstagedType: null,
          isUntracked: false,
        },
      ],
    };
    const payloadB: Extract<RepoChangesPayload, { ok: true }> = {
      ...payloadA,
      entries: payloadA.entries.map((entry) => ({ ...entry })).reverse(),
    };

    expect(sameRepoChangesPayload(payloadA, payloadB)).toBe(true);
    expect(
      sameRepoChangesPayload(payloadA, {
        ...payloadB,
        entries: payloadB.entries.map((entry) => (entry.path === 'src/app.ts' ? { ...entry, code: 'M ' } : entry)),
      }),
    ).toBe(false);
  });

  test('treats equivalent pull-preview payloads as unchanged', () => {
    const payloadA: Extract<RepoPullChangesPayload, { ok: true }> = {
      ok: true,
      id: 'drone-a',
      name: 'Drone A',
      repoRoot: '/repo',
      reviewScopeId: 'pull-scope',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      branchContext: {
        hostCurrent: 'main',
        droneCurrent: 'feature',
        droneConfigured: 'feature',
        droneFromRef: 'origin/feature',
      },
      counts: { changed: 1, additions: 5, deletions: 2, modified: 2 },
      entries: [{ path: 'src/app.ts', originalPath: null, statusChar: 'M', statusType: 'modified' }],
    };
    const payloadB: Extract<RepoPullChangesPayload, { ok: true }> = {
      ...payloadA,
      branchContext: { ...payloadA.branchContext },
      entries: payloadA.entries.map((entry) => ({ ...entry })).reverse(),
    };

    expect(sameRepoPullChangesPayload(payloadA, payloadB)).toBe(true);
    expect(
      sameRepoPullChangesPayload(payloadA, {
        ...payloadB,
        headSha: 'c'.repeat(40),
      }),
    ).toBe(false);
  });

  test('treats equivalent pull-request payloads as unchanged', () => {
    const payloadA: Extract<RepoPullRequestChangesPayload, { ok: true }> = {
      ok: true,
      id: 'drone-a',
      name: 'Drone A',
      repoRoot: '/repo',
      reviewScopeId: 'pr-scope',
      github: { owner: 'openai', repo: 'repo' },
      pullRequest: {
        number: 42,
        title: 'Fix changes refresh',
        state: 'open',
        htmlUrl: 'https://example.com/pr/42',
        baseRefName: 'main',
        headRefName: 'feature',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
      },
      counts: { changed: 1, additions: 10, deletions: 2 },
      entries: [
        {
          path: 'src/app.ts',
          originalPath: null,
          statusChar: 'M',
          statusType: 'modified',
          additions: 10,
          deletions: 2,
          changes: 12,
          patch: '@@ -1 +1 @@',
          truncated: false,
          isBinary: false,
        },
      ],
    };
    const payloadB: Extract<RepoPullRequestChangesPayload, { ok: true }> = {
      ...payloadA,
      github: { ...payloadA.github },
      pullRequest: { ...payloadA.pullRequest },
      entries: payloadA.entries.map((entry) => ({ ...entry })).reverse(),
    };

    expect(sameRepoPullRequestChangesPayload(payloadA, payloadB)).toBe(true);
    expect(
      sameRepoPullRequestChangesPayload(payloadA, {
        ...payloadB,
        entries: payloadB.entries.map((entry, index) => (index === 0 ? { ...entry, patch: '@@ -1 +1,2 @@' } : entry)),
      }),
    ).toBe(false);
  });
});
