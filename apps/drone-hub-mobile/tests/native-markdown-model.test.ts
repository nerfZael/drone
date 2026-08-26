import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  numericTableColumnIndexes,
  stableSortTableRows,
} from '@drone/markdown-table-sort';
import {
  buildNativeMarkdownOutline,
  nativeMarkdownHasCodeBlock,
  nativeMarkdownInlineText,
  parseNativeMarkdown,
  parseNativeMarkdownInline,
} from '../src/local-assistant/native-markdown-model';

describe('native assistant markdown', () => {
  test('parses the block structures used by assistant answers', () => {
    expect(
      parseNativeMarkdown(`# Result

- first
- [x] shipped

\`\`\`ts
const ready = true;
\`\`\`

| Name | State |
| --- | --- |
| App | Ready |`),
    ).toEqual([
      { type: 'heading', level: 1, text: 'Result' },
      {
        type: 'list',
        ordered: false,
        items: [
          { text: 'first', checked: null },
          { text: 'shipped', checked: true },
        ],
      },
      { type: 'code', language: 'ts', text: 'const ready = true;' },
      {
        type: 'table',
        headers: ['Name', 'State'],
        rows: [['App', 'Ready']],
      },
    ]);
  });

  test('parses inline emphasis, code, links, and plain text', () => {
    expect(
      parseNativeMarkdownInline('Use **bold**, `code`, and [docs](https://example.com).'),
    ).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'strong', text: 'bold' },
      { type: 'text', text: ', ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: ', and ' },
      { type: 'link', text: 'docs', href: 'https://example.com' },
      { type: 'text', text: '.' },
    ]);
    expect(nativeMarkdownInlineText('**10**, `3`, and [4](https://example.com)')).toBe('10, 3, and 4');
  });

  test('recognizes GitHub-style callouts', () => {
    expect(parseNativeMarkdown('> [!WARNING]\n> Check permissions.')).toEqual([
      { type: 'quote', text: 'Check permissions.', callout: 'warning' },
    ]);
  });

  test('detects fenced code blocks for user-message rendering', () => {
    expect(nativeMarkdownHasCodeBlock('ordinary user message')).toBe(false);
    expect(nativeMarkdownHasCodeBlock('Example:\n```tsx\n<View />\n```')).toBe(true);
  });

  test('parses Mermaid fences as diagram blocks', () => {
    expect(parseNativeMarkdown('```mermaid\nflowchart LR\n  A --> B\n```')).toEqual([
      { type: 'mermaid', text: 'flowchart LR\n  A --> B' },
    ]);
  });

  test('builds a nested document outline while preserving direct section content', () => {
    const blocks = parseNativeMarkdown(
      '# Document\n\nIntro.\n\n## Section\n\nSection body.\n\n### Detail\n\nDetail body.',
    );
    const outline = buildNativeMarkdownOutline(blocks);

    expect(outline.sectionIds).toHaveLength(3);
    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0]?.heading.text).toBe('Document');
    expect(outline.sections[0]?.content).toEqual([{ type: 'paragraph', text: 'Intro.' }]);
    expect(outline.sections[0]?.children[0]?.heading.text).toBe('Section');
    expect(outline.sections[0]?.children[0]?.content).toEqual([
      { type: 'paragraph', text: 'Section body.' },
    ]);
    expect(outline.sections[0]?.children[0]?.children[0]?.heading.text).toBe('Detail');
  });

  test('keeps heading identities stable when body content moves', () => {
    const before = buildNativeMarkdownOutline(
      parseNativeMarkdown('# Document\n\nIntro.\n\n## Section\n\nBody.'),
    );
    const after = buildNativeMarkdownOutline(
      parseNativeMarkdown('Preamble.\n\n# Document\n\nLonger intro.\n\n## Section\n\nBody.'),
    );

    expect(after.sectionIds).toEqual(before.sectionIds);
  });

  test('parses setext document headings', () => {
    expect(parseNativeMarkdown('Document title\n==============\n\nSection\n-------')).toEqual([
      { type: 'heading', level: 1, text: 'Document title' },
      { type: 'heading', level: 2, text: 'Section' },
    ]);
  });

  test('sorts only wholly numeric native table columns', () => {
    const table = parseNativeMarkdown(
      '| Name | **Score** | Change |\n| --- | --- | --- |\n| Alpha | **10** | -2.5 |\n| Beta | `3` | 1e2 |',
    )[0];
    expect(table?.type).toBe('table');
    if (!table || table.type !== 'table') throw new Error('Expected a native Markdown table');

    const numericValues = table.rows.map((row) => row.map(nativeMarkdownInlineText));
    expect(numericTableColumnIndexes(numericValues, table.headers.length)).toEqual([1, 2]);
    expect(stableSortTableRows(table.rows, numericValues, 1, 'ascending')).toEqual([
      ['Beta', '`3`', '1e2'],
      ['Alpha', '**10**', '-2.5'],
    ]);
  });

  test('exposes accessible sort and reset controls in the native renderer', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/NativeMarkdown.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('accessibilityLabel={`Sort ${headerLabels[columnIndex]');
    expect(source).toContain('accessibilityLabel="Reset table sort"');
    expect(source).toContain('accessibilityState={{ disabled: !activeSort }}');
    expect(source).toContain('onTouchStart={stopTouchPropagation}');
    expect(source).toContain('interactive={false}');
    expect(source).toContain('textAlign: \'left\'');
    expect(source).toContain('textAlign: \'center\'');
  });

  test('lets overflowing code blocks scroll or wrap without a touch-capturing container', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/NativeMarkdown.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('const [wordWrap, setWordWrap] = React.useState(false)');
    expect(source).toContain("wordWrap ? 'Turn off code word wrap' : 'Turn on code word wrap'");
    expect(source).toContain('<ScrollView\n          horizontal\n          nestedScrollEnabled');
    expect(source).toContain('style={[styles.codeText, styles.codeTextWrapped]}');
    expect(source).not.toContain('<Pressable\n      accessible={false}');
  });

  test('gives document previews more reading space without enlarging chat prose', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/NativeMarkdown.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('documentMode && styles.documentMarkdownStack');
    expect(source).toContain('documentMode && styles.documentBody');
    expect(source).toContain('documentMarkdownStack: { gap: 12 }');
    expect(source).toContain('documentBody: { lineHeight: 23 }');
    expect(source).toContain("useMobileReadingDensity() === 'comfortable'");
    expect(source).toContain('bodyComfortable: { fontSize: 16, lineHeight: 24 }');
  });

  test('keeps rendered Mermaid diagrams inside a horizontally scrollable frame', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/NativeMermaidDiagram.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('<ScrollView\n        horizontal\n        nestedScrollEnabled');
    expect(source).toContain('style={styles.scrollFrame}');
    expect(source).toContain("maxWidth: '100%'");
    expect(source).toContain('flexShrink: 1');
  });
});
