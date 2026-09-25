import React from 'react';
import { UiDialog } from '../../ui/components/Dialog';
import { confirmDialog } from '../../ui/AppConfirmDialog';
import { FolderWorkspaceFiles } from '../files/FolderWorkspaceFiles';
import type { CompanionHomeTarget } from './companion-home-files';

/** Companion's own workspace is not a drone, but the Hub serves its folder through the drone file routes under this id. */
const COMPANION_HOME_ID = 'companion-home';
const NAME = 'Companion home';

export default function CompanionHomeFilesDialog({ target, onClose }: { target: (CompanionHomeTarget & { sequence: number }) | null; onClose(): void }) {
  // Companion edits these files while the window is open. Open tabs and the explorer follow those
  // changes over the same workspace events as any drone: Companion home is served as a host drone.
  const [notice, setNotice] = React.useState<string | null>(null);
  const dirtyTabs = React.useRef<() => { name?: string | null; path?: string | null }[]>(() => []);
  const close = () => {
    void (async () => {
      const dirty = dirtyTabs.current();
      if (dirty.length > 0 && !(await confirmDialog({
        title: 'Discard unsaved changes in Companion home?',
        message: `Closing this window will discard them: ${dirty.slice(0, 4).map(tab => tab.name || tab.path || 'file').join(', ')}${dirty.length > 4 ? `, and ${dirty.length - 4} more` : ''}.`,
        confirmLabel: 'Discard changes', destructive: true,
      }))) return;
      onClose();
    })();
  };
  return <UiDialog open onClose={close} title={NAME} size="large" hideHeader className="!max-w-[min(76rem,calc(100vw-3rem))]" bodyClassName="min-h-0 !p-0">
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-1.5">
      <span className="text-sm text-[var(--fg-secondary)]">{NAME}</span>
      <span role={notice ? 'status' : undefined} className={`min-w-0 flex-1 truncate text-xs ${notice ? 'text-[var(--yellow)]' : 'text-[var(--muted)]'}`}>{notice ?? 'Companion’s own files · attachments are saved in uploads/'}</span>
      <button type="button" aria-label="Close dialog" onClick={close} className="rounded px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--hover)]">✕</button>
    </div>
    <FolderWorkspaceFiles workspaceId={COMPANION_HOME_ID} name={NAME} target={target} onNotice={setNotice} dirtyTabs={dirtyTabs}
      className="h-[78vh] max-h-[calc(100dvh-7rem)]" />
  </UiDialog>;
}
