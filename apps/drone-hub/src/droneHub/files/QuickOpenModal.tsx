import React from 'react';
import { IconChevron, iconForFilePath } from '../icons';
import { formatBytes, formatEditorMtime } from '../app/selected-drone-workspace-utils';
import {
  buildQuickOpenItems,
  quickOpenSelectionToOpenTarget,
  type QuickOpenFile,
  type QuickOpenItem,
  type QuickOpenRecentFile,
} from './quick-open-state';

type QuickOpenModalProps = {
  open: boolean;
  query: string;
  files: QuickOpenFile[];
  recentFiles: QuickOpenRecentFile[];
  loading: boolean;
  error: string | null;
  onQueryChange: (next: string) => void;
  onClose: () => void;
  onOpenFile: (next: { path: string; name: string }) => void;
};

function itemDetailText(item: QuickOpenItem): string {
  const parts = [
    item.relativePath && item.relativePath !== item.name ? item.relativePath : item.path,
    item.size != null ? formatBytes(item.size) : null,
    item.mtimeMs != null ? formatEditorMtime(item.mtimeMs) : null,
  ].filter(Boolean);
  return parts.join('  ');
}

export function QuickOpenModal({
  open,
  query,
  files,
  recentFiles,
  loading,
  error,
  onQueryChange,
  onClose,
  onOpenFile,
}: QuickOpenModalProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const items = React.useMemo(
    () => buildQuickOpenItems({ query, recentFiles, searchFiles: files, limit: 80 }),
    [files, query, recentFiles],
  );

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  React.useEffect(() => {
    setActiveIndex((current) => Math.min(Math.max(0, current), Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const openItem = (item: QuickOpenItem | undefined) => {
    if (!item) return;
    onOpenFile(quickOpenSelectionToOpenTarget(item));
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/45 px-3 py-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Quick open file"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) => (items.length > 0 ? Math.min(items.length - 1, current + 1) : 0));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => Math.max(0, current - 1));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                openItem(items[activeIndex]);
              }
            }}
            placeholder="Search files by path"
            className="h-9 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 font-mono text-[13px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
            spellCheck={false}
          />
        </div>
        <div className="min-h-0 overflow-y-auto py-1">
          {items.map((item, index) => {
            const active = index === activeIndex;
            const Icon = iconForFilePath(item.path);
            return (
              <button
                key={`${item.source}:${item.path}`}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => openItem(item)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-[var(--accent-subtle)] text-[var(--fg)]' : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0 text-[var(--muted)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[12px] font-medium">{item.name}</span>
                    {item.source === 'recent' ? (
                      <span className="shrink-0 rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        Recent
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted-dim)]">{itemDetailText(item)}</div>
                </div>
                {active ? <IconChevron className="h-3.5 w-3.5 -rotate-90 text-[var(--accent)]" /> : null}
              </button>
            );
          })}
          {!loading && items.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-[var(--muted)]">
              {query.trim() ? 'No matching files.' : 'No files found.'}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--muted)]">
          <span>{loading ? 'Searching...' : `${items.length} result${items.length === 1 ? '' : 's'}`}</span>
          <span className="truncate text-[var(--red)]">{error ?? ''}</span>
        </div>
      </div>
    </div>
  );
}
