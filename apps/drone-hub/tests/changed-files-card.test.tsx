import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildAgentRunChangeTree } from '@drone/assistant-chat';

import { AgentMessageExtras } from '../src/droneHub/chat/AgentMessageExtras';
import { AgentRunChangedFilesTree } from '../src/droneHub/chat/AgentRunChangedFilesTree';
import { ChangedFilesCard } from '../src/droneHub/chat/ChangedFilesCard';

const summary = {
  version: 2 as const,
  capturedAt: '2026-07-21T00:00:00.000Z',
  counts: { changed: 2, additions: 7, deletions: 3, modified: 2 },
  workspaces: [
    {
      targetId: 'drone:d1',
      droneId: 'd1',
      label: 'Drone 1',
      diffArtifactId: '018fdce7-6e20-7d31-a78c-3f95d665cc72',
      counts: { changed: 2, additions: 7, deletions: 3, modified: 2 },
      previewEntries: [
        { path: 'src/new.ts', status: 'added' as const, additions: 7, deletions: 0 },
        { path: 'src/old.ts', status: 'deleted' as const, additions: 0, deletions: 3 },
      ],
    },
  ],
};

describe('changed files card', () => {
  test('renders a compact collapsed summary without mounting file rows', () => {
    const html = renderToStaticMarkup(<ChangedFilesCard fileChanges={summary} />);

    expect(html).toContain('Changed files <span');
    expect(html).toContain('>(2)</span>');
    expect(html).toContain('aria-label="+4 net lines"');
    expect(html).toContain('│');
    expect(html).toContain('+5');
    expect(html).toContain('~2');
    expect(html).toContain('-1');
    expect(html.indexOf('title="Lines added">+5')).toBeLessThan(
      html.indexOf('title="Lines modified">~2'),
    );
    expect(html.indexOf('title="Lines modified">~2')).toBeLessThan(
      html.indexOf('title="Lines deleted">-1'),
    );
    expect(html.indexOf('title="Lines deleted">-1')).toBeLessThan(
      html.indexOf('aria-label="+4 net lines"'),
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('src/new.ts');
  });

  test('can start expanded with a capped scroll region', () => {
    const html = renderToStaticMarkup(
      <ChangedFilesCard fileChanges={summary} initiallyExpanded />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('max-h-72');
    expect(html).toContain('overflow-y-auto');
  });

  test('keeps agent-specific actions in flow below expanded file changes', () => {
    const html = renderToStaticMarkup(
      <AgentMessageExtras
        text="Completed the requested changes."
        tasks={[]}
        messageId="message-with-changes"
        fileChanges={summary}
        initiallyExpandFileChanges
        actionEnd={<button type="button">Rollback</button>}
      />,
    );

    const changedFilesIndex = html.indexOf('aria-label="Files changed by this agent run"');
    const actionsIndex = html.indexOf('data-agent-message-actions="true"');

    expect(changedFilesIndex).toBeGreaterThanOrEqual(0);
    expect(actionsIndex).toBeGreaterThan(changedFilesIndex);
  });

  test('does not render empty summaries', () => {
    const html = renderToStaticMarkup(
      <ChangedFilesCard
        fileChanges={{
          ...summary,
          counts: { changed: 0, additions: 0, deletions: 0, modified: 0 },
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
      {
        path: 'README.md',
        status: 'modified',
        additions: 1,
        deletions: 1,
        modified: 1,
      },
    ]);

    expect(tree).toEqual([
      expect.objectContaining({
        kind: 'directory',
        name: 'src/components',
        path: 'src/components',
        stats: { changed: 2, additions: 7, deletions: 3, modified: 0 },
      }),
      expect.objectContaining({
        kind: 'file',
        name: 'README.md',
        stats: { changed: 1, additions: 1, deletions: 1, modified: 1 },
      }),
    ]);
  });

  test('keeps raw added and deleted totals for older summaries without modified counts', () => {
    const html = renderToStaticMarkup(
      <ChangedFilesCard
        fileChanges={{
          ...summary,
          counts: { changed: 2, additions: 7, deletions: 3 },
        }}
      />,
    );

    expect(html).toContain('+7');
    expect(html).toContain('aria-label="+4 net lines"');
    expect(html).toContain('~0');
    expect(html).toContain('-3');
  });

  test('shows modified file rows as raw plus and minus counts', () => {
    const html = renderToStaticMarkup(
      <AgentRunChangedFilesTree
        entries={[
          {
            path: 'src/changed.ts',
            status: 'modified',
            additions: 10,
            deletions: 10,
            modified: 10,
          },
        ]}
        selectedPath="src/changed.ts"
        expandedDirectories={{}}
        onToggleDirectory={() => undefined}
        onSelectFile={() => undefined}
      />,
    );

    expect(html).toContain('+10');
    expect(html).toContain('-10');
    expect(html).not.toContain('~10');
    expect(html).not.toContain('hover:bg-[var(--hover)]');
    expect(html).not.toContain('bg-[var(--accent-subtle)]');
  });
});
