import React from 'react';
import { workspaceExplorerLocation } from '@drone/hub-model';
import type { DroneSummary } from '../types';
import { requestJson } from '../http';
import { useFilesPaneState } from './use-files-and-ports-pane-state';
import { useFileEditorState } from './use-file-editor-state';
import { EditorWorkspacePane } from './RightPanelTabContent';
import { resolveDroneFileOpenPath } from './helpers';
import type { PaneKey } from './pane-key';

type FileTarget = { path: string; name: string; line?: number | null; column?: number | null };

const uiDroneName = (nameRaw: string) => String(nameRaw ?? '').trim();

/**
 * An Editor with explorer and tab state of its own, for a desktop window. The
 * Hub's editor state follows the selected drone; this one stays with `drone`,
 * so a pinned window keeps its files while another drone is selected.
 */
export function DesktopEditorPane({ drone, currentDroneId, paneKey }: {
  drone: DroneSummary;
  currentDroneId: string | null;
  paneKey: PaneKey;
}) {
  const files = useFilesPaneState({ currentDrone: drone, requestJson, filesEnabled: true });
  // The Hub's editor owns the remembered last file; this window must not overwrite it.
  const editor = useFileEditorState({ currentDrone: drone, requestJson, onRefreshFsList: files.refreshFsList, rememberOpenedFiles: false });
  const revealSeq = React.useRef(0);
  const [explorerReveal, setExplorerReveal] = React.useState<{ path: string; sequence: number; kind?: 'file' | 'directory' } | null>(null);
  const { setCurrentFsPath, defaultFsPathForCurrentDrone } = files;
  const { openEditorFile, openEditorLocation, setActiveOpenedFileTab, openedFileTabs, goBackLocation, goForwardLocation } = editor;

  const revealFileInExplorer = React.useCallback((path: string) => {
    setCurrentFsPath(workspaceExplorerLocation(defaultFsPathForCurrentDrone, path).root);
    setExplorerReveal({ path, sequence: ++revealSeq.current, kind: 'file' });
  }, [defaultFsPathForCurrentDrone, setCurrentFsPath]);
  const openFile = React.useCallback((next: FileTarget) => {
    const path = resolveDroneFileOpenPath(drone, next.path);
    if (!path) return;
    const name = String(next.name ?? '').trim() || path.split('/').filter(Boolean).pop() || path;
    revealFileInExplorer(path);
    openEditorFile({ ...next, path, name });
  }, [drone, openEditorFile, revealFileInExplorer]);
  const activateTab = React.useCallback((tabId: string) => {
    const tab = openedFileTabs.find((entry) => entry.tabId === tabId);
    if (tab) revealFileInExplorer(tab.path);
    setActiveOpenedFileTab(tabId);
  }, [openedFileTabs, revealFileInExplorer, setActiveOpenedFileTab]);
  const revealLocation = (location: { path: string } | null) => {
    if (location) revealFileInExplorer(location.path);
  };

  return (
    <EditorWorkspacePane
      drone={drone}
      paneKey={paneKey}
      currentDroneId={currentDroneId}
      defaultFsPathForCurrentDrone={files.defaultFsPathForCurrentDrone}
      uiDroneName={uiDroneName}
      currentFsPath={files.currentFsPath}
      explorerReveal={explorerReveal}
      fsEntries={files.fsEntries}
      fsLoading={files.fsLoading}
      fsError={files.fsError}
      fsErrorUi={files.fsErrorUi}
      filesPane={files.filesPane}
      setCurrentFsPath={files.setCurrentFsPath}
      refreshFsList={files.refreshFsList}
      onRefreshOpenedEditorFile={editor.refreshOpenedFile}
      onReloadOpenedEditorFileFromDisk={editor.reloadOpenedFileFromDisk}
      onOverwriteOpenedEditorFile={editor.overwriteOpenedFile}
      onOpenFileInEditor={(entry) => { if (entry.kind === 'file') openFile({ path: entry.path, name: entry.name }); }}
      // Separate file windows belong to the Hub's dock, not to this window.
      onOpenFileInPanel={() => false}
      onOpenFileTargetInEditor={openFile}
      openedFile={{
        path: editor.openedFile?.path ?? null,
        name: editor.openedFile?.name ?? null,
        loading: editor.loading,
        saving: editor.saving,
        error: editor.error,
        kind: editor.kind,
        mime: editor.mime,
        size: editor.size,
        content: editor.content,
        dirty: editor.dirty,
        mtimeMs: editor.mtimeMs,
        revision: editor.revision,
        externallyChanged: editor.externallyChanged,
        canOverwriteExternalChange: editor.canOverwriteExternalChange,
        targetLine: editor.openedFile?.targetLine ?? null,
        targetColumn: editor.openedFile?.targetColumn ?? null,
        navigationSeq: editor.openedFile?.navigationSeq ?? 0,
      }}
      quickOpen={{
        open: editor.quickOpenOpen,
        query: editor.quickOpenQuery,
        files: editor.quickOpenFiles,
        recentFiles: editor.recentFiles,
        loading: editor.quickOpenLoading,
        error: editor.quickOpenError,
        canGoBack: editor.canGoBackLocation,
        canGoForward: editor.canGoForwardLocation,
        onQueryChange: editor.setQuickOpenQuery,
        onClose: editor.closeQuickOpen,
        onOpenFile: (next) => { openFile(next); editor.closeQuickOpen(); },
        onGoBack: () => revealLocation(goBackLocation()),
        onGoForward: () => revealLocation(goForwardLocation()),
      }}
      openedFileTabs={editor.openedFileTabs}
      activeOpenedFileTabId={editor.activeOpenedFileTabId}
      onOpenedEditorFileContentChange={editor.setOpenedFileContent}
      onSaveOpenedEditorFile={editor.saveOpenedFile}
      onAppendFileDictationLine={editor.appendAndSaveFileDictationLine}
      onOpenFileDictationTarget={(target) => {
        if (target.droneId === drone.id) openEditorLocation(target);
      }}
      onCloseOpenedEditorFile={editor.closeEditorFile}
      onConfirmCloseOpenedEditorFilesForPaths={editor.confirmCloseOpenedFileTabsForPaths}
      onCloseOpenedEditorFilesForPaths={editor.closeOpenedFileTabsForPaths}
      onRemapOpenedEditorFilesForPathChange={editor.remapOpenedFileTabsForPathChange}
      onActivateOpenedEditorFileTab={activateTab}
      onReorderOpenedEditorFileTabs={editor.reorderOpenedFileTabs}
    />
  );
}
