import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CollapsibleMarkdown } from '../src/droneHub/chat/CollapsibleMarkdown';

describe('CollapsibleMarkdown', () => {
  test('does not render a partial table when lead-preserving content is initially collapsed', () => {
    const text = [
      'Summary paragraph.',
      '',
      '| Name | Status |',
      '| - | - |',
      '| alpha | ok |',
      '| beta | ok |',
      '',
      'tail',
    ].join('\n');
    const html = renderToStaticMarkup(
      React.createElement(CollapsibleMarkdown, {
        text,
        fadeTo: 'var(--accent-subtle)',
        preserveLeadParagraph: true,
        collapseAfterLines: 3,
      }),
    );

    expect(html).toContain('Summary paragraph.');
    expect(html).toContain('Show more');
    expect(html).not.toContain('<table>');
    expect(html).not.toContain('alpha');
  });
});
