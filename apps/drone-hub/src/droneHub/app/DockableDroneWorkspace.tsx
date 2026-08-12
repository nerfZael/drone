import React from 'react';
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
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
  renderToolPane: (tab: RightPanelTab, paneKey: WorkspacePaneKey) => React.ReactNode;
  previewTab: RightPanelTab;
  onActiveToolTabChange?: (tab: RightPanelTab) => void;
  onPreviewHostChange?: (state: PreviewHostState) => void;
  onVisibleToolTabsChange?: (tabs: RightPanelTab[]) => void;
  onBeforeWorkspaceMouseDown?: () => void;
  onAfterToolPanelRemove?: () => void;
};

const CHAT_PANEL_ID = 'agent-chat';
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
    return Boolean(idTab && isEditorChangesTab(idTab));
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
    const nextGroupCount = Math.max(2, gridGroupCount + 1);
    return clampNewToolPanelWidth(availableWidth / nextGroupCount);
  }
  return DEFAULT_NEW_TOOL_PANEL_WIDTH;
}

function rebalanceGridGroupWidths(api: DockviewApi): void {
  const groups = api.groups.filter((group) => {
    if (group.api.location.type !== 'grid') return false;
    const width = Math.round(Number(group.width ?? 0));
    const height = Math.round(Number(group.height ?? 0));
    return width > 0 && height > 0;
  });
  const workspaceWidth = Math.round(Number(api.width ?? 0));
  if (workspaceWidth <= 0 || groups.length <= 1) return;

  const targetWidth = Math.max(1, Math.floor(workspaceWidth / groups.length));
  for (const group of groups) {
    const height = Math.max(1, Math.round(Number(group.height ?? 0)));
    group.api.setSize({ width: targetWidth, height });
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
    existing.api.setActive();
    return false;
  }

  const initialWidth = newToolPanelWidth(api, referencePanel);
  api.addPanel({
    id,
    component: 'tool',
    title: RIGHT_PANEL_TAB_LABELS[tab],
    params: { tab, paneKey },
    position: {
      direction: paneKey === 'bottom' ? 'below' : 'right',
      referencePanel,
    },
    initialWidth,
    initialHeight: DEFAULT_NEW_TOOL_PANEL_HEIGHT,
    minimumWidth: isEditorChangesTab(tab) ? EDITOR_PANEL_MIN_WIDTH : 260,
    minimumHeight: 180,
  });
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
    if (tab) panel.api.setTitle(RIGHT_PANEL_TAB_LABELS[tab]);
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
  const content = React.useContext(DockableDroneWorkspaceContext).chatContent;
  React.useEffect(() => {
    const panel = containerApi.getPanel(CHAT_PANEL_ID);
    if (panel) panel.api.setTitle('Agent Chat');
  }, [containerApi]);
  return <UiPanel flush className="h-full">{content}</UiPanel>;
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
      {previewHostedHere ? <div className="absolute inset-0 min-h-0 overflow-hidden" aria-hidden="true" /> : ctx.renderToolPane(tab, paneKey)}
    </UiPanel>
  );
}

function WorkspaceTab(props: IDockviewPanelHeaderProps) {
  const closeable = props.api.id !== CHAT_PANEL_ID;
  const closePanel = React.useCallback(() => {
    props.api.close();
  }, [props.api]);
  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!closeable || event.button !== 1) return;
    event.preventDefault();
  }, [closeable]);

  return (
    <DockviewDefaultTab
      {...props}
      hideClose={!closeable}
      closeActionOverride={closeable ? closePanel : undefined}
      onPointerDown={handlePointerDown}
    />
  );
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
  chatContent: React.ReactNode;
  renderToolPane: (tab: RightPanelTab, paneKey: WorkspacePaneKey) => React.ReactNode;
  previewTab: RightPanelTab;
  onPreviewHostChanged: () => void;
}>({
  chatContent: null,
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
  renderToolPane,
  previewTab,
  onActiveToolTabChange,
  onPreviewHostChange,
  onVisibleToolTabsChange,
  onBeforeWorkspaceMouseDown,
  onAfterToolPanelRemove,
}: DockableDroneWorkspaceProps) {
  const apiRef = React.useRef<DockviewApi | null>(null);
  const disposablesRef = React.useRef<Array<{ dispose: () => void }>>([]);
  const removedPanelTimersRef = React.useRef<Map<string, number>>(new Map());
  const suppressSaveRef = React.useRef(false);
  const unmountingRef = React.useRef(false);
  const lastAppliedOpenRequestRef = React.useRef(openRequestNonce);
  const [previewHostVersion, setPreviewHostVersion] = React.useState(0);
  const [workspacePanelCount, setWorkspacePanelCount] = React.useState(1);
  const lastReportedPreviewHostRef = React.useRef<PreviewHostState | null>(null);
  const isMobileViewport = useMobileViewport();
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
    setWorkspacePanelCount(Math.max(1, api?.totalPanels ?? 1));
    onVisibleToolTabsChange?.(api ? visibleToolTabs(api) : []);
  }, [onVisibleToolTabsChange]);
  const contextValue = React.useMemo(
    () => ({
      chatContent,
      renderToolPane,
      previewTab,
      onPreviewHostChanged: markPreviewHostChanged,
    }),
    [chatContent, markPreviewHostChanged, previewTab, renderToolPane],
  );
  const components = React.useMemo(() => ({ chat: ChatPanel, tool: ToolPanel }), []);

  React.useEffect(() => {
    if (!isMobileViewport) return;
    const api = apiRef.current;
    if (!api || visibleToolTabs(api).length === 0) return;
    setMobileToolPaneOpen(true);
    setMobileActivePanel('tool');
  }, [isMobileViewport]);

  React.useEffect(() => {
    if (!isMobileViewport) return;
    onVisibleToolTabsChange?.(
      mobileToolPaneOpen && mobileActivePanel === 'tool' ? [activeToolTab] : [],
    );
  }, [
    activeToolTab,
    isMobileViewport,
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
    if (isMobileViewport) {
      lastAppliedOpenRequestRef.current = openRequestNonce;
      setMobileToolPaneOpen(true);
      setMobileActivePanel('tool');
      return;
    }

    const api = apiRef.current;
    if (!api) return;
    lastAppliedOpenRequestRef.current = openRequestNonce;
    let addedPanel = false;
    suppressSaveRef.current = true;
    try {
      ensureChatPanel(api);
      addedPanel = ensureWorkspaceToolPanel(api, activeToolTab, 'single');
    } finally {
      suppressSaveRef.current = false;
    }
    updateWorkspacePanelState();
    if (addedPanel) {
      rebalanceWorkspaceGridGroups();
    } else {
      persistCurrentLayout();
    }
  }, [
    activeToolTab,
    isMobileViewport,
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

      const layoutDisposable = event.api.onDidLayoutChange(() => {
        updateWorkspacePanelState();
        persistCurrentLayout();
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
    [applyToolOpenRequest, loadLayout, onActiveToolTabChange, onAfterToolPanelRemove, persistCurrentLayout, rebalanceWorkspaceGridGroups, updateWorkspacePanelState],
  );

  React.useLayoutEffect(() => {
    // React Strict Mode runs this setup/cleanup pair twice on mount. Re-arm the
    // guard during setup so the simulated cleanup does not permanently disable
    // layout persistence for this workspace instance.
    unmountingRef.current = false;
    return () => {
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
    isMobileViewport,
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
      {isMobileViewport ? (
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
              <UiPanel flush className="h-full">{chatContent}</UiPanel>
            )}
          </UiPanelBody>
        </UiPanel>
      ) : (
        <div
          className={`flex-1 min-h-0 min-w-0 overflow-hidden dh-dockable-workspace ${
            paneHeaderMode === 'compact' ? 'dh-dockable-workspace--compact-headers' : ''
          } ${workspacePanelCount <= 1 ? 'dh-dockable-workspace--single-panel' : ''}`}
          onMouseDownCapture={handleWorkspaceMouseDownCapture}
        >
          <DockviewReact
            className="dockview-theme-dark dh-dockview"
            components={components}
            defaultTabComponent={WorkspaceTab}
            watermarkComponent={WorkspaceWatermark}
            onReady={handleReady}
            singleTabMode="fullwidth"
            floatingGroupBounds="boundedWithinViewport"
            getTabContextMenuItems={({ panel }) =>
              panel.id === CHAT_PANEL_ID ? [] : ['close', 'closeOthers', 'closeAll']
            }
          />
        </div>
      )}
    </DockableDroneWorkspaceContext.Provider>
  );
}
