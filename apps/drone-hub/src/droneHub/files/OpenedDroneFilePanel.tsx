import React from 'react';
import Editor from '@monaco-editor/react';
import { SegmentedToolbarToggle } from '../app/SegmentedToolbarToggle';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { defaultTextFileViewModeForPath, editorLanguageForPath, isMarkdownPath, type TextFileViewMode } from '../code-languages';
import { formatBytes, formatEditorMtime } from '../app/selected-drone-workspace-utils';
import { resolveMarkdownPreviewLinkTarget } from './markdown-preview-link-utils';
import type { DroneOpenedFileState } from './opened-file-types';

type OpenedDroneFilePanelProps = {
  droneId: string;
  file: DroneOpenedFileState;
  onFileContentChange?: (next: string) => void;
  onSaveFile?: (contentOverride?: string) => Promise<boolean>;
  onCloseFile?: () => void;
  onOpenResolvedFile?: (next: { path: string; name: string; line?: number | null; column?: number | null }) => void;
};

export function OpenedDroneFilePanel({
  droneId,
  file,
  onFileContentChange,
  onSaveFile,
  onCloseFile,
  onOpenResolvedFile,
}: OpenedDroneFilePanelProps) {
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
  const openedFileIsMarkdown = openedEditorIsText && isMarkdownPath(activeFilePath);
  const [openedTextMode, setOpenedTextMode] = React.useState<TextFileViewMode>('edit');
  const editorRef = React.useRef<any>(null);
  const [openedFileImageZoom, setOpenedFileImageZoom] = React.useState(1);
  const [openedFileImagePan, setOpenedFileImagePan] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [openedFileImagePanning, setOpenedFileImagePanning] = React.useState(false);
  const openedFileImagePanDragRef = React.useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  React.useEffect(() => {
    if (!activeFilePath || !openedEditorIsText) {
      setOpenedTextMode('edit');
      return;
    }
    setOpenedTextMode(defaultTextFileViewModeForPath(activeFilePath));
  }, [activeFilePath, fileNavigationSeq, openedEditorIsText]);

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
  const openedFileEditorVisible = openedEditorIsText && !openedFileShowsMarkdownPreview;
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
    const line = Math.min(Math.max(1, fileTargetLine), Number.isFinite(maxLine) && maxLine > 0 ? maxLine : fileTargetLine);
    const requestedColumn = fileTargetColumn ?? 1;
    const maxColumn = Number(model?.getLineMaxColumn?.(line) ?? requestedColumn);
    const column = Math.min(Math.max(1, requestedColumn), Number.isFinite(maxColumn) && maxColumn > 0 ? maxColumn : requestedColumn);
    editor.setPosition?.({ lineNumber: line, column });
    editor.revealPositionInCenter?.({ lineNumber: line, column });
    editor.focus?.();
  }, [activeFilePath, fileTargetColumn, fileTargetLine, openedFileEditorVisible]);

  React.useEffect(() => {
    if (!openedFileEditorVisible) editorRef.current = null;
  }, [openedFileEditorVisible]);

  React.useEffect(() => {
    if (!openedFileEditorVisible || Boolean(fileLoading) || !activeFilePath || !fileTargetLine) return;
    if (!fileNavigationSeq) return;
    applyEditorCursorTarget();
  }, [activeFilePath, applyEditorCursorTarget, fileLoading, fileNavigationSeq, fileTargetLine, openedFileEditorVisible]);

  React.useEffect(() => {
    if (!openedFileEditorVisible || Boolean(fileLoading) || !activeFilePath || fileTargetLine) return;
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

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onCloseFile}
          className="h-7 px-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--panel-alt)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] whitespace-nowrap"
          title="Back to file list"
        >
          Back to files
        </button>
        <div className="flex items-center gap-1.5">
          {openedFileIsMarkdown ? (
            <SegmentedToolbarToggle
              label="Mode"
              value={openedTextMode}
              options={[
                { value: 'preview', label: 'Preview', title: 'Render markdown preview' },
                { value: 'edit', label: 'Edit', title: 'Edit markdown source' },
              ]}
              onChange={setOpenedTextMode}
              disabled={Boolean(fileLoading)}
            />
          ) : null}
          {openedEditorIsText ? (
            <button
              type="button"
              onClick={() => {
                void onSaveFile?.();
              }}
              disabled={Boolean(fileLoading) || Boolean(fileSaving) || !fileDirty || !onSaveFile}
              className={`h-7 px-2.5 rounded-md border text-[10px] font-semibold tracking-wide uppercase transition-colors ${
                fileLoading || fileSaving || !fileDirty || !onSaveFile
                  ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
                  : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:shadow-[var(--glow-accent)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Save file (Ctrl/Cmd+S)"
            >
              Save
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 flex-1 min-h-0 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] flex flex-col">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
          <div className="text-[10px] text-[var(--muted-dim)] uppercase tracking-wide" style={{ fontFamily: 'var(--display)' }}>
            {fileName
              ? `${openedFileShowsMarkdownPreview ? 'Previewing' : 'Editing'} ${fileName}`
              : openedFileShowsMarkdownPreview
                ? 'Previewing file'
                : 'Editing file'}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--fg-secondary)] font-mono truncate" title={activeFilePath || undefined}>
            {activeFilePath}
          </div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">
            {openedEditorIsText
              ? fileSaving
                ? 'Saving...'
                : fileDirty
                  ? `${openedFileShowsMarkdownPreview ? 'Preview mode' : 'Edit mode'} • Unsaved changes`
                  : `${openedFileShowsMarkdownPreview ? 'Preview mode' : 'Edit mode'} • Saved • ${formatEditorMtime(fileMtimeMs ?? null)}`
              : `Preview${fileMime ? ` • ${fileMime}` : ''}${(fileSize ?? 0) > 0 ? ` • ${formatBytes(fileSize)}` : ''}`}
          </div>
        </div>
        {fileError ? (
          <div className="m-3 rounded border border-[rgba(255,90,90,.24)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">
            {fileError}
          </div>
        ) : null}
        <div className="flex-1 min-h-[360px] border-t border-[var(--border-subtle)]">
          {fileLoading ? (
            <div className="h-full w-full flex items-center justify-center text-[12px] text-[var(--muted)]">Loading file...</div>
          ) : fileKind === 'image' && openedFileMediaSrc ? (
            <div
              className="h-full w-full p-3 flex items-center justify-center select-none"
              style={{ cursor: openedFileImageZoom > 1 ? (openedFileImagePanning ? 'grabbing' : 'grab') : 'default' }}
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
              <video
                src={openedFileMediaSrc}
                controls
                className="max-w-full max-h-full rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)]"
              />
            </div>
          ) : fileKind === 'binary' ? (
            <div className="h-full w-full flex items-center justify-center px-6">
              <div className="max-w-[560px] rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-4 py-3 text-center">
                <div className="text-[12px] text-[var(--fg-secondary)]">Binary file preview is not available.</div>
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
          ) : (
            <Editor
              path={activeFilePath || undefined}
              language={editorLanguageForPath(activeFilePath)}
              value={fileContent ?? ''}
              onChange={(next) => onFileContentChange?.(next ?? '')}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                  void onSaveFile?.(editor.getValue());
                });
                applyEditorCursorTarget();
              }}
              theme="vs-dark"
              options={{
                readOnly: Boolean(fileSaving),
                fontSize: 12,
                minimap: { enabled: false },
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 12, bottom: 12 },
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
