import { beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let tokenizeCalls = 0;
let parsedChangeCount = 2;

function makeParsedFile(changeCount = 2) {
  const changes = Array.from({ length: changeCount }, (_, index) =>
    index % 2 === 0
      ? { type: 'delete', content: `-const value${index} = 1;`, lineNumber: 20 + index, isDelete: true }
      : { type: 'insert', content: `+const value${index} = 2;`, lineNumber: 20 + index, isInsert: true },
  );

  return {
    hunks: [
      {
        content: '@@ -20,1 +20,1 @@',
        oldStart: 20,
        newStart: 20,
        oldLines: 1,
        newLines: 1,
        changes,
      },
    ],
    oldEndingNewLine: true,
    newEndingNewLine: true,
    oldMode: '100644',
    newMode: '100644',
    oldRevision: '1111111',
    newRevision: '2222222',
    oldPath: 'src/example.ts',
    newPath: 'src/example.ts',
    type: 'modify',
  };
}

mock.module('react-diff-view', () => ({
  Decoration: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-decoration': 'true' }, children),
  Diff: ({
    children,
    hunks,
    tokens,
  }: {
    children: (hunks: ReturnType<typeof makeParsedFile>['hunks']) => React.ReactNode;
    hunks: ReturnType<typeof makeParsedFile>['hunks'];
    tokens: unknown;
  }) => React.createElement('section', { 'data-tokenized': tokens ? 'yes' : 'no' }, children(hunks)),
  Hunk: ({ hunk }: { hunk: ReturnType<typeof makeParsedFile>['hunks'][number] }) =>
    React.createElement('pre', { 'data-hunk': 'true' }, hunk.changes.map((change) => change.content).join('\n')),
  expandFromRawCode: (hunks: ReturnType<typeof makeParsedFile>['hunks']) => hunks,
  getCollapsedLinesCountBetween: (previous: ReturnType<typeof makeParsedFile>['hunks'][number], next: ReturnType<typeof makeParsedFile>['hunks'][number]) =>
    Math.max(0, next.oldStart - (previous.oldStart + previous.oldLines)),
  markEdits: () => null,
  parseDiff: () => [makeParsedFile(parsedChangeCount)],
  tokenize: () => {
    tokenizeCalls += 1;
    return { highlighted: true };
  },
}));

const { DIFF_HIGHLIGHT_MAX_CHANGED_LINES, DIFF_HIGHLIGHT_MAX_RAW_CHARS, DiffBlock, loadDiffExpansionSourceLines } = await import(
  '../src/droneHub/changes/DiffBlock'
);

function renderDiffBlock(props: Partial<React.ComponentProps<typeof DiffBlock>> = {}) {
  return renderToStaticMarkup(
    React.createElement(DiffBlock, {
      state: { status: 'loaded', text: 'diff --git a/src/example.ts b/src/example.ts\n@@ -20,1 +20,1 @@\n-const value = 1;\n+const value = 2;' },
      filePath: 'src/example.ts',
      ...props,
    }),
  );
}

describe('DiffBlock', () => {
  beforeEach(() => {
    tokenizeCalls = 0;
    parsedChangeCount = 2;
  });

  test('normal highlighted diff still renders', () => {
    const html = renderDiffBlock();

    expect(html).toContain('data-tokenized="yes"');
    expect(html).toContain('+const value1 = 2;');
    expect(tokenizeCalls).toBe(1);
  });

  test('very large diff renders without tokenization', () => {
    const html = renderDiffBlock({
      state: { status: 'loaded', text: 'x'.repeat(DIFF_HIGHLIGHT_MAX_RAW_CHARS + 1) },
    });

    expect(html).toContain('data-tokenized="no"');
    expect(html).toContain('+const value1 = 2;');
    expect(tokenizeCalls).toBe(0);
  });

  test('diff above changed-line threshold renders without tokenization', () => {
    parsedChangeCount = DIFF_HIGHLIGHT_MAX_CHANGED_LINES + 1;

    const html = renderDiffBlock();

    expect(html).toContain('data-tokenized="no"');
    expect(tokenizeCalls).toBe(0);
  });

  test('context expansion still loads source on demand', async () => {
    let loadCalls = 0;
    const loadExpansionSource = async () => {
      loadCalls += 1;
      return 'line one\r\nline two\n';
    };

    const html = renderDiffBlock({
      expansionSourceId: 'src/example.ts:unstaged',
      loadExpansionSource,
      onAddExpansionRange: () => {},
    });

    expect(html).toContain('19 hidden lines');
    expect(html).toContain('Hidden lines');
    expect(loadCalls).toBe(0);

    await expect(loadDiffExpansionSourceLines(loadExpansionSource)).resolves.toEqual(['line one', 'line two']);
    expect(loadCalls).toBe(1);
  });
});
