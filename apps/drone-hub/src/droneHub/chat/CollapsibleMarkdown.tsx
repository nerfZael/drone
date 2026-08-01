import React from 'react';
import {
  MarkdownMessage,
  type MarkdownBlockCopyActionRenderer,
  type MarkdownFileReference,
  type MarkdownTextMentionLink,
} from './MarkdownMessage';
import { IconChevron } from './icons';

function parseFenceMarker(line: string): { markerChar: '`' | '~'; markerLength: number } | null {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[1] ?? '';
  const markerChar = marker[0];
  if (markerChar !== '`' && markerChar !== '~') return null;
  return { markerChar, markerLength: marker.length };
}

function isClosingFence(line: string, fence: { markerChar: '`' | '~'; markerLength: number }): boolean {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
  if (!match) return false;
  const marker = match[1] ?? '';
  return marker[0] === fence.markerChar && marker.length >= fence.markerLength;
}

function previewCollapsedMarkdown(rawText: string, collapseAfterLines: number): string {
  const text = String(rawText ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const previewLineLimit = Math.max(1, Math.min(12, collapseAfterLines));
  const blockEnds: number[] = [];
  let fence: { markerChar: '`' | '~'; markerLength: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
    } else {
      fence = parseFenceMarker(line);
    }

    if (!fence && (lines[index + 1] === '' || index === lines.length - 1)) {
      blockEnds.push(index + 1);
    }
  }

  // Keep leading tables and code fences intact, then fill the preview with as many
  // complete blocks as fit. This gives short opening paragraphs useful context
  // without mounting the full Markdown body.
  const firstBlockEnd = blockEnds[0] ?? lines.length;
  const firstBlockIsFence = blockEnds.length > 0 && Boolean(parseFenceMarker(lines[0] ?? ''));
  const firstBlockIsTable =
    firstBlockEnd > 1 &&
    /\|/.test(lines[0] ?? '') &&
    /^\s*\|?\s*:?-+/.test(lines[1] ?? '');
  let previewEnd =
    firstBlockIsFence || firstBlockIsTable
      ? firstBlockEnd
      : Math.min(firstBlockEnd, previewLineLimit);
  for (const blockEnd of blockEnds.slice(1)) {
    if (blockEnd > previewLineLimit) break;
    previewEnd = blockEnd;
  }

  const preview = lines.slice(0, previewEnd).join('\n').trimEnd();
  return firstBlockIsFence || firstBlockIsTable ? preview : preview.slice(0, 1200).trimEnd();
}

const POINTER_TOGGLE_MAX_MOVEMENT_PX = 6;
const POINTER_TOGGLE_DELAY_MS = 320;
const COLLAPSE_TOGGLE_IGNORED_TARGETS = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  'pre',
  'code',
  'img',
  'video',
  'audio',
  '[contenteditable]',
  '[role="button"]',
  '[role="link"]',
  '[data-collapse-toggle-ignore="true"]',
  '.dh-markdown-table-toolbar',
  '.dh-markdown-table-wrap',
  '.dh-markdown-table-dialog',
].join(',');

function isCollapseToggleIgnoredTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return Boolean(target.closest(COLLAPSE_TOGGLE_IGNORED_TARGETS));
}

function hasSelectedText(): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

export function CollapsibleMarkdown({
  text,
  className,
  fadeTo,
  onOpenFileReference,
  onOpenLink,
  textMentionLinks,
  onOpenTextMention,
  renderBlockCopyAction,
  maxHeightPx = 240,
  collapseAfterLines = 40,
  toggleOnMessageClick = false,
  autoExpand = false,
}: {
  text: string;
  className?: string;
  fadeTo: string;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  textMentionLinks?: MarkdownTextMentionLink[];
  onOpenTextMention?: (mention: MarkdownTextMentionLink) => void;
  renderBlockCopyAction?: MarkdownBlockCopyActionRenderer;
  maxHeightPx?: number;
  collapseAfterLines?: number;
  /** @deprecated Collapsed previews now preserve Markdown blocks by default. */
  preserveLeadParagraph?: boolean;
  toggleOnMessageClick?: boolean;
  autoExpand?: boolean;
}) {
  const normalizedText = React.useMemo(() => text.replace(/\r\n/g, '\n'), [text]);
  const totalLines = React.useMemo(() => normalizedText.split('\n').length, [normalizedText]);
  const isLong = totalLines > collapseAfterLines || text.length > 2000;
  const [collapsed, setCollapsed] = React.useState(isLong && !autoExpand);
  const pointerDownRef = React.useRef<{ clientX: number; clientY: number; ignored: boolean; pointerId: number } | null>(null);
  const pointerToggleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsedPreviewText = React.useMemo(
    () => previewCollapsedMarkdown(normalizedText, collapseAfterLines),
    [collapseAfterLines, normalizedText],
  );
  const shouldDeferHiddenMarkdown = isLong && collapsed;

  React.useEffect(() => {
    setCollapsed(isLong && !autoExpand);
  }, [autoExpand, isLong, text]);

  const canExpandByPointer = toggleOnMessageClick && isLong && collapsed;
  const clearPendingPointerToggle = React.useCallback(() => {
    if (pointerToggleTimerRef.current == null) return;
    clearTimeout(pointerToggleTimerRef.current);
    pointerToggleTimerRef.current = null;
  }, []);
  React.useEffect(() => {
    return () => clearPendingPointerToggle();
  }, [clearPendingPointerToggle]);
  React.useEffect(() => {
    clearPendingPointerToggle();
  }, [clearPendingPointerToggle, isLong, text]);
  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      clearPendingPointerToggle();
      if (!canExpandByPointer) return;
      if (event.pointerType === 'mouse' && event.button !== 0) {
        pointerDownRef.current = null;
        return;
      }

      pointerDownRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        ignored: isCollapseToggleIgnoredTarget(event.target),
        pointerId: event.pointerId,
      };
    },
    [canExpandByPointer, clearPendingPointerToggle],
  );
  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canExpandByPointer) return;
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!down || down.pointerId !== event.pointerId) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (down.ignored || isCollapseToggleIgnoredTarget(event.target)) return;

      const movedX = Math.abs(event.clientX - down.clientX);
      const movedY = Math.abs(event.clientY - down.clientY);
      if (movedX > POINTER_TOGGLE_MAX_MOVEMENT_PX || movedY > POINTER_TOGGLE_MAX_MOVEMENT_PX) return;
      if (hasSelectedText()) return;

      pointerToggleTimerRef.current = setTimeout(() => {
        pointerToggleTimerRef.current = null;
        setCollapsed(false);
      }, POINTER_TOGGLE_DELAY_MS);
    },
    [canExpandByPointer],
  );
  const handlePointerCancel = React.useCallback(() => {
    pointerDownRef.current = null;
    clearPendingPointerToggle();
  }, [clearPendingPointerToggle]);

  const style = {
    ['--collapse-max-height' as any]: `${maxHeightPx}px`,
    ['--collapse-fade' as any]: fadeTo,
  } as React.CSSProperties;

  return (
    <div
      className={`relative ${canExpandByPointer ? 'dh-collapsible-markdown--click-toggle' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={clearPendingPointerToggle}
    >
      {shouldDeferHiddenMarkdown ? (
        <div className="output-collapse collapsed" style={style}>
          <MarkdownMessage
            text={collapsedPreviewText}
            className={className}
            onOpenFileReference={onOpenFileReference}
            onOpenLink={onOpenLink}
            textMentionLinks={textMentionLinks}
            onOpenTextMention={onOpenTextMention}
            renderBlockCopyAction={renderBlockCopyAction}
          />
        </div>
      ) : (
        <div className={`output-collapse ${isLong && collapsed ? 'collapsed' : ''}`} style={style}>
          <MarkdownMessage
            text={text}
            className={className}
            onOpenFileReference={onOpenFileReference}
            onOpenLink={onOpenLink}
            textMentionLinks={textMentionLinks}
            onOpenTextMention={onOpenTextMention}
            renderBlockCopyAction={renderBlockCopyAction}
          />
        </div>
      )}
      {isLong && (
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="mt-2 inline-flex min-h-7 items-center gap-1 rounded-[var(--radius-small)] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-2 text-[var(--text-11)] font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)]"
        >
          <IconChevron down={!collapsed} />
          {collapsed ? 'Show more' : 'Collapse'}
        </button>
      )}
    </div>
  );
}
