import React from 'react';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import {
  defaultTextFileViewModeForFile,
  editorLanguageForPath,
  isMarkdownFile,
  type TextFileViewMode,
} from '../code-languages';
import { formatBytes, formatEditorMtime } from '../app/selected-drone-workspace-utils';
import { requestJson } from '../http';
import { resolveMarkdownPreviewLinkTarget } from './markdown-preview-link-utils';
import type { DroneFsTextChunkPayload } from '../types';
import type { DroneOpenedFileState } from './opened-file-types';
import {
  activeLanguagePositionFromEditor,
  openLanguageLocationInEditor,
} from './editor-language-commands';
import {
  fetchLanguageDefinition,
  fetchLanguageReferences,
  type LanguageLocation,
} from './language-intelligence-api';
import { ReferencesResultsPanel, type ReferencesResultsState } from './ReferencesResultsPanel';
import { OpenedDroneFileTabs } from './OpenedDroneFileTabs';
import type { DroneOpenedFileTabState } from './opened-file-types';
import { VideoPreview } from '../media/VideoPreview';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { DESKTOP_THEMES, desktopMonacoTheme } from '../../theme';

type MonacoEditorComponent = (typeof import('@monaco-editor/react'))['default'];
type MonacoEditorProps = React.ComponentProps<MonacoEditorComponent>;
type MonacoEditorMountHandler = NonNullable<MonacoEditorProps['onMount']>;
type MonacoEditorInstance = Parameters<MonacoEditorMountHandler>[0];
const LARGE_TEXT_CHUNK_BYTES = 256 * 1024;

const MonacoEditor = React.lazy(async (): Promise<{ default: MonacoEditorComponent }> => {
  const module = await import('@monaco-editor/react');
  return { default: module.default };
});

function PlainTextEditorFallback({
  value,
  saving,
  readOnly,
  onChange,
  onSave,
}: {
  value: string;
  saving: boolean;
  readOnly?: boolean;
  onChange?: (next: string) => void;
  onSave?: (contentOverride?: string) => Promise<boolean>;
}) {
  const [localValue, setLocalValue] = React.useState(value);

  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <textarea
      value={localValue}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setLocalValue(next);
        onChange?.(next);
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void onSave?.(localValue);
        }
      }}
      readOnly={saving || readOnly}
      spellCheck={false}
      className="h-full w-full resize-none border-0 bg-[var(--panel-alt)] p-3 font-mono text-[12px] leading-5 text-[var(--fg-secondary)] outline-none"
      aria-label="Plain text editor"
    />
  );
}

class MonacoEditorErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

function LargeTextFileViewer({
  droneId,
  path,
  size,
}: {
  droneId: string;
  path: string;
  size: number;
}) {
  const [content, setContent] = React.useState('');
  const [nextOffset, setNextOffset] = React.useState(0);
  const [eof, setEof] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestSeqRef = React.useRef(0);

  React.useEffect(() => {
    requestSeqRef.current += 1;
    setContent('');
    setNextOffset(0);
    setEof(false);
    setLoading(false);
    setError(null);
  }, [droneId, path]);

  const loadNextChunk = React.useCallback(async () => {
    if (!path || loading || eof) return;
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    setLoading(true);
    setError(null);
    try {
      const data = await requestJson<DroneFsTextChunkPayload>(
        `/api/drones/${encodeURIComponent(droneId)}/fs/text-chunk?path=${encodeURIComponent(path)}&offset=${encodeURIComponent(String(nextOffset))}&limit=${encodeURIComponent(String(LARGE_TEXT_CHUNK_BYTES))}`,
      );
      if (requestSeqRef.current !== seq) return;
      if ((data as any)?.ok !== true) {
        throw new Error(String((data as any)?.error ?? 'file chunk request failed'));
      }
      const payload = data as Extract<DroneFsTextChunkPayload, { ok: true }>;
      setContent((prev) => `${prev}${String(payload.content ?? '')}`);
      setNextOffset(Number.isFinite(payload.nextOffset) ? Math.max(0, Math.floor(payload.nextOffset)) : nextOffset);
      setEof(Boolean(payload.eof));
    } catch (err: any) {
      if (requestSeqRef.current !== seq) return;
      setError(String(err?.message ?? err ?? 'file chunk request failed'));
    } finally {
      if (requestSeqRef.current === seq) setLoading(false);
    }
  }, [droneId, eof, loading, nextOffset, path]);

  React.useEffect(() => {
    if (!path || content || loading || eof || error) return;
    void loadNextChunk();
  }, [content, eof, error, loadNextChunk, loading, path]);

  const loadedLabel = `${formatBytes(nextOffset)} / ${formatBytes(size)}`;

  return (
    <div className="h-full min-h-0 flex flex-col bg-[var(--panel-alt)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
            Large file
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--muted-dim)]">{loadedLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => void loadNextChunk()}
          disabled={loading || eof}
          className={`h-7 px-2.5 rounded-md border text-[10px] font-semibold transition-colors ${
            loading || eof
              ? 'border-[var(--border-subtle)] bg-transparent text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
              : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:shadow-[var(--glow-accent)]'
          }`}
        >
          {eof ? 'Loaded' : loading ? 'Loading...' : 'Load more'}
        </button>
      </div>
      {error ? (
        <div className="m-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">
          {error}
        </div>
      ) : null}
      <pre className="flex-1 min-h-0 overflow-auto whitespace-pre-wrap break-words p-3 text-[12px] leading-5 text-[var(--fg-secondary)] font-mono">
        {content || (loading ? 'Loading...' : '')}
      </pre>
    </div>
  );
}

type OpenedDroneFilePanelProps = {
  droneId: string;
  file: DroneOpenedFileState;
  fileTabs?: DroneOpenedFileTabState[];
  activeTabId?: string | null;
  onFileContentChange?: (next: string) => void;
  onSaveFile?: (contentOverride?: string) => Promise<boolean>;
  onCloseFile?: (tabId?: string | null) => void;
  onActivateFileTab?: (tabId: string) => void;
  onReorderFileTabs?: (fromTabId: string, toTabId: string) => void;
  onOpenResolvedFile?: (next: { path: string; name: string; line?: number | null; column?: number | null }) => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  readOnly?: boolean;
};

export function OpenedDroneFilePanel({
  droneId,
  file,
  fileTabs = [],
  activeTabId = null,
  onFileContentChange,
  onSaveFile,
  onCloseFile,
  onActivateFileTab,
  onReorderFileTabs,
  onOpenResolvedFile,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  readOnly = false,
}: OpenedDroneFilePanelProps) {
  const themeId = useDroneHubUiStore((state) => state.themeId);
  const monacoTheme = desktopMonacoTheme(themeId);
  const {
    path: filePath,
    name: fileName,
    loading: fileLoading,
    saving: fileSaving,
    error: fileError,
    kind: fileKind,
    mime: fileMime,
    size: fileSize,
    content: fileContent,
    dirty: fileDirty,
    mtimeMs: fileMtimeMs,
    targetLine: fileTargetLine,
    targetColumn: fileTargetColumn,
    navigationSeq: fileNavigationSeq,
  } = file;
  const activeFilePath = String(filePath ?? '').trim();
  const openedEditorIsText = (fileKind ?? 'text') === 'text';
  const openedFileIsLargeText = fileKind === 'large-text';
  const openedFileIsMarkdown = openedEditorIsText && isMarkdownFile(activeFilePath, fileMime);
  const [openedTextMode, setOpenedTextMode] = React.useState<TextFileViewMode>(() =>
    activeFilePath && openedEditorIsText
      ? defaultTextFileViewModeForFile(activeFilePath, fileMime)
      : 'edit',
  );
  const editorRef = React.useRef<MonacoEditorInstance | null>(null);
  const languageActionsRef = React.useRef<{
    goToDefinition: () => void;
    findReferences: () => void;
  } | null>(null);
  const languageRequestSeqRef = React.useRef(0);
  const [languageStatus, setLanguageStatus] = React.useState<string | null>(null);
  const [languageLoading, setLanguageLoading] = React.useState<'definition' | 'references' | null>(
    null,
  );
  const [referencesState, setReferencesState] = React.useState<ReferencesResultsState>({
    open: false,
    loading: false,
    error: null,
    references: [],
    truncated: false,
  });
  const [openedFileImageZoom, setOpenedFileImageZoom] = React.useState(1);
  const [openedFileImagePan, setOpenedFileImagePan] = React.useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [openedFileImagePanning, setOpenedFileImagePanning] = React.useState(false);
  const openedFileImagePanDragRef = React.useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  React.useEffect(() => {
    if (!activeFilePath || !openedEditorIsText) {
      setOpenedTextMode('edit');
      return;
    }
    setOpenedTextMode(defaultTextFileViewModeForFile(activeFilePath, fileMime));
  }, [activeFilePath, fileMime, fileNavigationSeq, openedEditorIsText]);

  React.useEffect(() => {
    if ((fileKind ?? 'text') !== 'image' || !activeFilePath) {
      setOpenedFileImageZoom(1);
      setOpenedFileImagePan({ x: 0, y: 0 });
      setOpenedFileImagePanning(false);
      openedFileImagePanDragRef.current = null;
      return;
    }
    setOpenedFileImageZoom(1);
    setOpenedFileImagePan({ x: 0, y: 0 });
    setOpenedFileImagePanning(false);
    openedFileImagePanDragRef.current = null;
  }, [activeFilePath, fileKind]);

  React.useEffect(() => {
    if (!openedFileImagePanning) return;
    const onMouseMove = (event: MouseEvent) => {
      const drag = openedFileImagePanDragRef.current;
      if (!drag) return;
      setOpenedFileImagePan({
        x: drag.baseX + (event.clientX - drag.startX),
        y: drag.baseY + (event.clientY - drag.startY),
      });
    };
    const onMouseUp = () => {
      setOpenedFileImagePanning(false);
      openedFileImagePanDragRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [openedFileImagePanning]);

  const openedFileShowsMarkdownPreview = openedFileIsMarkdown && openedTextMode === 'preview';
  const openedFileEditorVisible =
    openedEditorIsText && Boolean(activeFilePath) && !openedFileShowsMarkdownPreview;
  const headerStatusText = React.useMemo(() => {
    if (openedFileIsLargeText) {
      return `Read-only • ${formatBytes(fileSize)}`;
    }
    if (openedEditorIsText) {
      if (readOnly) return 'Read-only';
      if (fileSaving) return 'Saving...';
      if (fileDirty) return 'Unsaved changes';
      const savedText = formatEditorMtime(fileMtimeMs ?? null);
      return savedText === '-' ? 'Saved' : `Saved ${savedText}`;
    }
    const details = [fileMime || null, (fileSize ?? 0) > 0 ? formatBytes(fileSize) : null].filter(
      Boolean,
    );
    return details.length > 0 ? details.join(' • ') : 'Preview';
  }, [fileDirty, fileMime, fileMtimeMs, fileSaving, fileSize, openedEditorIsText, openedFileIsLargeText, readOnly]);
  const openedFileMediaSrc = React.useMemo(() => {
    if (!activeFilePath) return '';
    if (fileKind !== 'image' && fileKind !== 'video') return '';
    return `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(activeFilePath)}`;
  }, [activeFilePath, droneId, fileKind]);
  const applyEditorCursorTarget = React.useCallback(() => {
    if (!openedFileEditorVisible || !activeFilePath || !fileTargetLine) return;
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel?.();
    const maxLine = Number(model?.getLineCount?.() ?? fileTargetLine);
    const line = Math.min(
      Math.max(1, fileTargetLine),
      Number.isFinite(maxLine) && maxLine > 0 ? maxLine : fileTargetLine,
    );
    const requestedColumn = fileTargetColumn ?? 1;
    const maxColumn = Number(model?.getLineMaxColumn?.(line) ?? requestedColumn);
    const column = Math.min(
      Math.max(1, requestedColumn),
      Number.isFinite(maxColumn) && maxColumn > 0 ? maxColumn : requestedColumn,
    );
    editor.setPosition?.({ lineNumber: line, column });
    editor.revealPositionInCenter?.({ lineNumber: line, column });
    editor.focus?.();
  }, [activeFilePath, fileTargetColumn, fileTargetLine, openedFileEditorVisible]);

  React.useEffect(() => {
    if (!openedFileEditorVisible) editorRef.current = null;
  }, [openedFileEditorVisible]);

  React.useEffect(() => {
    languageRequestSeqRef.current += 1;
    setLanguageStatus(null);
    setLanguageLoading(null);
    setReferencesState({
      open: false,
      loading: false,
      error: null,
      references: [],
      truncated: false,
    });
  }, [activeFilePath, droneId]);

  React.useEffect(() => {
    if (!fileDirty) return;
    languageRequestSeqRef.current += 1;
    setLanguageStatus(null);
    setLanguageLoading(null);
    setReferencesState((prev) => {
      if (!prev.open && !prev.loading && !prev.error && prev.references.length === 0) return prev;
      return {
        open: false,
        loading: false,
        error: null,
        references: [],
        truncated: false,
      };
    });
  }, [fileDirty]);

  React.useEffect(() => {
    if (!openedFileEditorVisible || Boolean(fileLoading) || !activeFilePath || !fileTargetLine)
      return;
    if (!fileNavigationSeq) return;
    applyEditorCursorTarget();
  }, [
    activeFilePath,
    applyEditorCursorTarget,
    fileLoading,
    fileNavigationSeq,
    fileTargetLine,
    openedFileEditorVisible,
  ]);

  React.useEffect(() => {
    if (!openedFileEditorVisible || Boolean(fileLoading) || !activeFilePath || fileTargetLine)
      return;
    editorRef.current?.focus?.();
  }, [activeFilePath, fileLoading, fileTargetLine, openedFileEditorVisible]);

  const openMarkdownPreviewLink = React.useCallback(
    (href: string): boolean => {
      if (!onOpenResolvedFile) return false;
      const resolved = resolveMarkdownPreviewLinkTarget(activeFilePath, href);
      if (!resolved) return false;
      const name = resolved.path.split('/').filter(Boolean).pop() || resolved.path;
      onOpenResolvedFile({
        path: resolved.path,
        name,
        line: resolved.line,
        column: resolved.column,
      });
      return true;
    },
    [activeFilePath, onOpenResolvedFile],
  );

  const languageCommandsDisabled =
    !openedFileEditorVisible ||
    Boolean(fileLoading) ||
    Boolean(fileSaving) ||
    Boolean(fileDirty) ||
    !onOpenResolvedFile ||
    readOnly;

  const activeLanguagePosition = React.useCallback(() => {
    if (languageCommandsDisabled) return null;
    return activeLanguagePositionFromEditor(editorRef.current, activeFilePath);
  }, [activeFilePath, languageCommandsDisabled]);

  const openLanguageLocation = React.useCallback(
    (location: LanguageLocation) => {
      if (!onOpenResolvedFile) return;
      openLanguageLocationInEditor(location, onOpenResolvedFile);
    },
    [onOpenResolvedFile],
  );

  const goToDefinition = React.useCallback(() => {
    const position = activeLanguagePosition();
    if (!position) return;
    const seq = languageRequestSeqRef.current + 1;
    languageRequestSeqRef.current = seq;
    setLanguageLoading('definition');
    setLanguageStatus(null);
    void fetchLanguageDefinition(droneId, position)
      .then((payload) => {
        if (languageRequestSeqRef.current !== seq) return;
        if (payload.ok !== true)
          throw new Error(String((payload as any).error ?? 'definition lookup failed'));
        if (!payload.target) {
          setLanguageStatus('No definition found.');
          return;
        }
        openLanguageLocation(payload.target);
      })
      .catch((error: any) => {
        if (languageRequestSeqRef.current !== seq) return;
        setLanguageStatus(String(error?.message ?? error ?? 'definition lookup failed'));
      })
      .finally(() => {
        if (languageRequestSeqRef.current !== seq) return;
        setLanguageLoading(null);
      });
  }, [activeLanguagePosition, droneId, openLanguageLocation]);

  const findReferences = React.useCallback(() => {
    const position = activeLanguagePosition();
    if (!position) return;
    const seq = languageRequestSeqRef.current + 1;
    languageRequestSeqRef.current = seq;
    setLanguageLoading('references');
    setLanguageStatus(null);
    setReferencesState({
      open: true,
      loading: true,
      error: null,
      references: [],
      truncated: false,
    });
    void fetchLanguageReferences(droneId, position)
      .then((payload) => {
        if (languageRequestSeqRef.current !== seq) return;
        if (payload.ok !== true)
          throw new Error(String((payload as any).error ?? 'reference lookup failed'));
        setReferencesState({
          open: true,
          loading: false,
          error: null,
          references: payload.references,
          truncated: Boolean(payload.truncated),
        });
      })
      .catch((error: any) => {
        if (languageRequestSeqRef.current !== seq) return;
        setReferencesState({
          open: true,
          loading: false,
          error: String(error?.message ?? error ?? 'reference lookup failed'),
          references: [],
          truncated: false,
        });
      })
      .finally(() => {
        if (languageRequestSeqRef.current !== seq) return;
        setLanguageLoading(null);
      });
  }, [activeLanguagePosition, droneId]);

  React.useEffect(() => {
    languageActionsRef.current = { goToDefinition, findReferences };
  }, [findReferences, goToDefinition]);

  const modeButtonClassName = (active: boolean, disabled: boolean) =>
    `h-7 px-2 rounded-md border text-[10px] font-semibold transition-colors ${
      active
        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
        : 'border-[var(--border-subtle)] bg-transparent text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
  const navButtonClassName = (enabled: boolean) =>
    `h-7 w-7 rounded-md border text-[13px] font-semibold transition-colors ${
      enabled
        ? 'border-[var(--border-subtle)] bg-transparent text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
        : 'border-[var(--border-subtle)] bg-transparent text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
    }`;

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[var(--panel-alt)]">
      <div className="min-w-0 h-full min-h-0 bg-[var(--panel-alt)] flex flex-col">
        <OpenedDroneFileTabs
          tabs={fileTabs}
          activeTabId={activeTabId}
          onActivateTab={(tabId) => onActivateFileTab?.(tabId)}
          onCloseTab={(tabId) => onCloseFile?.(tabId)}
          onReorderTabs={(fromTabId, toTabId) => onReorderFileTabs?.(fromTabId, toTabId)}
        />
        <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--surface-soft)] flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="truncate text-[13px] font-medium text-[var(--fg-secondary)]">
                {fileName || activeFilePath || 'File'}
              </div>
              <div className="shrink-0 text-[10px] text-[var(--muted)]">{headerStatusText}</div>
            </div>
            <div
              className="mt-0.5 text-[10px] text-[var(--muted-dim)] font-mono truncate"
              title={activeFilePath || undefined}
            >
              {activeFilePath}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onGoBack}
              disabled={!canGoBack || !onGoBack}
              className={navButtonClassName(Boolean(canGoBack && onGoBack))}
              title="Go back (Alt+Left)"
              aria-label="Go back"
            >
              {'<'}
            </button>
            <button
              type="button"
              onClick={onGoForward}
              disabled={!canGoForward || !onGoForward}
              className={navButtonClassName(Boolean(canGoForward && onGoForward))}
              title="Go forward (Alt+Right)"
              aria-label="Go forward"
            >
              {'>'}
            </button>
            {openedEditorIsText && !readOnly ? (
              <>
                {languageStatus ? (
                  <div className="max-w-[220px] truncate text-[10px] text-[var(--muted)]">
                    {languageStatus}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={goToDefinition}
                  disabled={languageCommandsDisabled || languageLoading === 'definition'}
                  className={`h-7 px-2.5 rounded-md border text-[10px] font-semibold transition-colors ${
                    languageCommandsDisabled || languageLoading === 'definition'
                      ? 'border-[var(--border-subtle)] bg-transparent text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
                      : 'border-[var(--border-subtle)] bg-transparent text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                  }`}
                  title={
                    fileDirty ? 'Save before using go to definition' : 'Go to definition (F12)'
                  }
                >
                  {languageLoading === 'definition' ? 'Going...' : 'Definition'}
                </button>
                <button
                  type="button"
                  onClick={findReferences}
                  disabled={languageCommandsDisabled || languageLoading === 'references'}
                  className={`h-7 px-2.5 rounded-md border text-[10px] font-semibold transition-colors ${
                    languageCommandsDisabled || languageLoading === 'references'
                      ? 'border-[var(--border-subtle)] bg-transparent text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
                      : 'border-[var(--border-subtle)] bg-transparent text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                  }`}
                  title={
                    fileDirty ? 'Save before finding references' : 'Find references (Shift+F12)'
                  }
                >
                  {languageLoading === 'references' ? 'Finding...' : 'References'}
                </button>
              </>
            ) : null}
            {openedFileIsMarkdown ? (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOpenedTextMode('preview')}
                  disabled={Boolean(fileLoading)}
                  className={modeButtonClassName(
                    openedTextMode === 'preview',
                    Boolean(fileLoading),
                  )}
                  title="Render markdown preview"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setOpenedTextMode('edit')}
                  disabled={Boolean(fileLoading)}
                  className={modeButtonClassName(openedTextMode === 'edit', Boolean(fileLoading))}
                  title="Edit markdown source"
                >
                  {readOnly ? 'Source' : 'Edit'}
                </button>
              </div>
            ) : null}
            {openedEditorIsText && !readOnly ? (
              <button
                type="button"
                onClick={() => {
                  void onSaveFile?.();
                }}
                disabled={Boolean(fileLoading) || Boolean(fileSaving) || !fileDirty || !onSaveFile}
                className={`h-7 px-2.5 rounded-md border text-[10px] font-semibold transition-colors ${
                  fileLoading || fileSaving || !fileDirty || !onSaveFile
                    ? 'border-[var(--border-subtle)] bg-transparent text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
                    : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:shadow-[var(--glow-accent)]'
                }`}
                title="Save file (Ctrl/Cmd+S)"
              >
                Save
              </button>
            ) : null}
          </div>
        </div>
        {fileError ? (
          <div className="m-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">
            {fileError}
          </div>
        ) : null}
        <div className="flex-1 min-h-[360px] flex flex-col">
          <div className="flex-1 min-h-0">
            {fileLoading ? (
              <div className="h-full w-full flex items-center justify-center text-[12px] text-[var(--muted)]">
                Loading file...
              </div>
            ) : fileKind === 'image' && openedFileMediaSrc ? (
              <div
                className="h-full w-full p-3 flex items-center justify-center select-none"
                style={{
                  cursor:
                    openedFileImageZoom > 1
                      ? openedFileImagePanning
                        ? 'grabbing'
                        : 'grab'
                      : 'default',
                }}
                onWheel={(event) => {
                  event.preventDefault();
                  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
                  setOpenedFileImageZoom((prev) => {
                    const next = Math.max(1, Math.min(8, prev * factor));
                    if (next === 1 && prev !== 1) {
                      setOpenedFileImagePan({ x: 0, y: 0 });
                      setOpenedFileImagePanning(false);
                      openedFileImagePanDragRef.current = null;
                    }
                    return next;
                  });
                }}
                onMouseDown={(event) => {
                  if (event.button !== 2) return;
                  if (openedFileImageZoom <= 1) return;
                  event.preventDefault();
                  openedFileImagePanDragRef.current = {
                    startX: event.clientX,
                    startY: event.clientY,
                    baseX: openedFileImagePan.x,
                    baseY: openedFileImagePan.y,
                  };
                  setOpenedFileImagePanning(true);
                }}
                onContextMenu={(event) => {
                  if (openedFileImageZoom > 1 || openedFileImagePanning) event.preventDefault();
                }}
              >
                <img
                  src={openedFileMediaSrc}
                  alt={fileName ?? 'image preview'}
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  className="max-w-full max-h-full object-contain rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)]"
                  style={{
                    transform: `translate(${openedFileImagePan.x}px, ${openedFileImagePan.y}px) scale(${openedFileImageZoom})`,
                    transformOrigin: 'center center',
                  }}
                />
              </div>
            ) : fileKind === 'video' && openedFileMediaSrc ? (
              <div className="h-full w-full p-3 flex items-center justify-center">
                <VideoPreview
                  src={openedFileMediaSrc}
                  label={fileName ?? 'video preview'}
                  mime={fileMime}
                  className="max-w-full max-h-full rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)]"
                  loadingClassName="min-h-[120px] flex items-center justify-center text-[12px] text-[var(--muted)] px-3 text-center"
                />
              </div>
            ) : openedFileIsLargeText && activeFilePath ? (
              <LargeTextFileViewer droneId={droneId} path={activeFilePath} size={fileSize} />
            ) : fileKind === 'binary' ? (
              <div className="h-full w-full flex items-center justify-center px-6">
                <div className="max-w-[560px] rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-4 py-3 text-center">
                  <div className="text-[12px] text-[var(--fg-secondary)]">
                    Binary file preview is not available.
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">
                    {fileMime ? `${fileMime} • ` : ''}
                    {formatBytes(fileSize)}
                  </div>
                </div>
              </div>
            ) : openedFileShowsMarkdownPreview ? (
              <div className="h-full w-full overflow-auto bg-[var(--panel-alt)] px-4 py-4">
                <MarkdownMessage
                  text={fileContent ?? ''}
                  className="dh-markdown--agent"
                  onOpenLink={openMarkdownPreviewLink}
                  preferOpenLinkBeforeModifiedClick
                />
              </div>
            ) : openedFileEditorVisible ? (
              <MonacoEditorErrorBoundary
                fallback={
                  <PlainTextEditorFallback
                    value={fileContent ?? ''}
                    saving={Boolean(fileSaving)}
                    readOnly={readOnly}
                    onChange={onFileContentChange}
                    onSave={onSaveFile}
                  />
                }
              >
                <React.Suspense
                  fallback={
                    <PlainTextEditorFallback
                      value={fileContent ?? ''}
                      saving={Boolean(fileSaving)}
                      readOnly={readOnly}
                      onChange={onFileContentChange}
                      onSave={onSaveFile}
                    />
                  }
                >
                  <MonacoEditor
                    path={activeFilePath || undefined}
                    language={editorLanguageForPath(activeFilePath)}
                    value={fileContent ?? ''}
                    onChange={(next) => onFileContentChange?.(next ?? '')}
                    beforeMount={(monaco) => {
                      for (const theme of DESKTOP_THEMES) {
                        const editorTheme = desktopMonacoTheme(theme.id);
                        monaco.editor.defineTheme(editorTheme.id, editorTheme.definition);
                      }
                    }}
                    onMount={(editor, monaco) => {
                      editorRef.current = editor;
                      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                        void onSaveFile?.(editor.getValue());
                      });
                      editor.addCommand(monaco.KeyCode.F12, () => {
                        languageActionsRef.current?.goToDefinition();
                      });
                      editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F12, () => {
                        languageActionsRef.current?.findReferences();
                      });
                      applyEditorCursorTarget();
                    }}
                    theme={monacoTheme.id}
                    options={{
                      readOnly: Boolean(fileSaving) || readOnly,
                      fontSize: 12,
                      minimap: { enabled: false },
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      padding: { top: 12, bottom: 12 },
                      'semanticHighlighting.enabled': true,
                      bracketPairColorization: { enabled: true },
                      guides: { bracketPairs: true },
                    }}
                  />
                </React.Suspense>
              </MonacoEditorErrorBoundary>
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[12px] text-[var(--muted)]">
                No file selected.
              </div>
            )}
          </div>
          {openedFileEditorVisible ? (
            <ReferencesResultsPanel
              state={referencesState}
              onOpenReference={(next) => onOpenResolvedFile?.(next)}
              onClose={() =>
                setReferencesState((prev) => ({
                  ...prev,
                  open: false,
                  loading: false,
                }))
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
