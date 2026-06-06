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

export type WorkspaceLayoutScope = 'global' | 'drone' | 'chat';
export type WorkspacePaneHeaderMode = 'normal' | 'compact';
type WorkspacePaneKey = 'single' | 'top' | 'bottom';

type DockableDroneWorkspaceProps = {
  currentDrone: DroneSummary;
  activeChatName: string;
  layoutScope: WorkspaceLayoutScope;
  paneHeaderMode: WorkspacePaneHeaderMode;
  toolPaneOpen: boolean;
  activeToolTab: RightPanelTab;
  secondaryToolTab: RightPanelTab;
  splitToolPane: boolean;
  openRequestNonce: number;
  resetLayoutNonce: number;
  chatContent: React.ReactNode;
  renderToolPane: (tab: RightPanelTab, paneKey: WorkspacePaneKey) => React.ReactNode;
  previewTab: RightPanelTab;
  onActiveToolTabChange?: (tab: RightPanelTab) => void;
  onPreviewHostChange?: (state: {
    style: React.CSSProperties;
    activeDroneId: string | null;
    previewVisible: boolean;
  }) => void;
};

const CHAT_PANEL_ID = 'agent-chat';
const TOOL_PANEL_PREFIX = 'tool:';
export const WORKSPACE_LAYOUT_SCOPES: WorkspaceLayoutScope[] = ['global', 'drone', 'chat'];
const LAYOUT_SCOPE_STORAGE_KEY = profileStorageKey('droneHub.workspaceLayoutScope');
const PANE_HEADER_MODE_STORAGE_KEY = profileStorageKey('droneHub.workspacePaneHeaderMode');
const LAYOUT_STORAGE_PREFIX = profileStorageKey('droneHub.workspaceLayout');
const PREVIEW_HOST_SELECTOR = '[data-dockview-preview-host="1"]';

function toolPanelId(tab: RightPanelTab): string {
  return `${TOOL_PANEL_PREFIX}${tab}`;
}

function tabFromPanelId(panelId: string): RightPanelTab | null {
  const raw = panelId.startsWith(TOOL_PANEL_PREFIX) ? panelId.slice(TOOL_PANEL_PREFIX.length) : '';
  return raw && raw in RIGHT_PANEL_TAB_LABELS ? (raw as RightPanelTab) : null;
}

function paneKeyForTab(tab: RightPanelTab, activeToolTab: RightPanelTab, secondaryToolTab: RightPanelTab): WorkspacePaneKey {
  if (tab === secondaryToolTab && tab !== activeToolTab) return 'bottom';
  if (tab === activeToolTab) return 'top';
  return 'single';
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

function ensurePanel(api: DockviewApi, tab: RightPanelTab, paneKey: WorkspacePaneKey, referencePanel: string = CHAT_PANEL_ID): void {
  const id = toolPanelId(tab);
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }

  api.addPanel({
    id,
    component: 'tool',
    title: RIGHT_PANEL_TAB_LABELS[tab],
    params: { tab, paneKey },
    position: {
      direction: paneKey === 'bottom' ? 'below' : 'right',
      referencePanel,
    },
    minimumWidth: 260,
    minimumHeight: 180,
  });
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
  secondaryToolTab: RightPanelTab,
  splitToolPane: boolean,
  toolPaneOpen: boolean,
): void {
  api.clear();
  ensureChatPanel(api);
  if (!toolPaneOpen) return;

  const firstPaneKey: WorkspacePaneKey = splitToolPane ? 'top' : 'single';
  ensurePanel(api, activeToolTab, firstPaneKey);
  if (splitToolPane && secondaryToolTab !== activeToolTab) {
    ensurePanel(api, secondaryToolTab, 'bottom', toolPanelId(activeToolTab));
  }
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
  const paneKey = tab ? params.paneKey ?? paneKeyForTab(tab, ctx.activeToolTab, ctx.secondaryToolTab) : 'single';
  const previewHostedHere = Boolean(tab && tab === ctx.previewTab);

  React.useLayoutEffect(() => {
    if (!previewHostedHere) return;
    ctx.onPreviewHostChanged();
  }, [ctx, previewHostedHere]);

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
  return <DockviewDefaultTab {...props} hideClose={props.api.id === CHAT_PANEL_ID} />;
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
  secondaryToolTab: RightPanelTab;
  previewTab: RightPanelTab;
  onPreviewHostChanged: () => void;
}>({
  chatContent: null,
  renderToolPane: () => null,
  activeToolTab: 'files',
  secondaryToolTab: 'terminal',
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
  secondaryToolTab,
  splitToolPane,
  openRequestNonce,
  resetLayoutNonce,
  chatContent,
  renderToolPane,
  previewTab,
  onActiveToolTabChange,
  onPreviewHostChange,
}: DockableDroneWorkspaceProps) {
  const apiRef = React.useRef<DockviewApi | null>(null);
  const disposablesRef = React.useRef<Array<{ dispose: () => void }>>([]);
  const suppressSaveRef = React.useRef(false);
  const lastAppliedOpenRequestRef = React.useRef<number>(-1);
  const lastAppliedToolTabRef = React.useRef<RightPanelTab | null>(null);
  const lastAppliedSecondaryToolTabRef = React.useRef<RightPanelTab | null>(null);
  const lastAppliedSplitToolPaneRef = React.useRef<boolean | null>(null);
  const lastAppliedOpenStateRef = React.useRef<boolean | null>(null);
  const lastLoadedKeyRef = React.useRef<string>('');
  const [previewHostVersion, setPreviewHostVersion] = React.useState(0);
  const markPreviewHostChanged = React.useCallback(() => {
    setPreviewHostVersion((version) => version + 1);
  }, []);
  const storageKey = React.useMemo(
    () => layoutStorageKey(layoutScope, currentDrone.id, activeChatName),
    [activeChatName, currentDrone.id, layoutScope],
  );
  const contextValue = React.useMemo(
    () => ({
      chatContent,
      renderToolPane,
      activeToolTab,
      secondaryToolTab,
      previewTab,
      onPreviewHostChanged: markPreviewHostChanged,
    }),
    [activeToolTab, chatContent, markPreviewHostChanged, previewTab, renderToolPane, secondaryToolTab],
  );
  const components = React.useMemo(() => ({ chat: ChatPanel, tool: ToolPanel }), []);

  const persistCurrentLayout = React.useCallback(() => {
    const api = apiRef.current;
    if (!api || suppressSaveRef.current) return;
    try {
      writeStoredLayout(storageKey, api.toJSON());
    } catch {
      // Ignore layout persistence failures; the active workspace can keep running.
    }
  }, [storageKey]);

  const loadLayout = React.useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    suppressSaveRef.current = true;
    try {
      const stored = readStoredLayout(storageKey);
      if (stored) {
        api.fromJSON(stored, { reuseExistingPanels: true });
        ensureChatPanel(api);
      } else {
        createDefaultLayout(api, activeToolTab, secondaryToolTab, splitToolPane, toolPaneOpen);
      }
      lastLoadedKeyRef.current = storageKey;
      lastAppliedOpenRequestRef.current = openRequestNonce;
      lastAppliedToolTabRef.current = activeToolTab;
      lastAppliedSecondaryToolTabRef.current = secondaryToolTab;
      lastAppliedSplitToolPaneRef.current = splitToolPane;
      lastAppliedOpenStateRef.current = toolPaneOpen;
    } catch {
      createDefaultLayout(api, activeToolTab, secondaryToolTab, splitToolPane, toolPaneOpen);
    } finally {
      suppressSaveRef.current = false;
      persistCurrentLayout();
    }
  }, [activeToolTab, openRequestNonce, persistCurrentLayout, secondaryToolTab, splitToolPane, storageKey, toolPaneOpen]);

  const handleReady = React.useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      loadLayout();

      const layoutDisposable = event.api.onDidLayoutChange(() => {
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
            lastAppliedSecondaryToolTabRef.current = null;
          }
          return;
        }
        window.setTimeout(() => {
          const api = apiRef.current;
          if (!api) return;
          suppressSaveRef.current = true;
          ensureChatPanel(api);
          suppressSaveRef.current = false;
          persistCurrentLayout();
        }, 0);
      });
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [layoutDisposable, activePanelDisposable, removeDisposable];
    },
    [loadLayout, onActiveToolTabChange, persistCurrentLayout],
  );

  React.useEffect(() => {
    return () => {
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];
    };
  }, []);

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
    createDefaultLayout(api, activeToolTab, secondaryToolTab, splitToolPane, toolPaneOpen);
    suppressSaveRef.current = false;
    persistCurrentLayout();
  }, [activeToolTab, persistCurrentLayout, resetLayoutNonce, secondaryToolTab, splitToolPane, storageKey, toolPaneOpen]);

  React.useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (!toolPaneOpen) return;
    const toolTabChanged = activeToolTab !== lastAppliedToolTabRef.current;
    const secondaryToolTabChanged = secondaryToolTab !== lastAppliedSecondaryToolTabRef.current;
    const splitToolPaneChanged = splitToolPane !== lastAppliedSplitToolPaneRef.current;
    const openedFromClosed = lastAppliedOpenStateRef.current === false && toolPaneOpen;
    if (
      openRequestNonce === lastAppliedOpenRequestRef.current &&
      !toolTabChanged &&
      !secondaryToolTabChanged &&
      !splitToolPaneChanged &&
      !openedFromClosed
    ) {
      return;
    }
    lastAppliedOpenRequestRef.current = openRequestNonce;
    lastAppliedToolTabRef.current = activeToolTab;
    lastAppliedSecondaryToolTabRef.current = secondaryToolTab;
    lastAppliedSplitToolPaneRef.current = splitToolPane;
    lastAppliedOpenStateRef.current = toolPaneOpen;
    ensureChatPanel(api);
    ensurePanel(api, activeToolTab, splitToolPane ? 'top' : 'single');
    if (splitToolPane && secondaryToolTab !== activeToolTab) {
      ensurePanel(api, secondaryToolTab, 'bottom', toolPanelId(activeToolTab));
    }
    persistCurrentLayout();
  }, [activeToolTab, openRequestNonce, persistCurrentLayout, secondaryToolTab, splitToolPane, toolPaneOpen]);

  React.useLayoutEffect(() => {
    const workspaceRoot = document.querySelector<HTMLElement>('[data-drone-workspace-root="1"]');
    const previewHost = document.querySelector<HTMLElement>(PREVIEW_HOST_SELECTOR);
    if (!workspaceRoot || !previewHost) {
      onPreviewHostChange?.({
        style: { left: 0, top: 0, width: 0, height: 0 },
        activeDroneId: null,
        previewVisible: false,
      });
      return;
    }

    const updatePosition = () => {
      const workspaceRect = workspaceRoot.getBoundingClientRect();
      const paneRect = previewHost.getBoundingClientRect();
      onPreviewHostChange?.({
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
  }, [currentDrone.id, onPreviewHostChange, previewHostVersion, activeToolTab, secondaryToolTab, splitToolPane, storageKey]);

  React.useEffect(() => {
    return () => {
      onPreviewHostChange?.({
        style: { left: 0, top: 0, width: 0, height: 0 },
        activeDroneId: null,
        previewVisible: false,
      });
    };
  }, [onPreviewHostChange]);

  return (
    <DockableDroneWorkspaceContext.Provider value={contextValue}>
      <div
        className={`flex-1 min-h-0 min-w-0 overflow-hidden dh-dockable-workspace ${
          paneHeaderMode === 'compact' ? 'dh-dockable-workspace--compact-headers' : ''
        }`}
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
    </DockableDroneWorkspaceContext.Provider>
  );
}
