import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownOutlinePreview } from '../src/droneHub/files/MarkdownOutlinePreview';
import { parseMarkdownOutline } from '../src/droneHub/files/markdown-outline';

describe('markdown outline', () => {
  test('builds nested sections and keeps only direct section content', () => {
    const outline = parseMarkdownOutline(
      [
        'Before the first heading.',
        '',
        '# Alpha',
        '',
        'Alpha intro.',
        '',
        '## Child',
        '',
        'Child content.',
        '',
        '# Beta',
        '',
        'Beta content.',
      ].join('\n'),
    );

    expect(outline.preamble).toBe('Before the first heading.');
    expect(outline.sectionIds).toHaveLength(3);
    expect(outline.sections).toHaveLength(2);
    expect(outline.sections[0]?.title).toBe('Alpha');
    expect(outline.sections[0]?.content).toBe('Alpha intro.');
    expect(outline.sections[0]?.headingStartLine).toBe(3);
    expect(outline.sections[0]?.contentStartLine).toBe(5);
    expect(outline.sections[0]?.children[0]?.title).toBe('Child');
    expect(outline.sections[0]?.children[0]?.content).toBe('Child content.');
    expect(outline.sections[0]?.children[0]?.headingStartLine).toBe(7);
    expect(outline.sections[0]?.children[0]?.contentStartLine).toBe(9);
    expect(outline.sections[1]?.title).toBe('Beta');
  });

  test('supports setext headings and ignores headings inside fenced code', () => {
    const outline = parseMarkdownOutline(
      [
        'Document title',
        '==============',
        '',
        '~~~md',
        '# Not a section',
        '~~~',
        '',
        'Real section',
        '------------',
      ].join('\n'),
    );

    expect(outline.sectionIds).toHaveLength(2);
    expect(outline.sections[0]?.title).toBe('Document title');
    expect(outline.sections[0]?.children[0]?.title).toBe('Real section');
  });

  test('keeps heading identities stable when body lines move', () => {
    const before = parseMarkdownOutline('# Document\n\nIntro.\n\n## Section\n\nBody.');
    const after = parseMarkdownOutline(
      'Preamble.\n\n# Document\n\nA longer introduction.\n\n## Section\n\nBody.',
    );

    expect(after.sectionIds).toEqual(before.sectionIds);
  });

  test('starts fully expanded without adding disclosure arrows', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownOutlinePreview, {
        text: '# Alpha\n\nAlpha content.\n\n## Child\n\nChild content.',
      }),
    );

    expect(html).not.toContain('Section browser');
    expect(html).toContain('dh-markdown--document');
    expect(html).not.toContain('>Collapse all</button>');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('<svg');
    expect(html).toMatch(/<h1 class="dh-markdown-outline__heading"[^>]*><button/);
    expect(html).toMatch(/<h2 class="dh-markdown-outline__heading"[^>]*><button/);
    expect(html).toContain('>Alpha</span></button></h1>');
    expect(html).toContain('Alpha content.');
    expect(html).toContain('>Child</');
    expect(html).toContain('Child content.');
    expect(html).toContain('data-markdown-source-start="1"');
    expect(html).toContain('data-markdown-source-start="3"');
    expect(html).toContain('data-markdown-source-start="5"');
    expect(html).toContain('data-markdown-source-start="7"');
  });

  test('is visually just the regular preview when there are no headings', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownOutlinePreview, { text: 'A heading-free document.' }),
    );

    expect(html).toContain('A heading-free document.');
    expect(html).not.toContain('Section browser');
    expect(html).not.toContain('no headings');
  });
});
