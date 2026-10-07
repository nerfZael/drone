import { COMPANION_FILE_PRESENTATION, type FilePresentation, type PresentedFile } from '../files/companion-file-presentation';
import { READ_WORKSPACE_LAYOUT } from '../workspace-layout/workspace-layout-events';
import { retainClosedSideChatWindows } from './retainClosedSideChatWindows';
import { closeDockedWindows } from './closeDockedWindows';
import { flushSync } from 'react-dom';
import { captureWorkspacePreset, restoreWorkspacePreset, remapPresetFiles, assertWorkspacePresetCanRestore } from './workspace-layout-presets';
import { registerWorkspacePresetTarget } from './workspace-preset-target';
import { registerChatWindowLayout } from '../chat-layout/registerChatWindowLayout';
import { UndoChatWindowLayout } from '../chat-layout/UndoChatWindowLayout';
import React from 'react';
import { IconTrash } from './icons';
import { ChatWindowTab, usePanelTitle } from './ChatWindowTab';
import { DockTabShell, OpenDesktopToolButton, stopTabEvent } from './DockTabShell';
import { OCCUPIED_GROUP_CONSTRAINTS, useWorkspacePanelExpansion } from './workspace-panel-expansion';
import { ChatsDockTab } from './ChatsDockTab';
import { TerminalHeaderControlsContext } from '../terminal/terminal-header-controls-context';
import {
  requestNewTerminalSession,
  useCanRequestNewTerminalSession,
} from '../terminal/terminal-new-session-request';
import { ChatUsageBadge } from '../usage/ChatUsageBadge';
import { measureSideChatBounds, readSideChatWorkspaceState, restoreSideChatBounds, saveSideChatWorkspaceState } from './side-chat-workspace-state';
import { placeSideChat } from './side-chat-placement';
import { useFloatingWindowKeeper } from './use-floating-window-keeper';
import { workspaceGridPanelCount } from './workspace-panel-count';
import { isUsableFloatingBounds } from './floating-window-bounds';
import { alignFloatingChats, SIDE_CHAT_PANEL_PREFIX } from './align-floating-chats';
import { prepareSideChatPanel } from './prepareSideChatPanel';
import { consumeKeepFocusOnChatActivation, focusChatWindow } from './focus-chat-window';
import { ALIGN_FLOATING_CHATS_EVENT, FOCUS_SIDE_CHAT_EVENT, type FocusSideChatDetail } from './side-chat-events';
import type { WorkspaceSideChat } from './use-workspace-side-chats';
import { EditorPaneContext } from './editor-pane-context';
import { OPEN_FILE_EXPLORER_EVENT } from '../files/file-explorer-navigation';
import { closeCanvasChatPanel, leaveCanvasFullView, useCanvasFullViewStore } from '../canvas/canvas-full-view';
import { openedFileTabId } from './opened-file-tabs';
import { ChangesExplorerContext } from '../changes/changes-explorer-context';
import { readWorkspaceExplorerWidth } from './workspace-explorer-preferences';
import { dropOverlayContextFromEvent, emptySlotDirectionForDrop, isCollapsedEmptySlot, isNoOpDropOverlay } from './workspace-drop-overlay';
import {
  FOCUS_FILE_PANEL_EVENT,
  FILE_PANEL_PREFIX,
  filePanelId,
  filePanelPositionForDrop,
  fileTabIdFromPanelId,
  hasFileTabDragPayload,
  readFileTabDragPayload,
  type DropPosition,
  type FileTabDragPayload,
} from './file-tab-drag';
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from 'dockview';
import 'dockview/dist/styles/dockview.css';
import {
  UiPanel,
  UiPanelBody,
  UiPanelToolbar,
  UiToolbarSegmentedControl,
} from '../../ui/components';
import type { DroneSummary } from '../types';
import { profileStorageKey } from '../../profile-storage';
import {
  normalizeRightPanelTab,
  RIGHT_PANEL_TAB_LABELS,
  type RightPanelTab,
} from './app-config';
import { useMobileViewport } from './use-mobile-viewport';
import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';

export type WorkspacePaneHeaderMode = 'normal' | 'compact';
type WorkspacePaneKey = 'single' | 'top' | 'bottom';
type PreviewHostState = {
  style: React.CSSProperties;
  activeDroneId: string | null;
  previewVisible: boolean;
};

type DockableDroneWorkspaceProps = {
  currentDrone: DroneSummary;
  paneHeaderMode: WorkspacePaneHeaderMode;
  activeToolTab: RightPanelTab;
  openRequestNonce: number;
  chatContent: React.ReactNode;
  sideChats?: WorkspaceSideChat[];
  mainChatName?: string;
  displacedMainChatName?: string;
  renderDisplacedMainChat?: (chatName: string) => React.ReactNode;
  onRestoreMainChat?: () => void;
  sideChatReturnRequest?: { droneId: string; chatName: string } | null;
  sideChatFocusRequest?: { droneId: string; chatName: string } | null;
  mainChatControls?: React.ReactNode;
  renderSideChat?: (chat: WorkspaceSideChat) => React.ReactNode;
  /** Title-bar actions of a floating forked chat, shown next to its delete action. */
  renderSideChatHeaderActions?: (chat: WorkspaceSideChat) => React.ReactNode;
  onCloseSideChat?: (chatName: string) => void;
  onRenameSideChat?: (chatName: string, newName: string) => Promise<{ ok: boolean; error?: string | null }>;
  sideChatStatus?: React.ReactNode;
  renderToolPane: (tab: RightPanelTab, paneKey: WorkspacePaneKey) => React.ReactNode;
  previewTab: RightPanelTab;
  onActiveToolTabChange?: (tab: RightPanelTab) => void;
  onPreviewHostChange?: (state: PreviewHostState) => void;
  onVisibleToolTabsChange?: (tabs: RightPanelTab[]) => void;
  /** Keeps floating side chat windows out of sight, positions and all, until it is off again. */
  hideFloatingSideChats?: boolean;
  /** Something needs a floating window on screen: one was focused, returned to, or just created. */
  onRevealFloatingSideChats?: () => void;
  onBeforeWorkspaceMouseDown?: () => void;
  onAfterToolPanelRemove?: () => void;
  /** Files opened in their own workspace windows by dragging editor tabs onto the grid. */
  fileWindows?: WorkspaceFileWindows;
  /** Use the one layout shared by every drone instead of this drone's own. */
  sharedLayout?: boolean;
};

export type WorkspaceFileWindow = { tabId: string; path: string; name: string };
export type WorkspaceFileWindows = {
  presetRootPath?: string;
  restorePresetFiles?: (files: WorkspaceFileWindow[]) => void;
  render: (file: WorkspaceFileWindow) => React.ReactNode;
  /** Tab ids currently open in the editor state; windows for other ids close themselves. */
  openTabIds: readonly string[];
  dirtyTabIds?: readonly string[];
  /** Tab ids currently shown in their own windows (excluded from the editor's tab strip). */
  onDetachedTabsChange?: (tabIds: string[]) => void;
  /** The user closed a file window (not a move); the host decides whether the file closes. */
  onClosed?: (tabId: string) => void;
};

const CHAT_PANEL_ID = 'agent-chat';
const DEFAULT_CHAT_NAME = 'default';
const EXPLORER_PANEL_ID = 'file-explorer';
const CHANGES_EXPLORER_PANEL_ID = 'changes-explorer';
const EXPLORER_PANEL_IDS = [EXPLORER_PANEL_ID, CHANGES_EXPLORER_PANEL_ID];
const TOOL_PANEL_PREFIX = 'tool:';
const DEFAULT_NEW_TOOL_PANEL_WIDTH = 720;
const DEFAULT_NEW_TOOL_PANEL_HEIGHT = 320;
const NEW_TOOL_PANEL_MIN_WIDTH = 360;
const NEW_TOOL_PANEL_MAX_WIDTH = 1200;
const EDITOR_PANEL_MIN_WIDTH = 480;
const PANE_HEADER_MODE_STORAGE_KEY = profileStorageKey('droneHub.workspacePaneHeaderMode');
const LEGACY_LAYOUT_STORAGE_KEY = profileStorageKey('droneHub.workspaceLayout.global');
// Not the legacy key above: that one is deleted once a drone has its own layout.
export const SHARED_WORKSPACE_LAYOUT_STORAGE_KEY = profileStorageKey('droneHub.workspaceLayout.shared');
const PREVIEW_HOST_SELECTOR = '[data-dockview-preview-host="1"]';
const disposedWorkspaceIds = new Set<string>();

// Dockview treats a new option callback as a configuration change and forces
// layout, even when only chat content changed. Keep this independent of React
// renders so background updates cannot interfere with an active resize.
const workspaceTabContextMenuItems: NonNullable<React.ComponentProps<typeof DockviewReact>['getTabContextMenuItems']> = ({ panel, group }) => {
  if (panel.id === CHAT_PANEL_ID || panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX)) return [];
  // Bulk tool-tab actions must not remove chats or bypass their
  // delete confirmation when a floating chat is docked in the group.
  const tools = group.panels.filter((item) =>
    item.id !== CHAT_PANEL_ID && !item.id.startsWith(SIDE_CHAT_PANEL_PREFIX));
  return [
    'close',
    { label: 'Close Others', action: () => tools.filter((item) => item !== panel).forEach((item) => item.api.close()) },
    { label: 'Close All', action: () => tools.forEach((item) => item.api.close()) },
  ];
};

export function workspaceLayoutStorageKey(droneIdRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return profileStorageKey(`droneHub.workspaceLayout.drone.${encodeURIComponent(droneId)}`);
}

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const droneId = disposedDroneIdFromEvent(event);
    if (!droneId) return;
    disposedWorkspaceIds.add(droneId);
    try {
      window.localStorage.removeItem(workspaceLayoutStorageKey(droneId));
    } catch {
      // Ignore localStorage cleanup failures.
    }
  });
}

function previewHostStatesEqual(a: PreviewHostState, b: PreviewHostState): boolean {
  return (
    a.activeDroneId === b.activeDroneId &&
    a.previewVisible === b.previewVisible &&
    a.style.left === b.style.left &&
    a.style.top === b.style.top &&
    a.style.width === b.style.width &&
    a.style.height === b.style.height
  );
}

function toolPanelId(tab: RightPanelTab): string {
  return `${TOOL_PANEL_PREFIX}${tab}`;
}

function isEditorChangesTab(tab: RightPanelTab): boolean {
  return tab === 'editor' || tab === 'changes';
}

function tabFromPanelId(panelId: string): RightPanelTab | null {
  if (panelId === EXPLORER_PANEL_ID) return 'editor';
  if (panelId === CHANGES_EXPLORER_PANEL_ID) return 'changes';
  const raw = panelId.startsWith(TOOL_PANEL_PREFIX) ? panelId.slice(TOOL_PANEL_PREFIX.length) : '';
  return normalizeRightPanelTab(raw.split(':')[0]);
}

type WorkspaceDockPanel = DockviewApi['panels'][number];

type WorkspaceToolParameters = { tab?: unknown; paneKey?: WorkspacePaneKey; splitEditor?: boolean; splitChangesExplorer?: boolean };

function workspaceToolParameters(panel: WorkspaceDockPanel): WorkspaceToolParameters {
  // getParameters() only contains the last API update; params also includes
  // the initial/restored values, including which explorer was intentionally closed.
  return panel.params ?? panel.api.getParameters<WorkspaceToolParameters>();
}

function tabFromPanel(panel: WorkspaceDockPanel): RightPanelTab | null {
  const idTab = tabFromPanelId(panel.id);
  if (EXPLORER_PANEL_IDS.includes(panel.id) || !idTab || !isEditorChangesTab(idTab)) return idTab;
  const params = workspaceToolParameters(panel);
  return normalizeRightPanelTab(params.tab) ?? idTab;
}

function editorChangesPanels(api: DockviewApi): WorkspaceDockPanel[] {
  return api.panels.filter((panel) => {
    const idTab = tabFromPanelId(panel.id);
    return !EXPLORER_PANEL_IDS.includes(panel.id) && Boolean(idTab && isEditorChangesTab(idTab));
  });
}

function visibleToolTabs(api: DockviewApi): RightPanelTab[] {
  const tabs = new Set<RightPanelTab>();
  for (const panel of api.panels) {
    const tab = tabFromPanel(panel);
    if (tab) tabs.add(tab);
  }
  return Array.from(tabs);
}

function clampNewToolPanelWidth(width: number): number {
  const safe = Number.isFinite(width) ? Math.round(width) : DEFAULT_NEW_TOOL_PANEL_WIDTH;
  return Math.max(NEW_TOOL_PANEL_MIN_WIDTH, Math.min(NEW_TOOL_PANEL_MAX_WIDTH, safe));
}

function isGridPanel(panel: WorkspaceDockPanel): boolean {
  // Panels without group information (e.g. before Dockview has laid them out)
  // count as grid panels so a bare chat still reads as a chat-only grid.
  const locationType = panel.api?.group?.api?.location?.type;
  return locationType === undefined || locationType === 'grid';
}

/** True when the docked grid holds nothing but the main chat. Floating and
 * popout groups (forked chats) do not count as open workspace panes. */
export function isChatOnlyGrid(api: DockviewApi): boolean {
  const gridPanels = api.panels.filter(isGridPanel);
  return gridPanels.length === 1 && gridPanels[0].id === CHAT_PANEL_ID;
}

function newToolPanelWidth(api: DockviewApi, referencePanelId: string): number {
  const workspaceWidth = Math.round(Number(api.width ?? 0));
  const referenceGroup = api.groups.find((group) => group.panels.some((panel) => panel.id === referencePanelId));
  const referenceWidth = Math.round(Number(referenceGroup?.width ?? 0));
  const availableWidth = workspaceWidth > 0 ? workspaceWidth : referenceWidth;
  if (availableWidth > 0) {
    const gridGroupCount = api.groups.filter((group) => group.api.location.type === 'grid').length;
    if (isChatOnlyGrid(api)) return Math.round(availableWidth * 2 / 3);
    const nextGroupCount = Math.max(2, gridGroupCount + 1);
    return clampNewToolPanelWidth(availableWidth / nextGroupCount);
  }
  return DEFAULT_NEW_TOOL_PANEL_WIDTH;
}

type GridGroup = DockviewApi['groups'][number];

function isStandaloneExplorerGroup(group: GridGroup): boolean {
  return group.panels.length === 1 && EXPLORER_PANEL_IDS.includes(group.panels[0].id);
}

function measuredGridGroups(api: DockviewApi): GridGroup[] {
  return api.groups.filter((group) => {
    if (group.api.location.type !== 'grid') return false;
    const width = Math.round(Number(group.width ?? 0));
    const height = Math.round(Number(group.height ?? 0));
    return width > 0 && height > 0;
  });
}

export type RebalanceGridGroupOptions = {
  /** Explorer sidebar width measured before Dockview handed a closed
   * neighbour's space to the explorer; keeps the sidebar from growing. */
  explorerWidths?: Record<string, number>;
};

export function rebalanceGridGroupWidths(api: DockviewApi, options: RebalanceGridGroupOptions = {}): void {
  const groups = measuredGridGroups(api);
  const workspaceWidth = Math.round(Number(api.width ?? 0));
  if (workspaceWidth <= 0 || groups.length <= 1) return;

  // Capture both sidebar widths before resizing siblings redistributes their space.
  const explorers = groups.filter(isStandaloneExplorerGroup);
  const widths = new Map(explorers.map((group) => {
    const preferred = options.explorerWidths?.[group.panels[0].id];
    return [group, preferred && Number.isFinite(preferred) ? Math.round(preferred) : group.width];
  }));
  const toolGroups = groups.filter((group) => !widths.has(group));
  if (toolGroups.length === 0) return;
  const explorerWidth = Array.from(widths.values()).reduce((sum, width) => sum + width, 0);
  const targetWidth = Math.max(1, Math.floor((workspaceWidth - explorerWidth) / toolGroups.length));
  for (const group of toolGroups) {
    const height = Math.max(1, Math.round(Number(group.height ?? 0)));
    group.api.setSize({ width: targetWidth, height });
  }
  for (const [group, width] of widths) group.api.setSize({ width });
}

/** Snapshot of grid group widths, taken before opening a tool so the panes the
 * user already sized can be restored around the newly added ones. */
export function captureGridGroupWidths(api: DockviewApi): Map<GridGroup, number> {
  return new Map(measuredGridGroups(api).map((group) => [group, Math.round(Number(group.width))]));
}

/** Makes room for groups added since `previousWidths` was captured without
 * resetting the widths the user chose for the existing panes. An explorer
 * added beside an existing tool takes its space from that tool only;
 * other new panes shrink the existing panes proportionally. */
export function fitAddedGridGroups(api: DockviewApi, previousWidths: Map<GridGroup, number>): void {
  const groups = measuredGridGroups(api);
  const workspaceWidth = Math.round(Number(api.width ?? 0));
  const added = groups.filter((group) => !previousWidths.has(group));
  if (workspaceWidth <= 0 || added.length === 0) return;
  const existing = groups.filter((group) => previousWidths.has(group));
  const addedExplorers = added.filter(isStandaloneExplorerGroup);
  const addedTools = added.filter((group) => !isStandaloneExplorerGroup(group));
  const explorerWidth = readWorkspaceExplorerWidth();
  const targets = new Map<GridGroup, number>();

  const ownerGroups = addedExplorers.map((group) => {
    const tab = tabFromPanelId(group.panels[0].id);
    return editorChangesPanels(api).find((panel) => tabFromPanel(panel) === tab)?.api.group;
  });
  if (addedExplorers.length > 0 && addedTools.length === 0 && ownerGroups.every((group) => group && previousWidths.has(group))) {
    // Reopening an explorer only takes space from its own editor or changes pane.
    for (const group of existing) targets.set(group, previousWidths.get(group)!);
    for (const group of ownerGroups) targets.set(group!, Math.max(1, targets.get(group!)! - explorerWidth));
  } else {
    const addedWidth = addedTools.reduce((sum, group) => sum + Math.round(Number(group.width)), 0)
      + addedExplorers.length * explorerWidth;
    // Existing explorers stay at their width; the other panes keep their ratios.
    const fixedWidth = existing
      .filter(isStandaloneExplorerGroup)
      .reduce((sum, group) => sum + previousWidths.get(group)!, 0);
    const scale = Math.max(0, workspaceWidth - addedWidth - fixedWidth) / Math.max(1, workspaceWidth - fixedWidth);
    for (const group of existing) {
      const previous = previousWidths.get(group)!;
      targets.set(group, isStandaloneExplorerGroup(group) ? previous : Math.max(1, Math.round(previous * scale)));
    }
    for (const group of addedTools) targets.set(group, Math.round(Number(group.width)));
  }
  for (const explorer of addedExplorers) targets.set(explorer, explorerWidth);
  // Dockview hands each resize's difference to the rightmost pane, so sizing
  // left to right leaves every earlier pane on target and the last one with
  // exactly the remainder.
  const left = (group: GridGroup) => group.element?.getBoundingClientRect?.().left ?? 0;
  const ordered = Array.from(targets).sort(([a], [b]) => left(a) - left(b));
  for (const [group, width] of ordered) {
    group.api.setSize({ width, height: Math.max(1, Math.round(Number(group.height ?? 0))) });
  }
}

function standaloneExplorerWidths(api: DockviewApi, removedPanelId: string): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const id of EXPLORER_PANEL_IDS) {
    if (id === removedPanelId) continue;
    const group = api.getPanel(id)?.api.group;
    if (!group || !isStandaloneExplorerGroup(group) || group.api.location.type !== 'grid') continue;
    const width = Math.round(Number(group.width ?? 0));
    if (width > 0) widths[id] = width;
  }
  return widths;
}

export function sizeWorkspaceOpenedFromChat(api: DockviewApi): void {
  api.getPanel(CHAT_PANEL_ID)?.api.group.api.setSize({ width: Math.round(api.width / 3) });
  for (const id of EXPLORER_PANEL_IDS) {
    const explorerGroup = api.getPanel(id)?.api.group;
    if (explorerGroup && isStandaloneExplorerGroup(explorerGroup) && explorerGroup.api.location.type === 'grid') {
      explorerGroup.api.setSize({ width: readWorkspaceExplorerWidth() });
    }
  }
}

export function readWorkspacePaneHeaderMode(): WorkspacePaneHeaderMode {
  if (typeof localStorage === 'undefined') return 'normal';
  return localStorage.getItem(PANE_HEADER_MODE_STORAGE_KEY) === 'compact' ? 'compact' : 'normal';
}

export function writeWorkspacePaneHeaderMode(mode: WorkspacePaneHeaderMode): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PANE_HEADER_MODE_STORAGE_KEY, mode);
}

function parseStoredLayout(raw: string | null): SerializedDockview | null {
  try {
    const parsed = JSON.parse(raw ?? 'null');
    return parsed && typeof parsed === 'object' && 'grid' in parsed && 'panels' in parsed
      ? (parsed as SerializedDockview)
      : null;
  } catch {
    return null;
  }
}

function readStoredLayout(droneId: string, shared: boolean): SerializedDockview | null {
  if (typeof localStorage === 'undefined') return null;
  // The shared layout starts from the chat alone, never from a drone's layout.
  if (shared) return parseStoredLayout(localStorage.getItem(SHARED_WORKSPACE_LAYOUT_STORAGE_KEY));
  const stored = parseStoredLayout(localStorage.getItem(workspaceLayoutStorageKey(droneId)));
  if (stored) return stored;
  return parseStoredLayout(localStorage.getItem(LEGACY_LAYOUT_STORAGE_KEY));
}

function writeStoredLayout(droneId: string, layout: SerializedDockview, shared: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (shared) {
    localStorage.setItem(SHARED_WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    return;
  }
  localStorage.setItem(workspaceLayoutStorageKey(droneId), JSON.stringify(layout));
  // The global layout predates per-drone workspaces. Once it has been copied
  // into a drone-specific key, do not seed every newly visited drone with it.
  localStorage.removeItem(LEGACY_LAYOUT_STORAGE_KEY);
}

function ensureExplorerPanel(api: DockviewApi, referencePanel: string, paneKey: WorkspacePaneKey, tab: RightPanelTab = 'editor'): boolean {
  const id = tab === 'changes' ? CHANGES_EXPLORER_PANEL_ID : EXPLORER_PANEL_ID;
  const title = tab === 'changes' ? 'Changes Explorer' : 'File Explorer';
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.updateParameters({ ...workspaceToolParameters(existing), tab, paneKey });
    existing.api.setTitle(title);
    return false;
  }
  api.addPanel({
    id,
    component: 'tool',
    title,
    params: { tab, paneKey },
    position: { direction: 'right', referencePanel },
    initialWidth: readWorkspaceExplorerWidth(),
    minimumWidth: 180,
    minimumHeight: 180,
  });
  return true;
}

export function ensureWorkspaceToolPanel(api: DockviewApi, tab: RightPanelTab, paneKey: WorkspacePaneKey, referencePanel: string = CHAT_PANEL_ID): boolean {
  let id = toolPanelId(tab);
  const existing = isEditorChangesTab(tab)
    ? editorChangesPanels(api).find((panel) => tabFromPanel(panel) === tab)
    : api.getPanel(id);
  if (existing) {
    if (isEditorChangesTab(tab)) {
      const existingParams = workspaceToolParameters(existing);
      existing.api.updateParameters({
        ...existingParams,
        tab,
        paneKey: existingParams.paneKey ?? paneKey,
        ...(tab === 'editor' ? { splitEditor: true } : { splitChangesExplorer: true }),
      });
    }
    existing.api.setTitle(RIGHT_PANEL_TAB_LABELS[tab]);
    if (isEditorChangesTab(tab)) {
      existing.api.setConstraints({ minimumWidth: EDITOR_PANEL_MIN_WIDTH });
    }
    const addedExplorer = isEditorChangesTab(tab) && ensureExplorerPanel(
      api, existing.id, workspaceToolParameters(existing).paneKey ?? paneKey, tab,
    );
    existing.api.setActive();
    return addedExplorer;
  }

  // Older layouts can have Changes in tool:editor (or vice versa). Keep that
  // panel and its position, and allocate a free ID for the other tool.
  for (let sequence = 2; api.getPanel(id); sequence += 1) id = `${toolPanelId(tab)}:${sequence}`;
  const initialWidth = newToolPanelWidth(api, referencePanel);
  api.addPanel({
    id,
    component: 'tool',
    title: RIGHT_PANEL_TAB_LABELS[tab],
    params: { tab, paneKey, ...(tab === 'editor' ? { splitEditor: true } : tab === 'changes' ? { splitChangesExplorer: true } : {}) },
    position: {
      direction: paneKey === 'bottom' ? 'below' : 'right',
      referencePanel,
    },
    initialWidth,
    initialHeight: DEFAULT_NEW_TOOL_PANEL_HEIGHT,
    minimumWidth: isEditorChangesTab(tab) ? EDITOR_PANEL_MIN_WIDTH : 260,
    minimumHeight: 180,
  });
  if (isEditorChangesTab(tab)) {
    ensureExplorerPanel(api, id, paneKey, tab);
    api.getPanel(id)?.api.setActive();
  }
  return true;
}

function ensureChatPanel(api: DockviewApi): void {
  if (api.getPanel(CHAT_PANEL_ID)) return;
  const referencePanel = api.panels.find((panel) => panel.api.group.api.location.type === 'grid');
  api.addPanel({
    id: CHAT_PANEL_ID,
    component: 'chat',
    title: DEFAULT_CHAT_NAME,
    ...(referencePanel
      ? { position: { direction: 'left' as const, referencePanel: referencePanel.api.id } }
      : {}),
    minimumWidth: 320,
    minimumHeight: 220,
  });
}

export function restoreRequiredWorkspacePanels(api: DockviewApi): void {
  // Empty grid slots are kept: the user creates them on purpose by dragging a
  // pane into half of its own space. Only the main chat is mandatory.
  ensureChatPanel(api);
}

export function refreshWorkspacePanelTitles(api: DockviewApi): void {
  for (const panel of api.panels) {
    if (panel.id === CHAT_PANEL_ID) {
      // The mounted panel replaces this with the current main chat name.
      panel.api.setTitle(DEFAULT_CHAT_NAME);
      continue;
    }
    const tab = tabFromPanel(panel);
    if (tab) panel.api.setTitle(EXPLORER_PANEL_IDS.includes(panel.id) ? (tab === 'changes' ? 'Changes Explorer' : 'File Explorer') : RIGHT_PANEL_TAB_LABELS[tab]);
  }
}

/** Restore every tool as saved; Editor and Changes no longer replace one another. */
export function migrateEditorChangesPanels(api: DockviewApi): void {
  for (const panel of editorChangesPanels(api)) {
    const tab = tabFromPanel(panel)!;
    panel.api.updateParameters({ ...workspaceToolParameters(panel), tab });
    panel.api.setTitle(RIGHT_PANEL_TAB_LABELS[tab]);
    panel.api.setConstraints({ minimumWidth: EDITOR_PANEL_MIN_WIDTH });
  }
}

/** Upgrade old combined panes once, while respecting an explorer the user subsequently closed. */
export function migrateWorkspaceExplorerPanels(api: DockviewApi): void {
  const active = api.activePanel;
  // The previous shared explorer could be saved in Changes mode. Restore the
  // editor explorer's identity and give Changes its own independently movable panel.
  const editorExplorer = api.getPanel(EXPLORER_PANEL_ID);
  if (editorExplorer) {
    editorExplorer.api.updateParameters({ ...workspaceToolParameters(editorExplorer), tab: 'editor' });
    editorExplorer.api.setTitle('File Explorer');
  }
  for (const panel of editorChangesPanels(api)) {
    const tab = tabFromPanel(panel);
    if (tab !== 'editor' && tab !== 'changes') continue;
    const flag = tab === 'editor' ? 'splitEditor' : 'splitChangesExplorer';
    const params = workspaceToolParameters(panel);
    if (params[flag]) continue;
    ensureExplorerPanel(api, panel.id, params.paneKey ?? 'single', tab);
    panel.api.updateParameters({ ...params, [flag]: true });
  }
  active?.api.setActive();
}

/**
 * A shared layout can hold file windows of the drone it was last arranged in.
 * They show that drone's files, so they close without resizing their neighbours,
 * and the files stay open in that drone's editor.
 */
export function removeOtherDronesFileWindows(api: DockviewApi, droneId: string): void {
  for (const panel of [...api.panels]) {
    if (!panel.id.startsWith(FILE_PANEL_PREFIX)) continue;
    const params = (panel.params ?? {}) as { droneId?: unknown; tabId?: unknown };
    const tabId = String(params.tabId ?? fileTabIdFromPanelId(panel.id) ?? '');
    const owner = typeof params.droneId === 'string' ? params.droneId : null;
    if (owner ? owner !== droneId : !tabId.startsWith(openedFileTabId(droneId, ''))) api.removePanel(panel);
  }
}

export function resetWorkspaceToChat(api: DockviewApi): void {
  api.clear();
  ensureChatPanel(api);
}

/** Room around the chat's widest reading line: the transcript's side padding, its scrollbar, the panel's border. */
const CANVAS_CHAT_PANEL_CHROME_PX = 48 + 12 + 1;

/**
 * The main chat in the canvas's full view: a panel at the canvas's left, as wide as the chat's widest reading line
 * and no wider, so widening it would change nothing. It is for reading; the canvas's composer writes to it, so its
 * own composer is hidden and only the line above it (runtime, branch, asks) stays.
 */
function CanvasChatPanel({ droneId, chatName, chatContent, top }: {
  droneId: string;
  chatName: string;
  chatContent: React.ReactNode;
  top: number;
}) {
  const probeRef = React.useRef<HTMLSpanElement | null>(null);
  const [width, setWidth] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    setWidth(Math.ceil(probe.getBoundingClientRect().width) + CANVAS_CHAT_PANEL_CHROME_PX);
  }, []);
  return (
    <div data-canvas-chat-panel="true" className="dh-canvas-chat-panel absolute bottom-0 left-0 z-20 flex max-w-[calc(100%-3rem)] flex-col border-r border-[var(--border)] bg-[var(--panel)] shadow-[0_0_24px_rgba(0,0,0,.35)]"
      style={{ top, width: width ?? undefined }}>
      {/* The chat's reading line, in the chat's own font. */}
      <span ref={probeRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 h-0 overflow-hidden"
        style={{ width: 'var(--chat-prose-max)', font: 'var(--chat-text-size)/1.65 var(--prose)' }} />
      <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] pl-3 pr-1 text-11 font-medium text-[var(--fg-secondary)]">
        <span className="min-w-0 flex-1 truncate">{chatName}</span>
        <button type="button" aria-label="Close chat" onClick={closeCanvasChatPanel}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12" /><path d="M18 6L6 18" />
          </svg>
        </button>
      </div>
      <UiPanel flush className="min-h-0 flex-1" data-main-workspace-chat="true" data-chat-drone-id={droneId} data-chat-name={chatName}>
        <React.Fragment key={droneId}>{chatContent}</React.Fragment>
      </UiPanel>
    </div>
  );
}

function ChatPanel({ containerApi }: IDockviewPanelProps) {
  const { chatContent, mainChatName, droneId } = React.useContext(DockableDroneWorkspaceContext);
  // In the canvas's full view the chat can show in a panel over the canvas instead; it is mounted in one place.
  const inCanvasPanel = useCanvasFullViewStore((state) => state.fullView && state.chatPanelOpen);
  const content = inCanvasPanel ? null : chatContent;
  React.useEffect(() => {
    const panel = containerApi.getPanel(CHAT_PANEL_ID);
    if (panel) panel.api.setTitle(mainChatName || DEFAULT_CHAT_NAME);
  }, [containerApi, mainChatName]);
  return <UiPanel flush className="h-full outline-none" data-main-workspace-chat="true" data-chat-drone-id={droneId} data-chat-name={mainChatName}><React.Fragment key={droneId}>{content}</React.Fragment></UiPanel>;
}

/** Main chat tab: the chat name with its estimated cost. It never closes. */
function MainChatTab({ api }: IDockviewPanelHeaderProps) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  const title = usePanelTitle(api);
  const chatName = ctx.mainChatName || DEFAULT_CHAT_NAME;
  return (
    <div className="dv-default-tab" data-testid="dockview-dv-default-tab" title={title}
      data-chat-drone-id={ctx.droneId} data-chat-name={chatName}>
      <span className="dv-default-tab-content">{title} <ChatUsageBadge droneId={ctx.droneId} chatName={chatName} /></span>
    </div>
  );
}

function SideChatPanel({ params }: IDockviewPanelProps<{ chatName: string }>) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  if (params.chatName === ctx.mainChatName && ctx.displacedMainChatName) {
    return ctx.renderDisplacedMainChat?.(ctx.displacedMainChatName);
  }
  const chat = ctx.sideChats.find((item) => item.name === params.chatName);
  return chat ? ctx.renderSideChat?.(chat) : null;
}

/**
 * Whether the view an explorer drives (Editor or Changes) is on screen. While it is
 * tabbed away, the explorer's selection is dimmed so it doesn't read as what is shown.
 */
function usePairedViewVisible(containerApi: DockviewApi, explorerId: string): boolean {
  const tab: RightPanelTab = explorerId === CHANGES_EXPLORER_PANEL_ID ? 'changes' : 'editor';
  const read = React.useCallback(
    () => editorChangesPanels(containerApi).some((panel) => tabFromPanel(panel) === tab && panel.api.isVisible),
    [containerApi, tab],
  );
  const [visible, setVisible] = React.useState(read);
  React.useEffect(() => {
    const update = () => setVisible(read());
    update();
    const disposables = [
      containerApi.onDidLayoutChange(update),
      containerApi.onDidActivePanelChange(update),
      containerApi.onDidMaximizedGroupChange(update),
    ];
    return () => disposables.forEach((disposable) => disposable.dispose());
  }, [containerApi, read]);
  return visible;
}

function ToolPanel({ api, containerApi, params }: IDockviewPanelProps<{ tab?: unknown; paneKey?: WorkspacePaneKey }>) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  const isExplorer = EXPLORER_PANEL_IDS.includes(api.id);
  const pairedViewVisible = usePairedViewVisible(containerApi, api.id);
  const selectionMuted = isExplorer && !pairedViewVisible ? '1' : undefined;
  const tab = EXPLORER_PANEL_IDS.includes(api.id) ? tabFromPanelId(api.id) : normalizeRightPanelTab(params.tab) ?? tabFromPanelId(api.id);
  const paneKey = params.paneKey ?? 'single';
  const previewHostedHere = Boolean(tab && tab === ctx.previewTab);
  const onPreviewHostChanged = ctx.onPreviewHostChanged;

  React.useLayoutEffect(() => {
    if (!previewHostedHere) return;
    onPreviewHostChanged();
  }, [onPreviewHostChanged, previewHostedHere]);

  if (!tab) return null;

  if (api.id === CHANGES_EXPLORER_PANEL_ID) {
    return <div ref={ctx.setChangesExplorerHost} className="h-full min-h-0" aria-label="Changes Explorer" data-explorer-selection-muted={selectionMuted}>
      <div className="hidden only:block p-3 text-11 text-[var(--muted)]">Open Changes to browse its files.</div>
    </div>;
  }

  return (
    <UiPanel
      flush
      surface="alternate"
      data-dockview-preview-host={previewHostedHere ? '1' : undefined}
      data-explorer-selection-muted={selectionMuted}
      className="dh-utility-panel relative h-full"
    >
      <EditorPaneContext.Provider value={api.id === EXPLORER_PANEL_ID ? 'explorer' : 'editor'}>
        <TerminalHeaderControlsContext.Provider value>
          <ChangesExplorerContext.Provider value={tab === 'changes' ? ctx.changesExplorerHost : undefined}>
            {previewHostedHere ? <div className="absolute inset-0 min-h-0 overflow-hidden" aria-hidden="true" /> : (
              <React.Fragment key={tab === 'canvas' ? 'canvas' : ctx.droneId}>
                {ctx.renderToolPane(tab, paneKey)}
              </React.Fragment>
            )}
          </ChangesExplorerContext.Provider>
        </TerminalHeaderControlsContext.Provider>
      </EditorPaneContext.Provider>
    </UiPanel>
  );
}

function FilePanel({ api, containerApi, params }: IDockviewPanelProps<{ tabId?: string; path?: string; name?: string; droneId?: string }>) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  const tabId = String(params.tabId ?? fileTabIdFromPanelId(api.id) ?? '');
  const path = String(params.path ?? '');
  const name = String(params.name ?? '') || path.split('/').filter(Boolean).pop() || 'File';
  const knownTabs = ctx.openFileTabIds;
  const stale = Boolean(knownTabs) && (!tabId || (Boolean(params.droneId) && params.droneId !== ctx.droneId) || !knownTabs!.has(tabId));
  const dirty = Boolean(tabId && ctx.dirtyFileTabIds?.has(tabId));

  React.useEffect(() => {
    // The file was closed elsewhere, so the window has nothing left to show.
    // A shared-workspace switch may already have removed it before this effect.
    if (stale && containerApi.getPanel(api.id)) api.close();
  }, [api, containerApi, stale]);
  React.useEffect(() => {
    api.setTitle(dirty ? `${name}*` : name);
  }, [api, dirty, name]);

  if (!tabId || stale || !ctx.renderFilePane) return null;
  return (
    <UiPanel flush surface="alternate" className="dh-utility-panel relative h-full">
      <EditorPaneContext.Provider value="editor">{ctx.renderFilePane({ tabId, path, name })}</EditorPaneContext.Provider>
    </UiPanel>
  );
}

function detachedFileTabIds(api: DockviewApi): string[] {
  const ids: string[] = [];
  for (const panel of api.panels) {
    if (!panel.id.startsWith(FILE_PANEL_PREFIX)) continue;
    const tabId = String((panel.params as { tabId?: unknown } | undefined)?.tabId ?? fileTabIdFromPanelId(panel.id) ?? '');
    if (tabId) ids.push(tabId);
  }
  return ids;
}

function dragEventOf(event: DragEvent | PointerEvent): DragEvent | null {
  return 'dataTransfer' in event ? event : null;
}

const terminalTab = () => 'terminal' as const;

/**
 * The terminal's tab carries its new-terminal button beside the close button, the way an
 * editor's panel header does, so the terminal pane itself needs no toolbar row.
 */
function TerminalDockTab({ api, params }: IDockviewPanelHeaderProps<{ paneKey?: WorkspacePaneKey }>) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  const paneKey = params?.paneKey ?? 'single';
  // False while the terminal is still provisioning or its pane has not loaded.
  const canOpen = useCanRequestNewTerminalSession(ctx.droneId, paneKey);
  return (
    <DockTabShell api={api}>
      <button
        type="button"
        className="dh-dock-tab-button"
        title={canOpen ? 'Open a new terminal' : 'The terminal is not ready yet'}
        aria-label="Open a new terminal"
        disabled={!canOpen}
        onPointerDown={stopTabEvent}
        onClick={(event) => {
          stopTabEvent(event);
          requestNewTerminalSession(ctx.droneId, paneKey);
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
      <OpenDesktopToolButton tab={terminalTab} />
    </DockTabShell>
  );
}

/** Any other tool's tab: its name, the desktop-window button, and the X. */
function ToolDockTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  // Older saved panels can have a different tool in their params than their ID.
  const tab = React.useCallback(
    () => {
      const panel = containerApi.getPanel(api.id);
      return panel ? tabFromPanel(panel) : tabFromPanelId(api.id);
    },
    [api, containerApi],
  );
  return (
    <DockTabShell api={api}>
      <OpenDesktopToolButton tab={tab} />
    </DockTabShell>
  );
}

function WorkspaceTab(props: IDockviewPanelHeaderProps) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  const sideChat = props.api.id.startsWith(SIDE_CHAT_PANEL_PREFIX);
  const closeable = props.api.id !== CHAT_PANEL_ID;
  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!closeable || event.button !== 1) return;
    event.preventDefault();
  }, [closeable]);
  const onRenameSideChat = ctx.onRenameSideChat;
  const chatName = sideChat ? props.api.id.slice(SIDE_CHAT_PANEL_PREFIX.length) : '';
  const displaced = chatName === ctx.mainChatName ? ctx.displacedMainChatName : undefined;
  const rename = React.useCallback(async (newName: string) => {
    if (!onRenameSideChat) return { ok: false, error: 'Renaming is unavailable.' };
    // The renamed chat mounts as a new panel; keep it where this one is.
    const panel = props.containerApi.getPanel(props.api.id);
    const root = panel?.group.element.closest('.dh-dockable-workspace');
    if (panel && root && panel.group.element.closest('.dv-resize-container')) {
      saveSideChatWorkspaceState(ctx.droneId, { floatingBounds: { [chatName]: measureSideChatBounds(panel.group.element, root) } });
    }
    return onRenameSideChat(chatName, newName);
  }, [onRenameSideChat, props.containerApi, props.api.id, chatName, ctx.droneId]);

  if (sideChat) {
    const displayedName = displaced || chatName;
    return <ChatWindowTab key={displayedName} {...props} data-side-chat-name={displayedName} data-chat-drone-id={ctx.droneId} data-chat-name={displayedName} chatName={displayedName} droneId={ctx.droneId}
      onRename={!displaced && onRenameSideChat ? rename : undefined} onPointerDown={handlePointerDown} />;
  }
  if (!closeable) return <MainChatTab {...props} />;
  if (tabFromPanelId(props.api.id) === 'terminal') return <TerminalDockTab {...props} />;
  if (tabFromPanelId(props.api.id) === 'chats') return <ChatsDockTab {...props} />;
  // The preview stays in the Hub: its session lives in a layer above the dock, not in the panel.
  if (props.api.id.startsWith(TOOL_PANEL_PREFIX) && tabFromPanelId(props.api.id) !== 'preview') return <ToolDockTab {...props} />;
  return (
    <DockviewDefaultTab
      {...props}
      closeActionOverride={() => props.api.close()}
      onPointerDown={handlePointerDown}
    />
  );
}

function WorkspaceHeaderActions({ activePanel }: IDockviewHeaderActionsProps) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  // A fork shown as the main chat keeps its actions in the tab bar, where the tab names it.
  if (activePanel?.id === CHAT_PANEL_ID) {
    return ctx.mainChatControls
      ? <div className="dh-chat-window-actions" role="toolbar" aria-label="Side chat controls">{ctx.mainChatControls}</div>
      : null;
  }
  if (!activePanel?.id.startsWith(SIDE_CHAT_PANEL_PREFIX)) return null;
  const chatName = activePanel.id.slice(SIDE_CHAT_PANEL_PREFIX.length);
  if (chatName === ctx.mainChatName && ctx.displacedMainChatName) {
    return <div className="dh-chat-window-actions" role="toolbar" aria-label="Main chat controls">
      <button type="button" data-side-chat-move={ctx.displacedMainChatName} className="dh-chat-window-action"
        title="Restore as main chat and return the side chat to this window" aria-label="Restore as main chat"
        onPointerDown={(event) => event.stopPropagation()} onClick={ctx.onRestoreMainChat}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 15l6-6M9 9h6v6" /></svg>
      </button>
    </div>;
  }
  const chat = ctx.sideChats.find((item) => item.name === chatName);
  return <div className="dh-chat-window-actions" role="toolbar" aria-label="Side chat controls">
    {chat ? ctx.renderSideChatHeaderActions?.(chat) : null}
    <button type="button" className="dh-chat-window-action" title="Delete forked chat" aria-label="Delete forked chat"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => ctx.onCloseSideChat?.(chatName)}>
      <IconTrash />
    </button>
  </div>;
}

function WorkspaceWatermark() {
  // Empty slots are deliberate breathing room in the layout: no chrome, no
  // label, just workspace background that accepts a dropped pane.
  return <div className="h-full" data-workspace-empty-slot="" />;
}

const EMPTY_SLOT_CONSTRAINTS = { minimumWidth: 0, minimumHeight: 0 };

/**
 * Keeps empty grid slots chrome-free: no tab bar (so nothing to drag or
 * close), no minimum size (so the divider can be dragged shut), and removal
 * once they have been collapsed. Groups that gain a panel get their header
 * and minimum size back.
 */
export function syncEmptyWorkspaceSlots(api: DockviewApi, options: { removeCollapsed?: boolean } = {}): boolean {
  const removeCollapsed = options.removeCollapsed ?? true;
  let changed = false;
  for (const group of [...api.groups]) {
    if (group.api.location.type !== 'grid') continue;
    if (group.panels.length > 0) {
      if (group.header.hidden) {
        group.header.hidden = false;
        group.api.setConstraints(OCCUPIED_GROUP_CONSTRAINTS);
      }
      continue;
    }
    if (removeCollapsed && isCollapsedEmptySlot(group, api)) {
      api.removeGroup(group);
      changed = true;
      continue;
    }
    if (!group.header.hidden) {
      group.header.hidden = true;
      group.api.setConstraints(EMPTY_SLOT_CONSTRAINTS);
    }
  }
  return changed;
}

const DockableDroneWorkspaceContext = React.createContext<{
  droneId: string;
  chatContent: React.ReactNode;
  mainChatName?: string;
  displacedMainChatName?: string;
  renderDisplacedMainChat?: (chatName: string) => React.ReactNode;
  onRestoreMainChat?: () => void;
  mainChatControls?: React.ReactNode;
  sideChats: WorkspaceSideChat[];
  renderSideChat?: (chat: WorkspaceSideChat) => React.ReactNode;
  renderSideChatHeaderActions?: (chat: WorkspaceSideChat) => React.ReactNode;
  onCloseSideChat?: (chatName: string) => void;
  onRenameSideChat?: (chatName: string, newName: string) => Promise<{ ok: boolean; error?: string | null }>;
  renderToolPane: (tab: RightPanelTab, paneKey: WorkspacePaneKey) => React.ReactNode;
  renderFilePane?: (file: WorkspaceFileWindow) => React.ReactNode;
  openFileTabIds?: ReadonlySet<string>;
  dirtyFileTabIds?: ReadonlySet<string>;
  previewTab: RightPanelTab;
  onPreviewHostChanged: () => void;
  changesExplorerHost: HTMLElement | null;
  setChangesExplorerHost: (element: HTMLDivElement | null) => void;
}>({
  droneId: '',
  chatContent: null,
  sideChats: [],
  renderToolPane: () => null,
  previewTab: 'preview',
  onPreviewHostChanged: () => {},
  changesExplorerHost: null,
  setChangesExplorerHost: () => {},
});

export function DockableDroneWorkspace({
  currentDrone,
  paneHeaderMode,
  activeToolTab,
  openRequestNonce,
  chatContent,
  sideChats = [],
  mainChatName = '',
  displacedMainChatName,
  renderDisplacedMainChat,
  onRestoreMainChat,
  sideChatReturnRequest,
  sideChatFocusRequest,
  mainChatControls,
  renderSideChat,
  renderSideChatHeaderActions,
  onCloseSideChat,
  onRenameSideChat,
  sideChatStatus,
  renderToolPane,
  previewTab,
  onActiveToolTabChange,
  onPreviewHostChange,
  onVisibleToolTabsChange,
  onBeforeWorkspaceMouseDown,
  onAfterToolPanelRemove,
  fileWindows,
  hideFloatingSideChats = false,
  onRevealFloatingSideChats,
  sharedLayout = false,
}: DockableDroneWorkspaceProps) {
  const revealFloatingSideChatsRef = React.useRef<(() => void) | null>(null);
  revealFloatingSideChatsRef.current = hideFloatingSideChats ? onRevealFloatingSideChats ?? null : null;
  const revealFloatingSideChats = React.useCallback(() => revealFloatingSideChatsRef.current?.(), []);
  const apiRef = React.useRef<DockviewApi | null>(null);
  const [changesExplorerHost, setChangesExplorerHost] = React.useState<HTMLDivElement | null>(null);
  const restoringPresetRef = React.useRef(false);
  const sideChatsRef = React.useRef(sideChats);
  sideChatsRef.current = sideChats;
  const fileWindowsRef = React.useRef(fileWindows);
  fileWindowsRef.current = fileWindows;
  const lastDetachedFileTabsRef = React.useRef<string | null>(null);
  const hasFileWindows = Boolean(fileWindows);
  const openFileTabIdsKey = (fileWindows?.openTabIds ?? []).join('\u0000');
  const dirtyFileTabIdsKey = (fileWindows?.dirtyTabIds ?? []).join('\u0000');
  const openFileTabIdSet = React.useMemo(
    () => (hasFileWindows ? new Set(openFileTabIdsKey.split('\u0000').filter(Boolean)) : undefined),
    [hasFileWindows, openFileTabIdsKey],
  );
  const dirtyFileTabIdSet = React.useMemo(
    () => new Set(dirtyFileTabIdsKey.split('\u0000').filter(Boolean)),
    [dirtyFileTabIdsKey],
  );
  const renderFilePane = fileWindows?.render;
  const workspaceElementRef = React.useRef<HTMLDivElement | null>(null);
  const [readyVersion, setReadyVersion] = React.useState(0);
  useWorkspacePanelExpansion({ apiRef, workspaceRef: workspaceElementRef, readyVersion });
  const initializingLayoutRef = React.useRef(true);
  const disposablesRef = React.useRef<Array<{ dispose: () => void }>>([]);
  const removedPanelTimersRef = React.useRef<Map<string, number>>(new Map());
  const workspaceLayoutRevisionRef = React.useRef(0);
  const layoutSaveTimerRef = React.useRef<number | null>(null);
  const suppressSaveRef = React.useRef(false);
  const arrangingWorkspaceRef = React.useRef(false);
  const reattachingFilePanelsRef = React.useRef(new Set<string>());
  const unmountingRef = React.useRef(false);
  const lastAppliedOpenRequestRef = React.useRef(openRequestNonce);
  const [previewHostVersion, setPreviewHostVersion] = React.useState(0);
  const [workspacePanelCount, setWorkspacePanelCount] = React.useState(1);
  const lastReportedPreviewHostRef = React.useRef<PreviewHostState | null>(null);
  const lastVisibleToolTabsRef = React.useRef<string>('');
  const isMobileViewport = useMobileViewport();
  // Floating chats keep their arrangement when the app window shrinks and grows back.
  const floatingWindows = useFloatingWindowKeeper({
    apiRef,
    rootRef: workspaceElementRef,
    ready: `${currentDrone.id}:${readyVersion}`,
    persist: (id, bounds) => {
      if (!id.startsWith(SIDE_CHAT_PANEL_PREFIX)) return;
      saveSideChatWorkspaceState(currentDrone.id, { floatingIntent: { [id.slice(SIDE_CHAT_PANEL_PREFIX.length)]: bounds } });
    },
    restore: (id) => id.startsWith(SIDE_CHAT_PANEL_PREFIX)
      ? readSideChatWorkspaceState(currentDrone.id).floatingIntent[id.slice(SIDE_CHAT_PANEL_PREFIX.length)]
      : undefined,
    onMoved: (api, id) => {
      const panel = api.getPanel(id);
      if (panel) prepareSideChatPanel(panel);
    },
  });
  // A small focused chat grows to read comfortably and shrinks back on blur.
  const [hasOpenedSideChats, setHasOpenedSideChats] = React.useState(sideChats.length > 0);
  if (sideChats.length > 0 && !hasOpenedSideChats) setHasOpenedSideChats(true);
  // Once floating chats need Dockview, keep it for this workspace's lifetime.
  // Switching back when the last float closes would remount the main chat and tools.
  const useMobileLayout = isMobileViewport && !hasOpenedSideChats;
  const [mobileActivePanel, setMobileActivePanel] = React.useState<'chat' | 'tool'>('chat');
  const [mobileToolPaneOpen, setMobileToolPaneOpen] = React.useState(false);
  const [mobileExplorerOnly, setMobileExplorerOnly] = React.useState(false);
  const markPreviewHostChanged = React.useCallback(() => {
    setPreviewHostVersion((version) => version + 1);
  }, []);
  const reportPreviewHostChange = React.useCallback(
    (state: PreviewHostState) => {
      const lastState = lastReportedPreviewHostRef.current;
      if (lastState && previewHostStatesEqual(lastState, state)) return;
      lastReportedPreviewHostRef.current = state;
      onPreviewHostChange?.(state);
    },
    [onPreviewHostChange],
  );
  const updateWorkspacePanelState = React.useCallback(() => {
    const api = apiRef.current;
    const nextPanelCount = Math.max(1, api ? workspaceGridPanelCount(api.groups) : 1);
    setWorkspacePanelCount((current) => current === nextPanelCount ? current : nextPanelCount);
    const detached = api ? detachedFileTabIds(api) : [];
    const detachedKey = detached.join('\u0000');
    if (lastDetachedFileTabsRef.current !== detachedKey) {
      lastDetachedFileTabsRef.current = detachedKey;
      fileWindowsRef.current?.onDetachedTabsChange?.(detached);
    }
    const nextVisibleTabs = api ? visibleToolTabs(api) : [];
    const nextVisibleTabsKey = nextVisibleTabs.join('\u0000');
    if (lastVisibleToolTabsRef.current === nextVisibleTabsKey) return;
    lastVisibleToolTabsRef.current = nextVisibleTabsKey;
    onVisibleToolTabsChange?.(nextVisibleTabs);
  }, [onVisibleToolTabsChange]);
  const contextValue = React.useMemo(
    () => ({
      chatContent,
      droneId: currentDrone.id,
      mainChatName,
      displacedMainChatName,
      renderDisplacedMainChat,
      onRestoreMainChat,
      mainChatControls,
      sideChats,
      renderSideChat,
      renderSideChatHeaderActions,
      onCloseSideChat,
      onRenameSideChat,
      renderToolPane,
      renderFilePane,
      openFileTabIds: openFileTabIdSet,
      dirtyFileTabIds: dirtyFileTabIdSet,
      previewTab,
      onPreviewHostChanged: markPreviewHostChanged,
      changesExplorerHost,
      setChangesExplorerHost,
    }),
    [currentDrone.id, chatContent, mainChatName, displacedMainChatName, renderDisplacedMainChat, onRestoreMainChat, mainChatControls, sideChats, renderSideChat, renderSideChatHeaderActions, onCloseSideChat, onRenameSideChat, markPreviewHostChanged, previewTab, renderToolPane, renderFilePane, openFileTabIdSet, dirtyFileTabIdSet, changesExplorerHost],
  );
  const components = React.useMemo(() => ({ chat: ChatPanel, tool: ToolPanel, sideChat: SideChatPanel, file: FilePanel }), []);

  React.useEffect(() => {
    const focus = (event: Event) => {
      const detail = (event as CustomEvent<{ droneId: string; tabId: string }>).detail;
      if (detail?.droneId !== currentDrone.id) return;
      const panel = apiRef.current?.getPanel(filePanelId(detail.tabId));
      if (!panel) return;
      panel.api.setActive();
      event.preventDefault();
    };
    window.addEventListener(FOCUS_FILE_PANEL_EVENT, focus);
    return () => window.removeEventListener(FOCUS_FILE_PANEL_EVENT, focus);
  }, [currentDrone.id]);

  // The canvas's full view: its group maximized, and the floating windows out of the way until it is left. The
  // session's store says whether it is wanted; this workspace fills itself with its canvas to match.
  const canvasFullViewWanted = useCanvasFullViewStore((state) => state.fullView);
  const canvasChatPanelWanted = useCanvasFullViewStore((state) => state.chatPanelOpen);
  const [canvasFullView, setCanvasFullView] = React.useState(false);
  React.useEffect(() => {
    const root = workspaceElementRef.current;
    const api = apiRef.current;
    if (!root || !api) return;
    const isCanvas = (panel: WorkspaceDockPanel) => tabFromPanel(panel) === 'canvas';
    const fullViewGroup = () => api.groups.find((group) => group.api.isMaximized() && group.activePanel && isCanvas(group.activePanel)) ?? null;
    let disposed = false;
    const sync = () => {
      const on = Boolean(fullViewGroup());
      setCanvasFullView(on);
      // Detached chats float over the page from outside the workspace; they step aside too.
      root.ownerDocument.documentElement.toggleAttribute('data-canvas-full-view', on);
      // Dockview lets go of the maximized pane whenever a pane outside it is made active (opening a card's chat
      // makes the main chat active), and for a moment while it saves the layout. The full view is only left on
      // request, so once that is done the canvas fills the workspace again; without a canvas in the grid, it ends.
      if (!on && useCanvasFullViewStore.getState().fullView) {
        queueMicrotask(() => {
          if (!disposed && !fullViewGroup() && useCanvasFullViewStore.getState().fullView) fill();
        });
      }
    };
    const fill = () => {
      // A drone whose own layout has no canvas (a card opened another drone) gets one: the full view is the canvas.
      if (!api.panels.some(isCanvas)) ensureWorkspaceToolPanel(api, 'canvas', 'single');
      // Only a canvas in the grid fills the workspace; a floating or popped-out one stays as it is.
      const canvas = api.panels.find((panel) => isCanvas(panel) && panel.api.group.api.location.type === 'grid');
      if (!canvas) {
        leaveCanvasFullView();
        return;
      }
      if (canvas.api.group.activePanel !== canvas) canvas.api.setActive();
      if (!canvas.api.group.api.isMaximized()) canvas.api.group.api.maximize();
    };
    if (canvasFullViewWanted) {
      fill();
    } else {
      fullViewGroup()?.api.exitMaximized();
    }
    sync();
    const disposable = api.onDidMaximizedGroupChange(sync);
    return () => {
      disposed = true;
      disposable.dispose();
      root.ownerDocument.documentElement.removeAttribute('data-canvas-full-view');
    };
  }, [canvasFullViewWanted, readyVersion]);
  const canvasChatPanelOpen = canvasFullView && canvasChatPanelWanted;
  // The panel starts under the canvas's toolbar, where the board itself starts.
  const [canvasChatPanelTop, setCanvasChatPanelTop] = React.useState(0);
  React.useLayoutEffect(() => {
    const root = workspaceElementRef.current;
    if (!canvasChatPanelOpen || !root) return;
    const measure = () => {
      const board = root.querySelector('.dv-groupview [data-drone-canvas-viewport]');
      if (board) setCanvasChatPanelTop(Math.max(0, Math.round(board.getBoundingClientRect().top - root.getBoundingClientRect().top)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [canvasChatPanelOpen]);
  React.useEffect(() => {
    if (!canvasFullView) return;
    // Escape closes the chat panel, then leaves the full view. Escape in a field, a menu or a dialog is theirs.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], .monaco-editor')) return;
      if (useCanvasFullViewStore.getState().chatPanelOpen) closeCanvasChatPanel();
      else leaveCanvasFullView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canvasFullView]);

  const cancelPendingChatFocusRef = React.useRef<(() => void) | null>(null);
  const focusFloatingChat = React.useCallback((chatName: string, opts?: { keyboardFocus?: boolean }) => {
    if (chatName === mainChatName) return false;
    const slotName = chatName === displacedMainChatName ? mainChatName : chatName;
    const panel = apiRef.current?.getPanel(`${SIDE_CHAT_PANEL_PREFIX}${slotName}`);
    const root = workspaceElementRef.current;
    if (!panel || !root) return false;
    cancelPendingChatFocusRef.current?.();
    revealFloatingSideChats();
    panel.api.setActive();
    if (opts?.keyboardFocus === false) return true;
    cancelPendingChatFocusRef.current = focusChatWindow(root,
      () => [...root.querySelectorAll<HTMLElement>('[data-side-chat-name]')]
        .find((element) => element.dataset.sideChatName === chatName && !element.closest('.dv-tabs-container')),
      () => apiRef.current?.getPanel(panel.id) === panel,
    );
    return true;
  }, [mainChatName, displacedMainChatName, revealFloatingSideChats]);
  React.useEffect(() => () => cancelPendingChatFocusRef.current?.(), [currentDrone.id]);

  React.useEffect(() => {
    const focus = (event: Event) => {
      const detail = (event as CustomEvent<FocusSideChatDetail>).detail;
      if (detail?.droneId !== currentDrone.id) return;
      if (focusFloatingChat(detail.chatName, { keyboardFocus: detail.keyboardFocus })) event.preventDefault();
    };
    window.addEventListener(FOCUS_SIDE_CHAT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SIDE_CHAT_EVENT, focus);
  }, [currentDrone.id, focusFloatingChat]);

  const knownSideChatNamesRef = React.useRef<{ droneId: string; names: Set<string> } | null>(null);
  React.useEffect(() => {
    const api = apiRef.current;
    const root = workspaceElementRef.current;
    if (!api || !root) return;
    const state = readSideChatWorkspaceState(currentDrone.id);
    // Selecting a closed fork as the main chat makes it available to return to
    // a floating window through the existing main/floating action.
    if (state.closedWindows.includes(mainChatName ?? '')) {
      state.closedWindows = state.closedWindows.filter(name => name !== mainChatName);
      saveSideChatWorkspaceState(currentDrone.id, { closedWindows: state.closedWindows });
    }
    // Each fork keeps its panel and geometry. While promoted, that panel
    // displays the regular chat; promoting another fork restores this one
    // in place and moves the regular chat to the new fork's slot.
    const floatingChats = sideChats.filter((chat) => (chat.name !== mainChatName || displacedMainChatName) && !state.closedWindows.includes(chat.name));
    // A side chat made while the windows are hidden would open unseen.
    const known = knownSideChatNamesRef.current;
    if (known?.droneId === currentDrone.id && sideChats.some((chat) => !known.names.has(chat.name))) revealFloatingSideChats();
    knownSideChatNamesRef.current = { droneId: currentDrone.id, names: new Set(sideChats.map((chat) => chat.name)) };
    const wanted = new Set(floatingChats.map((chat) => `${SIDE_CHAT_PANEL_PREFIX}${chat.name}`));
    for (const panel of api.panels) {
      if (!panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX) || wanted.has(panel.id)) continue;
      if (panel.id === `${SIDE_CHAT_PANEL_PREFIX}${mainChatName}`) {
        saveSideChatWorkspaceState(currentDrone.id, { floatingBounds: {
          [mainChatName]: measureSideChatBounds(panel.group.element, root),
        } });
      }
      api.removePanel(panel);
    }
    for (const chat of floatingChats) {
      const id = `${SIDE_CHAT_PANEL_PREFIX}${chat.name}`;
      const title = chat.name === mainChatName && displacedMainChatName ? displacedMainChatName : chat.name;
      const existing = api.getPanel(id);
      if (existing) {
        if (existing.api.title !== title) existing.api.setTitle(title);
        prepareSideChatPanel(existing);
        continue;
      }
      const rootRect = root.getBoundingClientRect();
      const groups = api.groups.filter((group) => group.panels.some((panel) => panel.id === CHAT_PANEL_ID || panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX)));
      const detachedGroups = [...(root.closest('[data-drone-workspace-root]')?.querySelectorAll('[data-detached-chat-key]') ?? [])]
        .map((element) => element.closest('.dv-groupview')).filter((element): element is Element => Boolean(element));
      const occupied = [...groups.map((group) => group.element), ...detachedGroups].filter((element) => element.closest('.dv-resize-container')).map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x - rootRect.x, y: rect.y - rootRect.y, width: rect.width, height: rect.height };
      });
      // Dockview reports 0×0 until its first layout pass (a host that has not
      // painted yet); sizing a window from that made 1px windows. The element
      // is laid out on demand, so measure it instead.
      const workspace = { width: api.width || rootRect.width, height: api.height || rootRect.height };
      const state = readSideChatWorkspaceState(currentDrone.id);
      const savedBounds = [state.floatingIntent[chat.name], state.floatingBounds[chat.name]].find(isUsableFloatingBounds);
      const bounds = savedBounds
        ? restoreSideChatBounds(savedBounds, workspace)
        : placeSideChat(workspace, occupied, api.panels.filter((panel) => panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX)).length);
      const panel = api.addPanel({ id, component: 'sideChat', title, params: { chatName: chat.name },
        minimumWidth: Math.min(320, workspace.width), minimumHeight: Math.min(220, workspace.height),
        floating: bounds, inactive: true,
      });
      prepareSideChatPanel(panel);
    }
  }, [currentDrone.id, sideChats, mainChatName, displacedMainChatName, readyVersion, revealFloatingSideChats]);

  const handledFocusRequestRef = React.useRef<typeof sideChatFocusRequest>(null);
  React.useEffect(() => {
    if (!sideChatFocusRequest || sideChatFocusRequest.droneId !== currentDrone.id ||
      handledFocusRequestRef.current === sideChatFocusRequest) return;
    if (focusFloatingChat(sideChatFocusRequest.chatName)) handledFocusRequestRef.current = sideChatFocusRequest;
  }, [currentDrone.id, sideChatFocusRequest, sideChats, readyVersion, focusFloatingChat]);

  const previousMainChatRef = React.useRef<{ droneId: string; chatName: string | undefined; returnRequest: typeof sideChatReturnRequest } | null>(null);
  React.useEffect(() => {
    const switchedDrone = previousMainChatRef.current !== null && previousMainChatRef.current.droneId !== currentDrone.id;
    const previous = previousMainChatRef.current?.chatName;
    const previousReturnRequest = previousMainChatRef.current?.returnRequest;
    if (previousMainChatRef.current?.droneId === currentDrone.id && previous === mainChatName) return;
    const api = apiRef.current;
    const root = workspaceElementRef.current;
    if (!api || !root) return;
    previousMainChatRef.current = { droneId: currentDrone.id, chatName: mainChatName, returnRequest: sideChatReturnRequest };
    // Keep the active shared tool (and its focus) when changing its drone.
    if (sharedLayout && switchedDrone) return;
    // In the canvas's full view the chat shows in its panel over the canvas; making its pane active would take the
    // full view down, and the keyboard away from the canvas.
    if (useCanvasFullViewStore.getState().fullView) return;
    if (sideChatFocusRequest?.droneId === currentDrone.id &&
      sideChatFocusRequest.chatName !== mainChatName && previous === undefined) return;
    const promoted = sideChats.some((chat) => chat.name === mainChatName);
    const returned = sideChats.some((chat) => chat.name === previous);
    // Only the explicit return action focuses the restored floating chat.
    // Selecting a regular chat in the sidebar must focus that new main chat.
    const focusReturned = returned && !promoted && sideChatReturnRequest !== previousReturnRequest
      && sideChatReturnRequest?.droneId === currentDrone.id && sideChatReturnRequest.chatName === previous;
    if (focusReturned) revealFloatingSideChats();
    const panel = api.getPanel(focusReturned ? `${SIDE_CHAT_PANEL_PREFIX}${previous}` : CHAT_PANEL_ID);
    panel?.api.setActive();
    if (consumeKeepFocusOnChatActivation()) return;
    return focusChatWindow(root,
      () => !focusReturned
        ? root.querySelector<HTMLElement>('[data-main-workspace-chat]')
        : [...root.querySelectorAll<HTMLElement>('[data-side-chat-name]')]
            .find((element) => element.dataset.sideChatName === previous && !element.closest('.dv-tabs-container')),
      () => root.isConnected,
    );
  }, [currentDrone.id, mainChatName, sideChats, sideChatReturnRequest, sideChatFocusRequest, readyVersion, revealFloatingSideChats, sharedLayout]);

  React.useEffect(() => {
    if (!useMobileLayout) return;
    const api = apiRef.current;
    if (!api || visibleToolTabs(api).length === 0) return;
    setMobileToolPaneOpen(true);
    setMobileActivePanel('tool');
  }, [useMobileLayout]);

  React.useEffect(() => {
    if (!useMobileLayout) return;
    onVisibleToolTabsChange?.(
      mobileToolPaneOpen && mobileActivePanel === 'tool' ? [activeToolTab] : [],
    );
  }, [
    activeToolTab,
    useMobileLayout,
    mobileActivePanel,
    mobileToolPaneOpen,
    onVisibleToolTabsChange,
  ]);

  const persistCurrentLayout = React.useCallback(() => {
    const api = apiRef.current;
    if (!api || suppressSaveRef.current || unmountingRef.current) return;
    // A deleted drone's own layout is gone; the shared one outlives it.
    if (!sharedLayout && disposedWorkspaceIds.has(currentDrone.id)) return;
    try {
      const layout = api.toJSON();
      if (!layout.panels[CHAT_PANEL_ID]) return;
      // The canvas's full view is a moment's view, not part of the layout: the workspace opens with its panes.
      if (workspaceElementRef.current?.hasAttribute('data-canvas-full-view')) delete (layout.grid as { maximizedNode?: unknown }).maximizedNode;
      writeStoredLayout(currentDrone.id, layout, sharedLayout);
    } catch {
      // Ignore layout persistence failures; the active workspace can keep running.
    }
  }, [currentDrone.id, sharedLayout]);

  const changeDockedWindows = React.useCallback((action: () => void) => {
    if (arrangingWorkspaceRef.current || restoringPresetRef.current) throw new Error('The workspace is already being arranged.');
    const previouslySuppressed = suppressSaveRef.current;
    workspaceLayoutRevisionRef.current++;
    suppressSaveRef.current = true;
    restoringPresetRef.current = true;
    removedPanelTimersRef.current.forEach(timer => window.clearTimeout(timer));
    removedPanelTimersRef.current.clear();
    const finishSideChatVisibility = retainClosedSideChatWindows(currentDrone.id, apiRef.current!);
    try { action(); } finally {
      finishSideChatVisibility();
      restoringPresetRef.current = false;
      suppressSaveRef.current = previouslySuppressed;
      updateWorkspacePanelState();
      const active = apiRef.current?.activePanel;
      const tab = active ? tabFromPanel(active) : null;
      if (tab) onActiveToolTabChange?.(tab);
      persistCurrentLayout();
    }
  }, [currentDrone.id, onActiveToolTabChange, persistCurrentLayout, updateWorkspacePanelState]);

  React.useEffect(() => {
    if (useMobileLayout || !apiRef.current) return;
    return registerWorkspacePresetTarget(currentDrone.id, {
      identity: apiRef.current,
      // Retain editor tabs (including unsaved edits) when closing their windows.
      closeDockedWindows: () => changeDockedWindows(() => closeDockedWindows(apiRef.current!)),
      capture: () => {
        const layout = captureWorkspacePreset(apiRef.current!);
        const root = fileWindowsRef.current?.presetRootPath?.replace(/\/+$/, '');
        for (const panel of Object.values(layout.panels)) {
          if (panel.contentComponent !== 'file' || !panel.params) continue;
          delete panel.params.presetRelativePath;
          if (root && panel.params.path?.startsWith(`${root}/`)) {
            panel.params.presetRelativePath = panel.params.path.slice(root.length + 1);
          }
        }
        return layout;
      },
      restore: (layout) => {
        // Validate drone-specific chat/file references before closing anything.
        for (const panel of Object.values(layout.panels)) {
          if (panel.contentComponent === 'sideChat' && !sideChatsRef.current.some(chat => chat.name === panel.params?.chatName)) {
            throw new Error('This preset contains a docked side chat that is not available in this drone.');
          }
        }
        const fileHost = fileWindowsRef.current;
        const restored = remapPresetFiles(layout, currentDrone.id, fileHost?.presetRootPath ?? '');
        assertWorkspacePresetCanRestore(apiRef.current!, restored);
        const files = Object.values(restored.panels).filter(panel => panel.contentComponent === 'file')
          .map(panel => panel.params as WorkspaceFileWindow);
        if (files.length && !fileHost?.restorePresetFiles) throw new Error('File windows are unavailable in this workspace.');
        changeDockedWindows(() => {
          if (files.length) flushSync(() => fileHost!.restorePresetFiles!(files));
          restoreWorkspacePreset(apiRef.current!, restored);
          migrateWorkspaceExplorerPanels(apiRef.current!);
          refreshWorkspacePanelTitles(apiRef.current!);
        });
      },
    });
  }, [currentDrone.id, readyVersion, useMobileLayout, changeDockedWindows]);

  React.useEffect(() => {
    const align = (event: Event) => {
      if ((event as CustomEvent<{ droneId: string }>).detail?.droneId !== currentDrone.id) return;
      const api = apiRef.current;
      const root = workspaceElementRef.current;
      if (!api || !root) return;
      const main = api.getPanel(CHAT_PANEL_ID);
      const detached = [...(root.closest('[data-drone-workspace-root]')?.querySelectorAll('[data-detached-chat-key]') ?? [])]
        .map((element) => element.closest('.dv-groupview')).filter((element): element is Element => Boolean(element));
      const occupied = [...(main?.group.api.location.type === 'floating' ? [main.group.element] : []), ...detached]
        .filter((element) => element.closest('.dv-resize-container'))
        .map((element) => measureSideChatBounds(element, root));
      const floatingBounds = alignFloatingChats(api, occupied);
      if (!Object.keys(floatingBounds).length) return;
      for (const [name, bounds] of Object.entries(floatingBounds)) {
        const panel = api.getPanel(`${SIDE_CHAT_PANEL_PREFIX}${name}`);
        if (panel) prepareSideChatPanel(panel);
        // Alignment is a deliberate placement, so it becomes the intended bounds.
        floatingWindows.set(`${SIDE_CHAT_PANEL_PREFIX}${name}`, bounds);
      }
      saveSideChatWorkspaceState(currentDrone.id, { floatingBounds, floatingIntent: floatingBounds });
      persistCurrentLayout();
      event.preventDefault();
    };
    window.addEventListener(ALIGN_FLOATING_CHATS_EVENT, align);
    return () => window.removeEventListener(ALIGN_FLOATING_CHATS_EVENT, align);
  }, [currentDrone.id, floatingWindows, persistCurrentLayout]);

  const pointerDownRef = React.useRef(false);
  React.useEffect(() => {
    const down = () => { pointerDownRef.current = true; };
    const up = () => {
      pointerDownRef.current = false;
      // Let Dockview finish its own divider handling before removing a slot
      // that was dragged shut.
      window.setTimeout(() => {
        const api = apiRef.current;
        if (!api || unmountingRef.current) return;
        if (syncEmptyWorkspaceSlots(api)) persistCurrentLayout();
      }, 0);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, [persistCurrentLayout]);

  React.useEffect(() => registerChatWindowLayout({
    workspaceId: currentDrone.id, api: () => apiRef.current, root: () => workspaceElementRef.current,
    available: () => !isMobileViewport,
    identity: (id) => id.startsWith(SIDE_CHAT_PANEL_PREFIX)
      ? { droneId: currentDrone.id, chatName: id === `${SIDE_CHAT_PANEL_PREFIX}${mainChatName}` && displacedMainChatName
        ? displacedMainChatName : id.slice(SIDE_CHAT_PANEL_PREFIX.length), kind: 'side_chat' } : null,
    layer: 0,
    persist: (id, bounds) => {
      floatingWindows.set(id, bounds);
      const panel = apiRef.current?.getPanel(id);
      if (panel) prepareSideChatPanel(panel);
      saveSideChatWorkspaceState(currentDrone.id, { floatingBounds: { [id.slice(SIDE_CHAT_PANEL_PREFIX.length)]: bounds } });
      persistCurrentLayout();
    },
  }), [currentDrone.id, mainChatName, displacedMainChatName, isMobileViewport, persistCurrentLayout, floatingWindows]);

  React.useEffect(() => {
    const read = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const api = apiRef.current, root = workspaceElementRef.current;
      if (detail.workspaceId !== currentDrone.id || isMobileViewport || !api || !root?.isConnected) return;
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || api.width <= 0 || api.height <= 0) return;
      detail.source = { api, root, transaction(action: () => void) {
        if (arrangingWorkspaceRef.current || restoringPresetRef.current || pointerDownRef.current) throw new Error('WORKSPACE_LAYOUT_BUSY: finish the current drag before arranging');
        const previouslySuppressed = suppressSaveRef.current;
        workspaceLayoutRevisionRef.current++;
        arrangingWorkspaceRef.current = true;
        suppressSaveRef.current = true;
        try { action(); } finally {
          try { syncEmptyWorkspaceSlots(api); } finally {
            arrangingWorkspaceRef.current = false;
            suppressSaveRef.current = previouslySuppressed;
          }
          for (const group of api.groups) if (group.api.location.type === 'floating' && group.panels.length === 1) {
            floatingWindows.set(group.panels[0]!.id, measureSideChatBounds(group.element, root));
          }
          updateWorkspacePanelState();
          const tab = api.activePanel ? tabFromPanel(api.activePanel) : null;
          if (tab) onActiveToolTabChange?.(tab);
          persistCurrentLayout();
        }
      } };
    };
    window.addEventListener(READ_WORKSPACE_LAYOUT, read);
    return () => window.removeEventListener(READ_WORKSPACE_LAYOUT, read);
  }, [currentDrone.id, isMobileViewport, floatingWindows, persistCurrentLayout, updateWorkspacePanelState, onActiveToolTabChange]);

  const schedulePersistCurrentLayout = React.useCallback(() => {
    if (layoutSaveTimerRef.current !== null) window.clearTimeout(layoutSaveTimerRef.current);
    layoutSaveTimerRef.current = window.setTimeout(() => {
      layoutSaveTimerRef.current = null;
      persistCurrentLayout();
    }, 200);
  }, [persistCurrentLayout]);

  const resizeWorkspaceGridGroupsLater = React.useCallback((resize: (api: DockviewApi) => void, afterResize?: () => void) => {
    const api = apiRef.current;
    if (!api) {
      afterResize?.();
      return;
    }
    // Restore the initial geometry before displaying the restored panes. The
    // deferred path remains necessary for interactive Dockview removals.
    if (initializingLayoutRef.current) {
      resize(api);
      afterResize?.();
      return;
    }
    const revision = workspaceLayoutRevisionRef.current;
    window.setTimeout(() => {
      const currentApi = apiRef.current;
      if (currentApi !== api || revision !== workspaceLayoutRevisionRef.current) return;
      suppressSaveRef.current = true;
      try {
        resize(currentApi);
      } finally {
        suppressSaveRef.current = false;
        updateWorkspacePanelState();
        persistCurrentLayout();
        afterResize?.();
      }
    }, 0);
  }, [persistCurrentLayout, updateWorkspacePanelState]);

  const rebalanceWorkspaceGridGroups = React.useCallback((afterRebalance?: () => void, options: RebalanceGridGroupOptions = {}) => {
    resizeWorkspaceGridGroupsLater((api) => rebalanceGridGroupWidths(api, options), afterRebalance);
  }, [resizeWorkspaceGridGroupsLater]);

  const loadLayout = React.useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    suppressSaveRef.current = true;
    try {
      const stored = readStoredLayout(currentDrone.id, sharedLayout);
      if (stored) {
        api.fromJSON(stored, { reuseExistingPanels: true });
        // Runs before the layout effect subscribes to removals, so nothing rebalances.
        if (sharedLayout) removeOtherDronesFileWindows(api, currentDrone.id);
        restoreRequiredWorkspacePanels(api);
        migrateEditorChangesPanels(api);
        migrateWorkspaceExplorerPanels(api);
        refreshWorkspacePanelTitles(api);
        syncEmptyWorkspaceSlots(api);
        // A drone opens on its agent chat, not on whichever pane was last active.
        api.getPanel(CHAT_PANEL_ID)?.api.setActive();
      } else {
        resetWorkspaceToChat(api);
      }
    } catch {
      resetWorkspaceToChat(api);
    } finally {
      suppressSaveRef.current = false;
      updateWorkspacePanelState();
      persistCurrentLayout();
    }
  }, [currentDrone.id, sharedLayout, persistCurrentLayout, updateWorkspacePanelState]);

  const applyToolOpenRequest = React.useCallback(() => {
    if (openRequestNonce === lastAppliedOpenRequestRef.current) return;
    setMobileExplorerOnly(false);
    if (useMobileLayout) {
      lastAppliedOpenRequestRef.current = openRequestNonce;
      setMobileToolPaneOpen(true);
      setMobileActivePanel('tool');
      return;
    }

    const api = apiRef.current;
    if (!api) return;
    lastAppliedOpenRequestRef.current = openRequestNonce;
    const wasChatOnly = isChatOnlyGrid(api);
    const previousWidths = captureGridGroupWidths(api);
    let addedPanel = false;
    suppressSaveRef.current = true;
    try {
      ensureChatPanel(api);
      addedPanel = ensureWorkspaceToolPanel(api, activeToolTab, 'single');
    } finally {
      suppressSaveRef.current = false;
    }
    updateWorkspacePanelState();
    if (addedPanel && wasChatOnly) {
      sizeWorkspaceOpenedFromChat(api);
      persistCurrentLayout();
    } else if (addedPanel) {
      resizeWorkspaceGridGroupsLater((currentApi) => fitAddedGridGroups(currentApi, previousWidths));
    } else {
      persistCurrentLayout();
    }
  }, [
    activeToolTab,
    useMobileLayout,
    openRequestNonce,
    persistCurrentLayout,
    resizeWorkspaceGridGroupsLater,
    updateWorkspacePanelState,
  ]);

  const openFileWindow = React.useCallback((payload: FileTabDragPayload, position: DropPosition, referenceGroup: string | null) => {
    const api = apiRef.current;
    if (!api) return;
    const id = filePanelId(payload.tabId);
    const existing = api.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    suppressSaveRef.current = true;
    try {
      api.addPanel({
        id,
        component: 'file',
        title: payload.name,
        params: { tabId: payload.tabId, path: payload.path, name: payload.name, droneId: payload.droneId },
        position: filePanelPositionForDrop(position, referenceGroup),
        minimumWidth: 320,
        minimumHeight: 180,
      });
      syncEmptyWorkspaceSlots(api);
    } finally {
      suppressSaveRef.current = false;
    }
    updateWorkspacePanelState();
    persistCurrentLayout();
  }, [persistCurrentLayout, updateWorkspacePanelState]);

  React.useEffect(() => {
    const present = (event: Event) => {
      const detail = (event as CustomEvent<{ droneId: string; files: PresentedFile[]; presentation: FilePresentation; panelIds?: string[]; error?: string }>).detail;
      if (detail.droneId !== currentDrone.id) return;
      const api = apiRef.current;
      try {
        if (isMobileViewport || !api || !workspaceElementRef.current?.isConnected) throw new Error('EDITOR_WORKSPACE_UNAVAILABLE');
        if (pointerDownRef.current) throw new Error('WORKSPACE_LAYOUT_BUSY');
        const bounds = workspaceElementRef.current.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) throw new Error('EDITOR_WORKSPACE_UNAVAILABLE');
        if (detail.files.some(file => !fileWindowsRef.current?.openTabIds.includes(file.tabId))) throw new Error('STALE_EDITOR_TAB');
        if (detail.presentation === 'panes') {
          for (const file of detail.files) openFileWindow({ ...file, droneId: currentDrone.id }, 'right', api.getPanel(CHAT_PANEL_ID)?.group.id ?? null);
          detail.panelIds = detail.files.map(file => filePanelId(file.tabId));
        } else {
          ensureWorkspaceToolPanel(api, 'editor', 'single');
          for (const file of detail.files) {
            const panel = api.getPanel(filePanelId(file.tabId));
            if (panel) { reattachingFilePanelsRef.current.add(panel.id); api.removePanel(panel); }
          }
          const editor = editorChangesPanels(api).find((panel) => tabFromPanel(panel) === 'editor');
          if (!editor) throw new Error('EDITOR_PANEL_NOT_READY');
          detail.panelIds = detail.files.map(() => editor.id);
        }
        updateWorkspacePanelState();
        persistCurrentLayout();
      } catch (error) { detail.error = error instanceof Error ? error.message : String(error); }
    };
    window.addEventListener(COMPANION_FILE_PRESENTATION, present);
    return () => window.removeEventListener(COMPANION_FILE_PRESENTATION, present);
  }, [currentDrone.id, isMobileViewport, openFileWindow, persistCurrentLayout, updateWorkspacePanelState]);

  const handleReady = React.useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      loadLayout();
      applyToolOpenRequest();
      initializingLayoutRef.current = false;
      setReadyVersion((version) => version + 1);

    },
    [applyToolOpenRequest, loadLayout],
  );

  const displayedDroneIdRef = React.useRef(currentDrone.id);
  React.useLayoutEffect(() => {
    const previousDroneId = displayedDroneIdRef.current;
    displayedDroneIdRef.current = currentDrone.id;
    if (previousDroneId === currentDrone.id || !sharedLayout) return;
    const api = apiRef.current;
    if (!api) return;
    // File windows and forked chats belong to their source drone. Removing
    // them during navigation must not close editor tabs or rebalance tools.
    workspaceLayoutRevisionRef.current++;
    cancelPendingChatFocusRef.current?.();
    removedPanelTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    removedPanelTimersRef.current.clear();
    reattachingFilePanelsRef.current.clear();
    lastAppliedOpenRequestRef.current = openRequestNonce;
    suppressSaveRef.current = true;
    restoringPresetRef.current = true;
    try {
      for (const panel of [...api.panels]) {
        if (!panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX)) continue;
        if (workspaceElementRef.current && panel.group.api.location.type === 'floating') {
          saveSideChatWorkspaceState(previousDroneId, { floatingBounds: {
            [panel.id.slice(SIDE_CHAT_PANEL_PREFIX.length)]: measureSideChatBounds(panel.group.element, workspaceElementRef.current),
          } });
        }
        api.removePanel(panel);
      }
      removeOtherDronesFileWindows(api, currentDrone.id);
    } finally {
      restoringPresetRef.current = false;
      suppressSaveRef.current = false;
    }
    lastDetachedFileTabsRef.current = null;
    lastVisibleToolTabsRef.current = '';
    updateWorkspacePanelState();
    persistCurrentLayout();
  }, [currentDrone.id, sharedLayout, openRequestNonce, persistCurrentLayout, updateWorkspacePanelState]);

  // A shared dock outlives the selected drone. Subscribe with current callbacks
  // without loading the saved layout again or replacing any tool panels.
  React.useLayoutEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const layoutDisposable = api.onDidLayoutChange(() => {
      if (arrangingWorkspaceRef.current || restoringPresetRef.current) return;
      // A slot dragged shut is removed only once the pointer is released
      // (see the pointerup effect): pulling a view out from under Dockview's
      // divider drag would break the drag still in progress.
      if (!suppressSaveRef.current) syncEmptyWorkspaceSlots(api, { removeCollapsed: !pointerDownRef.current });
      updateWorkspacePanelState();
      schedulePersistCurrentLayout();
    });
    const activePanelDisposable = api.onDidActivePanelChange((panel) => {
      if (arrangingWorkspaceRef.current || restoringPresetRef.current || !panel) return;
      const tab = tabFromPanel(panel);
      if (tab) onActiveToolTabChange?.(tab);
    });
    // A file tab dragged out of the editor's tab strip may land anywhere on
    // the grid and opens there in its own window. Dragging within the strip
    // itself is a reorder and must not light up the editor pane.
    const fileDragOverDisposable = api.onUnhandledDragOverEvent((drag) => {
      if (!hasFileTabDragPayload(dragEventOf(drag.nativeEvent))) return;
      const target = drag.nativeEvent.target;
      if (target instanceof Element && target.closest('[data-file-tab-strip]')) return;
      drag.accept();
    });
    const fileDropDisposable = api.onDidDrop((drop) => {
      const payload = readFileTabDragPayload(dragEventOf(drop.nativeEvent));
      if (!payload || payload.droneId !== currentDrone.id) return;
      openFileWindow(payload, drop.position, drop.group?.id ?? null);
    });
    // Dockview ignores a pane's whole content dropped onto one of its own
    // edges. Treat it as "shrink into that half": insert an empty slot on
    // the opposite side so the pane keeps only the half the user pointed at.
    const dropDisposable = api.onWillDrop((drop) => {
      const direction = emptySlotDirectionForDrop(dropOverlayContextFromEvent(drop, api, workspaceElementRef.current));
      const group = drop.group;
      if (!direction || !group) return;
      drop.preventDefault();
      api.addGroup({
        referenceGroup: group,
        direction,
        initialWidth: Math.max(1, Math.round(group.width / 2)),
        initialHeight: Math.max(1, Math.round(group.height / 2)),
        skipSetActive: true,
      });
      syncEmptyWorkspaceSlots(api);
      persistCurrentLayout();
    });
    // Hide drop highlights Dockview would ignore on release (a lone panel
    // dropped on its own centre or header, a group onto itself) and
    // workspace-edge highlights that duplicate the adjacent pane's own edge zone.
    const overlayDisposable = api.onWillShowOverlay((overlay) => {
      if (isNoOpDropOverlay(dropOverlayContextFromEvent(overlay, api, workspaceElementRef.current))) {
        overlay.preventDefault();
      }
    });
    const removeDisposable = api.onDidRemovePanel((panel) => {
      if (restoringPresetRef.current) return;
      const panelId = panel.id;
      const reattachingFile = reattachingFilePanelsRef.current.delete(panelId);
      const pendingTimer = removedPanelTimersRef.current.get(panelId);
      if (pendingTimer !== undefined) window.clearTimeout(pendingTimer);
      // Dockview fires this before it drops the emptied group and hands that
      // group's space to a neighbour, so this is the explorer's real sidebar
      // width. Measured now so closing the editor cannot leave the explorer
      // stretched across the freed space.
      const explorerWidths = standaloneExplorerWidths(api, panelId);

      // Dockview emits removal events while moving panels between groups as
      // well as when panels are actually closed. Wait until the move has
      // settled before changing React state or rebalancing the grid; doing
      // either during the drag can interrupt Dockview and snap the panel
      // back to its previous position.
      const timer = window.setTimeout(() => {
        removedPanelTimersRef.current.delete(panelId);
        const api = apiRef.current;
        if (!api) return;
        if (api.getPanel(panelId)) return;

        if (reattachingFile || panelId.startsWith(SIDE_CHAT_PANEL_PREFIX)) {
          updateWorkspacePanelState();
          persistCurrentLayout();
          return;
        }

        const closedFileTabId = fileTabIdFromPanelId(panelId);
        if (closedFileTabId) fileWindowsRef.current?.onClosed?.(closedFileTabId);

        if (panelId !== CHAT_PANEL_ID) {
          updateWorkspacePanelState();
          rebalanceWorkspaceGridGroups(onAfterToolPanelRemove, { explorerWidths });
          return;
        }

        suppressSaveRef.current = true;
        try {
          ensureChatPanel(api);
          updateWorkspacePanelState();
        } finally {
          suppressSaveRef.current = false;
        }
        persistCurrentLayout();
      }, 0);
      removedPanelTimersRef.current.set(panelId, timer);
    });

    updateWorkspacePanelState();
    const disposables = [layoutDisposable, activePanelDisposable, fileDragOverDisposable, fileDropDisposable, dropDisposable, overlayDisposable, removeDisposable];
    disposablesRef.current = disposables;
    return () => disposables.forEach((disposable) => disposable.dispose());
  }, [readyVersion, currentDrone.id, onActiveToolTabChange, onAfterToolPanelRemove, openFileWindow, persistCurrentLayout, rebalanceWorkspaceGridGroups, schedulePersistCurrentLayout, updateWorkspacePanelState]);

  const persistLayoutOnUnmountRef = React.useRef(persistCurrentLayout);
  persistLayoutOnUnmountRef.current = persistCurrentLayout;

  React.useLayoutEffect(() => {
    // React Strict Mode runs this setup/cleanup pair twice on mount. Re-arm the
    // guard during setup so the simulated cleanup does not permanently disable
    // layout persistence for this workspace instance.
    unmountingRef.current = false;
    return () => {
      if (layoutSaveTimerRef.current !== null) {
        window.clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
      }
      persistLayoutOnUnmountRef.current();
      unmountingRef.current = true;
      removedPanelTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      removedPanelTimersRef.current.clear();
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];
    };
  }, []);

  const handleWorkspaceMouseDownCapture = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    onBeforeWorkspaceMouseDown?.();
  }, [onBeforeWorkspaceMouseDown]);

  React.useEffect(() => {
    applyToolOpenRequest();
  }, [applyToolOpenRequest]);

  React.useEffect(() => {
    const openExplorer = (event: Event) => {
      if ((event as CustomEvent<{ droneId: string }>).detail?.droneId !== currentDrone.id) return;
      if (useMobileLayout) {
        setMobileExplorerOnly(true);
        setMobileToolPaneOpen(true);
        setMobileActivePanel('tool');
        onActiveToolTabChange?.('editor');
        return;
      }
      const api = apiRef.current;
      if (!api) return;
      const previousWidths = captureGridGroupWidths(api);
      let addedPanel = false;
      suppressSaveRef.current = true;
      try {
        ensureChatPanel(api);
        addedPanel = ensureExplorerPanel(api, CHAT_PANEL_ID, 'single');
        api.getPanel(EXPLORER_PANEL_ID)?.api.setActive();
      } finally {
        suppressSaveRef.current = false;
      }
      updateWorkspacePanelState();
      if (addedPanel) {
        resizeWorkspaceGridGroupsLater((currentApi) => fitAddedGridGroups(currentApi, previousWidths));
      } else {
        persistCurrentLayout();
      }
    };
    window.addEventListener(OPEN_FILE_EXPLORER_EVENT, openExplorer);
    return () => window.removeEventListener(OPEN_FILE_EXPLORER_EVENT, openExplorer);
  }, [currentDrone.id, useMobileLayout, onActiveToolTabChange, updateWorkspacePanelState, resizeWorkspaceGridGroupsLater, persistCurrentLayout]);

  React.useLayoutEffect(() => {
    const workspaceRoot = document.querySelector<HTMLElement>('[data-drone-workspace-root="1"]');
    const previewHost = document.querySelector<HTMLElement>(PREVIEW_HOST_SELECTOR);
    if (!workspaceRoot || !previewHost) {
      reportPreviewHostChange({
        style: { left: 0, top: 0, width: 0, height: 0 },
        activeDroneId: null,
        previewVisible: false,
      });
      return;
    }

    const updatePosition = () => {
      const workspaceRect = workspaceRoot.getBoundingClientRect();
      const paneRect = previewHost.getBoundingClientRect();
      reportPreviewHostChange({
        style: {
          left: paneRect.left - workspaceRect.left,
          top: paneRect.top - workspaceRect.top,
          width: paneRect.width,
          height: paneRect.height,
        },
        activeDroneId: currentDrone.id,
        previewVisible: true,
      });
    };

    updatePosition();
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            updatePosition();
          });
    resizeObserver?.observe(workspaceRoot);
    resizeObserver?.observe(previewHost);
    window.addEventListener('resize', updatePosition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [
    activeToolTab,
    currentDrone.id,
    useMobileLayout,
    mobileActivePanel,
    previewHostVersion,
    reportPreviewHostChange,
    mobileToolPaneOpen,
    mobileExplorerOnly,
  ]);

  React.useEffect(() => {
    return () => {
      reportPreviewHostChange({
        style: { left: 0, top: 0, width: 0, height: 0 },
        activeDroneId: null,
        previewVisible: false,
      });
    };
  }, [reportPreviewHostChange]);

  return (
    <DockableDroneWorkspaceContext.Provider value={contextValue}>
      {sideChatStatus}
      {useMobileLayout ? (
        <UiPanel flush className="dh-mobile-workspace flex-1">
          {mobileToolPaneOpen ? (
            <UiPanelToolbar
              aria-label="Mobile workspace panes"
              className="dh-mobile-workspace-tabs border-[var(--border)] py-1.5"
            >
              <UiToolbarSegmentedControl
                label="Active workspace pane"
                value={mobileActivePanel}
                size="small"
                options={[
                  { value: 'chat', label: 'Chat' },
                  { value: 'tool', label: mobileExplorerOnly ? 'File Explorer' : RIGHT_PANEL_TAB_LABELS[activeToolTab] },
                ]}
                onValueChange={(value) => {
                  setMobileActivePanel(value);
                  if (value === 'tool') onActiveToolTabChange?.(activeToolTab);
                }}
              />
            </UiPanelToolbar>
          ) : null}
          <UiPanelBody>
            {mobileActivePanel === 'tool' && mobileToolPaneOpen ? (
              mobileExplorerOnly ? (
                <UiPanel flush surface="alternate" className="h-full">
                  <EditorPaneContext.Provider value="explorer">
                    <React.Fragment key={currentDrone.id}>{renderToolPane('editor', 'single')}</React.Fragment>
                  </EditorPaneContext.Provider>
                </UiPanel>
              ) : activeToolTab === previewTab ? (
                <UiPanel
                  flush
                  surface="alternate"
                  data-dockview-preview-host="1"
                  className="relative h-full"
                >
                  <div className="absolute inset-0 min-h-0 overflow-hidden" aria-hidden="true" />
                </UiPanel>
              ) : (
                <UiPanel flush surface="alternate" className="h-full">
                  <React.Fragment key={activeToolTab === 'canvas' ? 'canvas' : currentDrone.id}>
                    {renderToolPane(activeToolTab, 'single')}
                  </React.Fragment>
                </UiPanel>
              )
            ) : (
              <UiPanel flush className="h-full" data-main-workspace-chat="true" data-chat-drone-id={currentDrone.id} data-chat-name={mainChatName}><React.Fragment key={currentDrone.id}>{chatContent}</React.Fragment></UiPanel>
            )}
          </UiPanelBody>
        </UiPanel>
      ) : (
        <div
          ref={workspaceElementRef}
          className={`relative flex-1 min-h-0 min-w-0 overflow-hidden dh-dockable-workspace ${
            paneHeaderMode === 'compact' ? 'dh-dockable-workspace--compact-headers' : ''
          } ${workspacePanelCount <= 1 ? 'dh-dockable-workspace--single-panel' : ''}`}
          data-floating-side-chats={hideFloatingSideChats ? 'hidden' : undefined}
          data-canvas-full-view={canvasFullView ? 'true' : undefined}
          onMouseDownCapture={handleWorkspaceMouseDownCapture}
        >
          <UndoChatWindowLayout workspaceId={currentDrone.id} />
          <DockviewReact
            className="dockview-theme-dark dh-dockview"
            components={components}
            defaultTabComponent={WorkspaceTab}
            rightHeaderActionsComponent={WorkspaceHeaderActions}
            watermarkComponent={WorkspaceWatermark}
            onReady={handleReady}
            singleTabMode="fullwidth"
            floatingGroupBounds="boundedWithinViewport"
            getTabContextMenuItems={workspaceTabContextMenuItems}
          />
          {canvasChatPanelOpen ? (
            <CanvasChatPanel droneId={currentDrone.id} chatName={mainChatName || DEFAULT_CHAT_NAME} chatContent={chatContent}
              top={canvasChatPanelTop} />
          ) : null}
        </div>
      )}
    </DockableDroneWorkspaceContext.Provider>
  );
}
