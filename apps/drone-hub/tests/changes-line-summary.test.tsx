import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangesFileCountPill, ChangesLineSummary } from '../src/droneHub/changes/ChangesLineSummary';

describe('changes line summary', () => {
  test('matches the agent changed-files totals and colors', () => {
    const html = renderToStaticMarkup(
      <ChangesLineSummary counts={{ changed: 3, additions: 10, deletions: 5, modified: 3 }} />,
    );

    expect(html).toContain('Changed files');
    expect(html).toContain('rounded-full');
    expect(html).toContain('bg-[var(--accent-subtle)]');
    expect(html).toContain('>3</span>');
    expect(html).toContain('+7');
    expect(html).toContain('~3');
    expect(html).toContain('-2');
    expect(html).toContain('Σ12');
    expect(html).toContain('12 total line changes');
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
