import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChangedFilesCard } from '../src/droneHub/chat/ChangedFilesCard';
import { buildAgentRunChangeTree } from '../src/droneHub/chat/agent-run-change-tree';

const summary = {
  version: 1 as const,
  capturedAt: '2026-07-21T00:00:00.000Z',
  counts: { changed: 2, additions: 7, deletions: 3 },
  workspaces: [
    {
      targetId: 'drone:d1',
      droneId: 'd1',
      label: 'Drone 1',
      repoRoot: '/work/repo',
      diffArtifactId: '018fdce7-6e20-7d31-a78c-3f95d665cc72',
      counts: { changed: 2, additions: 7, deletions: 3 },
      entries: [
        { path: 'src/new.ts', status: 'added' as const, additions: 7, deletions: 0 },
        { path: 'src/old.ts', status: 'deleted' as const, additions: 0, deletions: 3 },
      ],
    },
  ],
};

describe('changed files card', () => {
  test('renders a compact collapsed summary without mounting file rows', () => {
    const html = renderToStaticMarkup(<ChangedFilesCard fileChanges={summary} />);

    expect(html).toContain('Changed files');
    expect(html).toContain('2 changed files');
    expect(html).toContain('+7');
    expect(html).toContain('-3');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('src/new.ts');
  });

  test('does not render empty summaries', () => {
    const html = renderToStaticMarkup(
      <ChangedFilesCard
        fileChanges={{
          ...summary,
          counts: { changed: 0, additions: 0, deletions: 0 },
          workspaces: [],
        }}
      />,
    );

    expect(html).toBe('');
  });

  test('builds collapsed directory chains with aggregate line counts', () => {
    const tree = buildAgentRunChangeTree([
      { path: 'src/components/new.ts', status: 'added', additions: 7, deletions: 0 },
      { path: 'src/components/old.ts', status: 'deleted', additions: 0, deletions: 3 },
      { path: 'README.md', status: 'modified', additions: 1, deletions: 1 },
    ]);

    expect(tree).toEqual([
      expect.objectContaining({
        kind: 'directory',
        name: 'src/components',
        path: 'src/components',
        stats: { changed: 2, additions: 7, deletions: 3 },
      }),
      expect.objectContaining({
        kind: 'file',
        name: 'README.md',
        stats: { changed: 1, additions: 1, deletions: 1 },
      }),
    ]);
  });
});
