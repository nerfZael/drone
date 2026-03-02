import React from 'react';
import { Diff, Hunk, markEdits, parseDiff, tokenize } from 'react-diff-view';
import type { FileData, HunkTokens, RenderGutter } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import refractor from 'refractor';
import { diffLanguageForPath } from '../code-languages';

export type DiffNoTextReason = 'binary' | 'truncated' | 'empty' | 'unavailable';
export type DiffViewType = 'unified' | 'split';

export type DiffState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'loaded'; text: string; truncated: boolean; fromUntracked: boolean; isBinary: boolean; noTextReason: DiffNoTextReason | null };

function normalizeDiffFilePath(rawPath: string | null | undefined): string | null {
  const path = String(rawPath ?? '').trim();
  if (!path || path === '/dev/null') return null;
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2);
  return path;
}

function pathForParsedDiffFile(file: FileData, fallbackPath: string | null | undefined): string | null {
  return normalizeDiffFilePath(file.newPath) ?? normalizeDiffFilePath(file.oldPath) ?? normalizeDiffFilePath(fallbackPath);
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

export function DiffBlock({
  state,
  filePath,
  viewType = 'unified',
}: {
  state: DiffState | undefined;
  filePath?: string | null;
  viewType?: DiffViewType;
}) {
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
    return (
      <div className="px-3 py-3 text-[11px] text-[var(--muted)]">
        {emptyMessage}
      </div>
    );
  }

  const rawText = state.text;
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

  const parsed = React.useMemo<FileData[]>(() => {
    try {
      return parseDiff(rawText);
    } catch {
      return [];
    }
  }, [rawText]);
  const tokensByFile = React.useMemo<Array<HunkTokens | null>>(
    () => parsed.map((file) => tokenizeDiffFile(file, filePath ?? null)),
    [parsed, filePath],
  );
  const hasRenderableHunks = parsed.some((file) => Array.isArray(file.hunks) && file.hunks.length > 0);

  if (parsed.length === 0 || !hasRenderableHunks) {
    return <pre className="m-0 p-3 text-[11px] leading-5 text-[var(--fg-secondary)] whitespace-pre-wrap break-words">{rawText}</pre>;
  }

  const renderGutter = React.useCallback<RenderGutter>(({ change, side, renderDefault, wrapInAnchor }) => {
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
  }, []);

  return (
    <div className="rdv-wrapper px-2 py-2">
      {parsed.map((file, fileIndex) => (
        <Diff
          key={`${file.oldPath}-${file.newPath}-${fileIndex}`}
          viewType={viewType}
          diffType={file.type}
          hunks={file.hunks}
          tokens={tokensByFile[fileIndex] ?? null}
          renderGutter={renderGutter}
        >
          {(hunks) => hunks.map((hunk, hunkIndex) => <Hunk key={`${fileIndex}-${hunkIndex}`} hunk={hunk} />)}
        </Diff>
      ))}
      {state.truncated && (
        <div className="mt-2 px-2 py-1 rounded border border-[var(--yellow)]/30 bg-[var(--yellow-subtle)] text-[10px] text-[var(--yellow)]">
          Diff output is truncated.
        </div>
      )}
    </div>
  );
}
