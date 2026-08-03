import React from 'react';
import { profileStorageKey } from '../../profile-storage';

type ExplorerSide = 'left' | 'right';

type StoredExplorerLayout = {
  side: ExplorerSide;
  width: number;
};

type DroneEditorWorkspaceProps = {
  explorer: React.ReactNode;
  editor: React.ReactNode;
};

const EXPLORER_LAYOUT_STORAGE_KEY = profileStorageKey('droneHub.editorExplorerLayout');
const EXPLORER_DRAG_TYPE = 'application/x-drone-hub-editor-explorer';
const DEFAULT_EXPLORER_WIDTH = 240;
const MIN_EXPLORER_WIDTH = 180;
const MAX_EXPLORER_WIDTH = 420;

export function DroneEditorWorkspace({ explorer, editor }: DroneEditorWorkspaceProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const resizePointerIdRef = React.useRef<number | null>(null);
  const [layout, setLayout] = React.useState<StoredExplorerLayout>(readExplorerLayout);
  const [dragging, setDragging] = React.useState(false);
  const [dropSide, setDropSide] = React.useState<ExplorerSide | null>(null);

  const updateLayout = React.useCallback((next: StoredExplorerLayout) => {
    const normalized = normalizeExplorerLayout(next);
    setLayout(normalized);
    writeExplorerLayout(normalized);
  }, []);

  const resizeToPointer = React.useCallback(
    (clientX: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const requestedWidth = layout.side === 'left' ? clientX - rect.left : rect.right - clientX;
      const width = clampExplorerWidth(requestedWidth, rect.width);
      setLayout((current) => ({ ...current, width }));
    },
    [layout.side],
  );

  const handleResizeStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleResizeMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (resizePointerIdRef.current !== event.pointerId) return;
      resizeToPointer(event.clientX);
    },
    [resizeToPointer],
  );

  const finishResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (resizePointerIdRef.current !== event.pointerId) return;
    resizePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setLayout((current) => {
      writeExplorerLayout(current);
      return current;
    });
  }, []);

  const handleExplorerDragStart = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(EXPLORER_DRAG_TYPE, 'explorer');
    setDragging(true);
    setDropSide(null);
  }, []);

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasExplorerDragPayload(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    setDropSide(event.clientX < rect.left + rect.width / 2 ? 'left' : 'right');
  }, []);

  const finishExplorerDrag = React.useCallback(() => {
    setDragging(false);
    setDropSide(null);
  }, []);

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasExplorerDragPayload(event)) return;
      event.preventDefault();
      if (dropSide) updateLayout({ ...layout, side: dropSide });
      finishExplorerDrag();
    },
    [dropSide, finishExplorerDrag, layout, updateLayout],
  );

  const moveExplorer = React.useCallback(() => {
    updateLayout({ ...layout, side: layout.side === 'left' ? 'right' : 'left' });
  }, [layout, updateLayout]);

  const handleResizeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const separatorDirection = event.key === 'ArrowRight' ? 1 : -1;
      const widthDirection = layout.side === 'left' ? separatorDirection : -separatorDirection;
      updateLayout({ ...layout, width: layout.width + widthDirection * 12 });
    },
    [layout, updateLayout],
  );

  const explorerPane = (
    <aside
      className="flex h-full min-h-0 flex-shrink-0 flex-col overflow-hidden bg-[var(--panel)]"
      style={{ width: `${layout.width}px`, maxWidth: '50%' }}
      aria-label="File Explorer"
    >
      <div
        draggable
        onDragStart={handleExplorerDragStart}
        onDragEnd={finishExplorerDrag}
        className="flex h-8 flex-shrink-0 cursor-grab items-center gap-2 border-b border-[var(--border)] px-2 text-[var(--text-10)] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] active:cursor-grabbing"
        title="Drag to move the File Explorer to the other side"
      >
        <span className="min-w-0 flex-1 truncate">File Explorer</span>
        <button
          type="button"
          draggable={false}
          onClick={moveExplorer}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--fg-secondary)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)]"
          aria-label={`Move File Explorer to the ${layout.side === 'left' ? 'right' : 'left'}`}
          title={`Move File Explorer to the ${layout.side === 'left' ? 'right' : 'left'}`}
        >
          {layout.side === 'left' ? '\u2192' : '\u2190'}
        </button>
      </div>
      <div className="min-h-0 flex-1">{explorer}</div>
    </aside>
  );

  const resizeHandle = (
    <div
      role="separator"
      aria-label="Resize File Explorer"
      aria-orientation="vertical"
      aria-valuemin={MIN_EXPLORER_WIDTH}
      aria-valuemax={MAX_EXPLORER_WIDTH}
      aria-valuenow={layout.width}
      tabIndex={0}
      onPointerDown={handleResizeStart}
      onPointerMove={handleResizeMove}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onKeyDown={handleResizeKeyDown}
      onDoubleClick={() => updateLayout({ ...layout, width: DEFAULT_EXPLORER_WIDTH })}
      title="Drag to resize; double-click to reset"
      className="group relative z-10 h-full w-px flex-shrink-0 touch-none cursor-col-resize bg-[var(--border)] before:absolute before:inset-y-0 before:-left-1 before:w-2 hover:bg-[var(--accent-muted)] focus-visible:bg-[var(--accent)] focus-visible:outline-none"
    />
  );

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 w-full overflow-hidden bg-[var(--panel-alt)]"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {layout.side === 'left' ? explorerPane : null}
      {layout.side === 'left' ? resizeHandle : null}
      <main className="h-full min-h-0 min-w-0 flex-1 overflow-hidden" aria-label="File Editor">
        {editor}
      </main>
      {layout.side === 'right' ? resizeHandle : null}
      {layout.side === 'right' ? explorerPane : null}
      {dragging && dropSide ? (
        <div
          className={`pointer-events-none absolute inset-y-0 z-20 w-1/2 border-2 border-[var(--accent)] bg-[var(--accent-subtle)] ${
            dropSide === 'left' ? 'left-0' : 'right-0'
          }`}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

function hasExplorerDragPayload(event: React.DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types ?? []).includes(EXPLORER_DRAG_TYPE);
}

function clampExplorerWidth(width: number, containerWidth = Number.POSITIVE_INFINITY): number {
  const availableMaximum = Number.isFinite(containerWidth)
    ? Math.max(MIN_EXPLORER_WIDTH, Math.floor(containerWidth / 2))
    : MAX_EXPLORER_WIDTH;
  const maximum = Math.min(MAX_EXPLORER_WIDTH, availableMaximum);
  const safeWidth = Number.isFinite(width) ? Math.round(width) : DEFAULT_EXPLORER_WIDTH;
  return Math.max(MIN_EXPLORER_WIDTH, Math.min(maximum, safeWidth));
}

function normalizeExplorerLayout(raw: Partial<StoredExplorerLayout> | null | undefined): StoredExplorerLayout {
  return {
    side: raw?.side === 'right' ? 'right' : 'left',
    width: clampExplorerWidth(Number(raw?.width ?? DEFAULT_EXPLORER_WIDTH)),
  };
}

function readExplorerLayout(): StoredExplorerLayout {
  if (typeof localStorage === 'undefined') return normalizeExplorerLayout(null);
  try {
    return normalizeExplorerLayout(JSON.parse(localStorage.getItem(EXPLORER_LAYOUT_STORAGE_KEY) ?? 'null'));
  } catch {
    return normalizeExplorerLayout(null);
  }
}

function writeExplorerLayout(layout: StoredExplorerLayout): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(EXPLORER_LAYOUT_STORAGE_KEY, JSON.stringify(normalizeExplorerLayout(layout)));
  } catch {
    // Keep the current layout in memory if browser storage is unavailable.
  }
}
