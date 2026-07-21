import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import {
  parseNativeMarkdown,
  parseNativeMarkdownInline,
  type NativeMarkdownInline,
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

function codeTextWidth(text: string): number {
  const longestLine = String(text ?? '')
    .split('\n')
    .reduce((longest, line) => Math.max(longest, line.replace(/\t/g, '    ').length), 1);
  return Math.ceil(longestLine * CODE_CHARACTER_WIDTH);
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
  onOpenFileReference,
}: {
  text: string;
  onOpenFileReference?: (reference: MobileFileReference) => void;
}) {
  return (
    <>
      {parseNativeMarkdownInline(text).map((token: NativeMarkdownInline, index) => {
        const style =
          token.type === 'strong'
            ? styles.strong
            : token.type === 'emphasis'
              ? styles.emphasis
              : token.type === 'strike'
                ? styles.strike
                : token.type === 'code'
                  ? styles.inlineCode
                  : token.type === 'link'
                    ? styles.link
                    : undefined;
        const href = token.type === 'link' ? safeLink(token.href ?? '') : null;
        const fileReference =
          onOpenFileReference && (token.type === 'code' || (token.type === 'link' && !href))
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
                ? () => void Linking.openURL(href)
                : fileReference
                  ? (event) => {
                      event.stopPropagation?.();
                      onOpenFileReference?.(fileReference);
                    }
                  : undefined
            }
          >
            {token.type === 'text' ? (
              <FileLinkedText text={renderedText} onOpenFileReference={onOpenFileReference} />
            ) : (
              renderedText
            )}
          </Text>
        );
      })}
    </>
  );
}

export function NativeMarkdown({
  text,
  onOpenFileReference,
}: {
  text: string;
  onOpenFileReference?: (reference: MobileFileReference) => void;
}) {
  const blocks = React.useMemo(() => parseNativeMarkdown(text), [text]);
  return (
    <View style={styles.markdown}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Text
              selectable
              key={`heading:${index}`}
              style={[styles.heading, block.level <= 2 ? styles.headingLarge : styles.headingSmall]}
            >
              <InlineMarkdown text={block.text} onOpenFileReference={onOpenFileReference} />
            </Text>
          );
        }
        if (block.type === 'code') {
          const contentWidth = codeTextWidth(block.text);
          return (
            <View key={`code:${index}`} style={styles.codeBlock}>
              <ScrollView
                horizontal
                nestedScrollEnabled
                scrollEnabled
                showsHorizontalScrollIndicator
                style={styles.codeScroll}
                contentContainerStyle={styles.codeScrollContent}
              >
                <View style={[styles.codeContent, { width: contentWidth + 24 }]}>
                  <Text style={[styles.codeText, { width: contentWidth }]}>{block.text}</Text>
                </View>
              </ScrollView>
            </View>
          );
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
              <Text selectable style={styles.quoteText}>
                <InlineMarkdown text={block.text} onOpenFileReference={onOpenFileReference} />
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
                  <Text selectable style={styles.body}>
                    <InlineMarkdown text={item.text} onOpenFileReference={onOpenFileReference} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        if (block.type === 'divider')
          return <View key={`divider:${index}`} style={styles.divider} />;
        if (block.type === 'table') {
          const rows = [block.headers, ...block.rows];
          return (
            <ScrollView
              key={`table:${index}`}
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator
              style={styles.tableFrame}
            >
              <View style={styles.table}>
                {rows.map((row, rowIndex) => (
                  <View
                    key={rowIndex}
                    style={[styles.tableRow, rowIndex === 0 && styles.tableHead]}
                  >
                    {block.headers.map((_, cellIndex) => (
                      <Text
                        selectable
                        key={cellIndex}
                        style={[styles.tableCell, rowIndex === 0 && styles.tableHeadText]}
                      >
                        <InlineMarkdown
                          text={row[cellIndex] ?? ''}
                          onOpenFileReference={onOpenFileReference}
                        />
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        }
        return (
          <Text selectable key={`paragraph:${index}`} style={styles.body}>
            <InlineMarkdown text={block.text} onOpenFileReference={onOpenFileReference} />
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  markdown: { width: '100%', minWidth: 0, alignSelf: 'stretch', gap: 10 },
  body: { flex: 1, color: colors.assistantText, fontSize: 14, lineHeight: 21 },
  heading: { color: colors.text, fontWeight: '900', letterSpacing: -0.2 },
  headingLarge: { fontSize: 19, lineHeight: 25, marginTop: 3 },
  headingSmall: { fontSize: 16, lineHeight: 22, marginTop: 2 },
  strong: { fontWeight: '800', color: colors.text },
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
  codeBlock: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
    flexShrink: 1,
    borderWidth: 1,
    borderColor: colors.surface0,
    borderRadius: 10,
    backgroundColor: colors.crust,
    overflow: 'hidden',
  },
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
  codeText: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    flexShrink: 0,
  },
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
  tableFrame: {
    borderWidth: 1,
    borderColor: colors.surface1,
    borderRadius: 9,
    backgroundColor: colors.mantle,
  },
  table: { minWidth: 280 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.surface1 },
  tableHead: { backgroundColor: colors.surface0 },
  tableCell: {
    width: 150,
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: colors.surface1,
  },
  tableHeadText: { fontWeight: '900', color: colors.textStrong },
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
