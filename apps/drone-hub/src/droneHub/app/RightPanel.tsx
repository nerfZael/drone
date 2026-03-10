import React from 'react';
import type { DroneSummary } from '../types';

export type RightPanelTabId =
  | 'terminal'
  | 'files'
  | 'preview'
  | 'links'
  | 'changes'
  | 'prs'
  | 'canvas';
export type RightPanelPaneId = 'single' | 'top' | 'bottom';

export type RightPanelProps = {
  currentDrone: DroneSummary | null;
  visible: boolean;
  rightPanelWidth: number;
  rightPanelWidthMax: number;
  rightPanelMinWidth: number;
  rightPanelResizing: boolean;
  rightPanelSplit: boolean;
  rightPanelTab: RightPanelTabId;
  rightPanelBottomTab: RightPanelTabId;
  rightPanelTabs: readonly RightPanelTabId[];
  rightPanelTabLabels: Record<RightPanelTabId, string>;
  onRightPanelTabChange: (tab: RightPanelTabId) => void;
  onRightPanelBottomTabChange: (tab: RightPanelTabId) => void;
  onStartResize: React.MouseEventHandler<HTMLDivElement>;
  onResetWidth: () => void;
  renderTabContent: (drone: DroneSummary, tab: RightPanelTabId, pane: RightPanelPaneId) => React.ReactNode;
  persistentPreviewHostPane: RightPanelPaneId | null;
  onPersistentPreviewHostChange?: (state: {
    style: React.CSSProperties;
    activeDroneId: string | null;
    previewVisible: boolean;
  }) => void;
};

export function RightPanel({
  currentDrone,
  visible,
  rightPanelWidth,
  rightPanelWidthMax,
  rightPanelMinWidth,
  rightPanelResizing,
  rightPanelSplit,
  rightPanelTab,
  rightPanelBottomTab,
  rightPanelTabs,
  rightPanelTabLabels,
  onRightPanelTabChange,
  onRightPanelBottomTabChange,
  onStartResize,
  onResetWidth,
  renderTabContent,
  persistentPreviewHostPane,
  onPersistentPreviewHostChange,
}: RightPanelProps) {
  const asideRef = React.useRef<HTMLElement | null>(null);
  const paneContentRefs = React.useRef<Partial<Record<RightPanelPaneId, HTMLDivElement | null>>>({});
  const [previewHostStyle, setPreviewHostStyle] = React.useState<React.CSSProperties>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const setPaneContentRef = React.useCallback(
    (pane: RightPanelPaneId) => (node: HTMLDivElement | null) => {
      paneContentRefs.current[pane] = node;
    },
    [],
  );
  const previewVisible = Boolean(visible && currentDrone && persistentPreviewHostPane);

  React.useLayoutEffect(() => {
    const workspaceRoot = document.querySelector<HTMLElement>('[data-drone-workspace-root="1"]');
    const hostPane = persistentPreviewHostPane ? paneContentRefs.current[persistentPreviewHostPane] ?? null : null;
    if (!workspaceRoot || !hostPane || !previewVisible) {
      setPreviewHostStyle({ left: 0, top: 0, width: 0, height: 0 });
      return;
    }

    const updatePosition = () => {
      const workspaceRect = workspaceRoot.getBoundingClientRect();
      const paneRect = hostPane.getBoundingClientRect();
      setPreviewHostStyle({
        left: paneRect.left - workspaceRect.left,
        top: paneRect.top - workspaceRect.top,
        width: paneRect.width,
        height: paneRect.height,
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
    resizeObserver?.observe(hostPane);
    window.addEventListener('resize', updatePosition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [currentDrone?.id, persistentPreviewHostPane, previewVisible, rightPanelBottomTab, rightPanelSplit, rightPanelTab, rightPanelWidth]);

  React.useLayoutEffect(() => {
    onPersistentPreviewHostChange?.({
      style: previewHostStyle,
      activeDroneId: currentDrone?.id ?? null,
      previewVisible,
    });
  }, [currentDrone?.id, onPersistentPreviewHostChange, previewHostStyle, previewVisible]);

  React.useEffect(() => {
    return () => {
      onPersistentPreviewHostChange?.({
        style: { left: 0, top: 0, width: 0, height: 0 },
        activeDroneId: null,
        previewVisible: false,
      });
    };
  }, [onPersistentPreviewHostChange]);

  const renderPaneContent = React.useCallback(
    (activeTab: RightPanelTabId, pane: RightPanelPaneId, showActiveContent: boolean) => {
      const previewHostedHere = Boolean(activeTab === 'preview' && persistentPreviewHostPane === pane);
      const previewHostedElsewhere = Boolean(activeTab === 'preview' && persistentPreviewHostPane && persistentPreviewHostPane !== pane);
      return (
        <div ref={setPaneContentRef(pane)} className="flex-1 min-h-0 overflow-hidden relative">
          {showActiveContent && visible && currentDrone && (activeTab !== 'preview' || !persistentPreviewHostPane) ? (
            <div className="absolute inset-0 min-h-0 overflow-hidden">{renderTabContent(currentDrone, activeTab, pane)}</div>
          ) : null}
          {previewHostedHere ? <div className="absolute inset-0 min-h-0 overflow-hidden" aria-hidden="true" /> : null}
          {previewHostedElsewhere ? (
            <div className="absolute inset-0 min-h-0 overflow-hidden flex items-center justify-center bg-[rgba(0,0,0,.08)] px-4 text-center text-[11px] text-[var(--muted-dim)]">
              This Browser session is already active in the other preview pane.
            </div>
          ) : null}
        </div>
      );
    },
    [currentDrone, persistentPreviewHostPane, renderTabContent, setPaneContentRef, visible],
  );

  return (
    <aside
      ref={asideRef}
      aria-hidden={!visible}
      className={`relative bg-[var(--panel-alt)] flex flex-col min-h-0 overflow-hidden transition-[width,border-color] ${
        visible ? 'flex-shrink-0 border-l border-[var(--border)]' : 'flex-shrink-0 border-l border-transparent pointer-events-none'
      }`}
      style={
        visible
          ? { width: rightPanelWidth, minWidth: rightPanelMinWidth, maxWidth: rightPanelWidthMax }
          : { width: 0, minWidth: 0, maxWidth: 0 }
      }
    >
      {visible ? (
        <div
          role="separator"
          aria-label="Resize right panel"
          aria-orientation="vertical"
          onMouseDown={onStartResize}
          onDoubleClick={onResetWidth}
          className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 z-30 cursor-col-resize group"
          title="Drag to resize panel. Double-click to reset."
        >
          <div
            className={`absolute left-1/2 top-0 h-full -translate-x-1/2 w-px transition-colors ${
              rightPanelResizing
                ? 'bg-[var(--accent)]'
                : 'bg-transparent group-hover:bg-[var(--accent-muted)]'
            }`}
          />
        </div>
      ) : null}
      <div className={`flex-1 min-h-0 overflow-hidden flex flex-col ${rightPanelSplit ? '' : 'hidden'}`}>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col" data-right-panel-pane="top">
          <div className="flex-shrink-0 px-2 py-1 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] flex items-center gap-2">
            <span className="text-[9px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
              Top Pane
            </span>
            <div className="w-[2px] h-3.5 rounded-full bg-[var(--muted)] opacity-65 shadow-[0_0_0_1px_rgba(255,255,255,.05)]" />
            <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto pr-1">
              {rightPanelTabs.map((tab) => {
                const active = rightPanelTab === tab;
                return (
                  <button
                    key={`top-pane-${tab}`}
                    type="button"
                    onClick={() => onRightPanelTabChange(tab)}
                    data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide uppercase whitespace-nowrap transition-all ${
                      active
                        ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-muted)]'
                        : 'text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {rightPanelTabLabels[tab]}
                  </button>
                );
              })}
            </div>
          </div>
          {renderPaneContent(rightPanelTab, 'top', rightPanelSplit)}
        </div>
        <div className="h-px bg-[var(--border)]" />
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col" data-right-panel-pane="bottom">
          <div className="flex-shrink-0 px-2 py-1 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] flex items-center gap-2">
            <span className="text-[9px] font-semibold tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
              Bottom Pane
            </span>
            <div className="w-[2px] h-3.5 rounded-full bg-[var(--muted)] opacity-65 shadow-[0_0_0_1px_rgba(255,255,255,.05)]" />
            <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto pr-1">
              {rightPanelTabs.map((tab) => {
                const active = rightPanelBottomTab === tab;
                return (
                  <button
                    key={`bottom-pane-${tab}`}
                    type="button"
                    onClick={() => onRightPanelBottomTabChange(tab)}
                    data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide uppercase whitespace-nowrap transition-all ${
                      active
                        ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-muted)]'
                        : 'text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {rightPanelTabLabels[tab]}
                  </button>
                );
              })}
            </div>
          </div>
          {renderPaneContent(rightPanelBottomTab, 'bottom', rightPanelSplit)}
        </div>
      </div>
      <div className={`flex-1 min-h-0 overflow-hidden flex-col ${rightPanelSplit ? 'hidden' : 'flex'}`}>
        {renderPaneContent(rightPanelTab, 'single', !rightPanelSplit)}
      </div>
    </aside>
  );
}
