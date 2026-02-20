import React from 'react';
import type { DroneSummary } from '../types';

export type RightPanelTabId = 'terminal' | 'files' | 'preview' | 'links' | 'changes' | 'prs';
export type RightPanelPaneId = 'single' | 'top' | 'bottom';

export type RightPanelProps = {
  currentDrone: DroneSummary;
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
};

export function RightPanel({
  currentDrone,
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
}: RightPanelProps) {
  return (
    <aside
      className="relative flex-shrink-0 bg-[var(--panel-alt)] border-l border-[var(--border)] flex flex-col min-h-0 overflow-hidden"
      style={{ width: rightPanelWidth, minWidth: rightPanelMinWidth, maxWidth: rightPanelWidthMax }}
    >
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
      {rightPanelSplit ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
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
            <div className="flex-1 min-h-0 overflow-hidden">{renderTabContent(currentDrone, rightPanelTab, 'top')}</div>
          </div>
          <div className="h-px bg-[var(--border)]" />
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
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
            <div className="flex-1 min-h-0 overflow-hidden">{renderTabContent(currentDrone, rightPanelBottomTab, 'bottom')}</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden">{renderTabContent(currentDrone, rightPanelTab, 'single')}</div>
      )}
    </aside>
  );
}
