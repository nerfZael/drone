import { OpenedDroneFilePanel } from '../files/OpenedDroneFilePanel';
import { QuickOpenModal } from '../files/QuickOpenModal';
import type { DroneOpenedFileState, DroneOpenedFileTabState } from '../files/opened-file-types';
import type { QuickOpenFile, QuickOpenRecentFile } from '../files/quick-open-state';

type OpenFileTarget = {
  path: string;
  name: string;
  line?: number | null;
  column?: number | null;
  /** The workspace the file is in (as the file routes name it), when it is not the drone's own. */
  droneId?: string;
};

/** Another workspace whose files the editor shows beside the drone's own. */
export type EditorWorkspaceInfo = { name: string; homePath: string };

type DroneEditorDockProps = {
  droneId: string;
  droneName: string;
  /** Where the explorer starts, for links to the files it shows. */
  homePath?: string;
  openedFile: DroneOpenedFileState;
  quickOpen: {
    open: boolean;
    query: string;
    files: QuickOpenFile[];
    recentFiles: QuickOpenRecentFile[];
    loading: boolean;
    error: string | null;
    canGoBack: boolean;
    canGoForward: boolean;
    onQueryChange: (value: string) => void;
    onClose: () => void;
    onOpenFile: (file: OpenFileTarget) => void;
    onGoBack: () => void;
    onGoForward: () => void;
  };
  openedFileTabs: DroneOpenedFileTabState[];
  activeOpenedFileTabId: string | null;
  onOpenedEditorFileContentChange: (nextContent: string) => void;
  onSaveOpenedEditorFile: (contentOverride?: string) => Promise<boolean>;
  onAppendFileDictationLine: (input: {
    droneId: string;
    path: string;
    line: string;
  }) => Promise<boolean>;
  onOpenFileDictationTarget: (target: {
    droneId: string;
    path: string;
    name: string;
  }) => void;
  onReloadOpenedEditorFileFromDisk: () => void;
  onOverwriteOpenedEditorFile: () => Promise<boolean>;
  onCloseOpenedEditorFile: (tabId?: string | null) => void;
  onActivateOpenedEditorFileTab: (tabId: string) => void;
  onReorderOpenedEditorFileTabs: (activeId: string, overId: string) => void;
  onOpenFileTargetInEditor: (target: OpenFileTarget) => void;
  /** Tabs can hold files of other workspaces (explorer roots); what each of those is, by its file route id. */
  workspaceOf?: (droneId: string) => EditorWorkspaceInfo | null;
};

export function DroneEditorDock({
  droneId,
  droneName,
  homePath,
  openedFile,
  quickOpen,
  openedFileTabs,
  activeOpenedFileTabId,
  onOpenedEditorFileContentChange,
  onSaveOpenedEditorFile,
  onAppendFileDictationLine,
  onOpenFileDictationTarget,
  onReloadOpenedEditorFileFromDisk,
  onOverwriteOpenedEditorFile,
  onCloseOpenedEditorFile,
  onActivateOpenedEditorFileTab,
  onReorderOpenedEditorFileTabs,
  onOpenFileTargetInEditor,
  workspaceOf,
}: DroneEditorDockProps) {
  // The active file can be in another workspace; the panel reads, previews and links it there.
  const activeDroneId = openedFileTabs.find((tab) => tab.tabId === activeOpenedFileTabId)?.droneId || droneId;
  const foreign = activeDroneId !== droneId ? workspaceOf?.(activeDroneId) ?? null : null;
  const openResolvedFile = (target: OpenFileTarget) =>
    onOpenFileTargetInEditor(activeDroneId !== droneId ? { ...target, droneId: activeDroneId } : target);
  const workspaceLabelForTab = workspaceOf
    ? (tab: DroneOpenedFileTabState) => (tab.droneId && tab.droneId !== droneId ? workspaceOf(tab.droneId)?.name ?? null : null)
    : undefined;
  return (
    <div className="h-full min-h-0 overflow-hidden bg-[var(--panel-alt)]">
      <QuickOpenModal
        open={quickOpen.open}
        query={quickOpen.query}
        files={quickOpen.files}
        recentFiles={quickOpen.recentFiles}
        loading={quickOpen.loading}
        error={quickOpen.error}
        onQueryChange={quickOpen.onQueryChange}
        onClose={quickOpen.onClose}
        onOpenFile={quickOpen.onOpenFile}
      />
      {openedFile.path ? (
        <OpenedDroneFilePanel
          droneId={activeDroneId}
          droneName={foreign?.name ?? droneName}
          workspaceHomePath={foreign ? foreign.homePath : homePath}
          workspaceLabelForTab={workspaceLabelForTab}
          file={openedFile}
          fileTabs={openedFileTabs}
          activeTabId={activeOpenedFileTabId}
          onFileContentChange={onOpenedEditorFileContentChange}
          onSaveFile={onSaveOpenedEditorFile}
          onAppendFileDictationLine={onAppendFileDictationLine}
          onOpenFileDictationTarget={onOpenFileDictationTarget}
          onReloadFromDisk={onReloadOpenedEditorFileFromDisk}
          onOverwriteFile={onOverwriteOpenedEditorFile}
          onCloseFile={onCloseOpenedEditorFile}
          onActivateFileTab={onActivateOpenedEditorFileTab}
          onReorderFileTabs={onReorderOpenedEditorFileTabs}
          onOpenResolvedFile={openResolvedFile}
        />
      ) : (
        <div className="h-full flex items-center justify-center px-6 text-center text-ui text-[var(--muted)]">
          Select a file in the File Explorer, Changes, Pull requests, or a chat reference.
        </div>
      )}
    </div>
  );
}
