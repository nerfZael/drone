import * as React from 'react';
import {
  UiActionMenu,
  UiCard,
  UiCardHeader,
  UiCountBadge,
  UiNavigationRow,
  UiPaneState,
  UiPanel,
  UiPanelBody,
  UiPanelHeader,
  UiPanelStatusStrip,
  UiPanelToolbar,
  UiResizeHandle,
  UiStatusChip,
  UiStatusDot,
  UiToolbarButton,
  UiToolbarDivider,
  UiToolbarIconButton,
  UiToolbarInput,
  UiToolbarSegmentedControl,
} from '../../ui/components';
import { IconChat, IconDrone, IconFolder } from '../icons';
import {
  IconFolderGit,
  IconMore,
  IconPlus,
  IconSettings,
  IconTune,
} from './icons';
import { ComponentLibrarySection } from './ComponentLibrarySection';

type PreviewPattern = 'changes' | 'browser' | 'canvas' | 'workflows';
type ChangeSource = 'working' | 'apply';
type DiffView = 'changes' | 'commits';

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M12.5 5.5V2.75l-1 1A5 5 0 1 0 12.8 9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d={locked ? 'M4.5 7V5.5a3.5 3.5 0 0 1 7 0V7' : 'M5.5 7V5.5a2.5 2.5 0 1 1 5 0'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="4" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5v6M5.5 8.5h2A4 4 0 0 0 11.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

const panelOptions = [
  { value: 'changes', label: 'Changes' },
  { value: 'browser', label: 'Browser' },
  { value: 'canvas', label: 'Canvas' },
  { value: 'workflows', label: 'Workflows' },
] as const;

function SidebarPattern() {
  const [groupOpen, setGroupOpen] = React.useState(true);
  const [recentOnly, setRecentOnly] = React.useState(false);

  return (
    <UiCard padding="none" className="overflow-visible">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <UiCardHeader
          title="Sidebar navigation"
          description="Shell, nested rows, operational status, hover actions, and the collapsed rail."
        />
      </div>
      <div className="grid min-h-[24rem] grid-cols-[minmax(0,1fr)_3rem] overflow-visible">
        <UiPanel className="m-3 mr-0 rounded-r-none" surface="alternate">
          <UiPanelHeader
            title="Drone Hub"
            density="compact"
            meta={<UiStatusChip tone="success" dot>Local</UiStatusChip>}
            actions={
              <UiToolbarIconButton
                label="Create drone"
                icon={<IconPlus className="h-3.5 w-3.5" />}
                tone="accent"
              />
            }
          />
          <UiPanelBody scroll className="p-1.5">
            <UiNavigationRow
              label="drone"
              description="/work/drone"
              leading={<IconFolderGit className="h-3.5 w-3.5" />}
              status={<UiCountBadge>3</UiCountBadge>}
              expandable
              open
              selected
              current
            />
            <UiNavigationRow
              label="Release readiness"
              leading={<IconFolder size={13} />}
              depth={1}
              expandable
              open={groupOpen}
              onOpenChange={setGroupOpen}
              actions={
                <UiToolbarIconButton
                  label="Add drone to group"
                  icon={<IconPlus className="h-3 w-3" />}
                  size="xsmall"
                  tone="accent"
                />
              }
            />
            {groupOpen ? (
              <>
                <UiNavigationRow
                  label="workspace-scout"
                  description="Reviewing component coverage"
                  leading={<IconDrone size={13} />}
                  depth={2}
                  selected
                  status={<UiStatusDot tone="warning" pulse label="Working" />}
                  meta="2m"
                />
                <UiNavigationRow
                  label="release-check"
                  description="Approval required"
                  leading={<IconChat size={12} />}
                  depth={2}
                  status={<UiStatusChip tone="warning">Approve</UiStatusChip>}
                  actions={
                    <UiActionMenu
                      label="Chat actions"
                      icon={<IconMore className="h-3 w-3" />}
                      size="xsmall"
                      align="end"
                      entries={[
                        { id: 'rename', label: 'Rename chat' },
                        { id: 'move', label: 'Move to group' },
                        { kind: 'separator', id: 'danger' },
                        { id: 'delete', label: 'Delete chat', tone: 'danger' },
                      ]}
                      onSelect={() => {}}
                    />
                  }
                />
                <UiNavigationRow
                  label="docs-pass"
                  leading={<IconChat size={12} />}
                  depth={2}
                  status={<UiStatusDot tone="success" label="Unread response" />}
                  meta={<UiCountBadge>1</UiCountBadge>}
                />
              </>
            ) : null}
            <UiNavigationRow
              label="Archived"
              leading={<IconFolder size={13} />}
              depth={1}
              expandable
              open={false}
              disabled
            />
          </UiPanelBody>
          <UiPanelToolbar aria-label="Sidebar footer" className="border-b-0 border-t">
            <UiToolbarButton className="min-w-0 flex-1 justify-start" leadingIcon={<IconFolderGit className="h-3.5 w-3.5" />}>
              Repositories
            </UiToolbarButton>
            <UiActionMenu
              label="Sidebar options"
              icon={<IconMore className="h-3.5 w-3.5" />}
              entries={[
                {
                  id: 'recent',
                  label: 'Recent drones only',
                  selectionRole: 'checkbox',
                  checked: recentOnly,
                },
                { id: 'hidden', label: 'Show hidden groups' },
                { kind: 'separator', id: 'layout' },
                { id: 'side', label: 'Dock sidebar right' },
              ]}
              onSelect={(id) => {
                if (id === 'recent') setRecentOnly((current) => !current);
              }}
            />
            <UiToolbarIconButton label="Open settings" icon={<IconSettings className="h-3.5 w-3.5" />} />
          </UiPanelToolbar>
        </UiPanel>
        <div className="my-3 mr-3 flex flex-col items-center gap-2 rounded-r-[var(--radius-large)] border border-l-0 border-[var(--border-subtle)] bg-[var(--surface-inset)] pt-2">
          <UiToolbarIconButton label="Expand sidebar" icon={<IconDrone size={13} />} tone="accent" />
          <UiToolbarIconButton label="Create drone" icon={<IconPlus className="h-3.5 w-3.5" />} />
          <UiToolbarIconButton label="Open settings" icon={<IconSettings className="h-3.5 w-3.5" />} />
        </div>
      </div>
    </UiCard>
  );
}

function ChangesPattern() {
  const [source, setSource] = React.useState<ChangeSource>('working');
  const [view, setView] = React.useState<DiffView>('changes');
  const [explorerWidth, setExplorerWidth] = React.useState(150);

  return (
    <UiPanel className="h-[22rem]" surface="alternate">
      <UiPanelHeader
        title="Changes"
        density="compact"
        leading={<BranchIcon />}
        meta={<UiStatusChip tone="warning">3 files</UiStatusChip>}
        actions={
          <UiActionMenu
            label="Changes view options"
            icon={<IconMore className="h-3 w-3" />}
            size="xsmall"
            entries={[
              { id: 'split', label: 'Split diff', selectionRole: 'radio', checked: true },
              { id: 'stacked', label: 'Stacked diff', selectionRole: 'radio' },
              { kind: 'separator', id: 'visibility' },
              { id: 'viewed', label: 'Hide viewed files', selectionRole: 'checkbox', checked: false },
            ]}
            onSelect={() => {}}
          />
        }
      />
      <UiPanelToolbar aria-label="Changes controls">
        <UiToolbarSegmentedControl
          label="Change source"
          value={source}
          onValueChange={setSource}
          options={[
            { value: 'working', label: 'Working' },
            { value: 'apply', label: 'Apply' },
          ]}
        />
        <div className="flex-1" />
        <UiToolbarSegmentedControl
          label="Changes view"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'changes', label: 'Changes' },
            { value: 'commits', label: 'Commits' },
          ]}
        />
        <UiToolbarDivider />
        <UiToolbarButton size="xsmall">100%</UiToolbarButton>
      </UiPanelToolbar>
      <UiPanelBody className="flex">
        <div className="min-w-0 flex-1 bg-[var(--surface-inset-faint)] p-2">
          <div className="mb-2 flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-2 py-1.5">
            <UiStatusChip tone="warning">M</UiStatusChip>
            <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--text-10)] text-[var(--fg-secondary)]">
              ComponentLibraryPreview.tsx
            </span>
            <UiToolbarButton size="xsmall" tone="success">Stage</UiToolbarButton>
          </div>
          <div className="overflow-hidden rounded border border-[var(--border-subtle)] bg-[var(--panel)] font-mono text-[length:var(--text-9)]">
            <div className="bg-[var(--red-subtle)] px-2 py-1 text-[var(--red)]">− bespoke panel control</div>
            <div className="bg-[var(--green-subtle)] px-2 py-1 text-[var(--green)]">+ shared toolbar primitive</div>
            <div className="px-2 py-1 text-[var(--muted-dim)]">  keyboard and focus behavior included</div>
          </div>
        </div>
        <UiResizeHandle
          orientation="vertical"
          value={explorerWidth}
          min={100}
          max={220}
          step={10}
          label="Resize changes explorer"
          reversed
          onValueChange={setExplorerWidth}
          onReset={() => setExplorerWidth(150)}
        />
        <div className="shrink-0 bg-[var(--panel)] p-1.5" style={{ width: explorerWidth }}>
          <div className="mb-1 flex items-center justify-between px-1 text-[length:var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]">
            <span>Files</span>
            <UiCountBadge>3</UiCountBadge>
          </div>
          <UiNavigationRow label="src" leading={<IconFolder size={12} />} expandable open density="compact" />
          <UiNavigationRow label="ui" leading={<IconFolder size={12} />} depth={1} expandable open density="compact" />
          <UiNavigationRow role="treeitem" label="Panel.tsx" depth={2} selected density="compact" status={<UiStatusChip tone="success">A</UiStatusChip>} />
          <UiNavigationRow role="treeitem" label="Toolbar.tsx" depth={2} density="compact" status={<UiStatusChip tone="warning">M</UiStatusChip>} />
        </div>
      </UiPanelBody>
    </UiPanel>
  );
}

function BrowserPattern() {
  const [locked, setLocked] = React.useState(true);
  const [offline, setOffline] = React.useState(false);
  const [url, setUrl] = React.useState('http://localhost:3000/settings');

  return (
    <UiPanel className="h-[22rem]" surface="alternate">
      <UiPanelHeader
        title="Browser"
        density="compact"
        meta={<span className="font-mono text-[length:var(--text-9)] text-[var(--muted-dim)]">:3000</span>}
        actions={
          <>
            <UiToolbarIconButton
              label={locked ? 'Unlock browser' : 'Lock browser'}
              icon={<LockIcon locked={locked} />}
              size="xsmall"
              tone="accent"
              pressed={locked}
              onClick={() => setLocked((current) => !current)}
            />
            <UiToolbarButton size="xsmall" active>Links <UiCountBadge>2/3</UiCountBadge></UiToolbarButton>
            <UiToolbarIconButton
              label="Reload preview"
              icon={<RefreshIcon />}
              size="xsmall"
              onClick={() => setOffline(false)}
            />
          </>
        }
      />
      <UiPanelToolbar aria-label="Browser address bar">
        <UiToolbarInput
          value={url}
          readOnly={locked}
          onChange={(event) => setUrl(event.target.value)}
          aria-label="Browser URL"
          className="min-w-[12rem] flex-1"
        />
        <UiToolbarButton disabled={locked}>Save</UiToolbarButton>
        <UiToolbarButton
          tone={offline ? 'warning' : 'neutral'}
          active={offline}
          onClick={() => setOffline((current) => !current)}
        >
          {offline ? 'Offline' : 'Test offline'}
        </UiToolbarButton>
      </UiPanelToolbar>
      <UiPanelBody className="bg-[var(--surface-inset-faint)]">
        {offline ? (
          <UiPaneState
            kind="offline"
            title="Port looks offline"
            description="The preview keeps its saved URL and offers a clear recovery action."
            action={<UiToolbarButton tone="accent" onClick={() => setOffline(false)}>Try again</UiToolbarButton>}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-[linear-gradient(135deg,var(--accent-subtle),var(--surface-inset-faint))] px-5 text-center">
            <div className="rounded-[var(--radius-large)] border border-[var(--accent-border)] bg-[var(--panel-overlay)] px-4 py-3 shadow-[0_12px_30px_var(--shadow-color)]">
              <div className="text-[length:var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg-strong)]">Component library</div>
              <div className="mt-1 font-mono text-[length:var(--text-9)] text-[var(--muted)]">{url}</div>
            </div>
          </div>
        )}
      </UiPanelBody>
    </UiPanel>
  );
}

function CanvasPattern() {
  const [showMessages, setShowMessages] = React.useState(true);

  return (
    <UiPanel className="h-[22rem]" surface="alternate">
      <UiPanelHeader
        title="Canvas"
        density="compact"
        actions={
          <>
            <UiToolbarIconButton label="Canvas controls" icon={<IconTune className="h-3.5 w-3.5" />} size="xsmall" pressed />
            <UiToolbarButton size="xsmall" pressed={showMessages} onClick={() => setShowMessages((current) => !current)}>
              Last msgs
            </UiToolbarButton>
            <UiToolbarButton size="xsmall">Reset</UiToolbarButton>
            <span className="w-10 text-right font-mono text-[length:var(--text-9)] text-[var(--muted-dim)]">86%</span>
          </>
        }
      />
      <UiPanelToolbar aria-label="Canvas creation defaults">
        <span className="text-[length:var(--text-8)] font-[var(--weight-semibold)] uppercase text-[var(--muted-dim)]">Agent</span>
        <UiToolbarButton>Codex</UiToolbarButton>
        <UiToolbarDivider />
        <span className="text-[length:var(--text-8)] font-[var(--weight-semibold)] uppercase text-[var(--muted-dim)]">Model</span>
        <UiToolbarInput defaultValue="gpt-5" aria-label="Canvas model" className="w-24" />
      </UiPanelToolbar>
      <UiPanelBody
        className="relative overflow-hidden"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(var(--canvas-dot-rgb), .22) 0.7px, transparent 0.9px)',
          backgroundSize: '22px 22px',
        }}
      >
        <div className="absolute left-5 top-8 w-44 rounded-[var(--radius-large)] border border-[var(--accent-muted)] bg-[var(--panel-overlay)] p-2.5 shadow-[0_10px_24px_var(--shadow-color)]">
          {showMessages ? <div className="mb-1 truncate text-[length:var(--text-8)] text-[var(--muted-dim)]">Catalog audit complete.</div> : null}
          <div className="flex items-center gap-2">
            <UiStatusDot tone="success" />
            <span className="truncate text-[length:var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">workspace-scout</span>
          </div>
        </div>
        <div className="absolute bottom-12 right-8 w-40 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] p-2.5 shadow-[0_10px_24px_var(--shadow-color)]">
          <UiStatusChip tone="accent">Draft</UiStatusChip>
          <div className="mt-1 truncate text-[length:var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">New drone</div>
        </div>
        <svg className="pointer-events-none absolute inset-0 h-full w-full text-[var(--accent-muted)]" aria-hidden="true">
          <path d="M178 66 C240 66 260 180 330 180" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 4" />
        </svg>
        <div className="absolute inset-x-3 bottom-2 flex items-center gap-2 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] p-1.5 shadow-[0_8px_20px_var(--shadow-color)]">
          <UiToolbarInput placeholder="Message selected nodes…" aria-label="Canvas message" className="flex-1" />
          <UiToolbarButton tone="accent" active>Send</UiToolbarButton>
        </div>
      </UiPanelBody>
    </UiPanel>
  );
}

function WorkflowsPattern() {
  const [live, setLive] = React.useState(false);

  return (
    <UiPanel className="h-[22rem]">
      {!live ? (
        <UiPanelStatusStrip
          tone="warning"
          dot
          action={<UiToolbarButton size="xsmall" tone="warning" onClick={() => setLive(true)}>Refresh now</UiToolbarButton>}
        >
          Live updates are unavailable. Changes may be delayed.
        </UiPanelStatusStrip>
      ) : null}
      <UiPanelHeader
        eyebrow="Workflow"
        title="Release readiness"
        description="Review, verify, and prepare the release."
        meta={<UiStatusChip tone="accent">v3</UiStatusChip>}
        actions={
          <>
            <UiToolbarButton tone="danger">Delete</UiToolbarButton>
            <UiToolbarButton tone="accent" active>Run workflow</UiToolbarButton>
          </>
        }
      />
      <UiPanelToolbar aria-label="Workflow runs">
        <span className="text-[length:var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]">Runs</span>
        <UiCountBadge>03</UiCountBadge>
        <UiToolbarButton tone="success" pressed leadingIcon={<UiStatusDot tone="success" />}>Complete · 10:42</UiToolbarButton>
        <UiToolbarButton tone="warning" leadingIcon={<UiStatusDot tone="warning" />}>Approval · 10:47</UiToolbarButton>
      </UiPanelToolbar>
      <UiPanelBody scroll className="p-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[length:var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">Review changes</span>
              <UiStatusChip tone="success" dot>Done</UiStatusChip>
            </div>
            <div className="mt-2 text-[length:var(--text-9)] text-[var(--muted)]">2 agents · 4 invocations</div>
          </div>
          <div className="rounded-[var(--radius-large)] border border-[var(--yellow-border)] bg-[var(--yellow-subtle)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[length:var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">Publish release</span>
              <UiStatusChip tone="warning" dot>Approval</UiStatusChip>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <UiToolbarButton tone="accent">Approve</UiToolbarButton>
              <UiToolbarButton tone="danger">Deny</UiToolbarButton>
            </div>
          </div>
        </div>
      </UiPanelBody>
    </UiPanel>
  );
}

function PanelPattern() {
  const [activePattern, setActivePattern] = React.useState<PreviewPattern>('changes');

  return (
    <UiCard padding="medium">
      <UiCardHeader
        title="Panel recipes"
        description="One shared shell supports dense controls while each feature keeps its own content."
      />
      <div className="mt-3 max-w-full overflow-x-auto pb-1">
        <UiToolbarSegmentedControl
          label="Panel recipe"
          value={activePattern}
          onValueChange={setActivePattern}
          size="small"
          options={panelOptions}
        />
      </div>
      <div className="mt-4">
        {activePattern === 'changes' ? <ChangesPattern /> : null}
        {activePattern === 'browser' ? <BrowserPattern /> : null}
        {activePattern === 'canvas' ? <CanvasPattern /> : null}
        {activePattern === 'workflows' ? <WorkflowsPattern /> : null}
      </div>
    </UiCard>
  );
}

function StateMatrix() {
  return (
    <UiCard>
      <UiCardHeader
        title="Pane-state matrix"
        description="Every panel should use the same full-pane contract for non-content states."
      />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-inset)]">
          <UiPaneState compact kind="loading" title="Loading changes" description="Fetching the latest branch state." />
        </div>
        <div className="rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-inset)]">
          <UiPaneState compact kind="empty" title="Nothing here yet" description="Create or select an item to begin." />
        </div>
        <div className="rounded-[var(--radius-large)] border border-[var(--red-border)] bg-[var(--red-subtle)]">
          <UiPaneState compact kind="error" title="Panel failed to load" description="Keep the error and recovery action together." />
        </div>
        <div className="rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-inset)]">
          <UiPaneState compact kind="unavailable" title="Repository unavailable" description="Explain why the feature is disabled." />
        </div>
      </div>
    </UiCard>
  );
}

export function ComponentLibraryPatternsPreview() {
  return (
    <ComponentLibrarySection
      id="patterns"
      eyebrow="06 · Application patterns"
      title="Sidebar, panels, and dense workspace controls"
      description="These shared pieces capture the repeated structure and interaction behavior used by the real workspace. Feature panels compose them without giving up their own identity."
    >
      <div className="grid items-start gap-3 2xl:grid-cols-[minmax(21rem,0.8fr)_minmax(36rem,1.2fr)]">
        <SidebarPattern />
        <PanelPattern />
      </div>
      <div className="mt-3">
        <StateMatrix />
      </div>
    </ComponentLibrarySection>
  );
}
