import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiChoiceGroup,
  UiDialog,
  UiDisclosure,
  UiField,
  UiFileInput,
  UiInput,
  UiKbd,
  UiProgress,
  UiSelect,
  UiSegmentedControl,
  UiSlider,
  UiSwitch,
  UiTable,
  UiTableBody,
  UiTableCell,
  UiTableContainer,
  UiTableRow,
  UiTabs,
  UiToast,
  UiTooltip,
} from '../src/ui';
import { SETTINGS_TABS } from '../src/droneHub/app/settings-tabs';

describe('drone hub component library', () => {
  test('exposes the component catalog from settings', () => {
    expect(SETTINGS_TABS).toContainEqual({
      id: 'components',
      label: 'Components',
      title: 'Component library',
      description: 'Preview the shared visual primitives and their interactive states across every supported theme.',
    });
  });

  test('renders action and status variants with semantic tokens', () => {
    const html = renderToStaticMarkup(
      <div>
        <UiButton variant="primary">Create drone</UiButton>
        <UiButton loading>Creating</UiButton>
        <UiBadge tone="success" dot>Online</UiBadge>
        <UiAlert tone="danger" title="Connection lost">Try again.</UiAlert>
      </div>,
    );

    expect(html).toContain('bg-[var(--accent)]');
    expect(html).toContain('text-[var(--accent-fg)]');
    expect(html).toContain('text-[length:var(--text-11)]');
    expect(html).not.toContain('text-[var(--text-');
    expect(html).toContain('focus-visible:ring-2');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('bg-[var(--green-subtle)]');
    expect(html).toContain('role="alert"');
    expect(html).toContain('bg-[var(--red-subtle)]');
  });

  test('keeps form and selection semantics in the primitive contract', () => {
    const html = renderToStaticMarkup(
      <div>
        <UiField label="Repository" htmlFor="repo" error="Required">
          <UiInput id="repo" invalid />
        </UiField>
        <UiSwitch checked onCheckedChange={() => {}} label="Start after creation" />
        <UiSegmentedControl
          label="Density"
          value="default"
          onValueChange={() => {}}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'default', label: 'Default' },
          ]}
        />
      </div>,
    );

    expect(html).toContain('for="repo"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('tabindex="0"');
  });

  test('covers navigation, descriptive choices, and native selection', () => {
    const html = renderToStaticMarkup(
      <div>
        <UiSelect defaultValue="host">
          <option value="container">Container</option>
          <option value="host">Host</option>
        </UiSelect>
        <UiChoiceGroup
          label="Runtime"
          value="host"
          onValueChange={() => {}}
          options={[
            { value: 'container', title: 'Container' },
            { value: 'host', title: 'Host' },
          ]}
        />
        <UiTabs
          label="Workspace"
          value="files"
          onValueChange={() => {}}
          options={[
            { value: 'chat', label: 'Chat' },
            { value: 'files', label: 'Files', badge: 4 },
          ]}
        />
        <UiDisclosure title="Advanced settings" defaultOpen>Settings body</UiDisclosure>
      </div>,
    );

    expect(html).toContain('<select');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('<details open=""');
    expect(html).toContain('<summary');
  });

  test('covers file and continuous-value inputs', () => {
    const html = renderToStaticMarkup(
      <div>
        <UiSlider aria-label="Column width" min={280} max={720} defaultValue={420} />
        <UiFileInput aria-label="Import configuration" accept=".env,.json" />
      </div>,
    );

    expect(html).toContain('type="range"');
    expect(html).toContain('min="280"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".env,.json"');
  });

  test('renders shared overlays, progress, transient feedback, data, and utilities', () => {
    const html = renderToStaticMarkup(
      <div>
        <UiDialog open onClose={() => {}} title="Create drone" description="Ready to continue?">
          Dialog body
        </UiDialog>
        <UiProgress value={50} label="Transfer" showValue />
        <UiToast title="Ready" description="Drone started." />
        <UiTooltip content="Keyboard shortcut"><UiButton>Hover me</UiButton></UiTooltip>
        <UiKbd>⌘K</UiKbd>
        <UiTableContainer>
          <UiTable>
            <UiTableBody><UiTableRow><UiTableCell>workspace-scout</UiTableCell></UiTableRow></UiTableBody>
          </UiTable>
        </UiTableContainer>
      </div>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('<kbd');
    expect(html).toContain('<table');
  });
});
