import React from 'react';
import { DroneEditorDock } from '../app/DroneEditorDock';
import { useFileEditorState } from '../app/use-file-editor-state';
import { DroneFilesDock } from './DroneFilesDock';
import { requestJson } from '../http';
import type { DroneOpenedFileState } from './opened-file-types';
import type { DroneFsEntry, DroneFsListPayload, DroneSummary } from '../types';

/** A path to reveal: relative to the workspace root, or absolute inside it. */
export type FolderWorkspaceTarget = { path: string; line?: number | null; column?: number | null };

/**
 * Explorer and editor for a folder the Hub serves through the drone file routes without it being a drone
 * (Companion home, the entity workspace; see apps/drone/src/hub/folder-workspaces.ts).
 */
export function FolderWorkspaceFiles({ workspaceId, name, target, className, onNotice, dirtyTabs }: {
  workspaceId: string;
  name: string;
  target?: (FolderWorkspaceTarget & { sequence: number }) | null;
  className?: string;
  /** Reports a path that could not be revealed, or null when the last one was. */
  onNotice?(notice: string | null): void;
  /** Lets a container ask which tabs have unsaved changes before closing. */
  dirtyTabs?: React.MutableRefObject<() => { name?: string | null; path?: string | null }[]>;
}) {
  const drone = React.useMemo(() => ({ id: workspaceId, name }) as DroneSummary, [workspaceId, name]);
  // An empty path resolves to the workspace root; the listing reports its absolute path.
  const [path, setPath] = React.useState('');
  const [listing, setListing] = React.useState<{ entries: DroneFsEntry[]; loading: boolean; error: string | null }>({ entries: [], loading: true, error: null });
  const request = React.useRef(0);
  const refresh = React.useCallback(async (directory = path) => {
    const current = ++request.current;
    setListing(previous => ({ ...previous, loading: true }));
    try {
      const data = await requestJson<Extract<DroneFsListPayload, { ok: true }>>(`/api/drones/${workspaceId}/fs/list?path=${encodeURIComponent(directory)}`);
      if (current !== request.current) return;
      setPath(data.path);
      setListing({ entries: data.entries, loading: false, error: null });
    } catch (error) {
      if (current === request.current) setListing({ entries: [], loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [path]);
  React.useEffect(() => { void refresh(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const editor = useFileEditorState({ currentDrone: drone, requestJson, onRefreshFsList: () => void refresh() });
  // Agents edit these files while they are open. Open tabs and the explorer follow those changes over
  // the same workspace events as any drone: the folder is served as a host drone.
  const open = (file: { path: string; name: string; line?: number | null; column?: number | null }) => void editor.openEditorFile(file);
  // A path to reveal (e.g. clicked in a reply): a file opens and is selected in the explorer, a folder is
  // only selected. Its kind comes from the listing of its parent, and only paths inside the folder count.
  const root = React.useRef('');
  const [reveal, setReveal] = React.useState<{ path: string; sequence: number; kind: 'file' | 'directory' } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  React.useEffect(() => { onNotice?.(notice); }, [notice]); // eslint-disable-line react-hooks/exhaustive-deps
  if (dirtyTabs) dirtyTabs.current = () => editor.openedFileTabs.filter(tab => tab.dirty);
  const openEditorFile = React.useRef(open);
  openEditorFile.current = open;
  React.useEffect(() => {
    if (!target || !path) return;
    if (!root.current) root.current = path;
    let cancelled = false;
    const home = root.current;
    const absolute = (target.path.startsWith('/') ? target.path : `${home}/${target.path.replace(/^\.\//, '')}`).replace(/\/+$/, '');
    void (async () => {
      try {
        if (absolute !== home && !absolute.startsWith(`${home}/`)) throw new Error('outside');
        if (absolute === home) { setNotice(null); return; }
        const parent = absolute.slice(0, absolute.lastIndexOf('/'));
        const listing = await requestJson<Extract<DroneFsListPayload, { ok: true }>>(`/api/drones/${workspaceId}/fs/list?path=${encodeURIComponent(parent)}`);
        const entry = listing.entries.find(item => item.path === absolute);
        if (!entry) throw new Error('missing');
        if (cancelled) return;
        setNotice(null);
        setReveal({ path: entry.path, sequence: target.sequence, kind: entry.kind === 'directory' ? 'directory' : 'file' });
        if (entry.kind === 'file') openEditorFile.current({ path: entry.path, name: entry.name, line: target.line, column: target.column });
      } catch {
        if (!cancelled) setNotice(`${target.path} is not in ${name}.`);
      }
    })();
    return () => { cancelled = true; };
  }, [target, path]);
  const openedFile: DroneOpenedFileState = {
    path: editor.openedFile?.path ?? null, name: editor.openedFile?.name ?? null,
    loading: editor.loading, saving: editor.saving, error: editor.error, kind: editor.kind, mime: editor.mime, size: editor.size,
    content: editor.content, dirty: editor.dirty, mtimeMs: editor.mtimeMs, revision: editor.revision,
    externallyChanged: editor.externallyChanged, canOverwriteExternalChange: editor.canOverwriteExternalChange,
    targetLine: editor.openedFile?.targetLine ?? null, targetColumn: editor.openedFile?.targetColumn ?? null,
    navigationSeq: editor.openedFile?.navigationSeq ?? 0,
  };
  return (
    <div className={`flex min-h-0 ${className ?? ''}`}>
      <div className="min-w-0 flex-1">
        <DroneEditorDock
          droneId={workspaceId} droneName={name} openedFile={openedFile}
          quickOpen={{
            open: editor.quickOpenOpen, query: editor.quickOpenQuery, files: editor.quickOpenFiles, recentFiles: editor.recentFiles,
            loading: editor.quickOpenLoading, error: editor.quickOpenError,
            canGoBack: editor.canGoBackLocation, canGoForward: editor.canGoForwardLocation,
            onQueryChange: editor.setQuickOpenQuery, onClose: editor.closeQuickOpen,
            onOpenFile: next => { open(next); editor.closeQuickOpen(); },
            onGoBack: () => { editor.goBackLocation(); }, onGoForward: () => { editor.goForwardLocation(); },
          }}
          openedFileTabs={editor.openedFileTabs} activeOpenedFileTabId={editor.activeOpenedFileTabId}
          onOpenedEditorFileContentChange={editor.setOpenedFileContent} onSaveOpenedEditorFile={editor.saveOpenedFile}
          onAppendFileDictationLine={editor.appendAndSaveFileDictationLine} onOpenFileDictationTarget={open}
          onReloadOpenedEditorFileFromDisk={editor.reloadOpenedFileFromDisk} onOverwriteOpenedEditorFile={editor.overwriteOpenedFile}
          onCloseOpenedEditorFile={editor.closeEditorFile} onActivateOpenedEditorFileTab={editor.setActiveOpenedFileTab}
          onReorderOpenedEditorFileTabs={editor.reorderOpenedFileTabs} onOpenFileTargetInEditor={open}
        />
      </div>
      <div className="w-72 shrink-0 overflow-hidden border-l border-[var(--border)]">
        {path || listing.error ? <DroneFilesDock
          droneId={workspaceId} droneName={name} droneLabel={name}
          path={path} homePath={path} entries={listing.entries} loading={listing.loading} error={listing.error}
          onOpenPath={next => void refresh(next)} onRefresh={() => void refresh()}
          onOpenFile={entry => { if (entry.kind === 'file') open(entry); }}
          onRefreshOpenedFile={editor.refreshOpenedFile} onCloseOpenedFile={editor.closeEditorFile}
          onConfirmCloseOpenedFilesForPaths={editor.confirmCloseOpenedFileTabsForPaths}
          onCloseOpenedFilesForPaths={editor.closeOpenedFileTabsForPaths}
          onRemapOpenedFilesForPathChange={editor.remapOpenedFileTabsForPathChange}
          openedFile={openedFile} reveal={reveal}
        /> : null}
      </div>
    </div>
  );
}
