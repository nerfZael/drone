import React from 'react';
import { UiPaneState, UiPanel } from '../../ui/components';
import type { DroneOpenedFileTabState } from './opened-file-types';

type OpenedDroneFilePanelProps = React.ComponentProps<typeof import('./OpenedDroneFilePanel').OpenedDroneFilePanel>;

const LazyOpenedDroneFilePanel = React.lazy(async () => ({
  default: (await import('./OpenedDroneFilePanel')).OpenedDroneFilePanel,
}));

type DetachedFileWindowProps = Omit<OpenedDroneFilePanelProps, 'file' | 'fileTabs' | 'activeTabId' | 'onActivateFileTab' | 'onReorderFileTabs'> & {
  file: DroneOpenedFileTabState;
};

/**
 * One file in its own workspace window, created by dragging its tab out of
 * the editor. It shares the editor's tab state, so edits, saves, and
 * on-disk change tracking behave exactly as in the editor pane.
 */
export function DetachedFileWindow({ file, ...props }: DetachedFileWindowProps) {
  return (
    <div className="h-full min-h-0 overflow-hidden bg-[var(--panel-alt)]">
      <React.Suspense
        fallback={
          <UiPanel flush surface="alternate" className="h-full w-full">
            <UiPaneState kind="loading" title={`Loading ${file.name ?? 'file'}…`} />
          </UiPanel>
        }
      >
        <LazyOpenedDroneFilePanel {...props} file={file} fileTabs={[]} activeTabId={file.tabId} />
      </React.Suspense>
    </div>
  );
}
