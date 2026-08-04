import React from 'react';
import { profileStorageKey } from '../../profile-storage';
import { WorkspaceExplorerHeader } from './WorkspaceExplorerHeader';
import {
  clampWorkspaceExplorerWidth,
  clampWorkspaceExplorerZoom,
  readWorkspaceExplorerWidth,
  readWorkspaceExplorerZoom,
  WORKSPACE_EXPLORER_WIDTH_DEFAULT_PX,
  WORKSPACE_EXPLORER_WIDTH_MAX_PX,
  WORKSPACE_EXPLORER_WIDTH_MIN_PX,
  WORKSPACE_EXPLORER_ZOOM_DEFAULT,
  WORKSPACE_EXPLORER_ZOOM_STEP,
  writeWorkspaceExplorerWidth,
  writeWorkspaceExplorerZoom,
} from './workspace-explorer-preferences';

type ExplorerSide = 'left' | 'right';

type StoredExplorerLayout = {
  side: ExplorerSide;
  width: number;
};

type DroneEditorWorkspaceProps = {
  explorer: (zoom: number) => React.ReactNode;
  editor: React.ReactNode;
};

const EXPLORER_LAYOUT_STORAGE_KEY = profileStorageKey('droneHub.editorExplorerLayout');

export function DroneEditorWorkspace({ explorer, editor }: DroneEditorWorkspaceProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const resizePointerIdRef = React.useRef<number | null>(null);
  const [layout, setLayout] = React.useState<StoredExplorerLayout>(readExplorerLayout);
  const [explorerZoom, setExplorerZoom] = React.useState(readWorkspaceExplorerZoom);

  React.useEffect(() => {
    writeWorkspaceExplorerZoom(explorerZoom);
  }, [explorerZoom]);

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

  const handleResizeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const separatorDirection = event.key === 'ArrowRight' ? 1 : -1;
      const widthDirection = layout.side === 'left' ? separatorDirection : -separatorDirection;
      const containerWidth = rootRef.current?.getBoundingClientRect().width;
      const width = clampExplorerWidth(layout.width + widthDirection * 12, containerWidth);
      updateLayout({ ...layout, width });
    },
    [layout, updateLayout],
  );

  const explorerPane = (
    <aside
      className="flex h-full min-h-0 flex-shrink-0 flex-col overflow-hidden bg-[var(--panel)]"
      style={{ width: `${layout.width}px`, maxWidth: '50%' }}
      aria-label="File Explorer"
    >
      <WorkspaceExplorerHeader
        zoom={explorerZoom}
        onDecreaseZoom={() =>
          setExplorerZoom((current) => clampWorkspaceExplorerZoom(current - WORKSPACE_EXPLORER_ZOOM_STEP))
        }
        onIncreaseZoom={() =>
          setExplorerZoom((current) => clampWorkspaceExplorerZoom(current + WORKSPACE_EXPLORER_ZOOM_STEP))
        }
        onResetZoom={() => setExplorerZoom(WORKSPACE_EXPLORER_ZOOM_DEFAULT)}
      />
      <div className="min-h-0 flex-1">{explorer(explorerZoom)}</div>
    </aside>
  );

  const resizeHandle = (
    <div
      role="separator"
      aria-label="Resize File Explorer"
      aria-orientation="vertical"
      aria-valuemin={WORKSPACE_EXPLORER_WIDTH_MIN_PX}
      aria-valuemax={WORKSPACE_EXPLORER_WIDTH_MAX_PX}
      aria-valuenow={layout.width}
      tabIndex={0}
      onPointerDown={handleResizeStart}
      onPointerMove={handleResizeMove}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onLostPointerCapture={finishResize}
      onKeyDown={handleResizeKeyDown}
      onDoubleClick={() => updateLayout({ ...layout, width: WORKSPACE_EXPLORER_WIDTH_DEFAULT_PX })}
      title="Drag to resize; double-click to reset"
      className="group relative z-10 h-full w-px flex-shrink-0 touch-none cursor-col-resize bg-[var(--border)] before:absolute before:inset-y-0 before:-left-1 before:w-2 hover:bg-[var(--accent-muted)] focus-visible:bg-[var(--accent)] focus-visible:outline-none"
    />
  );

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 w-full overflow-hidden bg-[var(--panel-alt)]"
    >
      {layout.side === 'left' ? explorerPane : null}
      {layout.side === 'left' ? resizeHandle : null}
      <main className="h-full min-h-0 min-w-0 flex-1 overflow-hidden" aria-label="File Editor">
        {editor}
      </main>
      {layout.side === 'right' ? resizeHandle : null}
      {layout.side === 'right' ? explorerPane : null}
    </div>
  );
}

function clampExplorerWidth(width: number, containerWidth = Number.POSITIVE_INFINITY): number {
  const availableMaximum = Number.isFinite(containerWidth)
    ? Math.max(WORKSPACE_EXPLORER_WIDTH_MIN_PX, Math.floor(containerWidth / 2))
    : WORKSPACE_EXPLORER_WIDTH_MAX_PX;
  return Math.min(availableMaximum, clampWorkspaceExplorerWidth(width));
}

function normalizeExplorerLayout(raw: Partial<StoredExplorerLayout> | null | undefined): StoredExplorerLayout {
  return {
    side: raw?.side === 'right' ? 'right' : 'left',
    width: clampExplorerWidth(Number(raw?.width ?? readWorkspaceExplorerWidth())),
  };
}

function readExplorerLayout(): StoredExplorerLayout {
  if (typeof localStorage === 'undefined') {
    return { side: 'left', width: readWorkspaceExplorerWidth() };
  }
  try {
    const legacyLayout = JSON.parse(localStorage.getItem(EXPLORER_LAYOUT_STORAGE_KEY) ?? 'null') as Partial<StoredExplorerLayout> | null;
    return normalizeExplorerLayout({
      side: legacyLayout?.side,
      width: readWorkspaceExplorerWidth(),
    });
  } catch {
    return normalizeExplorerLayout(null);
  }
}

function writeExplorerLayout(layout: StoredExplorerLayout): void {
  writeWorkspaceExplorerWidth(layout.width);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(EXPLORER_LAYOUT_STORAGE_KEY, JSON.stringify(normalizeExplorerLayout(layout)));
  } catch {
    // Keep the current layout in memory if browser storage is unavailable.
  }
}
