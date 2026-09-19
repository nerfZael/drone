import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CompanionProposalStrip } from '../src/droneHub/companion/CompanionProposalStrip';

const summary = (targetId: string, title: string, status: 'draft' | 'executing' | 'failed' = 'draft') => ({
  targetId, revision: '1', title, status, operationCount: 1, defaultRepoPath: null,
});

describe('Companion proposal strip', () => {
  test('stacks compact proposal summaries by default and marks the reviewed one', () => {
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
    expect(html).toContain('data-proposal-display="summaries"');
    expect(html.indexOf('>Create reviewer<')).toBeLessThan(html.indexOf('>Rename group<'));
    expect(html.indexOf('>Rename group<')).toBeLessThan(html.indexOf('>Send message<'));
    expect(html).toContain('>1.</span>');
    expect(html).toContain('>Failed</span>');
    expect(html).toContain('>Applying</span>');
  });

  test('offers the space-saving numbered tabs as an alternate mode', () => {
    const html = renderToStaticMarkup(
      <CompanionProposalStrip
        proposals={[summary('a', 'Create reviewer'), summary('b', 'Rename group')]}
        selectedId="a"
        displayMode="numbers"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('data-proposal-display="numbers"');
    expect(html).toContain('>Proposals<');
    expect(html.indexOf('>1</button>')).toBeLessThan(html.indexOf('>2</button>'));
    expect(html).not.toContain('>Create reviewer</span>');
  });

  test('shows for a single proposal and renders nothing without one', () => {
    expect(renderToStaticMarkup(<CompanionProposalStrip proposals={[]} selectedId={null} onSelect={() => {}} />)).toBe('');
    const html = renderToStaticMarkup(
      <CompanionProposalStrip proposals={[summary('a', 'Only one')]} selectedId="a" onSelect={() => {}} />,
    );
    expect(html).toContain('>Proposal<');
    expect(html).toContain('aria-label="Proposal 1: Only one; hide it"');
  });

  test('a hidden review keeps its summary selected and offers to show it again', () => {
    const html = renderToStaticMarkup(
      <CompanionProposalStrip proposals={[summary('a', 'Only one')]} selectedId="a" selectedOpen={false} onSelect={() => {}} />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('title="Show Only one"');
  });
});
