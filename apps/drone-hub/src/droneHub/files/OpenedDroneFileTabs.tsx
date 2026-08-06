import React from 'react';
import { FileTypeIcon } from './FileTypeIcon';
import type { DroneOpenedFileTabState } from './opened-file-types';

type OpenedDroneFileTabsProps = {
  tabs: DroneOpenedFileTabState[];
  activeTabId: string | null;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onReorderTabs: (fromTabId: string, toTabId: string) => void;
  trailingActions?: React.ReactNode;
};

function IconClose({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  );
}

export function OpenedDroneFileTabs({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onReorderTabs,
  trailingActions,
}: OpenedDroneFileTabsProps) {
  const [draggingTabId, setDraggingTabId] = React.useState<string | null>(null);
  const normalizedTabs = tabs.filter((tab) => String(tab.tabId ?? '').trim());
  if (normalizedTabs.length === 0 && !trailingActions) return null;

  return (
    <div className="flex h-7 items-end border-b border-[var(--border-subtle)] bg-[var(--surface-softest)]">
      <div className="flex h-7 min-w-0 flex-1 items-end gap-0.5 overflow-x-auto px-1.5 pt-1" role="tablist" aria-label="Open files">
        {normalizedTabs.map((tab) => {
          const active = tab.tabId === activeTabId;
          const iconPath = tab.path ?? tab.name ?? '';
          const displayName =
            tab.name ||
            String(tab.path ?? '')
              .split(/[\\/]/)
              .filter(Boolean)
              .pop() ||
            'File';
          const title = `${displayName}${tab.dirty ? ' (unsaved)' : ''}`;
          return (
            <div
              key={tab.tabId}
              draggable
              onDragStart={(event) => {
                setDraggingTabId(tab.tabId);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', tab.tabId);
              }}
              onDragEnd={() => setDraggingTabId(null)}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                event.stopPropagation();
                onCloseTab(tab.tabId);
              }}
              onDragOver={(event) => {
                if (!draggingTabId || draggingTabId === tab.tabId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const fromTabId = event.dataTransfer.getData('text/plain') || draggingTabId;
                setDraggingTabId(null);
                if (!fromTabId || fromTabId === tab.tabId) return;
                onReorderTabs(fromTabId, tab.tabId);
              }}
              className={`group/tab flex h-6 min-w-[104px] max-w-[180px] items-center gap-0 overflow-hidden rounded-t-md text-[var(--text-11)] transition-colors ${
                active
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              } ${draggingTabId === tab.tabId ? 'opacity-45' : ''}`}
              title={title}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onActivateTab(tab.tabId)}
                className="flex h-6 min-w-0 flex-1 items-center gap-1 px-1.5 text-left"
                title={title}
              >
                <FileTypeIcon path={iconPath} className="h-3 w-3 shrink-0" size={12} />
                <span className="truncate">
                  {displayName}
                  {tab.dirty ? <span aria-hidden="true">*</span> : null}
                </span>
                {tab.dirty ? (
                  <span className="sr-only"> (unsaved)</span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseTab(tab.tabId);
                }}
                className="pointer-events-none inline-flex h-6 w-4 shrink-0 items-center justify-center rounded-none text-[var(--muted-dim)] opacity-0 transition-[background-color,color,opacity] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] group-hover/tab:pointer-events-auto group-hover/tab:opacity-70 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-70 hover:!opacity-100 focus-visible:pointer-events-auto focus-visible:!opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
                title={`Close ${displayName}`}
                aria-label={`Close ${displayName}`}
              >
                <IconClose className="h-2.5 w-2.5" />
              </button>
            </div>
          );
        })}
      </div>
      {trailingActions ? (
        <div className="flex h-7 shrink-0 items-center px-1.5">
          {trailingActions}
        </div>
      ) : null}
    </div>
  );
}
