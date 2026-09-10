import React from 'react';
import { IconTrash } from './icons';
import { ChatWindowTab } from './ChatWindowTab';
import { measureSideChatBounds, readSideChatWorkspaceState, restoreSideChatBounds, saveSideChatWorkspaceState } from './side-chat-workspace-state';
import { placeSideChat } from './side-chat-placement';
import { prepareSideChatPanel } from './prepareSideChatPanel';
import { focusChatWindow } from './focus-chat-window';
import { FOCUS_SIDE_CHAT_EVENT } from './side-chat-events';
import type { WorkspaceSideChat } from './use-workspace-side-chats';
import { EditorPaneContext } from './editor-pane-context';
import { readWorkspaceExplorerWidth } from './workspace-explorer-preferences';
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
  UiPaneState,
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
  onBeforeWorkspaceMouseDown?: () => void;
  onAfterToolPanelRemove?: () => void;
};

const CHAT_PANEL_ID = 'agent-chat';
const SIDE_CHAT_PANEL_PREFIX = 'side-chat:';
const EXPLORER_PANEL_ID = 'file-explorer';
const TOOL_PANEL_PREFIX = 'tool:';
const DEFAULT_WORKSPACE_TOOL_TAB: RightPanelTab = 'editor';
const DEFAULT_NEW_TOOL_PANEL_WIDTH = 720;
const DEFAULT_NEW_TOOL_PANEL_HEIGHT = 320;
const NEW_TOOL_PANEL_MIN_WIDTH = 360;
const NEW_TOOL_PANEL_MAX_WIDTH = 1200;
const EDITOR_PANEL_MIN_WIDTH = 480;
const PANE_HEADER_MODE_STORAGE_KEY = profileStorageKey('droneHub.workspacePaneHeaderMode');
const LEGACY_LAYOUT_STORAGE_KEY = profileStorageKey('droneHub.workspaceLayout.global');
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
  const raw = panelId.startsWith(TOOL_PANEL_PREFIX) ? panelId.slice(TOOL_PANEL_PREFIX.length) : '';
  return normalizeRightPanelTab(raw);
}

type WorkspaceDockPanel = DockviewApi['panels'][number];

function tabFromPanel(panel: WorkspaceDockPanel): RightPanelTab | null {
  const idTab = tabFromPanelId(panel.id);
  if (!idTab || !isEditorChangesTab(idTab)) return idTab;
  const params = panel.api.getParameters<{ tab?: unknown }>();
  return normalizeRightPanelTab(params.tab) ?? idTab;
}

function editorChangesPanels(api: DockviewApi): WorkspaceDockPanel[] {
  return api.panels.filter((panel) => {
    const idTab = tabFromPanelId(panel.id);
    return panel.id !== EXPLORER_PANEL_ID && Boolean(idTab && isEditorChangesTab(idTab));
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

function newToolPanelWidth(api: DockviewApi, referencePanelId: string): number {
  const workspaceWidth = Math.round(Number(api.width ?? 0));
  const referenceGroup = api.groups.find((group) => group.panels.some((panel) => panel.id === referencePanelId));
  const referenceWidth = Math.round(Number(referenceGroup?.width ?? 0));
  const availableWidth = workspaceWidth > 0 ? workspaceWidth : referenceWidth;
  if (availableWidth > 0) {
    const gridGroupCount = api.groups.filter((group) => group.api.location.type === 'grid').length;
    if (api.panels.length === 1 && api.panels[0].id === CHAT_PANEL_ID) return Math.round(availableWidth * 2 / 3);
    const nextGroupCount = Math.max(2, gridGroupCount + 1);
    return clampNewToolPanelWidth(availableWidth / nextGroupCount);
  }
  return DEFAULT_NEW_TOOL_PANEL_WIDTH;
}

export function rebalanceGridGroupWidths(api: DockviewApi): void {
  const groups = api.groups.filter((group) => {
    if (group.api.location.type !== 'grid') return false;
    const width = Math.round(Number(group.width ?? 0));
    const height = Math.round(Number(group.height ?? 0));
    return width > 0 && height > 0;
  });
  const workspaceWidth = Math.round(Number(api.width ?? 0));
  if (workspaceWidth <= 0 || groups.length <= 1) return;

  // The standalone explorer is a sidebar, not another full-width tool pane.
  // Capture its width before resizing siblings, since Dockview redistributes space.
  const explorer = groups.find((group) =>
    group.panels.length === 1 && group.panels[0].id === EXPLORER_PANEL_ID,
  );
  const explorerWidth = explorer ? explorer.width : 0;
  const toolGroups = groups.filter((group) => group !== explorer);
  const targetWidth = Math.max(1, Math.floor((workspaceWidth - explorerWidth) / toolGroups.length));
  for (const group of toolGroups) {
    const height = Math.max(1, Math.round(Number(group.height ?? 0)));
    group.api.setSize({ width: targetWidth, height });
  }
  if (explorer) explorer.api.setSize({ width: explorerWidth });
}

export function sizeWorkspaceOpenedFromChat(api: DockviewApi): void {
  api.getPanel(CHAT_PANEL_ID)?.api.group.api.setSize({ width: Math.round(api.width / 3) });
  const explorerGroup = api.getPanel(EXPLORER_PANEL_ID)?.api.group;
  if (explorerGroup?.panels.length === 1 && explorerGroup.api.location.type === 'grid') {
    // Apply this last so sizing the chat cannot expand the new explorer again.
    explorerGroup.api.setSize({ width: readWorkspaceExplorerWidth() });
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

function readStoredLayout(droneId: string): SerializedDockview | null {
  if (typeof localStorage === 'undefined') return null;
  const stored = parseStoredLayout(localStorage.getItem(workspaceLayoutStorageKey(droneId)));
  if (stored) return stored;
  return parseStoredLayout(localStorage.getItem(LEGACY_LAYOUT_STORAGE_KEY));
}

function writeStoredLayout(droneId: string, layout: SerializedDockview): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(workspaceLayoutStorageKey(droneId), JSON.stringify(layout));
  // The global layout predates per-drone workspaces. Once it has been copied
  // into a drone-specific key, do not seed every newly visited drone with it.
  localStorage.removeItem(LEGACY_LAYOUT_STORAGE_KEY);
}

function ensureExplorerPanel(api: DockviewApi, referencePanel: string, paneKey: WorkspacePaneKey): boolean {
  if (api.getPanel(EXPLORER_PANEL_ID)) return false;
  api.addPanel({
    id: EXPLORER_PANEL_ID,
    component: 'tool',
    title: 'File Explorer',
    params: { tab: 'editor', paneKey },
    position: { direction: 'right', referencePanel },
    initialWidth: readWorkspaceExplorerWidth(),
    minimumWidth: 180,
    minimumHeight: 180,
  });
  return true;
}

export function ensureWorkspaceToolPanel(api: DockviewApi, tab: RightPanelTab, paneKey: WorkspacePaneKey, referencePanel: string = CHAT_PANEL_ID): boolean {
  const id = toolPanelId(tab);
  const existing = isEditorChangesTab(tab)
    ? editorChangesPanels(api)[0]
    : api.getPanel(id);
  if (existing) {
    if (isEditorChangesTab(tab)) {
      const existingParams = existing.api.getParameters<{ paneKey?: WorkspacePaneKey }>();
      existing.api.updateParameters({
        ...existingParams,
        tab,
        paneKey: existingParams.paneKey ?? paneKey,
      });
    }
    existing.api.setTitle(RIGHT_PANEL_TAB_LABELS[tab]);
    if (isEditorChangesTab(tab)) {
      existing.api.setConstraints({ minimumWidth: EDITOR_PANEL_MIN_WIDTH });
    }
    const addedExplorer = tab === 'editor' && ensureExplorerPanel(api, existing.id, paneKey);
    if (tab === 'editor') existing.api.updateParameters({ splitEditor: true });
    existing.api.setActive();
    return addedExplorer;
  }

  const initialWidth = newToolPanelWidth(api, referencePanel);
  api.addPanel({
    id,
    component: 'tool',
    title: RIGHT_PANEL_TAB_LABELS[tab],
    params: { tab, paneKey, ...(tab === 'editor' ? { splitEditor: true } : {}) },
    position: {
      direction: paneKey === 'bottom' ? 'below' : 'right',
      referencePanel,
    },
    initialWidth,
    initialHeight: DEFAULT_NEW_TOOL_PANEL_HEIGHT,
    minimumWidth: isEditorChangesTab(tab) ? EDITOR_PANEL_MIN_WIDTH : 260,
    minimumHeight: 180,
  });
  if (tab === 'editor') {
    ensureExplorerPanel(api, id, paneKey);
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
    title: 'Agent Chat',
    ...(referencePanel
      ? { position: { direction: 'left' as const, referencePanel: referencePanel.api.id } }
      : {}),
    minimumWidth: 320,
    minimumHeight: 220,
  });
}

export function restoreRequiredWorkspacePanels(api: DockviewApi): void {
  for (const group of [...api.groups]) {
    if (group.panels.length === 0) api.removeGroup(group);
  }
  ensureChatPanel(api);
}

export function refreshWorkspacePanelTitles(api: DockviewApi): void {
  for (const panel of api.panels) {
    if (panel.id === CHAT_PANEL_ID) {
      panel.api.setTitle('Agent Chat');
      continue;
    }
    const tab = tabFromPanel(panel);
    if (tab) panel.api.setTitle(panel.id === EXPLORER_PANEL_ID ? 'File Explorer' : RIGHT_PANEL_TAB_LABELS[tab]);
  }
}

export function migrateEditorChangesPanels(api: DockviewApi): void {
  const panels = editorChangesPanels(api);
  if (panels.length === 0) return;
  const activePanelTab = api.activePanel ? tabFromPanel(api.activePanel) : null;
  const requestedTab =
    activePanelTab && isEditorChangesTab(activePanelTab)
      ? activePanelTab
      : tabFromPanel(panels[0]) ?? DEFAULT_WORKSPACE_TOOL_TAB;
  const survivor = panels.find((panel) => tabFromPanel(panel) === requestedTab) ?? panels[0];
  for (const panel of panels) {
    if (panel !== survivor) panel.api.close();
  }
  survivor.api.updateParameters({
    ...survivor.api.getParameters(),
    tab: requestedTab,
  });
  survivor.api.setTitle(RIGHT_PANEL_TAB_LABELS[requestedTab]);
  survivor.api.setConstraints({ minimumWidth: EDITOR_PANEL_MIN_WIDTH });
}

export function resetWorkspaceToChat(api: DockviewApi): void {
  api.clear();
  ensureChatPanel(api);
}

function ChatPanel({ containerApi }: IDockviewPanelProps) {
  const { chatContent: content, mainChatControls } = React.useContext(DockableDroneWorkspaceContext);
  React.useEffect(() => {
    const panel = containerApi.getPanel(CHAT_PANEL_ID);
    if (panel) panel.api.setTitle('Agent Chat');
  }, [containerApi]);
  return <UiPanel flush className="h-full" data-main-workspace-chat="true">{mainChatControls}{content}</UiPanel>;
}

function SideChatPanel({ params }: IDockviewPanelProps<{ chatName: string }>) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  const chat = ctx.sideChats.find((item) => item.name === params.chatName);
  return chat ? ctx.renderSideChat?.(chat) : null;
}

function ToolPanel({ api, params }: IDockviewPanelProps<{ tab?: unknown; paneKey?: WorkspacePaneKey }>) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  const tab = normalizeRightPanelTab(params.tab) ?? tabFromPanelId(api.id);
  const paneKey = params.paneKey ?? 'single';
  const previewHostedHere = Boolean(tab && tab === ctx.previewTab);
  const onPreviewHostChanged = ctx.onPreviewHostChanged;

  React.useLayoutEffect(() => {
    if (!previewHostedHere) return;
    onPreviewHostChanged();
  }, [onPreviewHostChanged, previewHostedHere]);

  if (!tab) return null;

  return (
    <UiPanel
      flush
      surface="alternate"
      data-dockview-preview-host={previewHostedHere ? '1' : undefined}
      className="dh-utility-panel relative h-full"
    >
      <EditorPaneContext.Provider value={api.id === EXPLORER_PANEL_ID ? 'explorer' : 'editor'}>
        {previewHostedHere ? <div className="absolute inset-0 min-h-0 overflow-hidden" aria-hidden="true" /> : ctx.renderToolPane(tab, paneKey)}
      </EditorPaneContext.Provider>
    </UiPanel>
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
    return <ChatWindowTab {...props} data-side-chat-name={chatName} chatName={chatName}
      onRename={onRenameSideChat ? rename : undefined} onPointerDown={handlePointerDown} />;
  }
  return (
    <DockviewDefaultTab
      {...props}
      hideClose={!closeable}
      closeActionOverride={closeable ? () => props.api.close() : undefined}
      onPointerDown={handlePointerDown}
    />
  );
}

function WorkspaceHeaderActions({ activePanel }: IDockviewHeaderActionsProps) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  if (!activePanel?.id.startsWith(SIDE_CHAT_PANEL_PREFIX)) return null;
  const chatName = activePanel.id.slice(SIDE_CHAT_PANEL_PREFIX.length);
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
  return (
    <UiPanel flush className="h-full">
      <UiPaneState
        kind="empty"
        title="No pane open"
        description="Open a pane from the toolbar."
      />
    </UiPanel>
  );
}

const DockableDroneWorkspaceContext = React.createContext<{
  droneId: string;
  chatContent: React.ReactNode;
  mainChatControls?: React.ReactNode;
  sideChats: WorkspaceSideChat[];
  renderSideChat?: (chat: WorkspaceSideChat) => React.ReactNode;
  renderSideChatHeaderActions?: (chat: WorkspaceSideChat) => React.ReactNode;
  onCloseSideChat?: (chatName: string) => void;
  onRenameSideChat?: (chatName: string, newName: string) => Promise<{ ok: boolean; error?: string | null }>;
  renderToolPane: (tab: RightPanelTab, paneKey: WorkspacePaneKey) => React.ReactNode;
  previewTab: RightPanelTab;
  onPreviewHostChanged: () => void;
}>({
  droneId: '',
  chatContent: null,
  sideChats: [],
  renderToolPane: () => null,
  previewTab: 'preview',
  onPreviewHostChanged: () => {},
});

export function DockableDroneWorkspace({
  currentDrone,
  paneHeaderMode,
  activeToolTab,
  openRequestNonce,
  chatContent,
  sideChats = [],
  mainChatName = '',
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
}: DockableDroneWorkspaceProps) {
  const apiRef = React.useRef<DockviewApi | null>(null);
  const workspaceElementRef = React.useRef<HTMLDivElement | null>(null);
  const [readyVersion, setReadyVersion] = React.useState(0);
  const disposablesRef = React.useRef<Array<{ dispose: () => void }>>([]);
  const removedPanelTimersRef = React.useRef<Map<string, number>>(new Map());
  const layoutSaveTimerRef = React.useRef<number | null>(null);
  const suppressSaveRef = React.useRef(false);
  const unmountingRef = React.useRef(false);
  const lastAppliedOpenRequestRef = React.useRef(openRequestNonce);
  const [previewHostVersion, setPreviewHostVersion] = React.useState(0);
  const [workspacePanelCount, setWorkspacePanelCount] = React.useState(1);
  const lastReportedPreviewHostRef = React.useRef<PreviewHostState | null>(null);
  const lastVisibleToolTabsRef = React.useRef<string>('');
  const isMobileViewport = useMobileViewport();
  const [hasOpenedSideChats, setHasOpenedSideChats] = React.useState(sideChats.length > 0);
  if (sideChats.length > 0 && !hasOpenedSideChats) setHasOpenedSideChats(true);
  // Once floating chats need Dockview, keep it for this workspace's lifetime.
  // Switching back when the last float closes would remount the main chat and tools.
  const useMobileLayout = isMobileViewport && !hasOpenedSideChats;
  const [mobileActivePanel, setMobileActivePanel] = React.useState<'chat' | 'tool'>('chat');
  const [mobileToolPaneOpen, setMobileToolPaneOpen] = React.useState(false);
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
    const nextPanelCount = Math.max(1, api?.totalPanels ?? 1);
    setWorkspacePanelCount((current) => current === nextPanelCount ? current : nextPanelCount);
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
      mainChatControls,
      sideChats,
      renderSideChat,
      renderSideChatHeaderActions,
      onCloseSideChat,
      onRenameSideChat,
      renderToolPane,
      previewTab,
      onPreviewHostChanged: markPreviewHostChanged,
    }),
    [currentDrone.id, chatContent, mainChatControls, sideChats, renderSideChat, renderSideChatHeaderActions, onCloseSideChat, onRenameSideChat, markPreviewHostChanged, previewTab, renderToolPane],
  );
  const components = React.useMemo(() => ({ chat: ChatPanel, tool: ToolPanel, sideChat: SideChatPanel }), []);

  const cancelPendingChatFocusRef = React.useRef<(() => void) | null>(null);
  const focusFloatingChat = React.useCallback((chatName: string) => {
    const panel = apiRef.current?.getPanel(`${SIDE_CHAT_PANEL_PREFIX}${chatName}`);
    const root = workspaceElementRef.current;
    if (!panel || !root) return false;
    cancelPendingChatFocusRef.current?.();
    panel.api.setActive();
    cancelPendingChatFocusRef.current = focusChatWindow(root,
      () => [...root.querySelectorAll<HTMLElement>('[data-side-chat-name]')]
        .find((element) => element.dataset.sideChatName === chatName && !element.closest('.dv-tabs-container')),
      () => apiRef.current?.getPanel(panel.id) === panel,
    );
    return true;
  }, []);
  React.useEffect(() => () => cancelPendingChatFocusRef.current?.(), [currentDrone.id]);

  React.useEffect(() => {
    const focus = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.droneId !== currentDrone.id) return;
      if (focusFloatingChat(detail.chatName)) event.preventDefault();
    };
    window.addEventListener(FOCUS_SIDE_CHAT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SIDE_CHAT_EVENT, focus);
  }, [currentDrone.id, focusFloatingChat]);

  React.useEffect(() => {
    const api = apiRef.current;
    const root = workspaceElementRef.current;
    if (!api || !root) return;
    const floatingChats = sideChats.filter((chat) => chat.name !== mainChatName);
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
      const existing = api.getPanel(id);
      if (existing) {
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
      const savedBounds = readSideChatWorkspaceState(currentDrone.id).floatingBounds[chat.name];
      const bounds = savedBounds
        ? restoreSideChatBounds(savedBounds, api)
        : placeSideChat({ width: api.width, height: api.height }, occupied, api.panels.filter((panel) => panel.id.startsWith(SIDE_CHAT_PANEL_PREFIX)).length);
      const panel = api.addPanel({ id, component: 'sideChat', title: chat.name, params: { chatName: chat.name },
        minimumWidth: Math.min(320, api.width), minimumHeight: Math.min(220, api.height),
        floating: bounds, inactive: true,
      });
      prepareSideChatPanel(panel);
    }
  }, [currentDrone.id, sideChats, mainChatName, readyVersion]);

  const handledFocusRequestRef = React.useRef<typeof sideChatFocusRequest>(null);
  React.useEffect(() => {
    if (!sideChatFocusRequest || sideChatFocusRequest.droneId !== currentDrone.id ||
      handledFocusRequestRef.current === sideChatFocusRequest) return;
    if (focusFloatingChat(sideChatFocusRequest.chatName)) handledFocusRequestRef.current = sideChatFocusRequest;
  }, [currentDrone.id, sideChatFocusRequest, sideChats, readyVersion, focusFloatingChat]);

  const previousMainChatRef = React.useRef<{ droneId: string; chatName: string | undefined; returnRequest: typeof sideChatReturnRequest } | null>(null);
  React.useEffect(() => {
    const previous = previousMainChatRef.current?.chatName;
    const previousReturnRequest = previousMainChatRef.current?.returnRequest;
    if (previousMainChatRef.current?.droneId === currentDrone.id && previous === mainChatName) return;
    const api = apiRef.current;
    const root = workspaceElementRef.current;
    if (!api || !root) return;
    previousMainChatRef.current = { droneId: currentDrone.id, chatName: mainChatName, returnRequest: sideChatReturnRequest };
    if (sideChatFocusRequest?.droneId === currentDrone.id &&
      sideChatFocusRequest.chatName !== mainChatName && previous === undefined) return;
    const promoted = sideChats.some((chat) => chat.name === mainChatName);
    const returned = sideChats.some((chat) => chat.name === previous);
    // Only the explicit return action focuses the restored floating chat.
    // Selecting a regular chat in the sidebar must focus that new main chat.
    const focusReturned = returned && !promoted && sideChatReturnRequest !== previousReturnRequest
      && sideChatReturnRequest?.droneId === currentDrone.id && sideChatReturnRequest.chatName === previous;
    const panel = api.getPanel(focusReturned ? `${SIDE_CHAT_PANEL_PREFIX}${previous}` : CHAT_PANEL_ID);
    panel?.api.setActive();
    return focusChatWindow(root,
      () => !focusReturned
        ? root.querySelector<HTMLElement>('[data-main-workspace-chat]')
        : [...root.querySelectorAll<HTMLElement>('[data-side-chat-name]')]
            .find((element) => element.dataset.sideChatName === previous && !element.closest('.dv-tabs-container')),
      () => root.isConnected,
    );
  }, [currentDrone.id, mainChatName, sideChats, sideChatReturnRequest, sideChatFocusRequest, readyVersion]);

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
    if (!api || suppressSaveRef.current || unmountingRef.current || disposedWorkspaceIds.has(currentDrone.id)) return;
    try {
      const layout = api.toJSON();
      if (!layout.panels[CHAT_PANEL_ID]) return;
      writeStoredLayout(currentDrone.id, layout);
    } catch {
      // Ignore layout persistence failures; the active workspace can keep running.
    }
  }, [currentDrone.id]);

  const schedulePersistCurrentLayout = React.useCallback(() => {
    if (layoutSaveTimerRef.current !== null) window.clearTimeout(layoutSaveTimerRef.current);
    layoutSaveTimerRef.current = window.setTimeout(() => {
      layoutSaveTimerRef.current = null;
      persistCurrentLayout();
    }, 200);
  }, [persistCurrentLayout]);

  const rebalanceWorkspaceGridGroups = React.useCallback((afterRebalance?: () => void) => {
    const api = apiRef.current;
    if (!api) {
      afterRebalance?.();
      return;
    }
    window.setTimeout(() => {
      const currentApi = apiRef.current;
      if (!currentApi) return;
      suppressSaveRef.current = true;
      try {
        rebalanceGridGroupWidths(currentApi);
      } finally {
        suppressSaveRef.current = false;
        updateWorkspacePanelState();
        persistCurrentLayout();
        afterRebalance?.();
      }
    }, 0);
  }, [persistCurrentLayout, updateWorkspacePanelState]);

  const loadLayout = React.useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    suppressSaveRef.current = true;
    try {
      const stored = readStoredLayout(currentDrone.id);
      if (stored) {
        api.fromJSON(stored, { reuseExistingPanels: true });
        restoreRequiredWorkspacePanels(api);
        migrateEditorChangesPanels(api);
        const editor = editorChangesPanels(api).find((panel) => tabFromPanel(panel) === 'editor');
        if (editor && !editor.api.getParameters<{ splitEditor?: boolean }>().splitEditor) {
          ensureExplorerPanel(api, editor.id, 'single');
          editor.api.updateParameters({ splitEditor: true });
        }
        refreshWorkspacePanelTitles(api);
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
  }, [currentDrone.id, persistCurrentLayout, updateWorkspacePanelState]);

  const applyToolOpenRequest = React.useCallback(() => {
    if (openRequestNonce === lastAppliedOpenRequestRef.current) return;
    if (useMobileLayout) {
      lastAppliedOpenRequestRef.current = openRequestNonce;
      setMobileToolPaneOpen(true);
      setMobileActivePanel('tool');
      return;
    }

    const api = apiRef.current;
    if (!api) return;
    lastAppliedOpenRequestRef.current = openRequestNonce;
    const wasChatOnly = api.panels.length === 1 && api.panels[0].id === CHAT_PANEL_ID;
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
      rebalanceWorkspaceGridGroups();
    } else {
      persistCurrentLayout();
    }
  }, [
    activeToolTab,
    useMobileLayout,
    openRequestNonce,
    persistCurrentLayout,
    rebalanceWorkspaceGridGroups,
    updateWorkspacePanelState,
  ]);

  const handleReady = React.useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      loadLayout();
      applyToolOpenRequest();
      setReadyVersion((version) => version + 1);

      const layoutDisposable = event.api.onDidLayoutChange(() => {
        updateWorkspacePanelState();
        schedulePersistCurrentLayout();
      });
      const activePanelDisposable = event.api.onDidActivePanelChange((panel) => {
        if (!panel) return;
        const tab = tabFromPanel(panel);
        if (tab) onActiveToolTabChange?.(tab);
      });
      const removeDisposable = event.api.onDidRemovePanel((panel) => {
        const panelId = panel.id;
        const pendingTimer = removedPanelTimersRef.current.get(panelId);
        if (pendingTimer !== undefined) window.clearTimeout(pendingTimer);

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

          if (panelId.startsWith(SIDE_CHAT_PANEL_PREFIX)) {
            updateWorkspacePanelState();
            persistCurrentLayout();
            return;
          }

          if (panelId !== CHAT_PANEL_ID) {
            updateWorkspacePanelState();
            rebalanceWorkspaceGridGroups(onAfterToolPanelRemove);
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
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [layoutDisposable, activePanelDisposable, removeDisposable];
    },
    [applyToolOpenRequest, loadLayout, onActiveToolTabChange, onAfterToolPanelRemove, persistCurrentLayout, rebalanceWorkspaceGridGroups, schedulePersistCurrentLayout, updateWorkspacePanelState],
  );

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
      persistCurrentLayout();
      unmountingRef.current = true;
      removedPanelTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      removedPanelTimersRef.current.clear();
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];
    };
  }, [persistCurrentLayout]);

  const handleWorkspaceMouseDownCapture = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    onBeforeWorkspaceMouseDown?.();
  }, [onBeforeWorkspaceMouseDown]);

  React.useEffect(() => {
    applyToolOpenRequest();
  }, [applyToolOpenRequest]);

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
                  { value: 'tool', label: RIGHT_PANEL_TAB_LABELS[activeToolTab] },
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
              activeToolTab === previewTab ? (
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
                  {renderToolPane(activeToolTab, 'single')}
                </UiPanel>
              )
            ) : (
              <UiPanel flush className="h-full" data-main-workspace-chat="true">{chatContent}</UiPanel>
            )}
          </UiPanelBody>
        </UiPanel>
      ) : (
        <div
          ref={workspaceElementRef}
          className={`flex-1 min-h-0 min-w-0 overflow-hidden dh-dockable-workspace ${
            paneHeaderMode === 'compact' ? 'dh-dockable-workspace--compact-headers' : ''
          } ${workspacePanelCount <= 1 ? 'dh-dockable-workspace--single-panel' : ''}`}
          onMouseDownCapture={handleWorkspaceMouseDownCapture}
        >
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
        </div>
      )}
    </DockableDroneWorkspaceContext.Provider>
  );
}
