import React from 'react';
import {
  defaultTextFileViewModeForFile,
  editorLanguageForPath,
  isHtmlFile,
  isMarkdownFile,
  type TextFileViewMode,
} from '../code-languages';
import { formatBytes } from '../app/selected-drone-workspace-utils';
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
import {
  MarkdownOutlinePreview,
  type MarkdownOutlineExpansionCommand,
} from './MarkdownOutlinePreview';
import { IsolatedHtmlPreview } from './IsolatedHtmlPreview';

type MonacoEditorComponent = (typeof import('@monaco-editor/react'))['default'];
type MonacoEditorProps = React.ComponentProps<MonacoEditorComponent>;
type MonacoEditorMountHandler = NonNullable<MonacoEditorProps['onMount']>;
type MonacoEditorInstance = Parameters<MonacoEditorMountHandler>[0];
const LARGE_TEXT_CHUNK_BYTES = 256 * 1024;

const MonacoEditor = React.lazy(async (): Promise<{ default: MonacoEditorComponent }> => {
  const module = await import('@monaco-editor/react');
  return { default: module.default };
});

function CollapseAllHeadingsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 3 4 4 4-4" />
      <path d="m4 13 4-4 4 4" />
    </svg>
  );
}

function ExpandAllHeadingsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 6 4-4 4 4" />
      <path d="m4 10 4 4 4-4" />
    </svg>
  );
}

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
      className="h-full w-full resize-none border-0 bg-[var(--panel-alt)] p-3 font-mono text-[var(--text-12)] leading-5 text-[var(--fg-secondary)] outline-none"
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
  revision,
}: {
  droneId: string;
  path: string;
  size: number;
  revision?: string | null;
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
  }, [droneId, path, revision]);

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
          <div className="text-[var(--text-11)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
            Large file
          </div>
          <div className="mt-0.5 text-[var(--text-11)] text-[var(--muted-dim)]">{loadedLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => void loadNextChunk()}
          disabled={loading || eof}
          className={`h-7 px-2.5 rounded-[var(--radius-medium)] border text-[var(--text-10)] font-[var(--weight-semibold)] transition-colors ${
            loading || eof
              ? 'border-[var(--border-subtle)] bg-transparent text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
              : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:shadow-[var(--glow-accent)]'
          }`}
        >
          {eof ? 'Loaded' : loading ? 'Loading...' : 'Load more'}
        </button>
      </div>
      {error ? (
        <div className="m-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
          {error}
        </div>
      ) : null}
      <pre className="flex-1 min-h-0 overflow-auto whitespace-pre-wrap break-words p-3 text-[var(--text-12)] leading-5 text-[var(--fg-secondary)] font-mono">
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
  onReloadFromDisk?: () => void;
  onOverwriteFile?: () => Promise<boolean>;
  onCloseFile?: (tabId?: string | null) => void;
  onActivateFileTab?: (tabId: string) => void;
  onReorderFileTabs?: (fromTabId: string, toTabId: string) => void;
  onOpenResolvedFile?: (next: { path: string; name: string; line?: number | null; column?: number | null }) => void;
  readOnly?: boolean;
};

export function OpenedDroneFilePanel({
  droneId,
  file,
  fileTabs = [],
  activeTabId = null,
  onFileContentChange,
  onSaveFile,
  onReloadFromDisk,
  onOverwriteFile,
  onCloseFile,
  onActivateFileTab,
  onReorderFileTabs,
  onOpenResolvedFile,
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
    targetLine: fileTargetLine,
    targetColumn: fileTargetColumn,
    navigationSeq: fileNavigationSeq,
    revision: fileRevision,
  } = file;
  const activeFilePath = String(filePath ?? '').trim();
  const openedEditorIsText = (fileKind ?? 'text') === 'text';
  const openedFileIsLargeText = fileKind === 'large-text';
  const openedFileIsMarkdown = openedEditorIsText && isMarkdownFile(activeFilePath, fileMime);
  const openedFileIsHtml = openedEditorIsText && isHtmlFile(activeFilePath, fileMime);
  const [openedTextMode, setOpenedTextMode] = React.useState<TextFileViewMode>(() =>
    activeFilePath && openedEditorIsText
      ? defaultTextFileViewModeForFile(activeFilePath, fileMime)
      : 'edit',
  );
  const [markdownOutlineExpansionCommand, setMarkdownOutlineExpansionCommand] =
    React.useState<MarkdownOutlineExpansionCommand | null>(null);
  const editorRef = React.useRef<MonacoEditorInstance | null>(null);
  const languageActionsRef = React.useRef<{
    goToDefinition: () => void;
    findReferences: () => void;
  } | null>(null);
  const languageRequestSeqRef = React.useRef(0);
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
    setMarkdownOutlineExpansionCommand(null);
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
  const openedFileShowsHtmlPreview = openedFileIsHtml && openedTextMode === 'preview';
  const openedFileShowsPreview =
    openedFileShowsMarkdownPreview || openedFileShowsHtmlPreview;
  const openedFileEditorVisible =
    openedEditorIsText && Boolean(activeFilePath) && !openedFileShowsPreview;
  const openedFileMediaSrc = React.useMemo(() => {
    if (!activeFilePath) return '';
    if (fileKind !== 'image' && fileKind !== 'video') return '';
    const revisionQuery = fileRevision
      ? `&revision=${encodeURIComponent(fileRevision)}`
      : '';
    return `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(activeFilePath)}${revisionQuery}`;
  }, [activeFilePath, droneId, fileKind, fileRevision]);
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
    void fetchLanguageDefinition(droneId, position)
      .then((payload) => {
        if (languageRequestSeqRef.current !== seq) return;
        if (payload.ok !== true)
          throw new Error(String((payload as any).error ?? 'definition lookup failed'));
        if (!payload.target) return;
        openLanguageLocation(payload.target);
      })
      .catch((error: any) => {
        if (languageRequestSeqRef.current !== seq) return;
        console.warn(String(error?.message ?? error ?? 'definition lookup failed'));
      });
  }, [activeLanguagePosition, droneId, openLanguageLocation]);

  const findReferences = React.useCallback(() => {
    const position = activeLanguagePosition();
    if (!position) return;
    const seq = languageRequestSeqRef.current + 1;
    languageRequestSeqRef.current = seq;
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
      });
  }, [activeLanguagePosition, droneId]);

  React.useEffect(() => {
    languageActionsRef.current = { goToDefinition, findReferences };
  }, [findReferences, goToDefinition]);

  const modeButtonClassName = (disabled: boolean) =>
    `h-6 rounded-[var(--radius-small)] bg-transparent px-2 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] ${
      disabled ? 'cursor-not-allowed opacity-50' : ''
    }`;
  const headingActionClassName = (disabled: boolean) =>
    `flex h-5 w-5 items-center justify-center rounded-[var(--radius-small)] bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] ${
      disabled ? 'cursor-not-allowed opacity-50' : ''
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
          trailingActions={
            openedFileIsMarkdown || openedFileIsHtml ? (
              <div className="flex items-center gap-1.5">
                {openedFileShowsMarkdownPreview ? (
                  <div
                    className="flex h-6 items-center gap-0.5 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--panel-alt)] p-0.5"
                    role="group"
                    aria-label="Heading expansion"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setMarkdownOutlineExpansionCommand((previous) => ({
                          action: 'collapse',
                          sequence: (previous?.sequence ?? 0) + 1,
                        }))
                      }
                      disabled={Boolean(fileLoading)}
                      className={headingActionClassName(Boolean(fileLoading))}
                      title="Collapse all Markdown headings"
                      aria-label="Collapse all Markdown headings"
                    >
                      <CollapseAllHeadingsIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setMarkdownOutlineExpansionCommand((previous) => ({
                          action: 'expand',
                          sequence: (previous?.sequence ?? 0) + 1,
                        }))
                      }
                      disabled={Boolean(fileLoading)}
                      className={headingActionClassName(Boolean(fileLoading))}
                      title="Expand all Markdown headings"
                      aria-label="Expand all Markdown headings"
                    >
                      <ExpandAllHeadingsIcon />
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (openedFileShowsPreview) {
                      setOpenedTextMode('edit');
                      setMarkdownOutlineExpansionCommand(null);
                    } else {
                      setOpenedTextMode('preview');
                      setMarkdownOutlineExpansionCommand(null);
                    }
                  }}
                  disabled={Boolean(fileLoading)}
                  className={modeButtonClassName(Boolean(fileLoading))}
                  title={
                    openedFileShowsPreview
                      ? readOnly
                        ? `View ${openedFileIsHtml ? 'HTML' : 'markdown'} source`
                        : `Edit ${openedFileIsHtml ? 'HTML' : 'markdown'} source`
                      : `Render ${openedFileIsHtml ? 'isolated HTML' : 'markdown'} preview`
                  }
                >
                  {openedFileShowsPreview ? (readOnly ? 'Source' : 'Edit') : 'Preview'}
                </button>
              </div>
            ) : null
          }
        />
        {fileError ? (
          <div className="m-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
            {fileError}
          </div>
        ) : null}
        {file.externallyChanged ? (
          <div className="mx-3 mt-3 flex items-center justify-between gap-3 rounded border border-[var(--yellow-border)] bg-[var(--yellow-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--fg-secondary)]">
            <span>
              This file changed on disk{fileDirty ? ' while you have unsaved edits.' : '.'}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {fileDirty && file.canOverwriteExternalChange && onOverwriteFile ? (
                <button
                  type="button"
                  onClick={() => void onOverwriteFile()}
                  className="rounded-[var(--radius-medium)] border border-[var(--yellow-border)] bg-transparent px-2 py-1 font-[var(--weight-semibold)] text-[var(--yellow)] hover:bg-[var(--yellow-subtle)]"
                >
                  Overwrite
                </button>
              ) : null}
              <button
                type="button"
                onClick={onReloadFromDisk}
                className="rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel)] px-2 py-1 font-[var(--weight-semibold)] text-[var(--fg)] hover:bg-[var(--hover)]"
              >
                Reload from disk
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex-1 min-h-[360px] flex flex-col">
          <div className="flex-1 min-h-0">
            {fileLoading ? (
              <div className="h-full w-full flex items-center justify-center text-[var(--text-12)] text-[var(--muted)]">
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
                  loadingClassName="min-h-[120px] flex items-center justify-center text-[var(--text-12)] text-[var(--muted)] px-3 text-center"
                />
              </div>
            ) : openedFileIsLargeText && activeFilePath ? (
              <LargeTextFileViewer
                droneId={droneId}
                path={activeFilePath}
                size={fileSize}
                revision={fileRevision}
              />
            ) : fileKind === 'binary' ? (
              <div className="h-full w-full flex items-center justify-center px-6">
                <div className="max-w-[560px] rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-4 py-3 text-center">
                  <div className="text-[var(--text-12)] text-[var(--fg-secondary)]">
                    Binary file preview is not available.
                  </div>
                  <div className="mt-1 text-[var(--text-11)] text-[var(--muted)]">
                    {fileMime ? `${fileMime} • ` : ''}
                    {formatBytes(fileSize)}
                  </div>
                </div>
              </div>
            ) : openedFileShowsMarkdownPreview ? (
              <MarkdownOutlinePreview
                text={fileContent ?? ''}
                onOpenLink={openMarkdownPreviewLink}
                expansionCommand={markdownOutlineExpansionCommand}
              />
            ) : openedFileShowsHtmlPreview ? (
              <IsolatedHtmlPreview source={fileContent ?? ''} fileName={fileName} />
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
              <div className="h-full w-full flex items-center justify-center text-[var(--text-12)] text-[var(--muted)]">
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
