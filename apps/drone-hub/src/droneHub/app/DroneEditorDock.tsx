import { OpenedDroneFilePanel } from '../files/OpenedDroneFilePanel';
import { QuickOpenModal } from '../files/QuickOpenModal';
import type { DroneOpenedFileState, DroneOpenedFileTabState } from '../files/opened-file-types';
import type { QuickOpenFile, QuickOpenRecentFile } from '../files/quick-open-state';

type OpenFileTarget = {
  path: string;
  name: string;
  line?: number | null;
  column?: number | null;
};

type DroneEditorDockProps = {
  droneId: string;
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
    onOpenFile: (file: { path: string; name: string }) => void;
    onGoBack: () => void;
    onGoForward: () => void;
  };
  openedFileTabs: DroneOpenedFileTabState[];
  activeOpenedFileTabId: string | null;
  onOpenedEditorFileContentChange: (nextContent: string) => void;
  onSaveOpenedEditorFile: (contentOverride?: string) => Promise<boolean>;
  onReloadOpenedEditorFileFromDisk: () => void;
  onOverwriteOpenedEditorFile: () => Promise<boolean>;
  onCloseOpenedEditorFile: (tabId?: string | null) => void;
  onActivateOpenedEditorFileTab: (tabId: string) => void;
  onReorderOpenedEditorFileTabs: (activeId: string, overId: string) => void;
  onOpenFileTargetInEditor: (target: OpenFileTarget) => void;
};

export function DroneEditorDock({
  droneId,
  openedFile,
  quickOpen,
  openedFileTabs,
  activeOpenedFileTabId,
  onOpenedEditorFileContentChange,
  onSaveOpenedEditorFile,
  onReloadOpenedEditorFileFromDisk,
  onOverwriteOpenedEditorFile,
  onCloseOpenedEditorFile,
  onActivateOpenedEditorFileTab,
  onReorderOpenedEditorFileTabs,
  onOpenFileTargetInEditor,
}: DroneEditorDockProps) {
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
          droneId={droneId}
          file={openedFile}
          fileTabs={openedFileTabs}
          activeTabId={activeOpenedFileTabId}
          onFileContentChange={onOpenedEditorFileContentChange}
          onSaveFile={onSaveOpenedEditorFile}
          onReloadFromDisk={onReloadOpenedEditorFileFromDisk}
          onOverwriteFile={onOverwriteOpenedEditorFile}
          onCloseFile={onCloseOpenedEditorFile}
          onActivateFileTab={onActivateOpenedEditorFileTab}
          onReorderFileTabs={onReorderOpenedEditorFileTabs}
          onOpenResolvedFile={onOpenFileTargetInEditor}
        />
      ) : (
        <div className="h-full flex items-center justify-center px-4 text-center text-[var(--text-12)] text-[var(--muted)]">
          Open a file from Files, Changes, PRs, or a chat reference.
        </div>
      )}
    </div>
  );
}
