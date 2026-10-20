import React from 'react';
import { workspaceExplorerLocation } from '@drone/hub-model';
import { requestJson } from '../http';
import { IconChevron } from '../icons';
import { useFilesPaneState } from '../app/use-files-and-ports-pane-state';
import { SidebarReorderDropIndicator } from '../app/sidebar-reorder-ui';
import {
  movedExplorerRootOrder,
  moveExplorerRoot,
  orderExplorerRoots,
  OWN_EXPLORER_ROOT,
  removeExplorerRoot,
  setExplorerRootOpen,
  useExplorerRootOrder,
  useExplorerRootReveal,
  type ExplorerRoot,
} from '../workspaces/explorer-roots';
import { openWorkspaceFolder } from '../workspaces/workspaces-client';
import { DroneFilesDock } from './DroneFilesDock';
import type { DroneOpenedFileState } from './opened-file-types';
import type { DroneFsEntry } from '../types';

/** What the explorer roots do with the drone's editor; paths are in the workspace the file routes name `droneId`. */
export type ExplorerRootsEditor = {
  /** The editor's active file, and the workspace it is in. */
  activeFile: { droneId: string; path: string } | null;
  onOpenFile(root: ExplorerRoot, entry: { path: string; name: string }): void;
  onConfirmCloseOpenedFilesForPaths(droneId: string, paths: string[], actionLabel?: string): boolean | Promise<boolean>;
  onCloseOpenedFilesForPaths(droneId: string, paths: string[]): void;
  onRemapOpenedFilesForPathChange(droneId: string, sourcePath: string, targetPath: string): void;
};

export type ExplorerRootsProps = {
  /** The drone whose explorer this is. */
  droneId: string;
  ownName: string;
  ownOpen: boolean;
  roots: ExplorerRoot[];
  editor: ExplorerRootsEditor;
};

const NO_OPENED_FILE: DroneOpenedFileState = {
  path: null, name: null, loading: false, saving: false, error: null, kind: 'text', mime: null, size: 0, content: '',
  dirty: false, mtimeMs: null, targetLine: null, targetColumn: null, navigationSeq: 0,
};

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-3 w-3" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

function OpenFolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M1.75 12.25v-8c0-.55.45-1 1-1h3.1l1.4 1.5h5c.55 0 1 .45 1 1v1" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M1.75 12.25 3.4 7.6c.14-.4.52-.67.95-.67h9.4c.69 0 1.17.68.95 1.33l-1.3 3.6c-.14.4-.52.64-.94.64H2.75" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

const actionClass =
  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted)] opacity-0 transition-[opacity,background-color,color] hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:opacity-100 group-hover/root:opacity-100 group-focus-within/root:opacity-100';

/** What a root's header carries while it is dragged; nothing else in the Hub takes it. */
const ROOT_DRAG_TYPE = 'application/x-drone-explorer-root';
type Placement = 'before' | 'after';

type RootDrag = {
  /** Its header was picked up. */
  dragging: boolean;
  /** Where a drop would put the dragged root, against this one. */
  dropAt: Placement | null;
  onDragStart(event: React.DragEvent): void;
  onDragEnd(): void;
  onDragOver(event: React.DragEvent): void;
  onDrop(event: React.DragEvent): void;
  /** Alt+Up and Alt+Down on the header. */
  onMove(step: -1 | 1): void;
};

function RootSection({ title, detail, open, onToggle, actions, drag, children }: {
  title: string;
  detail?: string;
  open: boolean;
  onToggle(): void;
  actions?: React.ReactNode;
  drag: RootDrag;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`relative flex min-h-0 flex-col border-b border-[var(--border-subtle)] last:border-b-0 ${open ? 'flex-1' : 'shrink-0'}`}
      aria-label={title}
      data-explorer-root={title}
      // Capture: a root's files take drags of their own, and must not see this one.
      onDragOverCapture={drag.onDragOver}
      onDropCapture={drag.onDrop}
    >
      <div
        className={`group/root flex h-6 shrink-0 items-center gap-0.5 bg-[var(--panel-alt)] pr-1 ${drag.dragging ? 'opacity-50' : ''}`}
        draggable
        onDragStart={drag.onDragStart}
        onDragEnd={drag.onDragEnd}
      >
        <button
          type="button"
          onClick={onToggle}
          onKeyDown={(event) => {
            if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
            event.preventDefault();
            drag.onMove(event.key === 'ArrowUp' ? -1 : 1);
          }}
          aria-expanded={open}
          title={`${detail ? `${title} · ${detail}` : title}\nDrag to move, or Alt+Up / Alt+Down`}
          className="flex h-full min-w-0 flex-1 items-center gap-1 pl-1 text-left text-[11px] font-[var(--weight-semibold)] uppercase tracking-[0.04em] text-[var(--fg-secondary)] hover:text-[var(--fg)]"
        >
          <IconChevron down={open} size={12} />
          <span className="min-w-0 truncate">{title}</span>
        </button>
        {actions}
      </div>
      {open ? <div className="min-h-0 flex-1">{children}</div> : null}
      {drag.dropAt ? <SidebarReorderDropIndicator placement={drag.dropAt} /> : null}
    </section>
  );
}

function ExplorerRootFiles({ droneId, root, zoom, editor }: {
  droneId: string;
  root: ExplorerRoot;
  zoom: number;
  editor: ExplorerRootsEditor;
}) {
  const files = useFilesPaneState({ currentDrone: root.drone, requestJson, filesEnabled: true });
  const reveal = useExplorerRootReveal(droneId, root.workspace.id);
  const { setCurrentFsPath, defaultFsPathForCurrentDrone } = files;
  React.useEffect(() => {
    // A file shown from elsewhere (a link, a tab): the listing goes to where the explorer can show it.
    if (reveal) setCurrentFsPath(workspaceExplorerLocation(defaultFsPathForCurrentDrone, reveal.path).root);
  }, [reveal?.sequence]); // eslint-disable-line react-hooks/exhaustive-deps
  const rootId = root.drone.id;
  const active = editor.activeFile?.droneId === rootId ? editor.activeFile : null;
  const openedFile = React.useMemo<DroneOpenedFileState>(
    () => (active ? { ...NO_OPENED_FILE, path: active.path, name: active.path.split('/').pop() ?? active.path } : NO_OPENED_FILE),
    [active?.path], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <DroneFilesDock
      droneId={rootId}
      droneName={root.workspace.name}
      droneLabel={root.workspace.name}
      path={files.currentFsPath}
      homePath={files.defaultFsPathForCurrentDrone}
      reveal={reveal}
      entries={files.fsEntries}
      loading={files.fsLoading}
      error={files.fsErrorUi}
      onOpenPath={setCurrentFsPath}
      onRefresh={files.refreshFsList}
      onOpenFile={(entry: DroneFsEntry) => { if (entry.kind === 'file') editor.onOpenFile(root, entry); }}
      onConfirmCloseOpenedFilesForPaths={(paths, actionLabel) => editor.onConfirmCloseOpenedFilesForPaths(rootId, paths, actionLabel)}
      onCloseOpenedFilesForPaths={(paths) => editor.onCloseOpenedFilesForPaths(rootId, paths)}
      onRemapOpenedFilesForPathChange={(source, target) => editor.onRemapOpenedFilesForPathChange(rootId, source, target)}
      openedFile={openedFile}
      zoom={zoom}
    />
  );
}

/** Before or after a root, by the pointer against its header: an open root's files are not where a root goes. */
function placementOf(event: React.DragEvent): Placement {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + Math.min(rect.height, 24) / 2 ? 'before' : 'after';
}

/**
 * The File Explorer of a drone with other workspaces as roots beside its own files, each collapsible on its own and
 * in the order the user dragged them into. Without other roots it is just the drone's own explorer.
 */
export function ExplorerRootsColumn({ droneId, ownName, ownOpen, roots, editor, own, zoom }: ExplorerRootsProps & {
  /** The drone's own explorer. */
  own: React.ReactNode;
  zoom: number;
}) {
  const [openError, setOpenError] = React.useState<{ rootId: string; message: string } | null>(null);
  const [dragged, setDragged] = React.useState<string | null>(null);
  const [drop, setDrop] = React.useState<{ id: string; placement: Placement } | null>(null);
  const order = useExplorerRootOrder(droneId);
  const ids = React.useMemo(
    () => orderExplorerRoots([OWN_EXPLORER_ROOT, ...roots.map((root) => root.workspace.id)], (id) => id, order),
    [order, roots],
  );
  if (roots.length === 0) return <>{own}</>;

  const endDrag = () => {
    setDragged(null);
    setDrop(null);
  };
  const dragFor = (id: string): RootDrag => ({
    dragging: dragged === id,
    dropAt: drop?.id === id ? drop.placement : null,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(ROOT_DRAG_TYPE, id);
      setDragged(id);
    },
    onDragEnd: endDrag,
    onDragOver: (event) => {
      if (!dragged || !event.dataTransfer.types.includes(ROOT_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      const placement = placementOf(event);
      // Only a drop that moves the root shows where it goes.
      const moves = Boolean(movedExplorerRootOrder(ids, dragged, id, placement));
      event.dataTransfer.dropEffect = moves ? 'move' : 'none';
      const next = moves ? { id, placement } : null;
      setDrop((current) => (current?.id === next?.id && current?.placement === next?.placement ? current : next));
    },
    onDrop: (event) => {
      if (!event.dataTransfer.types.includes(ROOT_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      // Where the pointer is now, not the last line drawn: that may not have rendered yet.
      const moved = event.dataTransfer.getData(ROOT_DRAG_TYPE) || dragged;
      if (moved) moveExplorerRoot(droneId, ids, moved, id, placementOf(event));
      endDrag();
    },
    onMove: (step) => {
      const at = ids.indexOf(id);
      const neighbour = ids[at + step];
      if (neighbour) moveExplorerRoot(droneId, ids, id, neighbour, step < 0 ? 'before' : 'after');
    },
  });

  const rootById = new Map(roots.map((root) => [root.workspace.id, root]));
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-explorer-roots
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(null);
      }}
    >
      {ids.map((id) => {
        if (id === OWN_EXPLORER_ROOT) {
          return (
            <RootSection key={id} title={ownName} open={ownOpen} drag={dragFor(id)}
              onToggle={() => setExplorerRootOpen(droneId, OWN_EXPLORER_ROOT, !ownOpen)}>
              {own}
            </RootSection>
          );
        }
        const root = rootById.get(id);
        if (!root) return null;
        const { workspace } = root;
        const removeLabel = `Remove ${workspace.name} from this File Explorer`;
        const failed = openError?.rootId === workspace.id ? openError.message : '';
        return (
          <RootSection
            key={workspace.id}
            title={workspace.name}
            detail={workspace.path}
            open={root.open}
            drag={dragFor(id)}
            onToggle={() => setExplorerRootOpen(droneId, workspace.id, !root.open)}
            actions={
              <>
                {workspace.kind === 'folder' ? (
                  <button
                    type="button"
                    className={`${actionClass} ${failed ? '!opacity-100 text-[var(--red)]' : ''}`}
                    title={failed || 'Open in file manager'}
                    aria-label={`Open ${workspace.name} in file manager`}
                    onClick={() => {
                      setOpenError(null);
                      void openWorkspaceFolder(workspace.browseId).catch((cause) =>
                        setOpenError({ rootId: workspace.id, message: cause instanceof Error ? cause.message : String(cause) }));
                    }}
                  >
                    <OpenFolderIcon />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={actionClass}
                  title={removeLabel}
                  aria-label={removeLabel}
                  onClick={() => removeExplorerRoot(droneId, workspace.id)}
                >
                  <CloseIcon />
                </button>
              </>
            }
          >
            <ExplorerRootFiles droneId={droneId} root={root} zoom={zoom} editor={editor} />
          </RootSection>
        );
      })}
    </div>
  );
}
