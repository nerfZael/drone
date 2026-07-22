import { describe, expect, test } from 'bun:test';
import {
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
});
