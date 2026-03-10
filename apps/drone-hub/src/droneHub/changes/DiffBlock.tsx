import React from 'react';
import { Decoration, Diff, Hunk, expandFromRawCode, getCollapsedLinesCountBetween, markEdits, parseDiff, tokenize } from 'react-diff-view';
import type { FileData, HunkData, HunkTokens, RenderGutter } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import refractor from 'refractor';
import { diffLanguageForPath } from '../code-languages';
import type { DiffExpansionRange, DiffState, DiffViewType } from './types';

const GAP_STEP_SMALL = 10;
const GAP_STEP_MEDIUM = 20;

type HiddenBlockKind = 'top' | 'middle' | 'bottom';

type HiddenBlockAction = {
  key: string;
  label: string;
  title: string;
  range: DiffExpansionRange;
};

function normalizeDiffFilePath(rawPath: string | null | undefined): string | null {
  const path = String(rawPath ?? '').trim();
  if (!path || path === '/dev/null') return null;
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2);
  return path;
}

function pathForParsedDiffFile(file: FileData, fallbackPath: string | null | undefined): string | null {
  return normalizeDiffFilePath(file.newPath) ?? normalizeDiffFilePath(file.oldPath) ?? normalizeDiffFilePath(fallbackPath);
}

function fileRenderKey(file: FileData, index: number): string {
  return `${file.oldPath ?? ''}\u0000${file.newPath ?? ''}\u0000${index}`;
}

function splitSourceLines(source: string): string[] {
  const normalized = source.replace(/\r\n/g, '\n');
  if (!normalized) return [];
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) lines.pop();
  return lines;
}

function tokenizeDiffFile(file: FileData, fallbackPath: string | null | undefined): HunkTokens | null {
  const language = diffLanguageForPath(pathForParsedDiffFile(file, fallbackPath) ?? '');
  if (!language) return null;
  try {
    return tokenize(file.hunks, {
      highlight: true,
      refractor,
      language,
      enhancers: [markEdits(file.hunks)],
    });
  } catch {
    return null;
  }
}

function dedupeHiddenBlockActions(actions: HiddenBlockAction[]): HiddenBlockAction[] {
  const seen = new Set<string>();
  const output: HiddenBlockAction[] = [];
  for (const action of actions) {
    const key = `${action.range.start}:${action.range.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(action);
  }
  return output;
}

function buildHiddenBlockActions(kind: HiddenBlockKind, start: number, end: number): HiddenBlockAction[] {
  const hiddenLines = Math.max(0, end - start);
  if (hiddenLines <= 0) return [];

  const actions: HiddenBlockAction[] = [];
  const push = (key: string, label: string, range: DiffExpansionRange, title: string) => {
    if (range.end <= range.start) return;
    actions.push({ key, label, range, title });
  };

  if (kind === 'top') {
    if (hiddenLines > GAP_STEP_SMALL) {
      push(
        'near-10',
        '10',
        { start: Math.max(start, end - GAP_STEP_SMALL), end },
        'Expand 10 lines closest to this hunk',
      );
    }
    if (hiddenLines > GAP_STEP_MEDIUM) {
      push(
        'near-20',
        '20',
        { start: Math.max(start, end - GAP_STEP_MEDIUM), end },
        'Expand 20 lines closest to this hunk',
      );
    }
    push('all', 'All', { start, end }, 'Expand this entire hidden block');
    return dedupeHiddenBlockActions(actions);
  }

  if (kind === 'middle') {
    if (hiddenLines > GAP_STEP_SMALL) {
      push(
        'top-10',
        'Top 10',
        { start, end: Math.min(end, start + GAP_STEP_SMALL) },
        'Expand 10 lines from the top of this hidden block',
      );
      push(
        'bottom-10',
        'Bottom 10',
        { start: Math.max(start, end - GAP_STEP_SMALL), end },
        'Expand 10 lines from the bottom of this hidden block',
      );
    }
    push('all', 'All', { start, end }, 'Expand this entire hidden block');
    return dedupeHiddenBlockActions(actions);
  }

  if (hiddenLines > GAP_STEP_SMALL) {
    push(
      'next-10',
      '10',
      { start, end: Math.min(end, start + GAP_STEP_SMALL) },
      'Expand the next 10 hidden lines',
    );
  }
  if (hiddenLines > GAP_STEP_MEDIUM) {
    push(
      'next-20',
      '20',
      { start, end: Math.min(end, start + GAP_STEP_MEDIUM) },
      'Expand the next 20 hidden lines',
    );
  }
  push('all', 'All', { start, end }, 'Expand this entire hidden block');
  return dedupeHiddenBlockActions(actions);
}

function GapActionButton({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-full border border-[var(--border-subtle)] bg-transparent px-2 py-[1px] text-[9px] font-semibold tracking-wide text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,.03)] disabled:opacity-40 disabled:cursor-wait"
      title={title}
    >
      {label}
    </button>
  );
}

function GapRow({
  hiddenLines,
  loading,
  actions,
  onAction,
}: {
  hiddenLines: number;
  loading: boolean;
  actions: HiddenBlockAction[];
  onAction: (action: HiddenBlockAction) => void;
}) {
  return (
    <div className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[10px] text-[var(--muted)]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[10px] leading-none text-[var(--muted-dim)]">
          +
        </span>
        <span className="truncate text-[var(--muted-dim)]">{loading ? 'Expanding...' : `${hiddenLines} hidden line${hiddenLines === 1 ? '' : 's'}`}</span>
      </div>
      <div className="inline-flex items-center gap-1 shrink-0">
        {actions.map((action) => (
          <GapActionButton
            key={action.key}
            label={action.label}
            title={action.title}
            disabled={loading}
            onClick={() => onAction(action)}
          />
        ))}
      </div>
    </div>
  );
}

const renderDiffGutter: RenderGutter = ({ change, side, renderDefault, wrapInAnchor }) => {
  const marker =
    change.type === 'insert' ? (side === 'new' ? '+' : '') : change.type === 'delete' ? (side === 'old' ? '-' : '') : '';
  const markerClassName =
    marker === '+' ? 'dh-diff-gutter-sign-insert' : marker === '-' ? 'dh-diff-gutter-sign-delete' : 'dh-diff-gutter-sign-neutral';
  return wrapInAnchor(
    <span className="dh-diff-gutter-content">
      <span className={`dh-diff-gutter-sign ${markerClassName}`} aria-hidden="true">
        {marker}
      </span>
      <span className="dh-diff-gutter-line">{renderDefault()}</span>
    </span>,
  );
};

export function DiffBlock({
  state,
  filePath,
  viewType = 'unified',
  expansionSourceId,
  loadExpansionSource,
  expansionRanges = [],
  onAddExpansionRange,
}: {
  state: DiffState | undefined;
  filePath?: string | null;
  viewType?: DiffViewType;
  expansionSourceId?: string | null;
  loadExpansionSource?: (() => Promise<string | null>) | null;
  expansionRanges?: DiffExpansionRange[];
  onAddExpansionRange?: ((range: DiffExpansionRange) => void) | null;
}) {
  const rawText = state?.status === 'loaded' ? state.text : '';
  const parsed = React.useMemo<FileData[]>(() => {
    if (!rawText) return [];
    try {
      return parseDiff(rawText);
    } catch {
      return [];
    }
  }, [rawText]);

  const [sourceLines, setSourceLines] = React.useState<string[] | null>(null);
  const [expandingActionKey, setExpandingActionKey] = React.useState<string | null>(null);
  const [expansionError, setExpansionError] = React.useState<string | null>(null);
  const sourceLoadRef = React.useRef<Promise<string[] | null> | null>(null);

  React.useEffect(() => {
    setSourceLines(null);
    setExpandingActionKey(null);
    setExpansionError(null);
    sourceLoadRef.current = null;
  }, [expansionSourceId, filePath, rawText]);

  const ensureSourceLines = React.useCallback(
    async (showError: boolean): Promise<string[] | null> => {
      if (sourceLines !== null) return sourceLines;
      if (!loadExpansionSource) return null;
      if (sourceLoadRef.current) return sourceLoadRef.current;

      const request = Promise.resolve(loadExpansionSource())
        .then((source) => {
          const next = typeof source === 'string' ? splitSourceLines(source) : [];
          setSourceLines(next);
          return next;
        })
        .catch((error: any) => {
          if (showError) {
            setExpansionError(error?.message ?? String(error));
          }
          return null;
        })
        .finally(() => {
          sourceLoadRef.current = null;
        });

      sourceLoadRef.current = request;
      return request;
    },
    [loadExpansionSource, sourceLines],
  );

  React.useEffect(() => {
    if (!loadExpansionSource || parsed.length === 0) return;
    if (!parsed.some((file) => file.type !== 'add' && Array.isArray(file.hunks) && file.hunks.length > 0)) return;
    void ensureSourceLines(false);
  }, [ensureSourceLines, loadExpansionSource, parsed]);

  const renderedFiles = React.useMemo<FileData[]>(
    () =>
      parsed.map((file) => {
        if (!sourceLines || expansionRanges.length === 0) return file;
        const expandedHunks = expansionRanges.reduce(
          (hunks, range) => expandFromRawCode(hunks, sourceLines, range.start, range.end),
          file.hunks,
        );
        return { ...file, hunks: expandedHunks };
      }),
    [expansionRanges, parsed, sourceLines],
  );

  const tokensByFile = React.useMemo<Array<HunkTokens | null>>(
    () => renderedFiles.map((file) => tokenizeDiffFile(file, filePath ?? null)),
    [renderedFiles, filePath],
  );

  const hasRenderableHunks = React.useMemo(
    () => renderedFiles.some((file) => Array.isArray(file.hunks) && file.hunks.length > 0),
    [renderedFiles],
  );

  const expandHiddenBlock = React.useCallback(
    async ({
      action,
      actionKey,
    }: {
      action: HiddenBlockAction;
      actionKey: string;
    }) => {
      if (!onAddExpansionRange) return;
      setExpandingActionKey(actionKey);
      setExpansionError(null);
      try {
        const lines = await ensureSourceLines(true);
        if (!lines) return;
        onAddExpansionRange(action.range);
      } finally {
        setExpandingActionKey((prev) => (prev === actionKey ? null : prev));
      }
    },
    [ensureSourceLines, onAddExpansionRange],
  );

  const renderCollapsedDecoration = React.useCallback(
    ({
      file,
      fileKey,
      kind,
      previousHunk,
      nextHunk,
    }: {
      file: FileData;
      fileKey: string;
      kind: HiddenBlockKind;
      previousHunk?: HunkData | null;
      nextHunk?: HunkData | null;
    }): React.ReactElement | null => {
      if (kind === 'bottom' && file.type === 'add') return null;

      const start = kind === 'top' ? 1 : previousHunk ? previousHunk.oldStart + previousHunk.oldLines : 1;
      const end =
        kind === 'top'
          ? (nextHunk?.oldStart ?? 1)
          : kind === 'middle'
            ? (nextHunk?.oldStart ?? start)
            : sourceLines !== null
              ? sourceLines.length + 1
              : null;

      const hiddenLines =
        kind === 'top'
          ? Math.max(0, (nextHunk?.oldStart ?? 1) - 1)
          : kind === 'middle' && previousHunk && nextHunk
            ? Math.max(0, getCollapsedLinesCountBetween(previousHunk, nextHunk))
            : kind === 'bottom' && sourceLines !== null
              ? Math.max(0, sourceLines.length - start + 1)
              : null;

      if (hiddenLines === null || hiddenLines <= 0 || end === null || end <= start) return null;

      const actions = buildHiddenBlockActions(kind, start, end);
      if (actions.length === 0) return null;

      const actionKeyBase = `${fileKey}\u0000${kind}\u0000${start}\u0000${end}`;
      const loading = expandingActionKey !== null && expandingActionKey.startsWith(actionKeyBase);
      return (
        <Decoration key={actionKeyBase}>
          <span className="inline-flex items-center justify-center w-full h-full text-[var(--muted-dim)]">+</span>
          <GapRow
            hiddenLines={hiddenLines}
            loading={loading}
            actions={actions}
            onAction={(action) => {
              void expandHiddenBlock({
                action,
                actionKey: `${actionKeyBase}\u0000${action.key}`,
              });
            }}
          />
        </Decoration>
      );
    },
    [expandHiddenBlock, expandingActionKey, sourceLines],
  );

  if (!state || state.status === 'loading') {
    return <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Loading diff...</div>;
  }

  if (state.status === 'error') {
    return <div className="px-3 py-3 text-[11px] text-[var(--red)]">{state.error}</div>;
  }

  if (!state.text) {
    const emptyMessage =
      state.noTextReason === 'binary'
        ? 'No textual diff: this file is binary.'
        : state.noTextReason === 'truncated'
          ? 'No textual diff: GitHub truncated this file patch.'
          : state.noTextReason === 'empty'
            ? 'No textual diff: this file has no line-level changes.'
            : state.noTextReason === 'unavailable'
              ? 'No textual diff: GitHub did not provide a patch for this file.'
              : 'No diff output for this selection. The file may be empty, non-text, or no longer present.';
    return <div className="px-3 py-3 text-[11px] text-[var(--muted)]">{emptyMessage}</div>;
  }

  const binaryDiffPattern = /(^|\n)(Binary files .* differ|GIT binary patch)(\n|$)/;
  if (state.isBinary || binaryDiffPattern.test(rawText)) {
    return (
      <div>
        <div className="px-3 py-2 text-[10px] text-[var(--muted)] border-b border-[var(--border-subtle)]">
          Binary file diff.
        </div>
        <pre className="m-0 p-3 text-[11px] leading-5 text-[var(--fg-secondary)] whitespace-pre-wrap break-words">{rawText}</pre>
      </div>
    );
  }

  if (parsed.length === 0 || !hasRenderableHunks) {
    return <pre className="m-0 p-3 text-[11px] leading-5 text-[var(--fg-secondary)] whitespace-pre-wrap break-words">{rawText}</pre>;
  }

  return (
    <div className="rdv-wrapper px-2 py-2">
      {expansionError ? (
        <div className="mb-2 px-2 py-1 rounded border border-[rgba(255,90,90,.28)] bg-[var(--red-subtle)] text-[10px] text-[var(--red)]">
          {expansionError}
        </div>
      ) : null}
      {renderedFiles.map((file, fileIndex) => {
        const fileKey = fileRenderKey(file, fileIndex);
        const canExpand = Boolean(loadExpansionSource && onAddExpansionRange) && file.type !== 'add';
        return (
          <Diff
            key={fileKey}
            viewType={viewType}
            diffType={file.type}
            hunks={file.hunks}
            tokens={tokensByFile[fileIndex] ?? null}
            renderGutter={renderDiffGutter}
          >
            {(hunks) => {
              const elements: React.ReactElement[] = [];
              if (canExpand && hunks.length > 0) {
                const top = renderCollapsedDecoration({ file, fileKey, kind: 'top', nextHunk: hunks[0] });
                if (top) elements.push(top);
              }
              hunks.forEach((hunk, hunkIndex) => {
                elements.push(<Hunk key={`${fileKey}\u0000hunk\u0000${hunkIndex}`} hunk={hunk} />);
                const nextHunk = hunks[hunkIndex + 1] ?? null;
                if (canExpand && nextHunk) {
                  const middle = renderCollapsedDecoration({
                    file,
                    fileKey,
                    kind: 'middle',
                    previousHunk: hunk,
                    nextHunk,
                  });
                  if (middle) elements.push(middle);
                }
              });
              if (canExpand && hunks.length > 0 && sourceLines !== null) {
                const bottom = renderCollapsedDecoration({
                  file,
                  fileKey,
                  kind: 'bottom',
                  previousHunk: hunks[hunks.length - 1],
                });
                if (bottom) elements.push(bottom);
              }
              return elements;
            }}
          </Diff>
        );
      })}
      {state.truncated ? (
        <div className="mt-2 px-2 py-1 rounded border border-[var(--yellow)]/30 bg-[var(--yellow-subtle)] text-[10px] text-[var(--yellow)]">
          Diff output is truncated.
        </div>
      ) : null}
    </div>
  );
}
