import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppConfirmDialog } from '../src/ui/AppConfirmDialog';

describe('application confirmation dialog', () => {
  test('renders an accessible themed confirmation instead of browser chrome', () => {
    const html = renderToStaticMarkup(
      <AppConfirmDialog
        open
        title="Merge PR #596?"
        message="Merge into main using a merge commit."
        confirmLabel="Merge"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Merge PR #596?');
    expect(html).toContain('Merge into main using a merge commit.');
    expect(html).toContain('bg-[var(--panel-overlay)]');
    expect(html).toContain('Cancel');
  });

  test('uses the destructive treatment for close and forced actions', () => {
    const html = renderToStaticMarkup(
      <AppConfirmDialog
        open
        destructive
        title="Close PR #596?"
        message="This closes the pull request without merging it."
        confirmLabel="Close pull request"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(html).toContain('border-[var(--red-border)]');
    expect(html).toContain('text-[var(--red)]');
    expect(html).toContain('Close pull request');
  });
});
