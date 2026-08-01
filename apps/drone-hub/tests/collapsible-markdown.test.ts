import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CollapsibleMarkdown } from '../src/droneHub/chat/CollapsibleMarkdown';

describe('CollapsibleMarkdown', () => {
  test('does not render a partial table when content is initially collapsed', () => {
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
        collapseAfterLines: 3,
      }),
    );

    expect(html).toContain('Summary paragraph.');
    expect(html).toContain('Show more');
    expect(html).not.toContain('<table>');
    expect(html).not.toContain('alpha');
  });

  test('keeps a leading table intact even when it exceeds the preview line limit', () => {
    const text = [
      '| Name | Status |',
      '| - | - |',
      '| alpha | ok |',
      '| beta | ok |',
      '',
      'Follow-up explanation.',
    ].join('\n');
    const html = renderToStaticMarkup(
      React.createElement(CollapsibleMarkdown, {
        text,
        fadeTo: 'var(--accent-subtle)',
        collapseAfterLines: 3,
      }),
    );

    expect(html).toContain('<table class=');
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
    expect(html).not.toContain('Follow-up explanation.');
  });

  test('does not split fenced code blocks at internal blank lines', () => {
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
        collapseAfterLines: 3,
      }),
    );

    expect(html).toContain('<pre>');
    expect(html).toContain('createDroneSDK');
    expect(html).toContain('hubTransport');
    expect(html).toContain('&quot;drone-sdk&quot;');
    expect(html).toContain('DRONE_TOKEN');
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

  test('shows several complete opening blocks in a collapsed message preview', () => {
    const text = [
      'Opening summary.',
      '',
      'Second paragraph.',
      '',
      'Third paragraph.',
      '',
      'Fourth paragraph.',
      '',
      'Hidden fifth paragraph.',
      '',
      'Hidden sixth paragraph.',
    ].join('\n');
    const html = renderToStaticMarkup(
      React.createElement(CollapsibleMarkdown, {
        text,
        fadeTo: 'var(--accent-subtle)',
        collapseAfterLines: 8,
      }),
    );

    expect(html).toContain('Opening summary.');
    expect(html).toContain('Fourth paragraph.');
    expect(html).not.toContain('Hidden fifth paragraph.');
    expect(html).toContain('bg-[var(--surface-soft)]');
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

  test('renders long markdown fully when it is the latest agent message', () => {
    const tail = 'latest response tail remains visible';
    const text = [...Array.from({ length: 12 }, (_, i) => `line ${i + 1}`), tail].join('\n');
    const html = renderToStaticMarkup(
      React.createElement(CollapsibleMarkdown, {
        text,
        fadeTo: 'var(--assistant-bubble-fade)',
        collapseAfterLines: 3,
        autoExpand: true,
      }),
    );

    expect(html).toContain(tail);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Collapse');
    expect(html).not.toContain('Show more');
  });
});
