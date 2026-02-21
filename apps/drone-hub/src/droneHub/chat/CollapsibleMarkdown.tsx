import React from 'react';
import { MarkdownMessage, type MarkdownFileReference } from './MarkdownMessage';
import { IconChevron } from './icons';

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
  onOpenLink?: (href: string) => Promise<boolean> | boolean;
  maxHeightPx?: number;
  collapseAfterLines?: number;
  preserveLeadParagraph?: boolean;
}) {
  const normalizedText = React.useMemo(() => text.replace(/\r\n/g, '\n'), [text]);
  const totalLines = React.useMemo(() => normalizedText.split('\n').length, [normalizedText]);
  const isLong = totalLines > collapseAfterLines || text.length > 2000;
  const [collapsed, setCollapsed] = React.useState(isLong);
  const leadSplit = React.useMemo(() => {
    if (!preserveLeadParagraph) return null;
    const firstBreak = normalizedText.indexOf('\n\n');
    if (firstBreak <= 0) return null;
    const lead = normalizedText.slice(0, firstBreak).trimEnd();
    const rest = normalizedText.slice(firstBreak + 2).trimStart();
    if (!lead || !rest) return null;
    return { lead, rest };
  }, [normalizedText, preserveLeadParagraph]);

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
          <div className={`output-collapse ${collapsed ? 'collapsed' : ''}`} style={style}>
            <MarkdownMessage text={leadSplit.rest} className={className} onOpenFileReference={onOpenFileReference} onOpenLink={onOpenLink} />
          </div>
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
