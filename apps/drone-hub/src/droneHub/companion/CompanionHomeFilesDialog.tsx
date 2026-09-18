import React from 'react';
import { UiDialog } from '../../ui/components/Dialog';
import { DroneEditorDock } from '../app/DroneEditorDock';
import { useFileEditorState } from '../app/use-file-editor-state';
import { DroneFilesDock } from '../files/DroneFilesDock';
import { requestJson } from '../http';
import { COMPANION_HOME_CHANGED_EVENT, type CompanionHomeTarget } from './companion-home-files';
import type { DroneOpenedFileState } from '../files/opened-file-types';
import type { DroneFsEntry, DroneFsListPayload, DroneSummary } from '../types';

/** Companion's own workspace is not a drone, but the Hub serves its folder through the drone file routes under this id. */
const COMPANION_HOME_ID = 'companion-home';
const HOME = { id: COMPANION_HOME_ID, name: 'Companion home' } as DroneSummary;

export default function CompanionHomeFilesDialog({ target, onClose }: { target: (CompanionHomeTarget & { sequence: number }) | null; onClose(): void }) {
  // An empty path resolves to the workspace root; the listing reports its absolute path.
  const [path, setPath] = React.useState('');
  const [listing, setListing] = React.useState<{ entries: DroneFsEntry[]; loading: boolean; error: string | null }>({ entries: [], loading: true, error: null });
  const request = React.useRef(0);
  const refresh = React.useCallback(async (directory = path) => {
    const current = ++request.current;
    setListing(previous => ({ ...previous, loading: true }));
    try {
      const data = await requestJson<Extract<DroneFsListPayload, { ok: true }>>(`/api/drones/${COMPANION_HOME_ID}/fs/list?path=${encodeURIComponent(directory)}`);
      if (current !== request.current) return;
      setPath(data.path);
      setListing({ entries: data.entries, loading: false, error: null });
    } catch (error) {
      if (current === request.current) setListing({ entries: [], loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [path]);
  React.useEffect(() => { void refresh(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const editor = useFileEditorState({ currentDrone: HOME, requestJson, onRefreshFsList: () => void refresh() });
  // Companion edits these files while the window is open. The Hub watches the folder and says when
  // something changed; the window then fetches the folder's fingerprint once, reloads the explorer
  // (expanded folders included) and reloads open tabs whose file changed on disk. Tabs with unsaved
  // edits are left alone, as are files this window just saved. Nothing is polled.
  const [refreshSignal, setRefreshSignal] = React.useState(0);
  const fingerprints = React.useRef<Record<string, string>>({});
  const tabs = React.useRef(editor.openedFileTabs);
  tabs.current = editor.openedFileTabs;
  const refreshFileTab = React.useRef(editor.refreshFileTab);
  refreshFileTab.current = editor.refreshFileTab;
  const reloadChangedTabs = React.useCallback(() => {
    for (const tab of tabs.current) {
      const fingerprint = tab.path ? fingerprints.current[tab.path] : undefined;
      if (!fingerprint || tab.dirty || tab.loading || tab.saving) continue;
      const mtimeMs = Number(fingerprint.split(':')[1]);
      if (Number.isFinite(mtimeMs) && tab.mtimeMs != null && mtimeMs !== tab.mtimeMs) refreshFileTab.current(tab.tabId);
    }
  }, []);
  React.useEffect(() => {
    let revision: string | null = null, stopped = false, running = false, again = false;
    const check = async () => {
      if (running) { again = true; return; }
      running = true;
      try {
        // Asking also arms the Hub's watcher, including after a Hub restart.
        const next = await requestJson<{ revision: string; files: Record<string, string> }>('/api/companion/home/revision');
        if (stopped) return;
        fingerprints.current = next.files;
        if (revision !== null && next.revision !== revision) { setRefreshSignal(value => value + 1); reloadChangedTabs(); }
        revision = next.revision;
      } catch { /* The Hub may be restarting; the next notice or focus tries again. */ }
      finally {
        running = false;
        if (again && !stopped) { again = false; void check(); }
      }
    };
    void check();
    const onChanged = () => void check();
    window.addEventListener(COMPANION_HOME_CHANGED_EVENT, onChanged);
    // Coming back to the window catches anything missed while the Hub or its watcher was away.
    window.addEventListener('focus', onChanged);
    return () => { stopped = true; window.removeEventListener(COMPANION_HOME_CHANGED_EVENT, onChanged); window.removeEventListener('focus', onChanged); };
  }, [reloadChangedTabs]);
  const open = (file: { path: string; name: string; line?: number | null; column?: number | null }) => void editor.openEditorFile(file);
  // A path clicked in a Companion reply: a file opens and is selected in the explorer, a folder is only
  // selected. Its kind comes from the listing of its parent, and only paths inside Companion home count.
  const root = React.useRef('');
  const [reveal, setReveal] = React.useState<{ path: string; sequence: number; kind: 'file' | 'directory' } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
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
        const listing = await requestJson<Extract<DroneFsListPayload, { ok: true }>>(`/api/drones/${COMPANION_HOME_ID}/fs/list?path=${encodeURIComponent(parent)}`);
        const entry = listing.entries.find(item => item.path === absolute);
        if (!entry) throw new Error('missing');
        if (cancelled) return;
        setNotice(null);
        setReveal({ path: entry.path, sequence: target.sequence, kind: entry.kind === 'directory' ? 'directory' : 'file' });
        if (entry.kind === 'file') openEditorFile.current({ path: entry.path, name: entry.name, line: target.line, column: target.column });
      } catch {
        if (!cancelled) setNotice(`${target.path} is not in Companion home.`);
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
  const close = () => {
    if (editor.openedFileTabs.some(tab => tab.dirty) && !window.confirm('Discard unsaved changes in Companion home?')) return;
    onClose();
  };
  return <UiDialog open onClose={close} title="Companion home" size="large" hideHeader className="!max-w-[min(76rem,calc(100vw-3rem))]" bodyClassName="min-h-0 !p-0">
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-1.5">
      <span className="text-sm text-[var(--fg-secondary)]">Companion home</span>
      <span role={notice ? 'status' : undefined} className={`min-w-0 flex-1 truncate text-xs ${notice ? 'text-[var(--yellow)]' : 'text-[var(--muted)]'}`} title={path}>{notice ?? 'Companion’s own files · attachments are saved in uploads/'}</span>
      <button type="button" aria-label="Close dialog" onClick={close} className="rounded px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--hover)]">✕</button>
    </div>
    <div className="flex h-[78vh] max-h-[calc(100dvh-7rem)] min-h-0">
      <div className="min-w-0 flex-1">
        <DroneEditorDock
          droneId={COMPANION_HOME_ID} droneName={HOME.name} openedFile={openedFile}
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
          droneId={COMPANION_HOME_ID} droneName={HOME.name} droneLabel={HOME.name}
          path={path} homePath={path} entries={listing.entries} loading={listing.loading} error={listing.error}
          onOpenPath={next => void refresh(next)} onRefresh={() => void refresh()}
          onOpenFile={entry => { if (entry.kind === 'file') open(entry); }}
          onRefreshOpenedFile={reloadChangedTabs} onCloseOpenedFile={editor.closeEditorFile} refreshSignal={refreshSignal}
          onConfirmCloseOpenedFilesForPaths={editor.confirmCloseOpenedFileTabsForPaths}
          onCloseOpenedFilesForPaths={editor.closeOpenedFileTabsForPaths}
          onRemapOpenedFilesForPathChange={editor.remapOpenedFileTabsForPathChange}
          openedFile={openedFile} reveal={reveal}
        /> : null}
      </div>
    </div>
  </UiDialog>;
}
