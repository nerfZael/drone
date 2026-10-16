import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MARKDOWN_STATUSES, splitMarkdownStatusEmoji } from '@drone/markdown-status-icons';
import { MarkdownMessage } from '../src/droneHub/chat/MarkdownMessage';

function renderMarkdown(text: string): string {
  return renderToStaticMarkup(React.createElement(MarkdownMessage, { text }));
}

describe('splitMarkdownStatusEmoji', () => {
  test('splits status emoji with and without the emoji variation selector', () => {
    expect(splitMarkdownStatusEmoji('⏭️ skipped ⏭ again')).toEqual([
      { type: 'status', text: '⏭️', status: expect.objectContaining({ kind: 'skipped' }) },
      { type: 'text', text: ' skipped ' },
      { type: 'status', text: '⏭', status: expect.objectContaining({ kind: 'skipped' }) },
      { type: 'text', text: ' again' },
    ]);
  });

  test('leaves plain text and other emoji alone', () => {
    expect(splitMarkdownStatusEmoji('ship it 🚀')).toEqual([{ type: 'text', text: 'ship it 🚀' }]);
    expect(splitMarkdownStatusEmoji('')).toEqual([{ type: 'text', text: '' }]);
  });

  test('leaves emoji that are part of a joined sequence to the emoji font', () => {
    expect(splitMarkdownStatusEmoji('✔‍ x')).toEqual([{ type: 'text', text: '✔‍ x' }]);
  });

  test('maps every emoji to exactly one status', () => {
    const emoji = MARKDOWN_STATUSES.flatMap((status) => status.emoji);
    expect(new Set(emoji).size).toBe(emoji.length);
    for (const status of MARKDOWN_STATUSES) {
      for (const value of status.emoji) {
        const [segment] = splitMarkdownStatusEmoji(`${value}️`);
        expect(segment).toEqual({ type: 'status', text: `${value}️`, status });
      }
    }
  });
});

describe('MarkdownMessage status icons', () => {
  test('draws status emoji as labelled icons and keeps the emoji for copying', () => {
    const html = renderMarkdown('- ✅ ~~Mech pass~~\n- 🔄 HUD speed-up');
    expect(html).toContain(
      '<span class="dh-md-status dh-md-status--success" role="img" aria-label="Done" data-status="done">',
    );
    expect(html).toContain('<svg class="dh-md-status__icon" viewBox="0 0 24 24" aria-hidden="true">');
    expect(html).toContain('<path d="m9 12 2 2 4-4"></path>');
    expect(html).toContain('<span class="dh-md-status__text">✅</span>');
    expect(html).toContain('data-status="in-progress"');
  });

  test('reaches emoji inside struck-through text, links and headings', () => {
    const html = renderMarkdown('## ⏳ Waiting\n\n~~⏭️ skipped~~ and [❌ broken](https://example.com)');
    expect(html).toMatch(/<h2[^>]*>.*data-status="waiting"/);
    expect(html).toMatch(/<del><span class="dh-md-status dh-md-status--muted"[^>]*data-status="skipped"/);
    expect(html).toMatch(/<a [^>]*><span class="dh-md-status dh-md-status--danger"/);
  });

  test('keeps code literal', () => {
    const html = renderMarkdown('Use `✅` here\n\n```\n✅ done\n```');
    expect(html).not.toContain('dh-md-status');
    expect(html).toContain('✅');
  });
});
