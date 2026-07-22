import React from 'react';
import { iconForFilePath } from '../icons';
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
    <div className="flex items-end border-b border-[var(--border-subtle)] bg-[var(--surface-soft)]">
      <div className="min-h-[34px] min-w-0 flex flex-1 items-end gap-1 overflow-x-auto px-2 pt-1.5" role="tablist" aria-label="Open files">
        {normalizedTabs.map((tab) => {
          const active = tab.tabId === activeTabId;
          const FileIcon = iconForFilePath(tab.path ?? tab.name ?? '');
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
              className={`group/tab flex h-8 min-w-[120px] max-w-[220px] items-center gap-1.5 rounded-t-md border px-2 text-[var(--text-11)] transition-colors ${
                active
                  ? 'border-[var(--border-subtle)] border-b-[var(--panel-alt)] bg-[var(--panel-alt)] text-[var(--fg-secondary)]'
                  : 'border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              } ${draggingTabId === tab.tabId ? 'opacity-45' : ''}`}
              title={title}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onActivateTab(tab.tabId)}
                className="min-w-0 flex-1 flex items-center gap-1.5 text-left"
                title={title}
              >
                <FileIcon className="h-3.5 w-3.5 shrink-0" />
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
                className="pointer-events-none shrink-0 rounded p-0.5 text-[var(--muted-dim)] opacity-0 transition-opacity hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                title={`Close ${displayName}`}
                aria-label={`Close ${displayName}`}
              >
                <IconClose className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      {trailingActions ? (
        <div className="flex h-[38px] shrink-0 items-center px-2">
          {trailingActions}
        </div>
      ) : null}
    </div>
  );
}
