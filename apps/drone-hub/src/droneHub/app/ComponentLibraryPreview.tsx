import * as React from 'react';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiCardDivider,
  UiCardHeader,
  UiCheckbox,
  UiChoiceGroup,
  UiDialog,
  UiDisclosure,
  UiEmptyState,
  UiField,
  UiFileInput,
  UiIconButton,
  UiInput,
  UiKbd,
  UiMenuSelect,
  UiProgress,
  UiSearchInput,
  UiSelect,
  UiSegmentedControl,
  UiSkeleton,
  UiSlider,
  UiSpinner,
  UiSwitch,
  UiTable,
  UiTableBody,
  UiTableCell,
  UiTableContainer,
  UiTableHead,
  UiTableHeaderCell,
  UiTableRow,
  UiTabs,
  UiTextarea,
  UiToast,
  UiTooltip,
} from '../../ui/components';
import { DESKTOP_THEMES } from '../../theme';
import { ComponentLibraryPatternsPreview } from './ComponentLibraryPatternsPreview';
import { ComponentLibrarySection } from './ComponentLibrarySection';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type PreviewDensity = 'compact' | 'default' | 'comfortable';
type PreviewPanel = 'overview' | 'files' | 'changes';
type PreviewRuntime = 'container' | 'host';

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DroneIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M6.25 7.75h7.5v4.5h-7.5zM2.5 5.5h4M13.5 5.5h4M4.5 5.5l2.25 2.25M15.5 5.5l-2.25 2.25M4 14.5h3M13 14.5h3M7.25 12.25 6 14.5M12.75 12.25 14 14.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="16" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <rect x="5" y="5" width="7.5" height="7.5" rx="1.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M3.5 10.5H3A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

const catalogSections = [
  ['foundation', 'Foundation'],
  ['actions', 'Actions'],
  ['inputs', 'Inputs'],
  ['navigation', 'Navigation'],
  ['feedback', 'Feedback'],
  ['patterns', 'App patterns'],
  ['composition', 'Composition'],
  ['inventory', 'Inventory'],
] as const;

function PreviewCell({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 ${className ?? ''}`}>
      <div
        className="mb-3 text-[length:var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]"
        style={{ fontFamily: 'var(--display)' }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const colorTokens = [
  { label: 'Accent', variable: '--accent' },
  { label: 'Primary text', variable: '--fg' },
  { label: 'Secondary text', variable: '--fg-secondary' },
  { label: 'Supporting text', variable: '--muted' },
  { label: 'Panel', variable: '--panel-raised' },
  { label: 'Success', variable: '--green' },
  { label: 'Warning', variable: '--yellow' },
  { label: 'Danger', variable: '--red' },
  { label: 'Info', variable: '--info' },
] as const;

const componentInventory = [
  ['UiButton', 'Actions and icon actions'],
  ['UiBadge', 'Status and metadata'],
  ['UiCard', 'Flat sections and explicit raised surfaces'],
  ['UiField', 'Labels and validation'],
  ['UiInput', 'Single-line input'],
  ['UiSearchInput', 'Search and clear actions'],
  ['UiFileInput', 'Native file selection'],
  ['UiTextarea', 'Long-form input'],
  ['UiSelect', 'Native option selection'],
  ['UiMenuSelect', 'Searchable menu selection'],
  ['UiSwitch', 'Immediate preferences'],
  ['UiSlider', 'Continuous numeric values'],
  ['UiCheckbox', 'Multi-select choices'],
  ['UiChoiceGroup', 'Descriptive exclusive choices'],
  ['UiSegmentedControl', 'Small exclusive choices'],
  ['UiTabs', 'View navigation'],
  ['UiDisclosure', 'Expandable content'],
  ['UiDialog', 'Modal structure and focus'],
  ['UiAlert', 'Inline feedback'],
  ['UiToast', 'Transient notifications'],
  ['UiSpinner', 'Indeterminate progress'],
  ['UiProgress', 'Transfer and task progress'],
  ['UiSkeleton', 'Content placeholders'],
  ['UiEmptyState', 'Zero-data guidance'],
  ['UiTable', 'Structured settings data'],
  ['UiTooltip', 'Accessible contextual help'],
  ['UiKbd', 'Keyboard shortcuts'],
  ['UiPanel', 'Dock and panel composition'],
  ['UiToolbarButton', 'Dense panel actions'],
  ['UiToolbarLink', 'Dense external and internal links'],
  ['UiToolbarSegmentedControl', 'Compact view selection'],
  ['UiActionMenu', 'Keyboard-accessible action menus'],
  ['UiPaneState', 'Loading, empty, and error states'],
  ['UiNavigationRow', 'Sidebar and explorer rows'],
  ['UiResizeHandle', 'Pointer and keyboard resizing'],
  ['UiStatusChip', 'Compact operational status'],
] as const;

export function ComponentLibraryPreview() {
  const themeId = useDroneHubUiStore((state) => state.themeId);
  const setThemeId = useDroneHubUiStore((state) => state.setThemeId);
  const [agent, setAgent] = React.useState('codex');
  const [density, setDensity] = React.useState<PreviewDensity>('default');
  const [name, setName] = React.useState('Workspace scout');
  const [prompt, setPrompt] = React.useState('Review the active branch and summarize anything that needs attention.');
  const [autoStart, setAutoStart] = React.useState(true);
  const [notifications, setNotifications] = React.useState(true);
  const [showSuccess, setShowSuccess] = React.useState(true);
  const [query, setQuery] = React.useState('workspace');
  const [runtime, setRuntime] = React.useState<PreviewRuntime>('container');
  const [activePanel, setActivePanel] = React.useState<PreviewPanel>('overview');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [toastVisible, setToastVisible] = React.useState(true);
  const [columnWidth, setColumnWidth] = React.useState(420);

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-9 pb-6">
      <UiCard
        surface="raised"
        padding="medium"
        className="relative overflow-hidden border-[var(--accent-border)] bg-[linear-gradient(120deg,var(--accent-subtle),var(--surface-softest)_62%)]"
      >
        <div className="pointer-events-none absolute -right-12 -top-20 h-44 w-44 rounded-full bg-[var(--accent-subtle)] blur-3xl" />
        <div className="relative grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div>
            <UiBadge tone="accent" dot>Foundation v0.1</UiBadge>
            <h2
              className="mt-3 max-w-[28ch] text-[20px] font-[var(--weight-semibold)] leading-tight text-[var(--fg-strong)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              One visual language for every Drone Hub surface.
            </h2>
            <p className="mt-2 max-w-[68ch] text-[length:var(--text-12)] leading-relaxed text-[var(--muted)]">
              These primitives use semantic theme tokens, expose consistent states, and are ready to replace bespoke controls incrementally.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <UiBadge tone="success" dot>{componentInventory.length} primitives</UiBadge>
            <UiBadge tone="neutral">2 themes</UiBadge>
            <UiBadge tone="info">Keyboard focus</UiBadge>
          </div>
        </div>
      </UiCard>

      <nav
        aria-label="Component catalog sections"
        className="sticky top-2 z-20 -my-2 flex items-center gap-1 overflow-x-auto rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] p-1.5 shadow-[0_8px_28px_var(--shadow-color)] backdrop-blur-md"
      >
        {catalogSections.map(([id, label], index) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
            }}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-medium)] px-2.5 text-[length:var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            <span className="font-mono text-[length:var(--text-8)] text-[var(--muted-dim)]">{String(index + 1).padStart(2, '0')}</span>
            {label}
          </button>
        ))}
      </nav>

      <ComponentLibrarySection
        id="foundation"
        eyebrow="01 · Foundation"
        title="Tokens and typography"
        description="Components reference roles such as accent, surface, danger, and muted text. Switching the app theme updates the entire library without component changes."
      >
        <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
          <UiCard>
            <UiCardHeader title="Semantic color roles" description="Theme-owned values exposed through stable CSS variables." />
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {colorTokens.map((token) => (
                <div key={token.variable} className="overflow-hidden rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)]">
                  <div className="h-12 border-b border-[var(--border-subtle)]" style={{ background: `var(${token.variable})` }} />
                  <div className="px-2 py-2">
                    <div className="text-[length:var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">{token.label}</div>
                    <code className="text-[length:var(--text-9)] text-[var(--muted-dim)]">{token.variable}</code>
                  </div>
                </div>
              ))}
            </div>
          </UiCard>

          <UiCard>
            <UiCardHeader title="Theme" description="Preview every component in the app’s supported themes." />
            <div className="mt-4 grid gap-2">
              {DESKTOP_THEMES.map((theme) => {
                const active = theme.id === themeId;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setThemeId(theme.id)}
                    className={`flex items-center gap-3 rounded-[var(--radius-large)] border p-2.5 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                      active
                        ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] hover:border-[var(--border)]'
                    }`}
                  >
                    <span className="flex shrink-0 overflow-hidden rounded-full border border-[var(--border)]">
                      {theme.swatches.map((swatch) => <span key={swatch} className="h-7 w-2.5" style={{ background: swatch }} />)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[length:var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">{theme.label}</span>
                      <span className="block truncate text-[length:var(--text-9)] text-[var(--muted-dim)]">{active ? 'Active theme' : 'Click to preview'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </UiCard>
        </div>

        <UiCard className="mt-3">
          <div className="grid gap-5 md:grid-cols-3">
            <div>
              <div className="dh-type-eyebrow">Brand · Chakra Petch</div>
              <div className="mt-2 text-[20px] font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--brand-display)' }}>Build with drones.</div>
            </div>
            <div>
              <div className="dh-type-eyebrow">UI · System font</div>
              <div className="mt-2 dh-type-control text-[var(--fg-secondary)]">Clear, compact copy for dense desktop workflows.</div>
            </div>
            <div>
              <div className="dh-type-eyebrow">Code · JetBrains Mono</div>
              <code className="mt-2 block text-[length:var(--text-12)] text-[var(--accent)]">drone.run({`{ agent: "codex" }`})</code>
            </div>
          </div>
        </UiCard>

        <UiCard className="mt-3">
          <UiCardHeader
            title="Readable content hierarchy"
            description="Brightness communicates meaning: primary content leads, secondary copy remains comfortable, supporting metadata recedes, and disabled text is the only deliberately dim role."
          />
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <div className="rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2.5">
              <div className="dh-type-label dh-tone-primary">Primary</div>
              <div className="mt-1 text-[var(--chat-question-size)] font-[var(--weight-semibold)] leading-relaxed dh-tone-primary">
                Questions, selected titles, and decisive labels.
              </div>
            </div>
            <div className="rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2.5">
              <div className="dh-type-label dh-tone-secondary">Secondary</div>
              <div className="mt-1 text-[var(--chat-text-size)] leading-relaxed dh-tone-secondary">
                Long-form prose, option descriptions, and ordinary navigation.
              </div>
            </div>
            <div className="rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2.5">
              <div className="dh-type-label dh-tone-supporting">Supporting</div>
              <div className="mt-1 dh-type-supporting dh-tone-supporting">
                Timestamps, counts, importance, and contextual metadata.
              </div>
            </div>
            <div className="rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2.5">
              <div className="dh-type-label dh-tone-disabled">Disabled</div>
              <div className="mt-1 dh-type-control dh-tone-disabled">
                Reserved for controls that cannot currently be used.
              </div>
            </div>
          </div>
        </UiCard>
      </ComponentLibrarySection>

      <ComponentLibrarySection
        id="actions"
        eyebrow="02 · Actions"
        title="Buttons and status"
        description="A small set of explicit variants covers hierarchy without inventing new colors or dimensions per feature."
      >
        <div className="grid gap-3 xl:grid-cols-2">
          <PreviewCell label="Button variants">
            <div className="flex flex-wrap items-center gap-2">
              <UiButton variant="primary">Primary</UiButton>
              <UiButton variant="secondary">Secondary</UiButton>
              <UiButton variant="ghost">Ghost</UiButton>
              <UiButton variant="danger">Danger</UiButton>
            </div>
          </PreviewCell>
          <PreviewCell label="Sizes and states">
            <div className="flex flex-wrap items-center gap-2">
              <UiButton size="small">Small</UiButton>
              <UiButton size="medium">Medium</UiButton>
              <UiButton size="large" trailingIcon={<ArrowIcon />}>Large</UiButton>
              <UiButton variant="primary" loading>Running</UiButton>
              <UiButton disabled>Disabled</UiButton>
              <UiIconButton label="Copy identifier" icon={<CopyIcon />} />
            </div>
          </PreviewCell>
          <PreviewCell label="Badge tones" className="xl:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <UiBadge tone="neutral">Idle</UiBadge>
              <UiBadge tone="accent" dot>Selected</UiBadge>
              <UiBadge tone="success" dot>Online</UiBadge>
              <UiBadge tone="warning">Waiting</UiBadge>
              <UiBadge tone="danger">Failed</UiBadge>
              <UiBadge tone="info">Remote</UiBadge>
            </div>
          </PreviewCell>
        </div>
      </ComponentLibrarySection>

      <ComponentLibrarySection
        id="inputs"
        eyebrow="03 · Inputs"
        title="Forms and preferences"
        description="Labels, help text, validation, and disabled states are part of the component contract rather than recreated by each settings panel."
      >
        <UiCard>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <UiField label="Agent name" htmlFor="component-preview-name" description="Shown in the sidebar and task activity.">
                <UiInput id="component-preview-name" value={name} onChange={(event) => setName(event.target.value)} />
              </UiField>
              <UiField label="Default agent" htmlFor="component-preview-agent">
                <UiMenuSelect
                  value={agent}
                  onValueChange={setAgent}
                  entries={[
                    { value: 'codex', label: 'Codex' },
                    { value: 'claude', label: 'Claude Code' },
                    { value: 'cursor', label: 'Cursor' },
                  ]}
                  triggerClassName="text-[var(--fg)]"
                />
              </UiField>
              <div className="grid gap-3 sm:grid-cols-2">
                <UiField label="Search" htmlFor="component-preview-search">
                  <UiSearchInput
                    id="component-preview-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onClear={() => setQuery('')}
                    placeholder="Search workspaces"
                  />
                </UiField>
                <UiField label="Reasoning" htmlFor="component-preview-reasoning">
                  <UiSelect id="component-preview-reasoning" defaultValue="high">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="xhigh">X-high</option>
                  </UiSelect>
                </UiField>
              </div>
              <UiField label="Startup prompt" htmlFor="component-preview-prompt" description={`${prompt.length}/240 characters`}>
                <UiTextarea
                  id="component-preview-prompt"
                  maxLength={240}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </UiField>
            </div>
            <div className="flex flex-col gap-4">
              <UiField label="Density">
                <UiSegmentedControl
                  label="Preview density"
                  value={density}
                  onValueChange={setDensity}
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'default', label: 'Default' },
                    { value: 'comfortable', label: 'Comfortable' },
                  ]}
                  className="w-full"
                />
              </UiField>
              <UiField label="Runtime">
                <UiChoiceGroup
                  label="Drone runtime"
                  value={runtime}
                  onValueChange={setRuntime}
                  columns={2}
                  options={[
                    { value: 'container', title: 'Container', description: 'Isolated environment', meta: 'Default' },
                    { value: 'host', title: 'Host', description: 'Run in the local workspace' },
                  ]}
                />
              </UiField>
              <UiCard surface="inset" padding="small">
                <div className="flex flex-col gap-3">
                  <UiSwitch
                    checked={autoStart}
                    onCheckedChange={setAutoStart}
                    label="Start after creation"
                    description="Launch the selected agent as soon as the workspace is ready."
                  />
                  <UiCardDivider className="my-0" />
                  <UiSwitch
                    checked={notifications}
                    onCheckedChange={setNotifications}
                    label="Completion notifications"
                    description="Show a desktop notification when the drone needs attention."
                  />
                </div>
              </UiCard>
              <div className="grid gap-3 sm:grid-cols-2">
                <UiCheckbox defaultChecked label="Include AGENTS.md" description="Inject repository guidance." />
                <UiCheckbox label="Open in new pane" description="Keep the current chat visible." />
              </div>
              <UiField label="Validation example" htmlFor="component-preview-invalid" error="Repository path is required.">
                <UiInput id="component-preview-invalid" invalid placeholder="/workspace/project" />
              </UiField>
            </div>
          </div>
          <UiCardDivider />
          <div className="grid gap-4 md:grid-cols-2">
            <UiField
              label="Column width"
              htmlFor="component-preview-width"
              description={`Current value: ${columnWidth}px. Use arrow keys for precise adjustment.`}
            >
              <UiSlider
                id="component-preview-width"
                min={280}
                max={720}
                step={10}
                value={columnWidth}
                onChange={(event) => setColumnWidth(Number(event.target.value))}
              />
            </UiField>
            <UiField
              label="Import configuration"
              htmlFor="component-preview-file"
              description="Accepts .env and JSON files up to 2 MB."
            >
              <UiFileInput id="component-preview-file" accept=".env,.json,text/plain,application/json" />
            </UiField>
          </div>
        </UiCard>
      </ComponentLibrarySection>

      <ComponentLibrarySection
        id="navigation"
        eyebrow="04 · Navigation and overlays"
        title="Tabs, dialogs, and data"
        description="The app repeatedly uses tab strips, modal shells, contextual help, shortcut labels, and compact data tables. These now share one interaction and spacing contract."
      >
        <div className="grid items-start gap-3 xl:grid-cols-2">
          <UiCard>
            <UiCardHeader title="Workspace tabs" description="Use tabs for switching peer views, and segmented controls for compact preference values." />
            <UiTabs
              label="Workspace views"
              value={activePanel}
              onValueChange={setActivePanel}
              className="mt-4"
              options={[
                { value: 'overview', label: 'Overview', tabId: 'component-preview-overview-tab', panelId: 'component-preview-overview-panel' },
                { value: 'files', label: 'Files', badge: 12, tabId: 'component-preview-files-tab', panelId: 'component-preview-files-panel' },
                { value: 'changes', label: 'Changes', badge: 3, badgeTone: 'warning', tabId: 'component-preview-changes-tab', panelId: 'component-preview-changes-panel' },
              ]}
            />
            <div
              role="tabpanel"
              id={`component-preview-${activePanel}-panel`}
              aria-labelledby={`component-preview-${activePanel}-tab`}
              tabIndex={0}
              className="mt-3 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 text-[length:var(--text-11)] text-[var(--muted)]"
            >
              Showing the <span className="font-[var(--weight-semibold)] text-[var(--fg-secondary)]">{activePanel}</span> panel.
            </div>
            <UiDisclosure
              title="Advanced agent options"
              description="Reasoning, sandbox, and permission defaults"
              badge={<UiBadge>3 settings</UiBadge>}
              className="mt-3"
            >
              Feature panels can compose their own controls inside a consistent expandable shell.
            </UiDisclosure>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <UiTooltip content="Create a fresh drone in this repository">
                <UiButton variant="primary" size="small" leadingIcon={<PlusIcon />}>New drone</UiButton>
              </UiTooltip>
              <span className="text-[length:var(--text-10)] text-[var(--muted-dim)]">Shortcut</span>
              <UiKbd>⌘</UiKbd>
              <UiKbd>N</UiKbd>
              <UiButton size="small" onClick={() => setDialogOpen(true)}>Open dialog</UiButton>
            </div>
          </UiCard>

          <UiTableContainer>
            <UiTable>
              <UiTableHead>
                <UiTableRow>
                  <UiTableHeaderCell>Drone</UiTableHeaderCell>
                  <UiTableHeaderCell>Status</UiTableHeaderCell>
                  <UiTableHeaderCell className="text-right">Tasks</UiTableHeaderCell>
                </UiTableRow>
              </UiTableHead>
              <UiTableBody>
                <UiTableRow>
                  <UiTableCell>workspace-scout</UiTableCell>
                  <UiTableCell><UiBadge tone="success" dot>Online</UiBadge></UiTableCell>
                  <UiTableCell className="text-right font-mono">4</UiTableCell>
                </UiTableRow>
                <UiTableRow>
                  <UiTableCell>release-check</UiTableCell>
                  <UiTableCell><UiBadge tone="warning" dot>Waiting</UiBadge></UiTableCell>
                  <UiTableCell className="text-right font-mono">2</UiTableCell>
                </UiTableRow>
                <UiTableRow>
                  <UiTableCell>docs-pass</UiTableCell>
                  <UiTableCell><UiBadge>Idle</UiBadge></UiTableCell>
                  <UiTableCell className="text-right font-mono">0</UiTableCell>
                </UiTableRow>
              </UiTableBody>
            </UiTable>
          </UiTableContainer>
        </div>
      </ComponentLibrarySection>

      <ComponentLibrarySection
        id="feedback"
        eyebrow="05 · Feedback"
        title="System states"
        description="Feedback stays calm and legible while making success, risk, and progress immediately recognizable."
      >
        <div className="grid items-start gap-3 xl:grid-cols-2">
          <div className="flex flex-col gap-2">
            {showSuccess ? (
              <UiAlert
                tone="success"
                title="Workspace ready"
                action={<UiButton variant="ghost" size="small" style={{ color: 'currentColor' }} onClick={() => setShowSuccess(false)}>Dismiss</UiButton>}
              >
                Dependencies restored and agent connection verified.
              </UiAlert>
            ) : (
              <UiButton size="small" onClick={() => setShowSuccess(true)}>Reset success alert</UiButton>
            )}
            <UiAlert tone="info" title="Remote device">Files will be transferred before the task starts.</UiAlert>
            <UiAlert tone="warning" title="Approval needed">This drone is waiting to run a host command.</UiAlert>
            <UiAlert tone="danger" title="Connection lost">The device stopped responding 12 seconds ago.</UiAlert>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PreviewCell label="Progress">
              <div className="flex flex-col gap-4">
                <UiSpinner size="small" label="Connecting" />
                <UiSpinner size="medium" label="Preparing workspace" />
                <UiSpinner size="large" label={null} />
                <UiProgress value={68} label="Transferring files" showValue />
                <UiProgress label="Discovering devices" />
              </div>
            </PreviewCell>
            <PreviewCell label="Skeleton">
              <div className="flex flex-col gap-3">
                <UiSkeleton className="h-7 w-7 rounded-full" />
                <UiSkeleton className="w-3/4" />
                <UiSkeleton className="w-full" />
                <UiSkeleton className="w-1/2" />
              </div>
            </PreviewCell>
            <UiCard padding="none" className="sm:col-span-2">
              <UiEmptyState
                icon={<DroneIcon />}
                title="No drones in this group"
                description="Create a drone or move an existing one here to start collaborating."
                action={<UiButton variant="primary" size="small" leadingIcon={<PlusIcon />}>Create drone</UiButton>}
              />
            </UiCard>
            <div className="sm:col-span-2">
              {toastVisible ? (
                <UiToast
                  tone="success"
                  title="Drone created"
                  description="workspace-scout is ready for its first task."
                  onDismiss={() => setToastVisible(false)}
                />
              ) : (
                <UiButton size="small" onClick={() => setToastVisible(true)}>Show toast</UiButton>
              )}
            </div>
          </div>
        </div>
      </ComponentLibrarySection>

      <ComponentLibraryPatternsPreview />

      <ComponentLibrarySection
        id="composition"
        eyebrow="07 · Composition"
        title="A real app pattern"
        description="Primitives are intentionally composable. This agent card uses only library pieces and layout utilities, with no feature-specific component styling."
      >
        <UiCard surface="raised">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-large)] border border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]">
              <DroneIcon />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate text-[length:var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg-strong)]">{name || 'Untitled agent'}</div>
                <UiBadge tone="success" dot>Running</UiBadge>
                <UiBadge tone="neutral">{agent}</UiBadge>
              </div>
              <p className="mt-1 truncate text-[length:var(--text-11)] text-[var(--muted)]">{prompt || 'No startup prompt'}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <UiIconButton label="Copy drone ID" icon={<CopyIcon />} variant="ghost" />
              <UiButton variant="secondary" trailingIcon={<ArrowIcon />}>Open</UiButton>
            </div>
          </div>
        </UiCard>
      </ComponentLibrarySection>

      <ComponentLibrarySection
        id="inventory"
        eyebrow="08 · Inventory"
        title="Current library surface"
        description="Import primitives from src/ui. Feature components should compose these before introducing new visual APIs."
      >
        <UiCard padding="none" className="overflow-hidden">
          <div className="grid grid-cols-[minmax(8rem,0.45fr)_minmax(0,1fr)] border-b border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-[length:var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
            <span>Component</span>
            <span>Purpose</span>
          </div>
          {componentInventory.map(([component, purpose], index) => (
            <div
              key={component}
              className={`grid grid-cols-[minmax(8rem,0.45fr)_minmax(0,1fr)] gap-3 px-3 py-2.5 text-[length:var(--text-11)] ${
                index < componentInventory.length - 1 ? 'border-b border-[var(--border-subtle)]' : ''
              }`}
            >
              <code className="text-[var(--accent)]">{component}</code>
              <span className="text-[var(--muted)]">{purpose}</span>
            </div>
          ))}
        </UiCard>
      </ComponentLibrarySection>

      <UiDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        tone="accent"
        size="small"
        eyebrow="Component preview"
        title="Create a drone?"
        description="The shared shell handles labelling, focus, Escape, overlay dismissal, and focus restoration."
        icon={<DroneIcon />}
        footer={
          <>
            <UiButton onClick={() => setDialogOpen(false)}>Cancel</UiButton>
            <UiButton variant="primary" onClick={() => setDialogOpen(false)}>Create drone</UiButton>
          </>
        }
      >
        <UiAlert tone="info">Dialog content can compose any of the form and feedback primitives.</UiAlert>
      </UiDialog>
    </div>
  );
}
