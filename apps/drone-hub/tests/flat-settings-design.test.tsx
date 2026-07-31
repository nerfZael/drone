import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SettingsListRow, SettingsSection } from '../src/droneHub/app/SettingsSurface';
import { UiCard, UiDisclosure } from '../src/ui';

describe('flat settings design', () => {
  test('keeps the default card flat and requires an explicit raised surface', () => {
    const flat = renderToStaticMarkup(<UiCard>Content</UiCard>);
    const raised = renderToStaticMarkup(<UiCard surface="raised">Content</UiCard>);

    expect(flat).toContain('bg-transparent');
    expect(flat).not.toContain('border-[var(--border-subtle)]');
    expect(flat).not.toContain('shadow-[var(--edge-highlight)]');
    expect(raised).toContain('border-[var(--border-subtle)]');
    expect(raised).toContain('shadow-[var(--edge-highlight),var(--shadow-raised)]');
  });

  test('uses separators and row selection instead of nested cards', () => {
    const html = renderToStaticMarkup(
      <SettingsSection title="Skills" description="Portable packages">
        <SettingsListRow selected title="agent-copilot" detail="agent-copilot" />
      </SettingsSection>,
    );

    expect(html).toContain('dh-settings-section');
    expect(html).toContain('bg-[var(--selected)]');
    expect(html).toContain('before:bg-[var(--accent)]');
    expect(html).not.toContain('bg-[var(--surface-softest)]');
  });

  test('renders disclosures as document sections rather than cards', () => {
    const html = renderToStaticMarkup(
      <UiDisclosure title="Advanced" defaultOpen>Options</UiDisclosure>,
    );

    expect(html).toContain('border-b border-[var(--border-subtle)]');
    expect(html).not.toContain('rounded-[var(--radius-large)] border');
    expect(html).not.toContain('bg-[var(--surface-softest)]');
  });
});
