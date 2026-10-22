import React from 'react';
import { FileTypeIcon } from './FileTypeIcon';
import { setFileTabDragPayload } from '../app/file-tab-drag';
import { SidebarContextMenu, type SidebarContextMenuItem } from '../app/SidebarContextMenu';
import type { DroneOpenedFileTabState } from './opened-file-types';

type OpenedDroneFileTabsProps = {
  tabs: DroneOpenedFileTabState[];
  activeTabId: string | null;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** Closes several tabs at once (the tab menu's Close Others, Close Saved…); `keepActiveTabId` is the tab the menu was opened on. */
  onCloseTabs?: (tabIds: string[], keepActiveTabId: string) => void;
  onReorderTabs: (fromTabId: string, toTabId: string) => void;
  /** The workspace a tab's file is in, when the strip holds tabs from more than the drone's own; null for its own. */
  workspaceLabel?: (tab: DroneOpenedFileTabState) => string | null;
  trailingActions?: React.ReactNode;
  fullScreenAction?: {
    active: boolean;
    onToggle: () => void;
  };
};

function IconClose({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  );
}

type TabMenuState = { tabId: string; x: number; y: number; view: Window };

/** VS Code's tab menu, plus Close to the Left. */
export function fileTabMenuItems(
  tabs: DroneOpenedFileTabState[],
  tabId: string,
  onCloseTab: (tabId: string) => void,
  onCloseTabs: (tabIds: string[], keepActiveTabId: string) => void,
): SidebarContextMenuItem[] {
  const index = tabs.findIndex((tab) => tab.tabId === tabId);
  const ids = (list: DroneOpenedFileTabState[]) => list.map((tab) => tab.tabId);
  const others = ids(tabs.filter((tab) => tab.tabId !== tabId));
  const left = ids(tabs.slice(0, Math.max(0, index)));
  const right = ids(tabs.slice(index + 1));
  const saved = ids(tabs.filter((tab) => !tab.dirty));
  const all = ids(tabs);
  return [
    { id: 'close', label: 'Close', onSelect: () => onCloseTab(tabId) },
    { id: 'close-others', label: 'Close Others', disabled: others.length === 0, onSelect: () => onCloseTabs(others, tabId) },
    { id: 'close-left', label: 'Close to the Left', disabled: left.length === 0, onSelect: () => onCloseTabs(left, tabId) },
    { id: 'close-right', label: 'Close to the Right', disabled: right.length === 0, onSelect: () => onCloseTabs(right, tabId) },
    { id: 'close-saved', label: 'Close Saved', disabled: saved.length === 0, onSelect: () => onCloseTabs(saved, tabId) },
    { id: 'close-all', label: 'Close All', onSelect: () => onCloseTabs(all, tabId) },
  ];
}

function FullScreenIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {active ? (
        <>
          <path d="M6 2v4H2" />
          <path d="m2 6 4-4" />
          <path d="M10 14v-4h4" />
          <path d="m14 10-4 4" />
        </>
      ) : (
        <>
          <path d="M6 2H2v4" />
          <path d="M10 2h4v4" />
          <path d="M6 14H2v-4" />
          <path d="M10 14h4v-4" />
        </>
      )}
    </svg>
  );
}

export function OpenedDroneFileTabs({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onCloseTabs,
  onReorderTabs,
  workspaceLabel,
  trailingActions,
  fullScreenAction,
}: OpenedDroneFileTabsProps) {
  const [draggingTabId, setDraggingTabId] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<TabMenuState | null>(null);
  const closeMenu = React.useCallback(() => setMenu(null), []);
  const normalizedTabs = tabs.filter((tab) => String(tab.tabId ?? '').trim());
  const menuTabOpen = Boolean(menu && normalizedTabs.some((tab) => tab.tabId === menu.tabId));
  // A tab closed while its menu is open drops the menu, so reopening the file does not bring it back.
  React.useEffect(() => {
    if (menu && !menuTabOpen) setMenu(null);
  }, [menu, menuTabOpen]);
  if (normalizedTabs.length === 0 && !trailingActions && !fullScreenAction) return null;

  return (
    <div className="flex h-9 items-stretch border-b border-[var(--border-subtle)] bg-[var(--panel-alt)]" data-file-tab-strip="">
      <div className="flex h-9 min-w-0 flex-1 items-stretch overflow-x-auto" role="tablist" aria-label="Open files">
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
          const workspace = workspaceLabel?.(tab) ?? null;
          const title = `${displayName}${workspace ? ` · ${workspace}` : ''}${tab.dirty ? ' (unsaved)' : ''}`;
          return (
            <div
              key={tab.tabId}
              draggable
              onDragStart={(event) => {
                setDraggingTabId(tab.tabId);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', tab.tabId);
                // Dropping the tab on the workspace grid opens it in its own window.
                // A file window reads from disk, so an unsaved new file stays here.
                if (!tab.untitled) setFileTabDragPayload(event.dataTransfer, {
                  droneId: tab.droneId,
                  tabId: tab.tabId,
                  path: tab.path ?? '',
                  name: displayName,
                });
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
              onContextMenu={onCloseTabs ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                // A file tab strip in a desktop tool window opens the menu in that window.
                const view = event.currentTarget.ownerDocument.defaultView;
                if (view) setMenu({ tabId: tab.tabId, x: event.clientX, y: event.clientY, view });
              } : undefined}
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
              className={`group/tab relative flex h-9 min-w-[120px] ${workspace ? 'max-w-[260px]' : 'max-w-[200px]'} items-center gap-0 overflow-hidden border-r border-[var(--border-subtle)] text-ui transition-colors ${
                active
                  ? 'bg-[var(--editor-surface)] text-[var(--fg)] shadow-[inset_0_2px_0_var(--accent)]'
                  : 'bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              } ${draggingTabId === tab.tabId ? 'opacity-45' : ''}`}
              title={title}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onActivateTab(tab.tabId)}
                className="flex h-9 min-w-0 flex-1 items-center gap-1.5 pl-3 pr-1 text-left"
                title={title}
              >
                <FileTypeIcon path={iconPath} className="h-3.5 w-3.5 shrink-0" size={14} />
                <span className="truncate">
                  {displayName}
                  {tab.dirty ? <span aria-hidden="true">*</span> : null}
                </span>
                {workspace ? (
                  // The file's name keeps its room; the workspace gives way first.
                  <span className="min-w-[3ch] shrink-[4] truncate text-caption text-[var(--muted-dim)]" data-tab-workspace="">{workspace}</span>
                ) : null}
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
                className="pointer-events-none mr-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted-dim)] opacity-0 transition-[background-color,color,opacity] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] group-hover/tab:pointer-events-auto group-hover/tab:opacity-70 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-70 hover:!opacity-100 focus-visible:pointer-events-auto focus-visible:!opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
                title={`Close ${displayName}`}
                aria-label={`Close ${displayName}`}
              >
                <IconClose className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      {menu && menuTabOpen && onCloseTabs ? (
        <SidebarContextMenu
          x={menu.x}
          y={menu.y}
          view={menu.view}
          label="File tab actions"
          items={fileTabMenuItems(normalizedTabs, menu.tabId, onCloseTab, onCloseTabs)}
          onClose={closeMenu}
        />
      ) : null}
      {trailingActions ? (
        <div className="flex h-9 shrink-0 items-center gap-1 px-2">
          {trailingActions}
        </div>
      ) : null}
      {fullScreenAction ? (
        <div className="flex h-9 shrink-0 items-center pr-2">
          <button
            type="button"
            onClick={fullScreenAction.onToggle}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-medium)] bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
            title={fullScreenAction.active ? 'Exit full screen' : 'Enter full screen'}
            aria-label={fullScreenAction.active ? 'Exit full screen' : 'Enter full screen'}
            aria-pressed={fullScreenAction.active}
          >
            <FullScreenIcon active={fullScreenAction.active} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
