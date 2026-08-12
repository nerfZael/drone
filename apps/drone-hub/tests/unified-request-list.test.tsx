import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RIGHT_PANEL_TAB_LABELS } from '../src/droneHub/app/app-config';
import {
  UnifiedRequestList,
  type UnifiedRequestListItem,
} from '../src/droneHub/requests/UnifiedRequestList';

const items: UnifiedRequestListItem[] = [
  {
    number: 1,
    title: 'Flatten request lists',
    state: 'open',
    updatedAt: '2025-01-02T03:04:05.000Z',
    lineStats: { files: 2, additions: 12, modifications: 4, deletions: 3, total: 15 },
    metadata: <span>feature → main</span>,
  },
  {
    number: 2,
    title: 'Previous request',
    state: 'merged',
    metadata: <span>merged yesterday</span>,
    selectionDisabled: true,
  },
];

describe('unified request list', () => {
  test('uses full request names in workspace chrome', () => {
    expect(RIGHT_PANEL_TAB_LABELS.prs).toBe('Pull requests');
    expect(RIGHT_PANEL_TAB_LABELS.requests).toBe('Change requests');
  });

  test('renders a flat selectable list with shared bulk actions', () => {
    const html = renderToStaticMarkup(
      <UnifiedRequestList
        ariaLabel="Change requests"
        items={items}
        selectedNumbers={new Set([1])}
        onSelectedNumbersChange={() => {}}
        onOpenRequest={() => {}}
        query=""
        onQueryChange={() => {}}
        queryPlaceholder="Search change requests"
        filters={[
          { value: 'all', label: 'All', count: 2 },
          { value: 'open', label: 'Open', count: 1 },
        ]}
        activeFilter="all"
        onFilterChange={() => {}}
        mergeAction={{
          label: 'Merge',
          title: 'Merge selected requests',
          tone: 'success',
          onClick: () => {},
        }}
        closeAction={{
          label: 'Close',
          title: 'Close selected requests',
          tone: 'danger',
          onClick: () => {},
        }}
      />,
    );

    expect(html).toContain('aria-label="Search change requests"');
    expect(html).toContain('aria-label="Select request #1"');
    expect(html).toContain('aria-label="Select request #2"');
    expect(html).toContain('1 selected');
    expect(html).toContain('Flatten request lists');
    expect(html).toContain('Previous request');
    expect(html).toContain('title="Request #1"');
    expect(html).not.toContain('<circle cx="4" cy="3.5"');
    expect(html).toContain('dateTime="2025-01-02T03:04:05.000Z"');
    expect(html).toContain('2 files changed, 12 additions, 4 modifications, 3 deletions, 15 total line changes');
    expect(html).toContain('2 files');
    expect(html).toContain('+12');
    expect(html).toContain('~4');
    expect(html).toContain('−3');
    expect(html).toContain('Σ15');
    expect(html).not.toContain(
      'min-h-[4.25rem] items-start gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5 transition-colors hover:bg',
    );
    expect(html).not.toContain('<section');
  });

  test('shows status counts until selection starts', () => {
    const html = renderToStaticMarkup(
      <UnifiedRequestList
        ariaLabel="Pull requests"
        items={items.slice(0, 1)}
        selectedNumbers={new Set()}
        onSelectedNumbersChange={() => {}}
        onOpenRequest={() => {}}
        query=""
        onQueryChange={() => {}}
        queryPlaceholder="Search pull requests"
        filters={[{ value: 'open', label: 'Open', count: 1 }]}
        activeFilter="open"
        onFilterChange={() => {}}
        mergeAction={{ label: 'Merge', title: 'Merge selected', tone: 'success' }}
        closeAction={{ label: 'Close', title: 'Close selected', tone: 'danger' }}
      />,
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Open');
    expect(html).not.toContain('>Merge<');
    expect(html).not.toContain('>Close<');
  });
});
