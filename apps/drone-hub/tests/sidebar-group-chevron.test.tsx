import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconChevron } from '../src/droneHub/icons';

describe('sidebar group chevrons', () => {
  test('uses a thin outline angle with right and down states', () => {
    const collapsed = renderToStaticMarkup(<IconChevron />);
    const expanded = renderToStaticMarkup(<IconChevron down />);

    expect(collapsed).toContain('fill="none"');
    expect(collapsed).toContain('stroke="currentColor"');
    expect(collapsed).toContain('stroke-width="1.5"');
    expect(collapsed).toContain('rotate-0');
    expect(expanded).toContain('rotate-90');
  });

  test('uses the collapsed chevron for top-level and nested group drafts', () => {
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );
    expect(groupedTreeSource).toContain('strokeWidth={1.25}');
    expect(groupedTreeSource).toContain(
      'className="h-4 w-4 translate-x-px flex-shrink-0 text-[var(--muted-dim)] opacity-72"',
    );
    expect(groupedTreeSource).toContain('densityClasses.folderChevron');
    expect(groupedTreeSource).toContain('function GroupedSidebarGroupDraftRow()');
    expect(groupedTreeSource).toContain('<GroupedSidebarGroupDraftRow />');
    expect(groupedTreeSource).not.toContain(
      '<IconFolder className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-dim)]" />',
    );
  });

  test('uses a larger, lighter, optically aligned explorer slot for folder chevrons', () => {
    const normal = readFileSync(
      new URL('../src/droneHub/sidebar/presentation.ts', import.meta.url),
      'utf8',
    );

    expect(normal).toContain(
      "folderChevron: 'h-4 w-4 translate-x-px text-[var(--muted-dim)] opacity-72'",
    );
  });
});
