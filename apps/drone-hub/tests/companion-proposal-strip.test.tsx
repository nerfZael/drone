import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CompanionProposalStrip } from '../src/droneHub/companion/CompanionProposalStrip';

const summary = (targetId: string, title: string, status: 'draft' | 'executing' | 'failed' = 'draft') => ({
  targetId, revision: '1', title, status, operationCount: 1, defaultRepoPath: null,
});

describe('Companion proposal strip', () => {
  test('numbers every pending proposal in order and marks the reviewed one', () => {
    const html = renderToStaticMarkup(
      <CompanionProposalStrip
        proposals={[summary('a', 'Create reviewer'), summary('b', 'Rename group', 'failed'), summary('c', 'Send message', 'executing')]}
        selectedId="b"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Pending proposals"');
    expect(html).toContain('aria-label="Proposal 1: Create reviewer"');
    expect(html).toContain('aria-label="Proposal 2: Rename group · Failed; hide it"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Proposal 3: Send message · Applying"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.indexOf('>1<')).toBeLessThan(html.indexOf('>2<'));
    expect(html).not.toContain('>Create reviewer<');
  });

  test('shows for a single proposal and renders nothing without one', () => {
    expect(renderToStaticMarkup(<CompanionProposalStrip proposals={[]} selectedId={null} onSelect={() => {}} />)).toBe('');
    const html = renderToStaticMarkup(
      <CompanionProposalStrip proposals={[summary('a', 'Only one')]} selectedId="a" onSelect={() => {}} />,
    );
    expect(html).toContain('>Proposal<');
    expect(html).toContain('aria-label="Proposal 1: Only one; hide it"');
  });

  test('a hidden review keeps its number selected and offers to show it again', () => {
    const html = renderToStaticMarkup(
      <CompanionProposalStrip proposals={[summary('a', 'Only one')]} selectedId="a" selectedOpen={false} onSelect={() => {}} />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('title="Show Only one"');
  });
});
