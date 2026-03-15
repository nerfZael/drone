import React from 'react';
import { MarkdownMessage, type MarkdownFileReference } from './MarkdownMessage';
import { IconChevron } from './icons';

function containsWideMarkdownBlocks(rawText: string): boolean {
  const text = String(rawText ?? '');
  if (!text) return false;
  if (/^\s{0,3}(?:```|~~~)/m.test(text)) return true;
  if (/!\[[^\]]*]\([^)]+\)/.test(text)) return true;
  return /^\|.+\|\s*$/m.test(text) && /^\|\s*[-:| ]+\|\s*$/m.test(text);
}

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

export function CollapsibleMarkdown({
  text,
  className,
  fadeTo,
  onOpenFileReference,
  onOpenLink,
  maxHeightPx = 240,
  collapseAfterLines = 40,
  preserveLeadParagraph = false,
}: {
  text: string;
  className?: string;
  fadeTo: string;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  maxHeightPx?: number;
  collapseAfterLines?: number;
  preserveLeadParagraph?: boolean;
}) {
  const normalizedText = React.useMemo(() => text.replace(/\r\n/g, '\n'), [text]);
  const totalLines = React.useMemo(() => normalizedText.split('\n').length, [normalizedText]);
  const isLong = totalLines > collapseAfterLines || text.length > 2000;
  const hasWideBlocks = React.useMemo(() => containsWideMarkdownBlocks(normalizedText), [normalizedText]);
  const [collapsed, setCollapsed] = React.useState(isLong);
  const leadSplit = React.useMemo(() => {
    if (!preserveLeadParagraph) return null;
    const firstBreak = findLeadParagraphBreak(normalizedText);
    if (firstBreak <= 0) return null;
    const lead = normalizedText.slice(0, firstBreak).trimEnd();
    const rest = normalizedText.slice(firstBreak + 2).trimStart();
    if (!lead || !rest) return null;
    return { lead, rest };
  }, [normalizedText, preserveLeadParagraph]);
  const collapseRestCompletely = isLong && Boolean(leadSplit) && hasWideBlocks;

  React.useEffect(() => {
    setCollapsed(isLong);
  }, [isLong, text]);

  const style = {
    ['--collapse-max-height' as any]: `${maxHeightPx}px`,
    ['--collapse-fade' as any]: fadeTo,
  } as React.CSSProperties;

  return (
    <div className="relative">
      {isLong && leadSplit ? (
        <>
          <MarkdownMessage text={leadSplit.lead} className={className} onOpenFileReference={onOpenFileReference} onOpenLink={onOpenLink} />
          {collapseRestCompletely ? (
            collapsed ? null : (
              <MarkdownMessage
                text={leadSplit.rest}
                className={className}
                onOpenFileReference={onOpenFileReference}
                onOpenLink={onOpenLink}
              />
            )
          ) : (
            <div className={`output-collapse ${collapsed ? 'collapsed' : ''}`} style={style}>
              <MarkdownMessage
                text={leadSplit.rest}
                className={className}
                onOpenFileReference={onOpenFileReference}
                onOpenLink={onOpenLink}
              />
            </div>
          )}
        </>
      ) : (
        <div className={`output-collapse ${isLong && collapsed ? 'collapsed' : ''}`} style={style}>
          <MarkdownMessage text={text} className={className} onOpenFileReference={onOpenFileReference} onOpenLink={onOpenLink} />
        </div>
      )}
      {isLong && (
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="mt-2 flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:text-[var(--fg)] transition-colors"
        >
          <IconChevron down={!collapsed} />
          {collapsed ? 'Show more' : 'Collapse'}
        </button>
      )}
    </div>
  );
}
