import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { parseMarkdownOutline, type MarkdownOutlineSection } from './markdown-outline';

type MarkdownOutlinePreviewProps = {
  text: string;
  onOpenLink?: (href: string) => boolean;
  expansionCommand?: MarkdownOutlineExpansionCommand | null;
};

const HEADING_REMARK_PLUGINS = [remarkGfm];

function MarkdownHeadingParagraph({ children }: React.ComponentProps<'p'>) {
  return <>{children}</>;
}

function MarkdownHeadingAnchor({ children }: React.ComponentProps<'a'>) {
  return <span className="dh-markdown-outline__heading-link">{children}</span>;
}

const HEADING_MARKDOWN_COMPONENTS: NonNullable<
  React.ComponentProps<typeof ReactMarkdown>['components']
> = {
  p: MarkdownHeadingParagraph,
  a: MarkdownHeadingAnchor,
};

export type MarkdownOutlineExpansionCommand = {
  action: 'collapse' | 'expand';
  sequence: number;
};

function ExpandArrow() {
  return (
    <svg
      className="dh-markdown-outline__expand-arrow"
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
      <path d="M3 8h9" />
      <path d="m9 5 3 3-3 3" />
    </svg>
  );
}

function HeadingTitle({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={HEADING_REMARK_PLUGINS}
      skipHtml
      components={HEADING_MARKDOWN_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
}

function OutlineSection({
  section,
  expandedIds,
  onToggle,
  onOpenLink,
  idPrefix,
  keepChildrenVisible = false,
}: {
  section: MarkdownOutlineSection;
  expandedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenLink?: (href: string) => boolean;
  idPrefix: string;
  keepChildrenVisible?: boolean;
}) {
  const expanded = expandedIds.has(section.id);
  const canToggle = Boolean(
    section.content || (section.children.length > 0 && !keepChildrenVisible),
  );
  const contentId = `${idPrefix}-${section.id}-content`;
  const headingTag = `h${Math.min(6, Math.max(1, section.level))}` as keyof React.JSX.IntrinsicElements;
  const heading = React.createElement(
    headingTag,
    { className: 'dh-markdown-outline__heading' },
    canToggle ? (
      <button
        type="button"
        className="dh-markdown-outline__heading-button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => onToggle(section.id)}
      >
        <span className="dh-markdown-outline__title">
          <HeadingTitle text={section.title} />
        </span>
        {!expanded ? <ExpandArrow /> : null}
      </button>
    ) : (
      <span className="dh-markdown-outline__title">
        <HeadingTitle text={section.title} />
      </span>
    ),
  );

  return (
    <section className="dh-markdown-outline__section">
      {heading}
      <div id={contentId} className="dh-markdown-outline__section-content">
        {expanded && section.content ? (
          <MarkdownMessage
            text={section.content}
            className="dh-markdown--agent dh-markdown--preserve-edge-margins"
            onOpenLink={onOpenLink}
            preferOpenLinkBeforeModifiedClick
          />
        ) : null}
        {section.children.length > 0 && (expanded || keepChildrenVisible) ? (
          <div className="dh-markdown-outline__children">
            {section.children.map((child) => (
              <OutlineSection
                key={child.id}
                section={child}
                expandedIds={expandedIds}
                onToggle={onToggle}
                onOpenLink={onOpenLink}
                idPrefix={idPrefix}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function MarkdownOutlinePreview({
  text,
  onOpenLink,
  expansionCommand,
}: MarkdownOutlinePreviewProps) {
  const idPrefix = React.useId();
  const outline = React.useMemo(() => parseMarkdownOutline(text), [text]);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(
    () => new Set(outline.sectionIds),
  );
  const previousSectionIdsRef = React.useRef(new Set(outline.sectionIds));
  const documentSection = React.useMemo(() => {
    const onlyRoot = outline.sections.length === 1 ? outline.sections[0] : null;
    return onlyRoot && onlyRoot.children.length > 0 ? onlyRoot : null;
  }, [outline.sections]);
  const collapsibleIds = outline.sectionIds;

  React.useEffect(() => {
    const previousSectionIds = previousSectionIdsRef.current;
    setExpandedIds((previousExpandedIds) => {
      const next = new Set<string>();
      for (const id of outline.sectionIds) {
        if (!previousSectionIds.has(id) || previousExpandedIds.has(id)) next.add(id);
      }
      return next;
    });
    previousSectionIdsRef.current = new Set(outline.sectionIds);
  }, [outline.sectionIds]);

  React.useEffect(() => {
    if (!expansionCommand) return;
    setExpandedIds(
      expansionCommand.action === 'expand' ? new Set(collapsibleIds) : new Set(),
    );
  }, [expansionCommand?.sequence]);

  const toggleSection = React.useCallback((id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (outline.sections.length === 0) {
    return (
      <div className="h-full w-full overflow-auto bg-[var(--panel-alt)] px-4 py-4">
        <MarkdownMessage
          text={text}
          className="dh-markdown--agent dh-markdown--document"
          onOpenLink={onOpenLink}
          preferOpenLinkBeforeModifiedClick
        />
      </div>
    );
  }

  return (
    <div className="dh-markdown-outline">
      <div className="dh-markdown dh-markdown--agent dh-markdown--document dh-markdown-outline__document">
        {outline.preamble ? (
          <div className="dh-markdown-outline__preamble">
            <MarkdownMessage
              text={outline.preamble}
              className="dh-markdown--agent"
              onOpenLink={onOpenLink}
              preferOpenLinkBeforeModifiedClick
            />
          </div>
        ) : null}
        <div className="dh-markdown-outline__tree">
          {outline.sections.map((section) => (
            <OutlineSection
              key={section.id}
              section={section}
              expandedIds={expandedIds}
              onToggle={toggleSection}
              onOpenLink={onOpenLink}
              idPrefix={idPrefix}
              keepChildrenVisible={section === documentSection}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
