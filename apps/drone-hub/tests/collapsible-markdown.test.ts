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

  test('does not split fenced code blocks at internal blank lines when preserving the lead block', () => {
    const text = [
      '```ts',
      'import { createDroneSDK, hubTransport } from "drone-sdk";',
      '',
      'const sdk = createDroneSDK({',
      '  transport: hubTransport({',
      '    baseUrl: "http://127.0.0.1:8787",',
      '    token: process.env.DRONE_TOKEN!,',
      '  }),',
      '});',
      '```',
      '',
      'Follow-up explanation that should stay behind the collapse.',
    ].join('\n');
    const html = renderToStaticMarkup(
      React.createElement(CollapsibleMarkdown, {
        text,
        fadeTo: 'var(--accent-subtle)',
        preserveLeadParagraph: true,
        collapseAfterLines: 3,
      }),
    );

    expect(html).toContain('<pre>');
    expect(html).toContain('import { createDroneSDK, hubTransport } from &quot;drone-sdk&quot;;');
    expect(html).toContain('const sdk = createDroneSDK({');
    expect(html).toContain('Show more');
    expect(html).not.toContain('Follow-up explanation that should stay behind the collapse.');
  });

  test('does not render the full body for collapsed long content without a lead paragraph', () => {
    const hiddenTail = 'this tail should not be rendered while collapsed';
    const text = [
      ...Array.from({ length: 50 }, (_, i) => `line ${i + 1}`),
      hiddenTail,
    ].join('\n');
    const html = renderToStaticMarkup(
      React.createElement(CollapsibleMarkdown, {
        text,
        fadeTo: 'var(--accent-subtle)',
        collapseAfterLines: 8,
      }),
    );

    expect(html).toContain('line 1');
    expect(html).toContain('Show more');
    expect(html).not.toContain(hiddenTail);
  });

  test('marks click-toggle markdown as collapsed and expandable when opted in', () => {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
    const html = renderToStaticMarkup(
      React.createElement(CollapsibleMarkdown, {
        text,
        fadeTo: 'var(--accent-subtle)',
        collapseAfterLines: 3,
        toggleOnMessageClick: true,
      }),
    );

    expect(html).toContain('dh-collapsible-markdown--click-toggle');
    expect(html).toContain('aria-expanded="false"');
  });

  test('does not mark collapsed markdown as click-toggle unless opted in', () => {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
    const html = renderToStaticMarkup(
      React.createElement(CollapsibleMarkdown, {
        text,
        fadeTo: 'var(--accent-subtle)',
        collapseAfterLines: 3,
      }),
    );

    expect(html).not.toContain('dh-collapsible-markdown--click-toggle');
    expect(html).toContain('aria-expanded="false"');
  });
});
