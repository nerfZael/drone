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
import type { DroneSummary } from '../types';
import { profileStorageKey } from '../../profile-storage';
import { RIGHT_PANEL_TAB_LABELS, type RightPanelTab } from './app-config';
import { useMobileViewport } from './use-mobile-viewport';

export type WorkspaceLayoutScope = 'global' | 'drone' | 'chat';
export type WorkspacePaneHeaderMode = 'normal' | 'compact';
type WorkspacePaneKey = 'single' | 'top' | 'bottom';
type PreviewHostState = {
  style: React.CSSProperties;
  activeDroneId: string | null;
  previewVisible: boolean;
};

type DockableDroneWorkspaceProps = {
  currentDrone: DroneSummary;
  activeChatName: string;
  layoutScope: WorkspaceLayoutScope;
  paneHeaderMode: WorkspacePaneHeaderMode;
  toolPaneOpen: boolean;
  activeToolTab: RightPanelTab;
  openRequestNonce: number;
  resetLayoutNonce: number;
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
const DEFAULT_NEW_TOOL_PANEL_WIDTH = 720;
const DEFAULT_NEW_TOOL_PANEL_HEIGHT = 320;
const NEW_TOOL_PANEL_MIN_WIDTH = 360;
const NEW_TOOL_PANEL_MAX_WIDTH = 1200;
export const WORKSPACE_LAYOUT_SCOPES: WorkspaceLayoutScope[] = ['global', 'drone', 'chat'];
const LAYOUT_SCOPE_STORAGE_KEY = profileStorageKey('droneHub.workspaceLayoutScope');
const PANE_HEADER_MODE_STORAGE_KEY = profileStorageKey('droneHub.workspacePaneHeaderMode');
const LAYOUT_STORAGE_PREFIX = profileStorageKey('droneHub.workspaceLayout');
const PREVIEW_HOST_SELECTOR = '[data-dockview-preview-host="1"]';

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

function tabFromPanelId(panelId: string): RightPanelTab | null {
  const raw = panelId.startsWith(TOOL_PANEL_PREFIX) ? panelId.slice(TOOL_PANEL_PREFIX.length) : '';
  return raw && raw in RIGHT_PANEL_TAB_LABELS ? (raw as RightPanelTab) : null;
}

function visibleToolTabs(api: DockviewApi): RightPanelTab[] {
  const tabs: RightPanelTab[] = [];
  for (const panel of api.panels) {
    const tab = tabFromPanelId(panel.id);
    if (tab) tabs.push(tab);
  }
  return tabs;
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

export function readWorkspaceLayoutScope(): WorkspaceLayoutScope {
  if (typeof localStorage === 'undefined') return 'global';
  const raw = localStorage.getItem(LAYOUT_SCOPE_STORAGE_KEY);
  return raw === 'drone' || raw === 'chat' || raw === 'global' ? raw : 'global';
}

export function writeWorkspaceLayoutScope(scope: WorkspaceLayoutScope): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAYOUT_SCOPE_STORAGE_KEY, scope);
}

export function readWorkspacePaneHeaderMode(): WorkspacePaneHeaderMode {
  if (typeof localStorage === 'undefined') return 'normal';
  return localStorage.getItem(PANE_HEADER_MODE_STORAGE_KEY) === 'compact' ? 'compact' : 'normal';
}

export function writeWorkspacePaneHeaderMode(mode: WorkspacePaneHeaderMode): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PANE_HEADER_MODE_STORAGE_KEY, mode);
}

function layoutStorageKey(scope: WorkspaceLayoutScope, droneId: string, chatName: string): string {
  if (scope === 'chat') return `${LAYOUT_STORAGE_PREFIX}.chat.${encodeURIComponent(droneId)}.${encodeURIComponent(chatName || 'default')}`;
  if (scope === 'drone') return `${LAYOUT_STORAGE_PREFIX}.drone.${encodeURIComponent(droneId)}`;
  return `${LAYOUT_STORAGE_PREFIX}.global`;
}

function readStoredLayout(storageKey: string): SerializedDockview | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return parsed && typeof parsed === 'object' && 'grid' in parsed && 'panels' in parsed
      ? (parsed as SerializedDockview)
      : null;
  } catch {
    return null;
  }
}

function writeStoredLayout(storageKey: string, layout: SerializedDockview): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(storageKey, JSON.stringify(layout));
}

function removeStoredLayout(storageKey: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(storageKey);
}

function ensurePanel(api: DockviewApi, tab: RightPanelTab, paneKey: WorkspacePaneKey, referencePanel: string = CHAT_PANEL_ID): boolean {
  const id = toolPanelId(tab);
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return false;
  }

  const editorReferencePanel = tab === 'editor' && api.getPanel(toolPanelId('files')) ? toolPanelId('files') : referencePanel;
  const initialWidth = newToolPanelWidth(api, editorReferencePanel);
  api.addPanel({
    id,
    component: 'tool',
    title: RIGHT_PANEL_TAB_LABELS[tab],
    params: { tab, paneKey },
    position: {
      direction: paneKey === 'bottom' ? 'below' : 'right',
      referencePanel: editorReferencePanel,
    },
    initialWidth,
    initialHeight: DEFAULT_NEW_TOOL_PANEL_HEIGHT,
    minimumWidth: 260,
    minimumHeight: 180,
  });
  return true;
}

function ensureChatPanel(api: DockviewApi): void {
  if (api.getPanel(CHAT_PANEL_ID)) return;
  api.addPanel({
    id: CHAT_PANEL_ID,
    component: 'chat',
    title: 'Agent Chat',
    minimumWidth: 320,
    minimumHeight: 220,
  });
}

function createDefaultLayout(
  api: DockviewApi,
  activeToolTab: RightPanelTab,
  toolPaneOpen: boolean,
): void {
  api.clear();
  ensureChatPanel(api);
  if (!toolPaneOpen) return;
  ensurePanel(api, activeToolTab, 'single');
}

function ChatPanel({ containerApi }: IDockviewPanelProps) {
  const content = React.useContext(DockableDroneWorkspaceContext).chatContent;
  React.useEffect(() => {
    const panel = containerApi.getPanel(CHAT_PANEL_ID);
    if (panel) panel.api.setTitle('Agent Chat');
  }, [containerApi]);
  return <div className="h-full min-w-0 min-h-0 overflow-hidden bg-[var(--panel)] flex flex-col">{content}</div>;
}

function ToolPanel({ api, params }: IDockviewPanelProps<{ tab?: RightPanelTab; paneKey?: WorkspacePaneKey }>) {
  const ctx = React.useContext(DockableDroneWorkspaceContext);
  const tab = params.tab && params.tab in RIGHT_PANEL_TAB_LABELS ? params.tab : tabFromPanelId(api.id);
  const paneKey = params.paneKey ?? 'single';
  const previewHostedHere = Boolean(tab && tab === ctx.previewTab);
  const onPreviewHostChanged = ctx.onPreviewHostChanged;

  React.useLayoutEffect(() => {
    if (!previewHostedHere) return;
    onPreviewHostChanged();
  }, [onPreviewHostChanged, previewHostedHere]);

  if (!tab) return null;

  return (
    <div
      data-dockview-preview-host={previewHostedHere ? '1' : undefined}
      className="h-full min-w-0 min-h-0 overflow-hidden bg-[var(--panel-alt)] relative flex flex-col"
    >
      {previewHostedHere ? <div className="absolute inset-0 min-h-0 overflow-hidden" aria-hidden="true" /> : ctx.renderToolPane(tab, paneKey)}
    </div>
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
    <div className="h-full flex items-center justify-center bg-[var(--panel)] text-[12px] text-[var(--muted)]">
      Open a pane from the toolbar.
    </div>
  );
}

const DockableDroneWorkspaceContext = React.createContext<{
  chatContent: React.ReactNode;
  renderToolPane: (tab: RightPanelTab, paneKey: WorkspacePaneKey) => React.ReactNode;
  activeToolTab: RightPanelTab;
  previewTab: RightPanelTab;
  onPreviewHostChanged: () => void;
}>({
  chatContent: null,
  renderToolPane: () => null,
  activeToolTab: 'files',
  previewTab: 'preview',
  onPreviewHostChanged: () => {},
});

export function DockableDroneWorkspace({
  currentDrone,
  activeChatName,
  layoutScope,
  paneHeaderMode,
  toolPaneOpen,
  activeToolTab,
  openRequestNonce,
  resetLayoutNonce,
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
  const suppressSaveRef = React.useRef(false);
  const lastAppliedOpenRequestRef = React.useRef<number>(-1);
  const lastAppliedToolTabRef = React.useRef<RightPanelTab | null>(null);
  const lastAppliedOpenStateRef = React.useRef<boolean | null>(null);
  const lastLoadedKeyRef = React.useRef<string>('');
  const [previewHostVersion, setPreviewHostVersion] = React.useState(0);
  const [workspacePanelCount, setWorkspacePanelCount] = React.useState(1);
  const lastReportedPreviewHostRef = React.useRef<PreviewHostState | null>(null);
  const isMobileViewport = useMobileViewport();
  const [mobileActivePanel, setMobileActivePanel] = React.useState<'chat' | 'tool'>('chat');
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
  const storageKey = React.useMemo(
    () => layoutStorageKey(layoutScope, currentDrone.id, activeChatName),
    [activeChatName, currentDrone.id, layoutScope],
  );
  const contextValue = React.useMemo(
    () => ({
      chatContent,
      renderToolPane,
      activeToolTab,
      previewTab,
      onPreviewHostChanged: markPreviewHostChanged,
    }),
    [activeToolTab, chatContent, markPreviewHostChanged, previewTab, renderToolPane],
  );
  const components = React.useMemo(() => ({ chat: ChatPanel, tool: ToolPanel }), []);

  React.useEffect(() => {
    if (!isMobileViewport) return;
    setMobileActivePanel(toolPaneOpen ? 'tool' : 'chat');
  }, [activeToolTab, isMobileViewport, openRequestNonce, toolPaneOpen]);

  React.useEffect(() => {
    if (!isMobileViewport) return;
    onVisibleToolTabsChange?.(toolPaneOpen ? [activeToolTab] : []);
  }, [activeToolTab, isMobileViewport, onVisibleToolTabsChange, toolPaneOpen]);

  const persistCurrentLayout = React.useCallback(() => {
    const api = apiRef.current;
    if (!api || suppressSaveRef.current) return;
    try {
      writeStoredLayout(storageKey, api.toJSON());
    } catch {
      // Ignore layout persistence failures; the active workspace can keep running.
    }
  }, [storageKey]);

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
      const stored = readStoredLayout(storageKey);
      if (stored && toolPaneOpen) {
        api.fromJSON(stored, { reuseExistingPanels: true });
        ensureChatPanel(api);
      } else {
        createDefaultLayout(api, activeToolTab, toolPaneOpen);
      }
      lastLoadedKeyRef.current = storageKey;
      lastAppliedOpenRequestRef.current = openRequestNonce;
      lastAppliedToolTabRef.current = activeToolTab;
      lastAppliedOpenStateRef.current = toolPaneOpen;
    } catch {
      createDefaultLayout(api, activeToolTab, toolPaneOpen);
    } finally {
      suppressSaveRef.current = false;
      updateWorkspacePanelState();
      persistCurrentLayout();
    }
  }, [activeToolTab, openRequestNonce, persistCurrentLayout, storageKey, toolPaneOpen, updateWorkspacePanelState]);

  const handleReady = React.useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      loadLayout();

      const layoutDisposable = event.api.onDidLayoutChange(() => {
        updateWorkspacePanelState();
        persistCurrentLayout();
      });
      const activePanelDisposable = event.api.onDidActivePanelChange((panel) => {
        if (!panel) return;
        const tab = tabFromPanelId(panel.id);
        if (tab) onActiveToolTabChange?.(tab);
      });
      const removeDisposable = event.api.onDidRemovePanel((panel) => {
        if (panel.id !== CHAT_PANEL_ID) {
          const tab = tabFromPanelId(panel.id);
          if (tab) {
            lastAppliedToolTabRef.current = null;
          }
          updateWorkspacePanelState();
          rebalanceWorkspaceGridGroups(onAfterToolPanelRemove);
          return;
        }
        window.setTimeout(() => {
          const api = apiRef.current;
          if (!api) return;
          suppressSaveRef.current = true;
          ensureChatPanel(api);
          updateWorkspacePanelState();
          suppressSaveRef.current = false;
          persistCurrentLayout();
        }, 0);
      });
      updateWorkspacePanelState();
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [layoutDisposable, activePanelDisposable, removeDisposable];
    },
    [loadLayout, onActiveToolTabChange, onAfterToolPanelRemove, persistCurrentLayout, rebalanceWorkspaceGridGroups, updateWorkspacePanelState],
  );

  React.useEffect(() => {
    return () => {
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];
    };
  }, []);

  const handleWorkspaceMouseDownCapture = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    onBeforeWorkspaceMouseDown?.();
  }, [onBeforeWorkspaceMouseDown]);

  React.useEffect(() => {
    if (!apiRef.current) return;
    if (lastLoadedKeyRef.current === storageKey) return;
    loadLayout();
  }, [loadLayout, storageKey]);

  React.useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (resetLayoutNonce <= 0) return;
    removeStoredLayout(storageKey);
    suppressSaveRef.current = true;
    createDefaultLayout(api, activeToolTab, toolPaneOpen);
    suppressSaveRef.current = false;
    updateWorkspacePanelState();
    persistCurrentLayout();
  }, [activeToolTab, persistCurrentLayout, resetLayoutNonce, storageKey, toolPaneOpen, updateWorkspacePanelState]);

  React.useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (!toolPaneOpen) return;
    const toolTabChanged = activeToolTab !== lastAppliedToolTabRef.current;
    const openedFromClosed = lastAppliedOpenStateRef.current === false && toolPaneOpen;
    if (
      openRequestNonce === lastAppliedOpenRequestRef.current &&
      !toolTabChanged &&
      !openedFromClosed
    ) {
      return;
    }
    lastAppliedOpenRequestRef.current = openRequestNonce;
    lastAppliedToolTabRef.current = activeToolTab;
    lastAppliedOpenStateRef.current = toolPaneOpen;
    let addedPanel = false;
    suppressSaveRef.current = true;
    try {
      ensureChatPanel(api);
      addedPanel = ensurePanel(api, activeToolTab, 'single');
    } finally {
      suppressSaveRef.current = false;
    }
    updateWorkspacePanelState();
    if (addedPanel) {
      rebalanceWorkspaceGridGroups();
    } else {
      persistCurrentLayout();
    }
  }, [activeToolTab, openRequestNonce, persistCurrentLayout, rebalanceWorkspaceGridGroups, toolPaneOpen, updateWorkspacePanelState]);

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
    storageKey,
    toolPaneOpen,
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
        <div className="dh-mobile-workspace flex-1 min-h-0 min-w-0 overflow-hidden bg-[var(--panel)] flex flex-col">
          {toolPaneOpen ? (
            <div className="dh-mobile-workspace-tabs flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel-alt)] px-2 py-1.5">
              <button
                type="button"
                onClick={() => setMobileActivePanel('chat')}
                className={`inline-flex h-8 items-center rounded-md border px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  mobileActivePanel === 'chat'
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileActivePanel('tool');
                  onActiveToolTabChange?.(activeToolTab);
                }}
                className={`inline-flex h-8 items-center rounded-md border px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  mobileActivePanel === 'tool'
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {RIGHT_PANEL_TAB_LABELS[activeToolTab]}
              </button>
            </div>
          ) : null}
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            {mobileActivePanel === 'tool' && toolPaneOpen ? (
              activeToolTab === previewTab ? (
                <div
                  data-dockview-preview-host="1"
                  className="h-full min-w-0 min-h-0 overflow-hidden bg-[var(--panel-alt)] relative flex flex-col"
                >
                  <div className="absolute inset-0 min-h-0 overflow-hidden" aria-hidden="true" />
                </div>
              ) : (
                <div className="h-full min-w-0 min-h-0 overflow-hidden bg-[var(--panel-alt)]">
                  {renderToolPane(activeToolTab, 'single')}
                </div>
              )
            ) : (
              <div className="h-full min-w-0 min-h-0 overflow-hidden bg-[var(--panel)] flex flex-col">{chatContent}</div>
            )}
          </div>
        </div>
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
