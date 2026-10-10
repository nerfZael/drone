import React from 'react';
import { workspaceExplorerLocation } from '@drone/hub-model';
import type { DroneSummary } from '../types';
import { requestJson } from '../http';
import { useFilesPaneState } from './use-files-and-ports-pane-state';
import { useFileEditorState } from './use-file-editor-state';
import { EditorWorkspacePane, type EditorWorkspacePaneProps } from './RightPanelTabContent';
import { droneHomePath, resolveDroneFileOpenPath } from './helpers';
import { setExplorerWorkspace, useExplorerWorkspaceDrone } from '../workspaces/explorer-workspace-store';
import { ExplorerWorkspaceSwitcher } from '../workspaces/ExplorerWorkspaceSwitcher';
import type { PaneKey } from './pane-key';

type FileTarget = { path: string; name: string; line?: number | null; column?: number | null };

const uiDroneName = (nameRaw: string) => String(nameRaw ?? '').trim();

/**
 * An Editor with explorer and tab state of its own, for a desktop window. The
 * Hub's editor state follows the selected drone; this one stays with `drone`,
 * so a pinned window keeps its files while another drone is selected.
 */
export function DesktopEditorPane({ drone, currentDroneId, paneKey, droneById }: {
  drone: DroneSummary;
  currentDroneId: string | null;
  paneKey: PaneKey;
  droneById: Record<string, DroneSummary>;
}) {
  // The window's File Explorer can show another workspace; the choice is this window's own, per drone, apart from
  // the Hub's. One editor state serves both, so the drone's tabs are still there when it switches back.
  const storeKey = `${paneKey}\u0000${drone.id}`;
  const { workspace, drone: switched } = useExplorerWorkspaceDrone(storeKey, droneById);
  const target = switched ?? drone;
  const { pane, controls } = useStandaloneEditorPaneProps(target);
  return (
    <EditorWorkspacePane
      {...pane}
      // Dictating into one of the drone's files brings the window back to the drone's own files, as in the Hub.
      onOpenFileDictationTarget={(location) => {
        if (location.droneId !== drone.id) return;
        setExplorerWorkspace(storeKey, null, drone.id);
        controls.openLocation(location);
      }}
      drone={target}
      paneKey={paneKey}
      currentDroneId={currentDroneId}
      explorerSwitcher={
        <ExplorerWorkspaceSwitcher
          droneId={drone.id}
          droneName={uiDroneName(drone.name)}
          ownPath={droneHomePath(drone)}
          current={workspace}
          storeKey={storeKey}
        />
      }
    />
  );
}

/** The editor commands the Hub's keyboard shortcuts run, for an editor that is not the Hub's own. */
export type StandaloneEditorControls = {
  openQuickOpen(): void;
  createUntitledFile(): boolean;
  /** False when there is no location to go to. */
  goBack(): boolean;
  goForward(): boolean;
  quickOpenOpen: boolean;
  /** Opens a file of any drone or folder this editor has shown, whichever it shows now. */
  openLocation(location: { droneId: string; path: string; name: string }): void;
};

/**
 * Explorer and editor state of its own for `drone` (null: idle), as Editor pane props: a pinned desktop window's
 * drone, or another workspace a drone's File Explorer is switched to. It never remembers files across sessions;
 * the Hub's own editor owns that.
 */
export function useStandaloneEditorPaneProps(
  drone: DroneSummary | null,
): { pane: Omit<EditorWorkspacePaneProps, 'drone' | 'paneKey' | 'currentDroneId'>; controls: StandaloneEditorControls } {
  const files = useFilesPaneState({ currentDrone: drone, requestJson, filesEnabled: Boolean(drone) });
  const revealUntitledRef = React.useRef<(path: string) => void>(() => {});
  // The Hub's editor owns the remembered last file; this window must not overwrite it.
  const editor = useFileEditorState({
    currentDrone: drone, requestJson, onRefreshFsList: files.refreshFsList, rememberOpenedFiles: false,
    saveAsDirectory: files.currentFsPath || files.defaultFsPathForCurrentDrone,
    onUntitledFileSaved: (path) => revealUntitledRef.current(path),
  });
  const revealSeq = React.useRef(0);
  const [explorerReveal, setExplorerReveal] = React.useState<{ path: string; sequence: number; kind?: 'file' | 'directory' } | null>(null);
  const { setCurrentFsPath, defaultFsPathForCurrentDrone } = files;
  const { openEditorFile, openEditorLocation, setActiveOpenedFileTab, openedFileTabs, goBackLocation, goForwardLocation } = editor;

  const revealFileInExplorer = React.useCallback((path: string) => {
    setCurrentFsPath(workspaceExplorerLocation(defaultFsPathForCurrentDrone, path).root);
    setExplorerReveal({ path, sequence: ++revealSeq.current, kind: 'file' });
  }, [defaultFsPathForCurrentDrone, setCurrentFsPath]);
  const openFile = React.useCallback((next: FileTarget) => {
    if (!drone) return;
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
  revealUntitledRef.current = revealFileInExplorer;
  const revealLocation = (location: { path: string } | null) => {
    if (location) revealFileInExplorer(location.path);
    return Boolean(location);
  };

  const controls: StandaloneEditorControls = {
    openQuickOpen: editor.openQuickOpen,
    createUntitledFile: () => editor.createUntitledFile() != null,
    goBack: () => revealLocation(goBackLocation()),
    goForward: () => revealLocation(goForwardLocation()),
    quickOpenOpen: editor.quickOpenOpen,
    openLocation: openEditorLocation,
  };
  const pane: Omit<EditorWorkspacePaneProps, 'drone' | 'paneKey' | 'currentDroneId'> = {
    defaultFsPathForCurrentDrone: files.defaultFsPathForCurrentDrone,
    uiDroneName,
    currentFsPath: files.currentFsPath,
    explorerReveal,
    fsEntries: files.fsEntries,
    fsLoading: files.fsLoading,
    fsError: files.fsError,
    fsErrorUi: files.fsErrorUi,
    filesPane: files.filesPane,
    setCurrentFsPath: files.setCurrentFsPath,
    refreshFsList: files.refreshFsList,
    onRefreshOpenedEditorFile: editor.refreshOpenedFile,
    onReloadOpenedEditorFileFromDisk: editor.reloadOpenedFileFromDisk,
    onOverwriteOpenedEditorFile: editor.overwriteOpenedFile,
    onOpenFileInEditor: (entry) => { if (entry.kind === 'file') openFile({ path: entry.path, name: entry.name }); },
    // Separate file windows belong to the Hub's dock, not to this editor.
    onOpenFileInPanel: () => false,
    onOpenFileTargetInEditor: openFile,
    pendingFileOpenPath: null,
    openedFile: {
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
    },
    quickOpen: {
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
      onGoBack: () => { revealLocation(goBackLocation()); },
      onGoForward: () => { revealLocation(goForwardLocation()); },
    },
    openedFileTabs: editor.openedFileTabs,
    activeOpenedFileTabId: editor.activeOpenedFileTabId,
    onOpenedEditorFileContentChange: editor.setOpenedFileContent,
    onSaveOpenedEditorFile: editor.saveOpenedFile,
    onAppendFileDictationLine: editor.appendAndSaveFileDictationLine,
    onOpenFileDictationTarget: (target) => {
      if (drone && target.droneId === drone.id) openEditorLocation(target);
    },
    onCloseOpenedEditorFile: editor.closeEditorFile,
    onConfirmCloseOpenedEditorFilesForPaths: editor.confirmCloseOpenedFileTabsForPaths,
    onCloseOpenedEditorFilesForPaths: editor.closeOpenedFileTabsForPaths,
    onRemapOpenedEditorFilesForPathChange: editor.remapOpenedFileTabsForPathChange,
    onActivateOpenedEditorFileTab: activateTab,
    onReorderOpenedEditorFileTabs: editor.reorderOpenedFileTabs,
  };
  return { pane, controls };
}
