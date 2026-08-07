import React from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  numericTableColumnIndexes,
  stableSortTableRows,
  type NumericTableSortDirection,
} from '@drone/markdown-table-sort';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import Copy from 'lucide-react-native/icons/copy';
import WrapText from 'lucide-react-native/icons/text-wrap';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { MobileHighlightedCode } from '../components/MobileHighlightedCode';
import { colors } from '../theme';
import { NativeMermaidDiagram } from './NativeMermaidDiagram';
import {
  buildNativeMarkdownOutline,
  nativeMarkdownInlineText,
  parseNativeMarkdown,
  parseNativeMarkdownInline,
  type NativeMarkdownBlock,
  type NativeMarkdownInline,
  type NativeMarkdownSection,
} from './native-markdown-model';
import {
  parseMobileFileReference,
  splitMobileFileReferences,
  type MobileFileReference,
} from './file-reference';

function safeLink(value: string): string | null {
  const link = String(value ?? '').trim();
  return /^(?:https?:|mailto:)/i.test(link) ? link : null;
}

const CODE_CHARACTER_WIDTH = 7.5;

function stopTouchPropagation(event: GestureResponderEvent): void {
  event.stopPropagation();
}

function codeTextWidth(text: string): number {
  const longestLine = String(text ?? '')
    .split('\n')
    .reduce((longest, line) => Math.max(longest, line.replace(/\t/g, '    ').length), 1);
  return Math.ceil(longestLine * CODE_CHARACTER_WIDTH);
}

function NativeCodeBlock({ code, language }: { code: string; language: string }) {
  const [wordWrap, setWordWrap] = React.useState(false);
  const contentWidth = codeTextWidth(code);
  const languageLabel = language.trim() || 'plain text';

  const copyCode = React.useCallback(async () => {
    try {
      await Clipboard.setStringAsync(code);
    } catch {
      // Leave the action available so the user can retry.
    }
  }, [code]);

  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeToolbar}>
        <Text numberOfLines={1} style={styles.codeLanguage}>
          {languageLabel}
        </Text>
        <View style={styles.codeActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={wordWrap ? 'Turn off code word wrap' : 'Turn on code word wrap'}
            accessibilityState={{ checked: wordWrap }}
            hitSlop={6}
            onPress={(event) => {
              event.stopPropagation();
              setWordWrap((current) => !current);
            }}
            style={({ pressed }) => [
              styles.codeAction,
              wordWrap && styles.codeActionActive,
              pressed && styles.codeActionPressed,
            ]}
          >
            <WrapText
              color={wordWrap ? colors.accent : colors.textSecondary}
              size={14}
              strokeWidth={2}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy ${languageLabel} code`}
            hitSlop={6}
            onPress={(event) => {
              event.stopPropagation();
              void copyCode();
            }}
            style={({ pressed }) => [styles.codeAction, pressed && styles.codeActionPressed]}
          >
            <Copy color={colors.textSecondary} size={14} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
      {wordWrap ? (
        <View style={[styles.codeContent, styles.codeContentWrapped]}>
          <MobileHighlightedCode
            content={code}
            language={language}
            style={[styles.codeText, styles.codeTextWrapped]}
          />
        </View>
      ) : (
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={styles.codeScroll}
          contentContainerStyle={styles.codeScrollContent}
        >
          <View style={[styles.codeContent, { width: contentWidth + 24 }]}>
            <MobileHighlightedCode
              content={code}
              language={language}
              style={[styles.codeText, { width: contentWidth }]}
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function NativeMermaidBlock({ source }: { source: string }) {
  const [showSource, setShowSource] = React.useState(false);

  return (
    <View style={styles.mermaidBlock}>
      <View style={styles.mermaidToolbar}>
        <Text style={styles.mermaidLabel}>Diagram</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showSource ? 'Show rendered diagram' : 'Show Mermaid source'}
          accessibilityState={{ expanded: showSource }}
          hitSlop={6}
          onPress={(event) => {
            event.stopPropagation();
            setShowSource((visible) => !visible);
          }}
          style={({ pressed }) => [
            styles.mermaidSourceButton,
            pressed && styles.mermaidSourceButtonPressed,
          ]}
        >
          <Text style={styles.mermaidSourceButtonText}>
            {showSource ? 'Diagram' : 'Source'}
          </Text>
        </Pressable>
      </View>
      {showSource ? (
        <View style={styles.mermaidSource}>
          <NativeCodeBlock code={source} language="mermaid" />
        </View>
      ) : (
        <NativeMermaidDiagram source={source} />
      )}
    </View>
  );
}

function FileLinkedText({
  text,
  onOpenFileReference,
}: {
  text: string;
  onOpenFileReference?: (reference: MobileFileReference) => void;
}) {
  if (!onOpenFileReference) return text;
  return splitMobileFileReferences(text).map((segment, index) =>
    segment.type === 'text' ? (
      segment.text
    ) : (
      <Text
        key={`${segment.reference.path}:${index}`}
        accessibilityRole="link"
        accessibilityHint="Opens a read-only file preview"
        onPress={(event) => {
          event.stopPropagation?.();
          onOpenFileReference(segment.reference);
        }}
        style={styles.fileLink}
      >
        {segment.text}
      </Text>
    ),
  );
}

function InlineMarkdown({
  text,
  tone,
  onOpenFileReference,
  interactive = true,
}: {
  text: string;
  tone: 'assistant' | 'user';
  onOpenFileReference?: (reference: MobileFileReference) => void;
  interactive?: boolean;
}) {
  return (
    <>
      {parseNativeMarkdownInline(text).map((token: NativeMarkdownInline, index) => {
        const style =
          token.type === 'strong'
            ? tone === 'user'
              ? styles.userStrong
              : styles.strong
            : token.type === 'emphasis'
              ? styles.emphasis
              : token.type === 'strike'
                ? styles.strike
                : token.type === 'code'
                  ? styles.inlineCode
                  : token.type === 'link'
                    ? styles.link
                    : undefined;
        const href = interactive && token.type === 'link' ? safeLink(token.href ?? '') : null;
        const fileReference =
          interactive && onOpenFileReference
            && (token.type === 'code' || (token.type === 'link' && !href))
            ? parseMobileFileReference(token.type === 'link' ? (token.href ?? '') : token.text)
            : null;
        const renderedText = token.type === 'code' ? `\u202f${token.text}\u202f` : token.text;
        return (
          <Text
            key={`${token.type}:${index}`}
            style={[style, fileReference && styles.fileLink]}
            accessibilityRole={href || fileReference ? 'link' : undefined}
            accessibilityHint={fileReference ? 'Opens a read-only file preview' : undefined}
            onPress={
              href
                ? (event) => {
                    event.stopPropagation?.();
                    void Linking.openURL(href);
                  }
                : fileReference
                  ? (event) => {
                      event.stopPropagation?.();
                      onOpenFileReference?.(fileReference);
                    }
                  : undefined
            }
          >
            {token.type === 'text' ? (
              <FileLinkedText
                text={renderedText}
                onOpenFileReference={interactive ? onOpenFileReference : undefined}
              />
            ) : (
              renderedText
            )}
          </Text>
        );
      })}
    </>
  );
}

type NativeMarkdownTableBlock = Extract<NativeMarkdownBlock, { type: 'table' }>;
type NativeMarkdownTableSort = {
  columnIndex: number;
  direction: NumericTableSortDirection;
};

function NativeMarkdownTable({
  block,
  tone,
  onOpenFileReference,
}: {
  block: NativeMarkdownTableBlock;
  tone: 'assistant' | 'user';
  onOpenFileReference?: (reference: MobileFileReference) => void;
}) {
  const [sort, setSort] = React.useState<NativeMarkdownTableSort | null>(null);
  const headerLabels = React.useMemo(
    () => block.headers.map((header) => nativeMarkdownInlineText(header).trim()),
    [block.headers],
  );
  const numericValues = React.useMemo(
    () => block.rows.map((row) => row.map((cell) => nativeMarkdownInlineText(cell).trim())),
    [block.rows],
  );
  const numericColumns = React.useMemo(
    () => new Set(numericTableColumnIndexes(numericValues, block.headers.length)),
    [block.headers.length, numericValues],
  );
  const activeSort = sort && numericColumns.has(sort.columnIndex) ? sort : null;
  const orderedRows = React.useMemo(() => {
    const indexedRows = block.rows.map((row, originalIndex) => ({ row, originalIndex }));
    return activeSort
      ? stableSortTableRows(
        indexedRows,
        numericValues,
        activeSort.columnIndex,
        activeSort.direction,
      )
      : indexedRows;
  }, [activeSort, block.rows, numericValues]);

  React.useEffect(() => setSort(null), [block]);

  return (
    <View style={styles.tableBlock}>
      {numericColumns.size > 0 ? (
        <View style={styles.tableToolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset table sort"
            accessibilityState={{ disabled: !activeSort }}
            disabled={!activeSort}
            hitSlop={6}
            onPress={(event) => {
              event.stopPropagation();
              setSort(null);
            }}
            onTouchStart={stopTouchPropagation}
            onTouchEnd={stopTouchPropagation}
            style={({ pressed }) => [
              styles.tableResetButton,
              !activeSort && styles.tableResetButtonDisabled,
              pressed && styles.tableResetButtonPressed,
            ]}
          >
            <Text style={styles.tableResetText}>Reset</Text>
          </Pressable>
        </View>
      ) : null}
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={styles.tableFrame}
      >
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHead]}>
            {block.headers.map((header, columnIndex) => {
              const sortable = numericColumns.has(columnIndex);
              if (!sortable) {
                return (
                  <Text
                    selectable
                    key={columnIndex}
                    style={[
                      styles.tableCell,
                      styles.tableHeadText,
                      tone === 'user' && styles.userText,
                    ]}
                  >
                    <InlineMarkdown
                      text={header}
                      tone={tone}
                      onOpenFileReference={onOpenFileReference}
                    />
                  </Text>
                );
              }
              const direction = activeSort?.columnIndex === columnIndex
                ? activeSort.direction
                : null;
              const nextDirection = direction === 'ascending' ? 'descending' : 'ascending';
              return (
                <Pressable
                  key={columnIndex}
                  accessibilityRole="button"
                  accessibilityLabel={`Sort ${headerLabels[columnIndex] || 'column'} ${nextDirection}`}
                  accessibilityHint="Sorts this numeric table column"
                  onPress={(event) => {
                    event.stopPropagation();
                    setSort({ columnIndex, direction: nextDirection });
                  }}
                  onTouchStart={stopTouchPropagation}
                  onTouchEnd={stopTouchPropagation}
                  style={({ pressed }) => [
                    styles.tableSortHeader,
                    pressed && styles.tableSortHeaderPressed,
                  ]}
                >
                  <View style={styles.tableSortHeaderContent}>
                    <Text
                      style={[
                        styles.tableSortHeaderText,
                        tone === 'user' && styles.userText,
                      ]}
                    >
                      <InlineMarkdown
                        text={header}
                        tone={tone}
                        interactive={false}
                      />
                    </Text>
                    <Text
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      style={[
                        styles.tableSortIndicator,
                        direction && styles.tableSortIndicatorActive,
                      ]}
                    >
                      {direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : '↕'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {orderedRows.map(({ row, originalIndex }) => (
            <View key={originalIndex} style={styles.tableRow}>
              {block.headers.map((_, cellIndex) => (
                <Text
                  selectable
                  key={cellIndex}
                  style={[styles.tableCell, tone === 'user' && styles.userText]}
                >
                  <InlineMarkdown
                    text={row[cellIndex] ?? ''}
                    tone={tone}
                    onOpenFileReference={onOpenFileReference}
                  />
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function NativeMarkdownBlocks({
  blocks,
  tone = 'assistant',
  onOpenFileReference,
}: {
  blocks: NativeMarkdownBlock[];
  tone?: 'assistant' | 'user';
  onOpenFileReference?: (reference: MobileFileReference) => void;
}) {
  return (
    <View style={styles.markdown}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Text
              selectable
              key={`heading:${index}`}
              style={[
                styles.heading,
                block.level <= 2 ? styles.headingLarge : styles.headingSmall,
                tone === 'user' && styles.userText,
              ]}
            >
              <InlineMarkdown
                text={block.text}
                tone={tone}
                onOpenFileReference={onOpenFileReference}
              />
            </Text>
          );
        }
        if (block.type === 'code') {
          return (
            <NativeCodeBlock
              key={`code:${index}`}
              code={block.text}
              language={block.language}
            />
          );
        }
        if (block.type === 'mermaid') {
          return <NativeMermaidBlock key={`mermaid:${index}`} source={block.text} />;
        }
        if (block.type === 'quote') {
          const calloutStyle = block.callout
            ? calloutStyles[block.callout as keyof typeof calloutStyles]
            : undefined;
          return (
            <View
              key={`quote:${index}`}
              style={[styles.quote, calloutStyle?.container]}
            >
              {block.callout ? (
                <Text style={[styles.calloutLabel, calloutStyle?.label]}>{block.callout}</Text>
              ) : null}
              <Text selectable style={[styles.quoteText, tone === 'user' && styles.userText]}>
                <InlineMarkdown
                  text={block.text}
                  tone={tone}
                  onOpenFileReference={onOpenFileReference}
                />
              </Text>
            </View>
          );
        }
        if (block.type === 'list') {
          return (
            <View key={`list:${index}`} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={styles.listRow}>
                  <Text style={styles.listMarker}>
                    {item.checked == null
                      ? block.ordered
                        ? `${itemIndex + 1}.`
                        : '•'
                      : item.checked
                        ? '☑'
                        : '☐'}
                  </Text>
                  <Text selectable style={[styles.body, tone === 'user' && styles.userText]}>
                    <InlineMarkdown
                      text={item.text}
                      tone={tone}
                      onOpenFileReference={onOpenFileReference}
                    />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        if (block.type === 'divider')
          return <View key={`divider:${index}`} style={styles.divider} />;
        if (block.type === 'table') {
          return (
            <NativeMarkdownTable
              key={`table:${index}`}
              block={block}
              tone={tone}
              onOpenFileReference={onOpenFileReference}
            />
          );
        }
        return (
          <Text
            selectable
            key={`paragraph:${index}`}
            style={[styles.body, tone === 'user' && styles.userText]}
          >
            <InlineMarkdown
              text={block.text}
              tone={tone}
              onOpenFileReference={onOpenFileReference}
            />
          </Text>
        );
      })}
    </View>
  );
}

export type NativeMarkdownExpansionCommand = {
  action: 'collapse' | 'expand';
  sequence: number;
};

function DocumentSection({
  section,
  expandedIds,
  keepChildrenVisible,
  onToggle,
  onOpenFileReference,
}: {
  section: NativeMarkdownSection;
  expandedIds: ReadonlySet<string>;
  keepChildrenVisible: boolean;
  onToggle(id: string): void;
  onOpenFileReference?: (reference: MobileFileReference) => void;
}) {
  const expanded = expandedIds.has(section.id);
  const canToggle = Boolean(
    section.content.length > 0 || (section.children.length > 0 && !keepChildrenVisible),
  );
  const level = Math.min(6, Math.max(1, section.heading.level));
  const headingTextStyle = [
    styles.documentHeadingText,
    level === 1
      ? styles.documentHeading1Text
      : level === 2
        ? styles.documentHeading2Text
        : level === 3
          ? styles.documentHeading3Text
          : level === 4
            ? styles.documentHeading4Text
            : level === 5
              ? styles.documentHeading5Text
              : styles.documentHeading6Text,
  ];
  const headingContainerStyle = [
    styles.documentHeading,
    level === 1
      ? styles.documentHeading1
      : level === 2
        ? styles.documentHeading2
        : styles.documentHeadingNested,
  ];
  const headingContent = (
    <View style={styles.documentHeadingRow}>
      <Text style={headingTextStyle}>
        <InlineMarkdown
          text={section.heading.text}
          tone="assistant"
          onOpenFileReference={onOpenFileReference}
        />
      </Text>
      {canToggle && !expanded ? (
        <ArrowRight
          color={colors.mutedDim}
          size={14}
          strokeWidth={1.8}
          style={styles.documentExpandArrow}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.documentSection}>
      {canToggle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${section.heading.text}`}
          accessibilityState={{ expanded }}
          onPress={() => onToggle(section.id)}
          style={({ pressed }) => [headingContainerStyle, pressed && styles.headingPressed]}
        >
          {headingContent}
        </Pressable>
      ) : (
        <View style={headingContainerStyle}>{headingContent}</View>
      )}
      {expanded && section.content.length > 0 ? (
        <NativeMarkdownBlocks
          blocks={section.content}
          onOpenFileReference={onOpenFileReference}
        />
      ) : null}
      {section.children.length > 0 && (expanded || keepChildrenVisible) ? (
        <View style={styles.documentChildren}>
          {section.children.map((child) => (
            <DocumentSection
              key={child.id}
              section={child}
              expandedIds={expandedIds}
              keepChildrenVisible={false}
              onToggle={onToggle}
              onOpenFileReference={onOpenFileReference}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function NativeMarkdown({
  text,
  tone = 'assistant',
  onOpenFileReference,
  documentMode = false,
  collapsibleHeadings = false,
  expansionCommand,
}: {
  text: string;
  tone?: 'assistant' | 'user';
  onOpenFileReference?: (reference: MobileFileReference) => void;
  documentMode?: boolean;
  collapsibleHeadings?: boolean;
  expansionCommand?: NativeMarkdownExpansionCommand | null;
}) {
  const blocks = React.useMemo(() => parseNativeMarkdown(text), [text]);
  const outline = React.useMemo(() => buildNativeMarkdownOutline(blocks), [blocks]);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(
    () => new Set(outline.sectionIds),
  );
  const previousSectionIdsRef = React.useRef(new Set(outline.sectionIds));

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
      expansionCommand.action === 'expand' ? new Set(outline.sectionIds) : new Set(),
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

  if (!documentMode || !collapsibleHeadings || outline.sections.length === 0) {
    return (
      <NativeMarkdownBlocks
        blocks={blocks}
        tone={tone}
        onOpenFileReference={onOpenFileReference}
      />
    );
  }

  const documentRoot =
    outline.sections.length === 1 && outline.sections[0]!.children.length > 0
      ? outline.sections[0]!
      : null;

  return (
    <View style={styles.documentMarkdown}>
      {outline.preamble.length > 0 ? (
        <NativeMarkdownBlocks
          blocks={outline.preamble}
          tone={tone}
          onOpenFileReference={onOpenFileReference}
        />
      ) : null}
      {outline.sections.map((section) => (
        <DocumentSection
          key={section.id}
          section={section}
          expandedIds={expandedIds}
          keepChildrenVisible={section === documentRoot}
          onToggle={toggleSection}
          onOpenFileReference={onOpenFileReference}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  markdown: { width: '100%', minWidth: 0, alignSelf: 'stretch', gap: 10 },
  documentMarkdown: { width: '100%', minWidth: 0, alignSelf: 'stretch', gap: 10 },
  documentSection: { width: '100%', minWidth: 0, alignSelf: 'stretch', gap: 10 },
  documentChildren: { width: '100%', minWidth: 0, alignSelf: 'stretch', gap: 10 },
  documentHeading: {
    width: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
  },
  documentHeading1: {
    borderBottomWidth: 1,
    borderBottomColor: colors.surface1,
    paddingBottom: 9,
    marginBottom: 2,
  },
  documentHeading2: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    paddingBottom: 6,
    marginTop: 8,
  },
  documentHeadingNested: { marginTop: 5 },
  documentHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  documentHeadingText: {
    flexShrink: 1,
    color: colors.text,
    fontWeight: '900',
  },
  documentHeading1Text: {
    color: colors.textStrong,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.35,
  },
  documentHeading2Text: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.15,
  },
  documentHeading3Text: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  documentHeading4Text: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  documentHeading5Text: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  documentHeading6Text: {
    color: colors.mutedDim,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  documentExpandArrow: { marginLeft: 6 },
  headingPressed: { opacity: 0.7 },
  body: { flex: 1, color: colors.assistantText, fontSize: 14, lineHeight: 21 },
  heading: { color: colors.text, fontWeight: '900', letterSpacing: -0.2 },
  headingLarge: { fontSize: 19, lineHeight: 25, marginTop: 3 },
  headingSmall: { fontSize: 16, lineHeight: 22, marginTop: 2 },
  strong: { fontWeight: '800', color: colors.text },
  userStrong: { fontWeight: '800', color: colors.userBubbleText },
  userText: { color: colors.userBubbleText },
  emphasis: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through', color: colors.muted },
  link: { color: colors.link, textDecorationLine: 'underline' },
  fileLink: {
    color: colors.accentAlt,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  inlineCode: {
    color: colors.accentAlt,
    backgroundColor: colors.surface0,
    fontFamily: 'monospace',
    fontSize: 12,
    paddingVertical: 1,
    borderRadius: 4,
  },
  mermaidBlock: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
    flexShrink: 1,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.mantle,
  },
  mermaidToolbar: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 7,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.whiteWash,
  },
  mermaidLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  mermaidSourceButton: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 6,
  },
  mermaidSourceButtonPressed: {
    borderColor: colors.border,
    backgroundColor: colors.surface0,
  },
  mermaidSourceButtonText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  mermaidSource: {
    padding: 8,
  },
  codeBlock: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
    flexShrink: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.mantle,
    overflow: 'hidden',
  },
  codeToolbar: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 5,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.whiteWash,
  },
  codeLanguage: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  codeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  codeAction: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  codeActionActive: { backgroundColor: colors.accentWash },
  codeActionPressed: { opacity: 0.68 },
  codeScroll: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
    flexGrow: 0,
    flexShrink: 1,
  },
  codeScrollContent: {
    alignItems: 'flex-start',
  },
  codeContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  codeContentWrapped: { width: '100%', minWidth: 0 },
  codeText: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    flexShrink: 0,
  },
  codeTextWrapped: { width: '100%', minWidth: 0, flexShrink: 1 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.surface2,
    backgroundColor: colors.panel,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  calloutLabel: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 5,
  },
  quoteText: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  list: { gap: 5 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  listMarker: { width: 22, color: colors.chatListMarker, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: 4 },
  tableBlock: { width: '100%', minWidth: 0, alignSelf: 'stretch' },
  tableToolbar: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  tableResetButton: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 7,
    borderRadius: 6,
  },
  tableResetButtonPressed: { backgroundColor: colors.whiteWash },
  tableResetButtonDisabled: { opacity: 0.42 },
  tableResetText: { color: colors.accentAlt, fontSize: 11, fontWeight: '800' },
  tableFrame: {
    borderWidth: 1,
    borderColor: colors.surface1,
    borderRadius: 9,
    backgroundColor: colors.mantle,
  },
  table: { minWidth: 280 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.surface1 },
  tableHead: { backgroundColor: colors.surface0 },
  tableSortHeader: {
    width: 150,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: colors.surface1,
  },
  tableSortHeaderPressed: { backgroundColor: colors.whiteWash },
  tableSortHeaderContent: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 4,
  },
  tableSortHeaderText: {
    flexShrink: 1,
    color: colors.textStrong,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  tableSortIndicator: {
    flexShrink: 0,
    color: colors.mutedDim,
    fontSize: 11,
    lineHeight: 17,
  },
  tableSortIndicatorActive: { color: colors.accentAlt },
  tableCell: {
    width: 150,
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: colors.surface1,
    textAlign: 'left',
  },
  tableHeadText: { fontWeight: '900', color: colors.textStrong, textAlign: 'center' },
});

const calloutStyles = {
  note: StyleSheet.create({
    container: { borderLeftColor: colors.info, backgroundColor: colors.infoDark },
    label: { color: colors.info },
  }),
  tip: StyleSheet.create({
    container: { borderLeftColor: colors.online, backgroundColor: colors.onlineDark },
    label: { color: colors.online },
  }),
  important: StyleSheet.create({
    container: { borderLeftColor: colors.accent, backgroundColor: colors.accentWash },
    label: { color: colors.accent },
  }),
  warning: StyleSheet.create({
    container: { borderLeftColor: colors.warning, backgroundColor: colors.warningDark },
    label: { color: colors.warning },
  }),
  caution: StyleSheet.create({
    container: { borderLeftColor: colors.danger, backgroundColor: colors.dangerDark },
    label: { color: colors.danger },
  }),
} as const;
