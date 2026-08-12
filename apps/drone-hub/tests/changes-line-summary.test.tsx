import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangesFileCountPill, ChangesLineSummary } from '../src/droneHub/changes/ChangesLineSummary';

describe('changes line summary', () => {
  test('matches the agent changed-files breakdown, net change, and colors', () => {
    const html = renderToStaticMarkup(
      <ChangesLineSummary counts={{ changed: 2, additions: 54, deletions: 67, modified: 46 }} />,
    );

    expect(html).toContain('Changed files');
    expect(html).toContain('rounded-full');
    expect(html).toContain('bg-[var(--accent-subtle)]');
    expect(html).toContain('>2</span>');
    expect(html).toContain('+8');
    expect(html).toContain('~46');
    expect(html).toContain('-21');
    expect(html).toContain('-13 net lines');
    expect(html).toContain('title="Net line change"');
    expect(html).not.toContain('Σ');
    expect(html).toContain('text-[var(--green)]');
    expect(html).toContain('text-[var(--yellow)]');
    expect(html).toContain('text-[var(--red)]');
    expect(html).toContain('text-[var(--accent)]');
  });

  test('coordinates staged and unstaged pill colors', () => {
    const staged = renderToStaticMarkup(<ChangesFileCountPill count={4} tone="staged" />);
    const unstaged = renderToStaticMarkup(<ChangesFileCountPill count={7} tone="unstaged" />);

    expect(staged).toContain('bg-[var(--green-subtle)]');
    expect(staged).toContain('text-[var(--green)]');
    expect(unstaged).toContain('bg-[var(--yellow-subtle)]');
    expect(unstaged).toContain('text-[var(--yellow)]');
  });
});
