import React from 'react';
import { IconGrip } from '../app/icons';
import { iconForFilePath } from '../icons';
import type { DroneOpenedFileTabState } from './opened-file-types';

type OpenedDroneFileTabsProps = {
  tabs: DroneOpenedFileTabState[];
  activeTabId: string | null;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onReorderTabs: (fromTabId: string, toTabId: string) => void;
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
}: OpenedDroneFileTabsProps) {
  const [draggingTabId, setDraggingTabId] = React.useState<string | null>(null);
  const normalizedTabs = tabs.filter((tab) => String(tab.tabId ?? '').trim());
  if (normalizedTabs.length === 0) return null;

  return (
    <div className="border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)]">
      <div className="min-h-[34px] flex items-end gap-1 overflow-x-auto px-2 pt-1.5" role="tablist" aria-label="Open files">
        {normalizedTabs.map((tab) => {
          const active = tab.tabId === activeTabId;
          const FileIcon = iconForFilePath(tab.path ?? tab.name ?? '');
          const title = `${tab.path || tab.name || 'File'}${tab.dirty ? ' (unsaved)' : ''}`;
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
              className={`group/tab flex h-8 min-w-[120px] max-w-[220px] items-center gap-1.5 rounded-t-md border px-2 text-[11px] transition-colors ${
                active
                  ? 'border-[var(--border-subtle)] border-b-[var(--panel-alt)] bg-[var(--panel-alt)] text-[var(--fg-secondary)]'
                  : 'border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              } ${draggingTabId === tab.tabId ? 'opacity-45' : ''}`}
              title={title}
            >
              <span className="shrink-0 cursor-grab text-[var(--muted-dim)] active:cursor-grabbing" aria-hidden="true">
                <IconGrip className="h-3 w-3" />
              </span>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onActivateTab(tab.tabId)}
                className="min-w-0 flex-1 flex items-center gap-1.5 text-left"
                title={title}
              >
                <FileIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{tab.name || tab.path || 'File'}</span>
                {tab.dirty ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" title="Unsaved changes">
                    <span className="sr-only">Unsaved changes</span>
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseTab(tab.tabId);
                }}
                className="shrink-0 rounded p-0.5 text-[var(--muted-dim)] opacity-70 hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] group-hover/tab:opacity-100 focus:opacity-100"
                title={`Close ${tab.name || tab.path || 'file'}`}
                aria-label={`Close ${tab.name || tab.path || 'file'}`}
              >
                <IconClose className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
