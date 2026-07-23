import { describe, expect, test } from 'bun:test';
import {
  buildNativeMarkdownOutline,
  nativeMarkdownHasCodeBlock,
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
});
