import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMessage } from '../src/droneHub/chat/MarkdownMessage';

function renderMarkdown(
  text: string,
  options: Partial<React.ComponentProps<typeof MarkdownMessage>> = {},
): string {
  return renderToStaticMarkup(React.createElement(MarkdownMessage, { text, ...options }));
}

describe('MarkdownMessage', () => {
  test('renders GFM lists and tables', () => {
    const html = renderMarkdown(['- alpha', '- beta', '', '| A | B |', '| - | - |', '| 1 | 2 |'].join('\n'));
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>alpha</li>');
    expect(html).toContain('dh-markdown-table-wrap');
    expect(html).toContain('dh-markdown-table--fit');
    expect(html).toContain('<table class="dh-markdown-table dh-markdown-table--fit">');
    expect(html).toContain('>Wrap<');
    expect(html).toContain('>Scroll<');
    expect(html).toContain('>Expand<');
    expect(html).toContain('<thead>');
  });

  test('defaults dense structured tables to wrap mode', () => {
    const html = renderMarkdown(
      [
        '| Name | Path | Sha | Status | Owner |',
        '| - | - | - | - | - |',
        '| alpha | src/features/auth/routes/index.tsx | 1234567890abcdef1234567890abcdef | ready | platform |',
      ].join('\n'),
    );
    expect(html).toContain('dh-markdown-table--fit');
  });

  test('renders callout blockquotes and strips marker text', () => {
    const html = renderMarkdown(['> [!WARNING]', '> Rotate credentials now'].join('\n'));
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain('dh-markdown-callout-label');
    expect(html).toContain('Rotate credentials now');
    expect(html).not.toContain('[!WARNING]');
  });

  test('converts single newlines to hard breaks', () => {
    const html = renderMarkdown(['line one', 'line two'].join('\n'));
    expect(html).toContain('<br');
  });

  test('renders inline code URLs as clickable links', () => {
    const html = renderMarkdown('Open `https://example.com/path?q=1` for docs.');
    expect(html).toContain('class="dh-inline-code-link"');
    expect(html).toContain('href="https://example.com/path?q=1"');
  });

  test('renders inline code file references as file buttons when a handler is provided', () => {
    const html = renderMarkdown('Inspect `src/main.ts:42`', {
      onOpenFileReference: () => {},
    });
    expect(html).toContain('class="dh-inline-code-file-link"');
    expect(html).toContain('title="Open src/main.ts:42"');
  });

  test('renders markdown file links with file-open labels when a handler is provided', () => {
    const html = renderMarkdown('[open file](src/main.ts:7)', {
      onOpenFileReference: () => {},
    });
    expect(html).toContain('href="src/main.ts:7"');
    expect(html).toContain('aria-label="Open file src/main.ts:7"');
    expect(html).not.toContain('target="_blank"');
  });

  test('renders normal external links with new-tab attributes', () => {
    const html = renderMarkdown('[docs](https://example.com/docs)');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  test('nests loose bullet lines directly under numbered items', () => {
    const html = renderMarkdown(
      [
        '1. `Source`',
        '- `none`',
        '- `host-current`',
        '- `host-local-ref`',
        '- `remote-ref`',
        '- `remote-default`',
      ].join('\n'),
    );
    expect(html).toContain('<ol>');
    expect(html).toContain('<ul>');
    expect(html).not.toContain('</ol><ul>');
    expect(html).toMatch(/<li>[\s\S]*Source[\s\S]*<ul>/);
  });
});
