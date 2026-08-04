import React from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import {
  allocateFitTableColumnWidths,
  type FitTableColumnMetric,
} from './table-layout.js';
import {
  numericTableColumnIndexes,
  stableSortTableRows,
  type NumericTableSortDirection,
} from './table-sort.js';

type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';
type TableMode = 'fit' | 'natural';
type TableSortState = {
  columnIndex: number;
  direction: NumericTableSortDirection;
};
type TablePropsSansChildren = Omit<React.ComponentProps<'table'>, 'children'>;
type ExpandedTableState = {
  id: string;
  children: React.ReactNode;
  props: TablePropsSansChildren;
};
const COMMON_FILE_BASENAMES = new Set([
  'dockerfile',
  'makefile',
  'readme',
  'readme.md',
  'license',
  'license.md',
  'package.json',
  'tsconfig.json',
  '.gitignore',
  'agents.md',
]);

const CALLOUT_LABEL: Record<CalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

function flattenText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((part) => flattenText(part)).join('');
  if (React.isValidElement(node)) {
    return flattenText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

function blockquoteCopyText(
  node: unknown,
  source: string,
  fallbackChildren: React.ReactNode,
): string {
  const position = (node as {
    position?: { start?: { offset?: number }; end?: { offset?: number } };
  } | null)?.position;
  const start = position?.start?.offset;
  const end = position?.end?.offset;
  if (typeof start === 'number' && typeof end === 'number' && end > start) {
    const quotedSource = source.slice(start, end);
    const unquoted = quotedSource
      .split('\n')
      .map((line) => line.replace(/^\s{0,3}>\s?/, ''))
      .join('\n')
      .replace(/^\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:\n|$)/i, '')
      .trim();
    if (unquoted) return unquoted;
  }
  return flattenText(fallbackChildren).trim();
}

function tableIdFromNode(node: unknown, children: React.ReactNode): string {
  const pos = (node as { position?: { start?: { offset?: number }; end?: { offset?: number } } } | null)?.position;
  const start = pos?.start?.offset;
  const end = pos?.end?.offset;
  if (typeof start === 'number' && typeof end === 'number') return `pos:${start}:${end}`;
  const text = flattenText(children).replace(/\s+/g, ' ').trim();
  return `text:${text.slice(0, 160)}:${text.length}`;
}

function fitTableColumnMetrics(children: React.ReactNode): FitTableColumnMetric[] {
  const rows: Array<Array<{ text: string; sortable: boolean }>> = [];

  const visit = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return;
      if (child.type === 'tr') {
        const cells = React.Children.toArray(child.props.children)
          .filter((cell) => React.isValidElement(cell))
          .map((cell) => ({
            text: flattenText(cell).replace(/\s+/g, ' ').trim(),
            sortable: Boolean(
              (cell.props as { markdownSortableHeader?: unknown }).markdownSortableHeader,
            ),
          }));
        if (cells.length > 0) rows.push(cells);
        return;
      }
      visit(child.props.children);
    });
  };

  visit(children);
  const columnCount = rows.reduce((largest, row) => Math.max(largest, row.length), 0);
  if (columnCount === 0) return [];

  // Fixed table layout is what guarantees that wrap mode never scrolls. Give
  // it explicit content-derived widths so it does not fall back to equal-width
  // columns. The square root dampens long prose. A pixel minimum derived from
  // the longest word protects compact labels and the cell's padding whenever
  // the complete set of column minima fits in the container.
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    let preferredWeight = 5;
    let longestWordLength = 2;
    let hasSortableHeader = false;
    for (const row of rows) {
      const cell = row[columnIndex];
      const text = cell?.text ?? '';
      hasSortableHeader ||= Boolean(cell?.sortable);
      const longestWord = text
        .split(/\s+/)
        .reduce((longest, word) => Math.max(longest, word.length), 0);
      const dampedLength = Math.ceil(Math.sqrt(text.length) * 3);
      preferredWeight = Math.max(
        preferredWeight,
        Math.min(30, Math.max(longestWord, dampedLength)),
      );
      longestWordLength = Math.max(longestWordLength, Math.min(16, longestWord));
    }
    return {
      preferredWeight,
      // Current cells have 20px of inline padding plus borders. Seven pixels
      // per character is conservative for the 10–12px table fonts.
      minimumWidth: 22 + longestWordLength * 7 + (hasSortableHeader ? 14 : 0),
    };
  });
}

function useFitTableColumnWidths(children: React.ReactNode) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = React.useState<number | null>(null);
  const metrics = React.useMemo(() => fitTableColumnMetrics(children), [children]);

  React.useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;

    const updateWidth = (width: number) => {
      const roundedWidth = roundWidthForLayout(width);
      setAvailableWidth((current) => (current === roundedWidth ? current : roundedWidth));
    };
    updateWidth(node.clientWidth);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        updateWidth(entries[0]?.contentRect.width ?? node.clientWidth);
      });
      observer.observe(node);
      return () => observer.disconnect();
    }

    const onResize = () => updateWidth(node.clientWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const columnWidths = React.useMemo(
    () => allocateFitTableColumnWidths(metrics, availableWidth),
    [availableWidth, metrics],
  );
  return { columnWidths, wrapRef };
}

function roundWidthForLayout(width: number): number {
  return Number(Math.max(0, width).toFixed(3));
}

type MarkdownSortableHeader = {
  direction: NumericTableSortDirection | null;
  onToggle: () => void;
};

type MarkdownTableStructure = {
  bodyRows: React.ReactElement[];
  bodyValues: string[][];
  columnCount: number;
  numericColumns: ReadonlySet<number>;
};

function directElementChildren(children: React.ReactNode): React.ReactElement[] {
  return React.Children.toArray(children).filter(React.isValidElement);
}

function intrinsicElementNamed(element: React.ReactElement, name: string): boolean {
  return typeof element.type === 'string' && element.type === name;
}

function markdownTableStructure(children: React.ReactNode): MarkdownTableStructure {
  const sections = directElementChildren(children);
  const thead = sections.find((element) => intrinsicElementNamed(element, 'thead')) ?? null;
  const tbody = sections.find((element) => intrinsicElementNamed(element, 'tbody')) ?? null;
  const headerRow = thead
    ? directElementChildren((thead.props as { children?: React.ReactNode }).children)
      .find((element) => intrinsicElementNamed(element, 'tr')) ?? null
    : null;
  const columnCount = headerRow
    ? directElementChildren((headerRow.props as { children?: React.ReactNode }).children).length
    : 0;
  const bodyRows = tbody
    ? directElementChildren((tbody.props as { children?: React.ReactNode }).children)
      .filter((element) => intrinsicElementNamed(element, 'tr'))
    : [];
  const bodyValues = bodyRows.map((row) =>
    directElementChildren((row.props as { children?: React.ReactNode }).children)
      .map((cell) => flattenText((cell.props as { children?: React.ReactNode }).children).trim()),
  );
  return {
    bodyRows,
    bodyValues,
    columnCount,
    numericColumns: new Set(numericTableColumnIndexes(bodyValues, columnCount)),
  };
}

function renderSortableTableChildren(
  children: React.ReactNode,
  structure: MarkdownTableStructure,
  sort: TableSortState | null,
  onSortChange: (sort: TableSortState | null) => void,
): React.ReactNode {
  const sortedRows = sort
    ? stableSortTableRows(
      structure.bodyRows,
      structure.bodyValues,
      sort.columnIndex,
      sort.direction,
    )
    : structure.bodyRows;

  return React.Children.map(children, (section) => {
    if (!React.isValidElement(section)) return section;
    if (intrinsicElementNamed(section, 'tbody')) {
      return React.cloneElement(section as React.ReactElement<{ children?: React.ReactNode }>, undefined, sortedRows);
    }
    if (!intrinsicElementNamed(section, 'thead')) return section;
    return React.cloneElement(
      section as React.ReactElement<{ children?: React.ReactNode }>,
      undefined,
      React.Children.map(
        (section.props as { children?: React.ReactNode }).children,
        (row) => {
          if (!React.isValidElement(row) || !intrinsicElementNamed(row, 'tr')) return row;
          let cellIndex = 0;
          return React.cloneElement(
            row as React.ReactElement<{ children?: React.ReactNode }>,
            undefined,
            React.Children.map(
              (row.props as { children?: React.ReactNode }).children,
              (cell) => {
                if (!React.isValidElement(cell)) return cell;
                const columnIndex = cellIndex;
                cellIndex += 1;
                if (!structure.numericColumns.has(columnIndex)) return cell;
                const direction = sort?.columnIndex === columnIndex
                  ? sort.direction
                  : null;
                const markdownSortableHeader: MarkdownSortableHeader = {
                  direction,
                  onToggle: () => onSortChange({
                    columnIndex,
                    direction: direction === 'ascending' ? 'descending' : 'ascending',
                  }),
                };
                return React.cloneElement(cell as React.ReactElement<Record<string, unknown>>, {
                  markdownSortableHeader,
                });
              },
            ),
          );
        },
      ),
    );
  });
}

function MarkdownTable({
  children,
  mode,
  sort,
  onModeChange,
  onSortChange,
  onOpenExpanded,
  ...props
}: React.ComponentProps<'table'> & {
  mode: TableMode;
  sort: TableSortState | null;
  onModeChange: (mode: TableMode) => void;
  onSortChange: (sort: TableSortState | null) => void;
  onOpenExpanded: () => void;
}) {
  const structure = React.useMemo(() => markdownTableStructure(children), [children]);
  const activeSort = sort && structure.numericColumns.has(sort.columnIndex) ? sort : null;
  const renderedChildren = React.useMemo(
    () => renderSortableTableChildren(children, structure, activeSort, onSortChange),
    [activeSort, children, onSortChange, structure],
  );
  const { columnWidths, wrapRef } = useFitTableColumnWidths(renderedChildren);
  return (
    <div className="dh-markdown-block dh-markdown-block--wide">
      <div className="dh-markdown-table-toolbar">
        <span className="dh-markdown-table-label">Table</span>
        <button
          type="button"
          className="dh-markdown-table-expand"
          title="Open this table in a larger scroll view"
          aria-label="Open table in expanded scroll view"
          onClick={onOpenExpanded}
        >
          Expand
        </button>
        {structure.numericColumns.size > 0 ? (
          <button
            type="button"
            className="dh-markdown-table-reset"
            title={activeSort ? 'Restore the original row order' : 'Table is already in its original order'}
            aria-label="Reset table sort"
            disabled={!activeSort}
            onClick={() => onSortChange(null)}
          >
            Reset
          </button>
        ) : null}
        <div className="dh-markdown-table-toggle" role="group" aria-label="Table display mode">
          <button
            type="button"
            className={`dh-markdown-table-toggle-button ${mode === 'fit' ? 'is-active' : ''}`}
            aria-pressed={mode === 'fit'}
            title="Wrap cell content to fit the table to the available width"
            aria-label="Wrap table to available width"
            onClick={() => onModeChange('fit')}
          >
            Wrap
          </button>
          <button
            type="button"
            className={`dh-markdown-table-toggle-button ${mode === 'natural' ? 'is-active' : ''}`}
            aria-pressed={mode === 'natural'}
            title="Keep natural column widths and allow horizontal scrolling"
            aria-label="Scroll table horizontally using natural column widths"
            onClick={() => onModeChange('natural')}
          >
            Scroll
          </button>
        </div>
      </div>
      <div ref={wrapRef} className={`dh-markdown-table-wrap dh-markdown-table-wrap--${mode}`}>
        <table className={`dh-markdown-table dh-markdown-table--${mode}`} {...props}>
          {mode === 'fit' && columnWidths.length > 0 ? (
            <colgroup>
              {columnWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
          ) : null}
          {renderedChildren}
        </table>
      </div>
    </div>
  );
}

function ExpandedMarkdownTableDialog({
  table,
  mode,
  sort,
  onModeChange,
  onSortChange,
  onClose,
}: {
  table: ExpandedTableState;
  mode: TableMode;
  sort: TableSortState | null;
  onModeChange: (mode: TableMode) => void;
  onSortChange: (sort: TableSortState | null) => void;
  onClose: () => void;
}) {
  const structure = React.useMemo(
    () => markdownTableStructure(table.children),
    [table.children],
  );
  const activeSort = sort && structure.numericColumns.has(sort.columnIndex) ? sort : null;
  const renderedChildren = React.useMemo(
    () => renderSortableTableChildren(table.children, structure, activeSort, onSortChange),
    [activeSort, onSortChange, structure, table.children],
  );
  const { columnWidths, wrapRef } = useFitTableColumnWidths(renderedChildren);
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="dh-markdown-table-dialog" role="dialog" aria-modal="true" aria-label="Expanded table view" onClick={onClose}>
      <div className="dh-markdown dh-markdown-table-dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dh-markdown-table-dialog-header">
          <div>
            <div className="dh-markdown-table-dialog-title">Expanded Table</div>
            <div className="dh-markdown-table-dialog-subtitle">Use wrap or scroll mode in a much wider viewport</div>
          </div>
          <div className="dh-markdown-table-dialog-actions">
            {structure.numericColumns.size > 0 ? (
              <button
                type="button"
                className="dh-markdown-table-reset"
                title={activeSort ? 'Restore the original row order' : 'Table is already in its original order'}
                aria-label="Reset table sort"
                disabled={!activeSort}
                onClick={() => onSortChange(null)}
              >
                Reset
              </button>
            ) : null}
            <div className="dh-markdown-table-toggle" role="group" aria-label="Expanded table display mode">
              <button
                type="button"
                className={`dh-markdown-table-toggle-button ${mode === 'fit' ? 'is-active' : ''}`}
                aria-pressed={mode === 'fit'}
                title="Wrap cell content to fit the table to the available width"
                aria-label="Wrap expanded table to available width"
                onClick={() => onModeChange('fit')}
              >
                Wrap
              </button>
              <button
                type="button"
                className={`dh-markdown-table-toggle-button ${mode === 'natural' ? 'is-active' : ''}`}
                aria-pressed={mode === 'natural'}
                title="Keep natural column widths and allow horizontal scrolling"
                aria-label="Scroll expanded table horizontally using natural column widths"
                onClick={() => onModeChange('natural')}
              >
                Scroll
              </button>
            </div>
            <button
              type="button"
              className="dh-markdown-table-dialog-close"
              onClick={onClose}
              aria-label="Close expanded table view"
            >
              Close
            </button>
          </div>
        </div>
        <div ref={wrapRef} className={`dh-markdown-table-wrap dh-markdown-table-wrap--${mode}`}>
          <table className={`dh-markdown-table dh-markdown-table--${mode}`} {...table.props}>
            {mode === 'fit' && columnWidths.length > 0 ? (
              <colgroup>
                {columnWidths.map((width, index) => (
                  <col key={index} style={{ width }} />
                ))}
              </colgroup>
            ) : null}
            {renderedChildren}
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function detectCalloutKind(node: React.ReactNode): CalloutKind | null {
  const text = flattenText(node).trimStart();
  const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(text);
  if (!m) return null;
  return String(m[1]).toLowerCase() as CalloutKind;
}

function stripLeadingCalloutMarker(node: React.ReactNode): React.ReactNode {
  let stripped = false;
  const marker = /^\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

  const strip = (value: React.ReactNode): React.ReactNode => {
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const raw = String(value);
      if (stripped) return raw;
      const next = raw.replace(marker, '');
      if (next !== raw) stripped = true;
      return next;
    }
    if (Array.isArray(value)) return value.map((part) => strip(part));
    if (React.isValidElement(value)) {
      const child = (value.props as { children?: React.ReactNode }).children;
      return React.cloneElement(value as React.ReactElement<any>, undefined, strip(child));
    }
    return value;
  };

  return strip(node);
}

function parseInlineCodeLinkHref(raw: string): string | null {
  const candidate = String(raw ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type MarkdownFileReference = {
  raw: string;
  path: string;
  line: number | null;
  column: number | null;
};

export type MarkdownTextMentionLink = {
  key: string;
  label: string;
  title?: string;
};

export type MarkdownBlockCopyActionRenderer = (text: string) => React.ReactNode;

export type MarkdownCodeBlockRenderer = (input: {
  code: string;
  language: string;
}) => React.ReactElement;

export type MarkdownMessageProps = {
  text: string;
  className?: string;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  textMentionLinks?: MarkdownTextMentionLink[];
  onOpenTextMention?: (mention: MarkdownTextMentionLink) => void;
  renderBlockCopyAction?: MarkdownBlockCopyActionRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
  preferOpenLinkBeforeModifiedClick?: boolean;
};

type PreparedTextMentionLink = MarkdownTextMentionLink & {
  lowerLabel: string;
};

function prepareTextMentionLinks(links: MarkdownTextMentionLink[] | undefined): PreparedTextMentionLink[] {
  const seen = new Set<string>();
  return (Array.isArray(links) ? links : [])
    .map((link) => ({
      ...link,
      key: String(link.key ?? '').trim(),
      label: String(link.label ?? '').trim(),
      lowerLabel: String(link.label ?? '').trim().toLowerCase(),
    }))
    .filter((link) => {
      if (!link.key || !link.label || seen.has(link.lowerLabel)) return false;
      seen.add(link.lowerLabel);
      return true;
    })
    .sort((a, b) => b.label.length - a.label.length || a.label.localeCompare(b.label));
}

function isMentionBoundaryChar(value: string): boolean {
  return !/[A-Za-z0-9_-]/.test(value);
}

function hasMentionBoundary(text: string, index: number, label: string): boolean {
  const before = index > 0 ? text[index - 1] ?? '' : '';
  const afterIndex = index + label.length;
  const after = afterIndex < text.length ? text[afterIndex] ?? '' : '';
  return (!before || isMentionBoundaryChar(before)) && (!after || isMentionBoundaryChar(after));
}

function splitTextMentionLinks(
  text: string,
  mentions: PreparedTextMentionLink[],
  onOpenTextMention: ((mention: MarkdownTextMentionLink) => void) | undefined,
): React.ReactNode {
  if (!text || mentions.length === 0 || !onOpenTextMention) return text;
  const lowerText = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let partIndex = 0;

  while (cursor < text.length) {
    let match: PreparedTextMentionLink | null = null;
    for (const mention of mentions) {
      if (!lowerText.startsWith(mention.lowerLabel, cursor)) continue;
      if (!hasMentionBoundary(text, cursor, mention.label)) continue;
      match = mention;
      break;
    }

    if (!match) {
      cursor += 1;
      continue;
    }

    if (cursor > partIndex) parts.push(text.slice(partIndex, cursor));
    const label = text.slice(cursor, cursor + match.label.length);
    parts.push(
      <button
        key={`${match.key}:${cursor}`}
        type="button"
        className="dh-markdown-text-mention"
        title={match.title ?? `Ctrl-click ${match.label}`}
        aria-label={match.title ?? `Ctrl-click ${match.label}`}
        onClick={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenTextMention(match);
        }}
      >
        {label}
      </button>,
    );
    cursor += match.label.length;
    partIndex = cursor;
  }

  if (parts.length === 0) return text;
  if (partIndex < text.length) parts.push(text.slice(partIndex));
  return parts;
}

function renderTextMentionChildren(
  children: React.ReactNode,
  mentions: PreparedTextMentionLink[],
  onOpenTextMention: ((mention: MarkdownTextMentionLink) => void) | undefined,
): React.ReactNode {
  if (mentions.length === 0 || !onOpenTextMention) return children;
  if (typeof children === 'string') return splitTextMentionLinks(children, mentions, onOpenTextMention);
  if (typeof children === 'number') return splitTextMentionLinks(String(children), mentions, onOpenTextMention);
  if (!Array.isArray(children)) return children;
  return children.map((child, index) => (
    <React.Fragment key={React.isValidElement(child) && child.key != null ? child.key : index}>
      {renderTextMentionChildren(child, mentions, onOpenTextMention)}
    </React.Fragment>
  ));
}

function isLikelyFilePath(raw: string): boolean {
  const candidate = String(raw ?? '').trim();
  if (!candidate || /\s/.test(candidate) || candidate.includes('\0')) return false;
  if (candidate.startsWith('~')) return false;
  if (/^https?:\/\//i.test(candidate)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return false;
  const normalized = candidate.replace(/\\/g, '/');
  const segs = normalized.split('/').filter(Boolean);
  if (segs.some((seg) => seg === '..')) return false;
  const base = (segs.length ? segs[segs.length - 1] : normalized).toLowerCase();
  if (COMMON_FILE_BASENAMES.has(base)) return true;
  if (normalized.includes('/')) return true;
  if (/\.[a-z0-9_-]{1,12}$/i.test(base)) return true;
  return false;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizeFileRefPath(raw: string): string {
  let next = String(raw ?? '').trim().replace(/\\/g, '/');
  if (next.startsWith('./')) next = next.slice(2);
  next = next.replace(/\/+/g, '/');
  if (next.length > 1 && next.endsWith('/')) next = next.slice(0, -1);
  return next;
}

function parseInlineCodeFileReference(raw: string): MarkdownFileReference | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let pathToken = text;
  let line: number | null = null;
  let column: number | null = null;

  const hashMatch = /^(.*)#L(\d+)(?:C(\d+))?$/i.exec(pathToken);
  if (hashMatch) {
    pathToken = String(hashMatch[1] ?? '').trim();
    line = parsePositiveInt(hashMatch[2]);
    column = parsePositiveInt(hashMatch[3]);
  } else {
    const lineSuffix = /:(\d+)(?::(\d+))?$/.exec(pathToken);
    if (lineSuffix && typeof lineSuffix.index === 'number') {
      const maybePath = pathToken.slice(0, lineSuffix.index).trim();
      if (isLikelyFilePath(maybePath)) {
        pathToken = maybePath;
        line = parsePositiveInt(lineSuffix[1]);
        column = parsePositiveInt(lineSuffix[2]);
      }
    }
  }

  if (!isLikelyFilePath(pathToken)) return null;
  const normalizedPath = normalizeFileRefPath(pathToken);
  if (!normalizedPath || normalizedPath === '/' || normalizedPath.includes('/../') || normalizedPath.startsWith('../') || normalizedPath.startsWith('/..')) {
    return null;
  }
  return { raw: text, path: normalizedPath, line, column };
}

function normalizeLooseNestedBullets(rawText: string): string {
  const text = String(rawText ?? '');
  if (!text.includes('\n')) return text;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let changed = false;

  for (let i = 0; i < lines.length - 1; i++) {
    const parent = /^(\s*)\d+[.)]\s+.+$/.exec(lines[i] ?? '');
    if (!parent) continue;
    const parentIndent = String(parent[1] ?? '').length;
    const next = /^(\s*)[-+*]\s+.+$/.exec(lines[i + 1] ?? '');
    if (!next) continue;
    const nextIndent = String(next[1] ?? '').length;
    if (nextIndent > parentIndent) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
      if (!line.trim()) continue;
      const bullet = /^(\s*)[-+*]\s+.+$/.exec(line);
      if (bullet) {
        const bulletIndent = String(bullet[1] ?? '').length;
        if (bulletIndent <= parentIndent) {
          lines[j] = `${' '.repeat(parentIndent + 3)}${line.trimStart()}`;
          changed = true;
        }
        continue;
      }
      const ordered = /^(\s*)\d+[.)]\s+.+$/.exec(line);
      const lineIndent = (line.match(/^\s*/)?.[0].length ?? 0);
      if (ordered && String(ordered[1] ?? '').length <= parentIndent) break;
      if (lineIndent <= parentIndent) break;
    }
  }

  return changed ? lines.join('\n') : text;
}

type MarkdownCodeRenderContextValue = {
  handleAnchorClick: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  onOpenFileReference: MarkdownMessageProps['onOpenFileReference'];
  renderCodeBlock: MarkdownMessageProps['renderCodeBlock'];
  renderMentionChildren: (children: React.ReactNode) => React.ReactNode;
  renderBlockCopyAction: MarkdownMessageProps['renderBlockCopyAction'];
  normalizedText: string;
  tableModes: Record<string, TableMode>;
  setTableMode: (tableId: string, mode: TableMode) => void;
  tableSorts: Record<string, TableSortState>;
  setTableSort: (tableId: string, sort: TableSortState | null) => void;
  openExpandedTable: (table: ExpandedTableState) => void;
};

const MarkdownCodeRenderContext = React.createContext<MarkdownCodeRenderContextValue | null>(null);

function StableMarkdownCode({
  children,
  className: codeClassName,
  node: _node,
  ...props
}: React.ComponentProps<'code'> & { node?: unknown }) {
  const context = React.useContext(MarkdownCodeRenderContext);
  const raw = flattenText(children);
  const hasLanguageClass = typeof codeClassName === 'string' && codeClassName.includes('language-');
  const isInline = !hasLanguageClass && !raw.includes('\n');
  if (!isInline && context?.renderCodeBlock) {
    const language = /(?:^|\s)language-([^\s]+)/.exec(codeClassName ?? '')?.[1] ?? '';
    return context.renderCodeBlock({ code: raw.replace(/\n$/, ''), language });
  }

  const href = isInline ? parseInlineCodeLinkHref(raw) : null;
  if (href) {
    return (
      <a
        className="dh-inline-code-link"
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open link ${href}`}
        onClick={(event) => context?.handleAnchorClick(event, href)}
      >
        <code className={codeClassName} {...props}>
          {raw}
        </code>
      </a>
    );
  }

  const fileRef = isInline ? parseInlineCodeFileReference(raw) : null;
  if (fileRef && context?.onOpenFileReference) {
    const targetDescription =
      fileRef.line == null
        ? fileRef.path
        : `${fileRef.path}:${fileRef.line}${fileRef.column == null ? '' : `:${fileRef.column}`}`;
    return (
      <button
        type="button"
        className="dh-inline-code-file-link"
        onClick={() => context.onOpenFileReference?.(fileRef)}
        title={`Open ${targetDescription}`}
        aria-label={`Open file ${targetDescription}`}
      >
        <code className={codeClassName} {...props}>
          {raw}
        </code>
      </button>
    );
  }

  return (
    <code className={codeClassName} {...props}>
      {children}
    </code>
  );
}

function StableMarkdownPre({
  children,
  node: _node,
  ...props
}: React.ComponentProps<'pre'> & { node?: unknown }) {
  const context = React.useContext(MarkdownCodeRenderContext);
  const childList = React.Children.toArray(children);
  const onlyChild = childList.length === 1 ? childList[0] : null;
  if (
    React.isValidElement(onlyChild) &&
    (context?.renderCodeBlock ||
      (onlyChild.props as Record<string, unknown>)['data-markdown-code-block'] === true)
  ) {
    return <div className="dh-markdown-block dh-markdown-block--wide">{onlyChild}</div>;
  }
  return (
    <div className="dh-markdown-block dh-markdown-block--wide">
      <pre {...props}>{children}</pre>
    </div>
  );
}

type MarkdownElementProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentProps<Tag> & { node?: unknown };

function StableMarkdownParagraph({ children, node: _node, ...props }: MarkdownElementProps<'p'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  return <p {...props}>{context?.renderMentionChildren(children) ?? children}</p>;
}

function StableMarkdownListItem({ children, node: _node, ...props }: MarkdownElementProps<'li'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  return <li {...props}>{context?.renderMentionChildren(children) ?? children}</li>;
}

function StableMarkdownTableCell({ children, node: _node, ...props }: MarkdownElementProps<'td'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  return <td {...props}>{context?.renderMentionChildren(children) ?? children}</td>;
}

function StableMarkdownTableHeader({
  children,
  node: _node,
  markdownSortableHeader,
  ...props
}: MarkdownElementProps<'th'> & { markdownSortableHeader?: MarkdownSortableHeader }) {
  const context = React.useContext(MarkdownCodeRenderContext);
  const renderedChildren = context?.renderMentionChildren(children) ?? children;
  if (!markdownSortableHeader) return <th {...props}>{renderedChildren}</th>;
  const { direction, onToggle } = markdownSortableHeader;
  const label = flattenText(children).replace(/\s+/g, ' ').trim() || 'column';
  const nextDirection = direction === 'ascending' ? 'descending' : 'ascending';
  return (
    <th
      {...props}
      className={`dh-markdown-table-sortable-header ${props.className ?? ''}`.trim()}
      aria-sort={direction ?? undefined}
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented) return;
        const target = event.target as Element | null;
        if (target?.closest?.('a, button, input, select, textarea, summary, [role="button"], [role="link"]')) {
          return;
        }
        onToggle();
      }}
    >
      <span className="dh-markdown-table-sort-content">
        <span className="dh-markdown-table-sort-label">{renderedChildren}</span>
        <button
          type="button"
          className="dh-markdown-table-sort-button"
          title={`Sort ${label} ${nextDirection}`}
          aria-label={`Sort ${label} ${nextDirection}`}
          onClick={onToggle}
        >
          <span
            className={`dh-markdown-table-sort-indicator ${direction ? 'is-active' : ''}`}
            aria-hidden="true"
          >
            {direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : '↕'}
          </span>
        </button>
      </span>
    </th>
  );
}

function StableMarkdownHeading1({ children, node: _node, ...props }: MarkdownElementProps<'h1'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  return <h1 {...props}>{context?.renderMentionChildren(children) ?? children}</h1>;
}

function StableMarkdownHeading2({ children, node: _node, ...props }: MarkdownElementProps<'h2'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  return <h2 {...props}>{context?.renderMentionChildren(children) ?? children}</h2>;
}

function StableMarkdownHeading3({ children, node: _node, ...props }: MarkdownElementProps<'h3'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  return <h3 {...props}>{context?.renderMentionChildren(children) ?? children}</h3>;
}

function StableMarkdownHeading4({ children, node: _node, ...props }: MarkdownElementProps<'h4'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  return <h4 {...props}>{context?.renderMentionChildren(children) ?? children}</h4>;
}

function StableMarkdownHeading5({ children, node: _node, ...props }: MarkdownElementProps<'h5'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  return <h5 {...props}>{context?.renderMentionChildren(children) ?? children}</h5>;
}

function StableMarkdownHeading6({ children, node: _node, ...props }: MarkdownElementProps<'h6'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  return <h6 {...props}>{context?.renderMentionChildren(children) ?? children}</h6>;
}

function StableMarkdownAnchor({
  href,
  children,
  node: _node,
  ...props
}: MarkdownElementProps<'a'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  const hrefText = typeof href === 'string' ? href : '';
  const hrefFileRef = context?.onOpenFileReference
    ? parseInlineCodeFileReference(hrefText)
    : null;
  if (hrefFileRef && context?.onOpenFileReference) {
    const targetDescription =
      hrefFileRef.line == null
        ? hrefFileRef.path
        : `${hrefFileRef.path}:${hrefFileRef.line}${hrefFileRef.column == null ? '' : `:${hrefFileRef.column}`}`;
    return (
      <a
        href={hrefText}
        title={`Open ${targetDescription}`}
        aria-label={`Open file ${targetDescription}`}
        onClick={(event) => {
          event.preventDefault();
          context.onOpenFileReference?.(hrefFileRef);
        }}
        {...props}
      >
        {children}
      </a>
    );
  }
  return (
    <a
      href={hrefText}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => context?.handleAnchorClick(event, hrefText)}
      {...props}
    >
      {children}
    </a>
  );
}

function StableMarkdownBlockquote({
  children,
  node,
  ...props
}: MarkdownElementProps<'blockquote'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  const kind = detectCalloutKind(children);
  const cleanedChildren = kind ? stripLeadingCalloutMarker(children) : children;
  const blockquote = (
    <blockquote data-callout={kind ?? undefined} {...props}>
      {kind ? (
        <span className="dh-markdown-callout-label" aria-label={`${CALLOUT_LABEL[kind]} callout`}>
          {CALLOUT_LABEL[kind]}
        </span>
      ) : null}
      {cleanedChildren}
    </blockquote>
  );
  const blockText = context?.renderBlockCopyAction
    ? blockquoteCopyText(node, context.normalizedText, cleanedChildren)
    : '';
  return blockText ? (
    <div className="dh-markdown-copyable-block group/markdown-block">
      {blockquote}
      {context?.renderBlockCopyAction?.(blockText)}
    </div>
  ) : blockquote;
}

function StableMarkdownTable({
  children,
  node,
  ...props
}: MarkdownElementProps<'table'>) {
  const context = React.useContext(MarkdownCodeRenderContext);
  const tableId = tableIdFromNode(node, children);
  const mode = context?.tableModes[tableId] ?? 'fit';
  const sort = context?.tableSorts[tableId] ?? null;
  return (
    <MarkdownTable
      {...props}
      mode={mode}
      sort={sort}
      onModeChange={(nextMode) => context?.setTableMode(tableId, nextMode)}
      onSortChange={(nextSort) => context?.setTableSort(tableId, nextSort)}
      onOpenExpanded={() =>
        context?.openExpandedTable({
          id: tableId,
          children,
          props,
        })
      }
    >
      {children}
    </MarkdownTable>
  );
}

// React uses component identity during reconciliation. Keep this map and every
// renderer in it module-stable so a timer or data poll cannot replace unchanged
// Markdown DOM nodes and destroy the user's browser text selection.
const STABLE_MARKDOWN_COMPONENTS: NonNullable<
  React.ComponentProps<typeof ReactMarkdown>['components']
> = {
  p: StableMarkdownParagraph,
  li: StableMarkdownListItem,
  td: StableMarkdownTableCell,
  th: StableMarkdownTableHeader,
  h1: StableMarkdownHeading1,
  h2: StableMarkdownHeading2,
  h3: StableMarkdownHeading3,
  h4: StableMarkdownHeading4,
  h5: StableMarkdownHeading5,
  h6: StableMarkdownHeading6,
  a: StableMarkdownAnchor,
  code: StableMarkdownCode,
  blockquote: StableMarkdownBlockquote,
  pre: StableMarkdownPre,
  table: StableMarkdownTable,
};

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

export function MarkdownMessage({
  text,
  className,
  onOpenFileReference,
  onOpenLink,
  textMentionLinks,
  onOpenTextMention,
  renderBlockCopyAction,
  renderCodeBlock,
  preferOpenLinkBeforeModifiedClick = false,
}: MarkdownMessageProps) {
  const handleAnchorClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, hrefText: string) => {
      if (!onOpenLink || !hrefText) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (preferOpenLinkBeforeModifiedClick && !event.shiftKey && !event.altKey) {
        const handled = Boolean(onOpenLink(hrefText));
        if (handled) {
          event.preventDefault();
          return;
        }
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        window.open(hrefText, '_blank', 'noopener,noreferrer');
        return;
      }
      if (event.shiftKey || event.altKey) return;
      if (!preferOpenLinkBeforeModifiedClick) {
        const handled = Boolean(onOpenLink(hrefText));
        if (handled) event.preventDefault();
      }
    },
    [onOpenLink, preferOpenLinkBeforeModifiedClick],
  );
  const normalizedText = React.useMemo(() => normalizeLooseNestedBullets(text), [text]);
  const preparedTextMentionLinks = React.useMemo(() => prepareTextMentionLinks(textMentionLinks), [textMentionLinks]);
  const renderMentionChildren = React.useCallback(
    (children: React.ReactNode) => renderTextMentionChildren(children, preparedTextMentionLinks, onOpenTextMention),
    [onOpenTextMention, preparedTextMentionLinks],
  );
  const [tableModes, setTableModes] = React.useState<Record<string, TableMode>>({});
  const [tableSorts, setTableSorts] = React.useState<Record<string, TableSortState>>({});
  const [expandedTable, setExpandedTable] = React.useState<ExpandedTableState | null>(null);
  const [expandedTableMode, setExpandedTableMode] = React.useState<TableMode>('fit');
  const setTableMode = React.useCallback((tableId: string, mode: TableMode) => {
    setTableModes((prev) => (prev[tableId] === mode ? prev : { ...prev, [tableId]: mode }));
  }, []);
  const setTableSort = React.useCallback((tableId: string, sort: TableSortState | null) => {
    setTableSorts((previous) => {
      if (!sort) {
        if (!(tableId in previous)) return previous;
        const next = { ...previous };
        delete next[tableId];
        return next;
      }
      const current = previous[tableId];
      if (current?.columnIndex === sort.columnIndex && current.direction === sort.direction) {
        return previous;
      }
      return { ...previous, [tableId]: sort };
    });
  }, []);
  const openExpandedTable = React.useCallback((table: ExpandedTableState) => {
    setExpandedTable(table);
    setExpandedTableMode('fit');
  }, []);
  const codeRenderContext = React.useMemo<MarkdownCodeRenderContextValue>(
    () => ({
      handleAnchorClick,
      onOpenFileReference,
      renderCodeBlock,
      renderMentionChildren,
      renderBlockCopyAction,
      normalizedText,
      tableModes,
      setTableMode,
      tableSorts,
      setTableSort,
      openExpandedTable,
    }),
    [
      handleAnchorClick,
      normalizedText,
      onOpenFileReference,
      openExpandedTable,
      renderBlockCopyAction,
      renderCodeBlock,
      renderMentionChildren,
      setTableMode,
      setTableSort,
      tableModes,
      tableSorts,
    ],
  );

  React.useEffect(() => {
    setTableModes({});
    setTableSorts({});
    setExpandedTable(null);
    setExpandedTableMode('fit');
  }, [normalizedText]);

  return (
    <>
      <div className={`dh-markdown ${className ?? ''}`}>
        <MarkdownCodeRenderContext.Provider value={codeRenderContext}>
          <ReactMarkdown
            remarkPlugins={MARKDOWN_REMARK_PLUGINS}
            components={STABLE_MARKDOWN_COMPONENTS}
          >
            {normalizedText}
          </ReactMarkdown>
        </MarkdownCodeRenderContext.Provider>
      </div>
      {expandedTable ? (
        <ExpandedMarkdownTableDialog
          table={expandedTable}
          mode={expandedTableMode}
          sort={tableSorts[expandedTable.id] ?? null}
          onModeChange={setExpandedTableMode}
          onSortChange={(nextSort) => setTableSort(expandedTable.id, nextSort)}
          onClose={() => setExpandedTable(null)}
        />
      ) : null}
    </>
  );
}
