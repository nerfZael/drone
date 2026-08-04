import React from 'react';
import {
  UiPaneState,
  UiPanelToolbar,
  UiResizeHandle,
  UiToolbarDivider,
  UiToolbarSegmentedControl,
} from '../../ui/components';
import type { DroneSummary } from '../types';
import { resolveRightPanelWidthStyleValue, type RightPanelWidthMode } from './right-panel-width';

export type RightPanelTabId =
  | 'terminal'
  | 'env'
  | 'files'
  | 'editor'
  | 'preview'
  | 'links'
  | 'changes'
  | 'prs'
  | 'canvas'
  | 'whiteboard'
  | 'workflows';
export type RightPanelPaneId = 'single' | 'top' | 'bottom';

export type RightPanelProps = {
  currentDrone: DroneSummary | null;
  visible: boolean;
  rightPanelWidth: number;
  rightPanelWidthMode: RightPanelWidthMode;
  rightPanelWidthMax: number;
  rightPanelMinWidth: number;
  rightPanelSplit: boolean;
  rightPanelTab: RightPanelTabId;
  rightPanelBottomTab: RightPanelTabId;
  rightPanelTabs: readonly RightPanelTabId[];
  rightPanelTabLabels: Record<RightPanelTabId, string>;
  onRightPanelTabChange: (tab: RightPanelTabId) => void;
  onRightPanelBottomTabChange: (tab: RightPanelTabId) => void;
  onWidthChange: (width: number) => void;
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
  rightPanelWidthMode,
  rightPanelWidthMax,
  rightPanelMinWidth,
  rightPanelSplit,
  rightPanelTab,
  rightPanelBottomTab,
  rightPanelTabs,
  rightPanelTabLabels,
  onRightPanelTabChange,
  onRightPanelBottomTabChange,
  onWidthChange,
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
            <UiPaneState
              kind="unavailable"
              title="Browser active in another pane"
              description="This Browser session is already active in the other preview pane."
              className="absolute inset-0 bg-[var(--surface-inset-faint)]"
            />
          ) : null}
        </div>
      );
    },
    [currentDrone, persistentPreviewHostPane, renderTabContent, setPaneContentRef, visible],
  );
  const rightPanelStyle = visible
    ? {
        width: resolveRightPanelWidthStyleValue(rightPanelWidthMode, rightPanelWidth),
        minWidth: rightPanelMinWidth,
        maxWidth: rightPanelWidthMode === 'custom' ? rightPanelWidthMax : '100%',
      }
    : { width: 0, minWidth: 0, maxWidth: 0 };

  return (
    <aside
      ref={asideRef}
      aria-hidden={!visible}
      className={`dh-utility-panel relative bg-[var(--panel-alt)] flex flex-col min-h-0 overflow-hidden transition-[width,border-color] ${
        visible ? 'flex-shrink-0 border-l border-[var(--border)]' : 'flex-shrink-0 border-l border-transparent pointer-events-none'
      }`}
      style={rightPanelStyle}
    >
      {visible ? (
        <UiResizeHandle
          orientation="vertical"
          value={rightPanelWidth}
          min={rightPanelMinWidth}
          max={rightPanelWidthMax}
          label="Resize right panel"
          reversed
          onValueChange={onWidthChange}
          onReset={onResetWidth}
          className="absolute inset-y-0 left-0 z-30 -translate-x-1/2"
        />
      ) : null}
      {visible ? (
        <>
          <div className={`flex-1 min-h-0 overflow-hidden flex flex-col ${rightPanelSplit ? '' : 'hidden'}`}>
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col" data-right-panel-pane="top">
              <UiPanelToolbar aria-label="Top pane tabs" className="gap-2 bg-[var(--surface-softest)]">
                <span className="text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                  Top Pane
                </span>
                <UiToolbarDivider />
                <UiToolbarSegmentedControl
                  label="Top pane"
                  value={rightPanelTab}
                  options={rightPanelTabs.map((tab) => ({
                    value: tab,
                    label:
                      tab === 'changes' ? (
                        <span data-onboarding-id="rightPanel.tab.changes">
                          {rightPanelTabLabels[tab]}
                        </span>
                      ) : (
                        rightPanelTabLabels[tab]
                      ),
                  }))}
                  onValueChange={onRightPanelTabChange}
                  className="min-w-0 overflow-x-auto"
                />
              </UiPanelToolbar>
              {renderPaneContent(rightPanelTab, 'top', rightPanelSplit)}
            </div>
            <div className="h-px bg-[var(--border)]" />
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col" data-right-panel-pane="bottom">
              <UiPanelToolbar aria-label="Bottom pane tabs" className="gap-2 bg-[var(--surface-softest)]">
                <span className="text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                  Bottom Pane
                </span>
                <UiToolbarDivider />
                <UiToolbarSegmentedControl
                  label="Bottom pane"
                  value={rightPanelBottomTab}
                  options={rightPanelTabs.map((tab) => ({
                    value: tab,
                    label:
                      tab === 'changes' ? (
                        <span data-onboarding-id="rightPanel.tab.changes">
                          {rightPanelTabLabels[tab]}
                        </span>
                      ) : (
                        rightPanelTabLabels[tab]
                      ),
                  }))}
                  onValueChange={onRightPanelBottomTabChange}
                  className="min-w-0 overflow-x-auto"
                />
              </UiPanelToolbar>
              {renderPaneContent(rightPanelBottomTab, 'bottom', rightPanelSplit)}
            </div>
          </div>
          <div className={`flex-1 min-h-0 overflow-hidden flex-col ${rightPanelSplit ? 'hidden' : 'flex'}`}>
            {renderPaneContent(rightPanelTab, 'single', !rightPanelSplit)}
          </div>
        </>
      ) : null}
    </aside>
  );
}
