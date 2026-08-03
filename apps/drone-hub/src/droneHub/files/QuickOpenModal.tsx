import React from 'react';
import { FileTypeIcon } from './FileTypeIcon';
import {
  buildQuickOpenItems,
  QUICK_OPEN_SEARCH_MIN_QUERY_LENGTH,
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
  onOpenFile: (next: { path: string; name: string; line: number | null; column: number | null }) => void;
};

function itemDirectoryText(item: QuickOpenItem): string {
  const displayPath = String(item.relativePath || item.path)
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '');
  const separatorIndex = displayPath.lastIndexOf('/');
  return separatorIndex >= 0 ? displayPath.slice(0, separatorIndex) || '/' : '';
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
  const listRef = React.useRef<HTMLDivElement | null>(null);
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

  React.useEffect(() => {
    if (open) setActiveIndex(0);
  }, [open, query]);

  React.useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-quick-open-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  const openItem = (item: QuickOpenItem | undefined) => {
    if (!item) return;
    onOpenFile(quickOpenSelectionToOpenTarget(item, query));
  };
  const trimmedQuery = query.trim();
  const searchingEnabled = trimmedQuery.length >= QUICK_OPEN_SEARCH_MIN_QUERY_LENGTH;
  const emptyMessage = (() => {
    if (error) return error;
    if (loading) return 'Searching files...';
    if (!trimmedQuery) return recentFiles.length > 0 ? 'Type to search more files.' : 'No recent files. Type to search files.';
    if (!searchingEnabled) return `Type ${QUICK_OPEN_SEARCH_MIN_QUERY_LENGTH} or more characters to search files.`;
    return 'No matching files.';
  })();

  return (
    <div
      className="fixed inset-0 z-[80] px-3 pt-1.5"
      role="dialog"
      aria-modal="true"
      aria-label="Quick open file"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex max-h-[min(455px,calc(100vh-12px))] w-full max-w-[600px] flex-col overflow-hidden rounded-[7px] border border-[var(--border)] bg-[var(--panel-raised)] shadow-[0_8px_28px_rgba(0,0,0,0.58)]">
        <div className="px-1.5 pb-1 pt-1.5">
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
                setActiveIndex((current) => (items.length > 0 ? (current + 1) % items.length : 0));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => (items.length > 0 ? (current - 1 + items.length) % items.length : 0));
                return;
              }
              if (event.key === 'PageDown' || event.key === 'PageUp') {
                event.preventDefault();
                const direction = event.key === 'PageDown' ? 1 : -1;
                setActiveIndex((current) => Math.min(Math.max(0, current + direction * 10), Math.max(0, items.length - 1)));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                openItem(items[activeIndex]);
              }
            }}
            placeholder="Search files by name (append : to go to line)"
            className="h-7 w-full rounded-[3px] border border-[#007acc] bg-[var(--panel)] px-2 text-[12px] text-[var(--fg)] shadow-[0_0_0_1px_rgba(0,122,204,0.16)] outline-none placeholder:text-[var(--muted-dim)]"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="quick-open-results"
            aria-activedescendant={items[activeIndex] ? `quick-open-result-${activeIndex}` : undefined}
          />
        </div>
        <div
          ref={listRef}
          id="quick-open-results"
          role="listbox"
          aria-label="Matching files"
          className="min-h-0 overflow-y-auto px-1.5 pb-1.5"
        >
          {items.map((item, index) => {
            const active = index === activeIndex;
            const directory = itemDirectoryText(item);
            return (
              <button
                key={`${item.source}:${item.path}`}
                id={`quick-open-result-${index}`}
                data-quick-open-index={index}
                role="option"
                aria-selected={active}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => openItem(item)}
                className={`flex h-[22px] w-full items-center gap-1.5 rounded-[2px] px-3 text-left ${
                  active
                    ? 'bg-[#0e639c] text-white'
                    : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-strong)]'
                }`}
              >
                <FileTypeIcon path={item.path} className="h-3.5 w-3.5 flex-shrink-0" size={14} />
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden leading-none">
                  <span className="max-w-[58%] shrink truncate text-[12px]">{item.name}</span>
                  {directory ? (
                    <span className={`min-w-0 flex-1 truncate text-[11px] ${active ? 'text-white/70' : 'text-[var(--muted-dim)]'}`}>
                      {directory}
                    </span>
                  ) : null}
                </div>
                {!trimmedQuery && index === 0 ? (
                  <span className={`ml-auto shrink-0 text-[10px] ${active ? 'text-white/80' : 'text-[var(--muted)]'}`}>
                    recently opened
                  </span>
                ) : null}
              </button>
            );
          })}
          {items.length === 0 && emptyMessage ? (
            <div className={`px-4 py-5 text-center text-[11px] ${error ? 'text-[var(--red)]' : 'text-[var(--muted)]'}`}>
              {emptyMessage}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
