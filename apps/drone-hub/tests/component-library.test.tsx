import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  UiAlert,
  UiActionMenu,
  UiBadge,
  UiButton,
  UiChoiceGroup,
  UiCountBadge,
  UiDialog,
  UiDisclosure,
  UiField,
  UiFileInput,
  UiInput,
  UiKbd,
  UiMenuSelect,
  UiNavigationRow,
  UiPaneState,
  UiPanel,
  UiPanelBody,
  UiPanelHeader,
  UiPanelStatusStrip,
  UiPanelToolbar,
  UiProgress,
  UiResizeHandle,
  UiSelect,
  UiSegmentedControl,
  UiSlider,
  UiStatusChip,
  UiStatusDot,
  UiSwitch,
  UiTable,
  UiTableBody,
  UiTableCell,
  UiTableContainer,
  UiTableRow,
  UiTabs,
  UiToast,
  UiToolbarButton,
  UiToolbarIconButton,
  UiToolbarInput,
  UiToolbarLink,
  UiToolbarSegmentedControl,
  UiTooltip,
} from '../src/ui';
import { ComponentLibraryPatternsPreview } from '../src/droneHub/app/ComponentLibraryPatternsPreview';
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

  test('renders dense application patterns with accessible interaction contracts', () => {
    const html = renderToStaticMarkup(
      <div>
        <UiPanel>
          <UiPanelHeader
            title="Changes"
            density="compact"
            meta={<UiStatusChip tone="warning">3 files</UiStatusChip>}
          />
          <UiPanelStatusStrip tone="warning" dot>Live updates delayed</UiPanelStatusStrip>
          <UiPanelToolbar aria-label="Changes toolbar">
            <UiToolbarSegmentedControl
              label="Changes view"
              value="changes"
              onValueChange={() => {}}
              options={[
                { value: 'changes', label: 'Changes' },
                { value: 'commits', label: 'Commits' },
              ]}
            />
            <UiToolbarInput aria-label="Filter files" />
            <UiToolbarButton pressed>Viewed</UiToolbarButton>
            <UiToolbarButton pressed={false}>Unviewed</UiToolbarButton>
            <UiToolbarIconButton label="Refresh changes" icon={<span>↻</span>} />
            <UiToolbarLink href="/pull/42" tone="accent">Open pull request</UiToolbarLink>
          </UiPanelToolbar>
          <UiPanelBody>
            <UiNavigationRow
              label="Panel.tsx"
              role="treeitem"
              selected
              status={<UiStatusDot tone="success" label="Added" />}
              meta={<UiCountBadge>2</UiCountBadge>}
            />
            <UiPaneState kind="empty" title="No more files" compact />
          </UiPanelBody>
        </UiPanel>
        <UiActionMenu
          label="Panel options"
          icon={<span>…</span>}
          open
          onOpenChange={() => {}}
          entries={[
            { id: 'compact', label: 'Compact', selectionRole: 'radio', checked: true },
            { kind: 'separator', id: 'separator' },
            { id: 'delete', label: 'Delete', tone: 'danger' },
          ]}
          onSelect={() => {}}
        />
        <UiResizeHandle
          orientation="vertical"
          value={320}
          min={240}
          max={720}
          label="Resize panel"
          onValueChange={() => {}}
        />
      </div>,
    );

    expect(html).toContain('role="toolbar"');
    expect(html).toContain('href="/pull/42"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="320"');
    expect(html).toContain('aria-selected="true"');
  });

  test('shows sidebar and feature-panel recipes in the settings catalog', () => {
    const html = renderToStaticMarkup(<ComponentLibraryPatternsPreview />);

    expect(html).toContain('id="patterns"');
    expect(html).toContain('Sidebar navigation');
    expect(html).toContain('Panel recipes');
    expect(html).toContain('Changes');
    expect(html).toContain('Browser');
    expect(html).toContain('Canvas');
    expect(html).toContain('Workflows');
    expect(html).toContain('Pane-state matrix');
  });

  test('keeps dock panels flush and menu triggers semantically distinct from toggles', () => {
    const panelHtml = renderToStaticMarkup(<UiPanel flush>Dock content</UiPanel>);
    const menuHtml = renderToStaticMarkup(
      <UiActionMenu
        label="View options"
        triggerContent="View"
        open
        onOpenChange={() => {}}
        entries={[{ id: 'stacked', label: 'Stacked' }]}
        onSelect={() => {}}
      />,
    );
    const numericTriggerHtml = renderToStaticMarkup(
      <UiActionMenu
        label="Numeric options"
        triggerContent={0}
        entries={[{ id: 'zero', label: 'Zero' }]}
        onSelect={() => {}}
      />,
    );

    expect(panelHtml).not.toContain('rounded-[var(--radius-large)]');
    expect(panelHtml).not.toContain('border-[var(--border-subtle)]');
    expect(menuHtml).toContain('aria-haspopup="menu"');
    expect(menuHtml).toContain('aria-expanded="true"');
    expect(menuHtml).not.toContain('aria-pressed');
    expect(numericTriggerHtml).toContain('>0</span>');
  });

  test('exposes menu selection with listbox semantics', () => {
    const html = renderToStaticMarkup(
      <UiMenuSelect
        value="squash"
        open
        onOpenChange={() => {}}
        onValueChange={() => {}}
        entries={[
          { value: 'merge', label: 'Merge' },
          { value: 'squash', label: 'Squash' },
        ]}
      />,
    );

    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls=');
  });

  test('keeps enabled segmented options keyboard reachable when selection is disabled', () => {
    const html = renderToStaticMarkup(
      <UiToolbarSegmentedControl
        label="Context"
        value="pull-request"
        onValueChange={() => {}}
        options={[
          { value: 'branch', label: 'Branch' },
          { value: 'pull-request', label: 'Pull request', disabled: true },
        ]}
      />,
    );

    expect(html).toMatch(
      /role="radio"[^>]*aria-checked="false"[^>]*tabindex="0"[^>]*>.*Branch/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*role="radio"[^>]*aria-checked="true"[^>]*tabindex="-1"[^>]*>.*Pull request/,
    );
  });
});
