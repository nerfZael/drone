import React from 'react';
import {
  MarkdownMessage,
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

function findLeadParagraphBreak(rawText: string): number {
  const text = String(rawText ?? '');
  if (!text.includes('\n\n')) return -1;
  const lines = text.split('\n');
  let offset = 0;
  let fence: { markerChar: '`' | '~'; markerLength: number } | null = null;

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i] ?? '';
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
    } else {
      fence = parseFenceMarker(line);
    }

    if (!fence && lines[i + 1] === '' && offset + line.length > 0) {
      return offset + line.length;
    }
    offset += line.length + 1;
  }

  return -1;
}

function previewCollapsedMarkdown(rawText: string, collapseAfterLines: number): string {
  const text = String(rawText ?? '').replace(/\r\n/g, '\n');
  const leadBreak = findLeadParagraphBreak(text);
  if (leadBreak > 0) return text.slice(0, leadBreak).trimEnd();

  const lines = text.split('\n');
  if (lines.length > collapseAfterLines) {
    return lines.slice(0, Math.max(1, Math.min(12, collapseAfterLines))).join('\n').trimEnd();
  }

  return text.slice(0, 1200).trimEnd();
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
  maxHeightPx = 240,
  collapseAfterLines = 40,
  preserveLeadParagraph = false,
  toggleOnMessageClick = false,
}: {
  text: string;
  className?: string;
  fadeTo: string;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  textMentionLinks?: MarkdownTextMentionLink[];
  onOpenTextMention?: (mention: MarkdownTextMentionLink) => void;
  maxHeightPx?: number;
  collapseAfterLines?: number;
  preserveLeadParagraph?: boolean;
  toggleOnMessageClick?: boolean;
}) {
  const normalizedText = React.useMemo(() => text.replace(/\r\n/g, '\n'), [text]);
  const totalLines = React.useMemo(() => normalizedText.split('\n').length, [normalizedText]);
  const isLong = totalLines > collapseAfterLines || text.length > 2000;
  const [collapsed, setCollapsed] = React.useState(isLong);
  const pointerDownRef = React.useRef<{ clientX: number; clientY: number; ignored: boolean; pointerId: number } | null>(null);
  const pointerToggleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadSplit = React.useMemo(() => {
    if (!preserveLeadParagraph) return null;
    const firstBreak = findLeadParagraphBreak(normalizedText);
    if (firstBreak <= 0) return null;
    const lead = normalizedText.slice(0, firstBreak).trimEnd();
    const rest = normalizedText.slice(firstBreak + 2).trimStart();
    if (!lead || !rest) return null;
    return { lead, rest };
  }, [normalizedText, preserveLeadParagraph]);
  const collapsedPreviewText = React.useMemo(
    () => (leadSplit ? leadSplit.lead : previewCollapsedMarkdown(normalizedText, collapseAfterLines)),
    [collapseAfterLines, leadSplit, normalizedText],
  );
  const shouldDeferHiddenMarkdown = isLong && collapsed;

  React.useEffect(() => {
    setCollapsed(isLong);
  }, [isLong, text]);

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
      {isLong && leadSplit ? (
        <>
          <MarkdownMessage
            text={leadSplit.lead}
            className={className}
            onOpenFileReference={onOpenFileReference}
            onOpenLink={onOpenLink}
            textMentionLinks={textMentionLinks}
            onOpenTextMention={onOpenTextMention}
          />
          {!collapsed ? (
            <div className={`output-collapse ${collapsed ? 'collapsed' : ''}`} style={style}>
              <MarkdownMessage
                text={leadSplit.rest}
                className={className}
                onOpenFileReference={onOpenFileReference}
                onOpenLink={onOpenLink}
                textMentionLinks={textMentionLinks}
                onOpenTextMention={onOpenTextMention}
              />
            </div>
          ) : null}
        </>
      ) : shouldDeferHiddenMarkdown ? (
        <div className="output-collapse collapsed" style={style}>
          <MarkdownMessage
            text={collapsedPreviewText}
            className={className}
            onOpenFileReference={onOpenFileReference}
            onOpenLink={onOpenLink}
            textMentionLinks={textMentionLinks}
            onOpenTextMention={onOpenTextMention}
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
          />
        </div>
      )}
      {isLong && (
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="mt-2 flex items-center gap-1 text-[var(--text-11)] font-medium text-[var(--accent)] hover:text-[var(--fg)] transition-colors"
        >
          <IconChevron down={!collapsed} />
          {collapsed ? 'Show more' : 'Collapse'}
        </button>
      )}
    </div>
  );
}
