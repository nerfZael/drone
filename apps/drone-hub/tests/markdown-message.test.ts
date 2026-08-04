import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { allocateFitTableColumnWidths } from '../../../packages/assistant-markdown/src/table-layout';
import { MarkdownMessage } from '../src/droneHub/chat/MarkdownMessage';

function renderMarkdown(
  text: string,
  options: Partial<React.ComponentProps<typeof MarkdownMessage>> = {},
): string {
  return renderToStaticMarkup(React.createElement(MarkdownMessage, { text, ...options }));
}

describe('MarkdownMessage', () => {
  test('keeps text-renderer identities stable across parent refreshes', () => {
    const markdownSource = readFileSync(
      new URL('../../../packages/assistant-markdown/src/MarkdownMessage.tsx', import.meta.url),
      'utf8',
    );
    const outlineSource = readFileSync(
      new URL('../src/droneHub/files/MarkdownOutlinePreview.tsx', import.meta.url),
      'utf8',
    );
    const editorSource = readFileSync(
      new URL('../src/droneHub/files/OpenedDroneFilePanel.tsx', import.meta.url),
      'utf8',
    );

    expect(markdownSource).toContain('components={STABLE_MARKDOWN_COMPONENTS}');
    expect(markdownSource).not.toContain('components={{');
    expect(outlineSource).toContain('components={HEADING_MARKDOWN_COMPONENTS}');
    expect(outlineSource).not.toContain('components={{');
    expect(editorSource).toContain('const monacoOptions = React.useMemo');
    expect(editorSource).toContain('options={monacoOptions}');
    expect(editorSource).toContain('onChange={handleEditorChange}');
  });

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

  test('uses content-aware column widths in wrap mode', () => {
    const html = renderMarkdown(
      [
        '| ID | Change | Why it helps | Controversy | Risk / tradeoff | Dependencies | My recommendation |',
        '| - | - | - | - | - | - | - |',
        '| A | Trigger an immediate registry refresh after the rename transaction | Removes the normal outbox delay and greatly reduces cases where the old name remains visible | Very low | Adds a redundant refresh; the outbox remains the reliable fallback | None | Do it |',
        '| D | Allow manual sidebar rename while a drone is starting or seeding | Directly fixes the reported inability to rename during container startup | Medium | Exposes a real race with an in-flight automatic rename unless C is included | C strongly recommended; A and B improve UX | Do it with C |',
      ].join('\n'),
    );

    expect(html).toContain('<colgroup>');
    const columnWidths = [...html.matchAll(/<col style="width:([\d.]+)%"\/>/g)].map(
      (match) => Number(match[1]),
    );
    expect(columnWidths).toHaveLength(7);
    expect(columnWidths[0]).toBeGreaterThan(3);
    expect(columnWidths.slice(1).every((width) => width > columnWidths[0])).toBe(true);
    expect(columnWidths[3]).toBeGreaterThan(columnWidths[0] * 2);
    expect(columnWidths[5]).toBeLessThan(columnWidths[1]);
    expect(columnWidths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 2);

    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const tableRule =
      /\.dh-markdown table\.dh-markdown-table--fit\s*\{([^}]*)\}/.exec(styles)?.[1];
    const cellRule =
      /\.dh-markdown-table--fit th,\s*\.dh-markdown-table--fit td\s*\{([^}]*)\}/.exec(
        styles,
      )?.[1];
    expect(tableRule).toContain('table-layout: fixed');
    expect(cellRule).toContain('max-width: 0');
    expect(cellRule).toContain('overflow-wrap: anywhere');
  });

  test('keeps fitted column totals exact and preserves minima when space permits', () => {
    const equalMetrics = Array.from({ length: 6 }, () => ({
      preferredWeight: 10,
      minimumWidth: 40,
    }));
    const percentages = allocateFitTableColumnWidths(equalMetrics, null).map(Number.parseFloat);
    expect(percentages.reduce((sum, width) => sum + width, 0)).toBe(100);

    const metrics = [
      { preferredWeight: 5, minimumWidth: 36 },
      { preferredWeight: 30, minimumWidth: 100 },
    ];
    const roomyWidths = allocateFitTableColumnWidths(metrics, 400).map(Number.parseFloat);
    expect(roomyWidths.reduce((sum, width) => sum + width, 0)).toBe(400);
    expect(roomyWidths[0]).toBeGreaterThanOrEqual(36);
    expect(roomyWidths[1]).toBeGreaterThanOrEqual(100);

    const compressedWidths = allocateFitTableColumnWidths(metrics, 100).map(Number.parseFloat);
    expect(compressedWidths.reduce((sum, width) => sum + width, 0)).toBe(100);
  });

  test('renders callout blockquotes and strips marker text', () => {
    const html = renderMarkdown(['> [!WARNING]', '> Rotate credentials now'].join('\n'));
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain('dh-markdown-callout-label');
    expect(html).toContain('Rotate credentials now');
    expect(html).not.toContain('[!WARNING]');
  });

  test('exposes the inner blockquote source to an optional copy action', () => {
    const html = renderMarkdown(['> Create a multi-shot prompt.', '>', '> Keep **all three** shots.'].join('\n'), {
      renderBlockCopyAction: (text) =>
        React.createElement('button', { 'data-copy-text': text }, 'Copy block'),
    });

    expect(html).toContain('dh-markdown-copyable-block group/markdown-block');
    expect(html).toContain(
      'data-copy-text="Create a multi-shot prompt.\n\nKeep **all three** shots."',
    );
    expect(html).toContain('>Copy block</button>');
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

  test('renders fenced code as a highlighted, copyable, horizontally scrollable card', () => {
    const html = renderMarkdown('```ts\nconst answer = 42;\n```');
    expect(html).toContain('class="dh-code-card group/code-block"');
    expect(html).toContain('class="dh-code-card__scroll"');
    expect(html).not.toContain('<pre><section');
    expect(html).toContain('title="Copy code"');
    expect(html).not.toContain('dh-code-card__language');
    expect(html).not.toContain('&lt;/&gt;');
    expect(html).toContain('class="token keyword"');
    expect(html).toContain('class="token number"');
  });

  test('renders mermaid fences as diagrams instead of code cards', () => {
    const html = renderMarkdown('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(html).toContain('class="dh-mermaid-card"');
    expect(html).toContain('aria-label="Mermaid diagram"');
    expect(html).toContain('Rendering diagram');
    expect(html).toContain('Maximize');
    expect(html).not.toContain('class="dh-code-card');
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

  test('renders configured plain-text mentions without changing links or code', () => {
    const html = renderMarkdown('Ask Alpha Agent, not `Alpha Agent` or [Alpha Agent](https://example.com).', {
      textMentionLinks: [{ key: 'drone-1', label: 'Alpha Agent', title: 'Ctrl-click to open Alpha Agent' }],
      onOpenTextMention: () => {},
    });
    expect(html).toContain('class="dh-markdown-text-mention"');
    expect(html).toContain('title="Ctrl-click to open Alpha Agent"');
    expect(html).toContain('aria-label="Ctrl-click to open Alpha Agent"');
    expect(html).toContain('<code>Alpha Agent</code>');
    expect(html).toContain('<a href="https://example.com"');
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
