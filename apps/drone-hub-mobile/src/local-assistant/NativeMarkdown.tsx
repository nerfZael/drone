import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import {
  parseNativeMarkdown,
  parseNativeMarkdownInline,
  type NativeMarkdownInline,
} from './native-markdown-model';

function safeLink(value: string): string | null {
  const link = String(value ?? '').trim();
  return /^(?:https?:|mailto:)/i.test(link) ? link : null;
}

function InlineMarkdown({ text }: { text: string }) {
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
        return (
          <Text
            key={`${token.type}:${index}`}
            style={style}
            accessibilityRole={href ? 'link' : undefined}
            onPress={href ? () => void Linking.openURL(href) : undefined}
          >
            {token.text}
          </Text>
        );
      })}
    </>
  );
}

export function NativeMarkdown({ text }: { text: string }) {
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
              <InlineMarkdown text={block.text} />
            </Text>
          );
        }
        if (block.type === 'code') {
          return (
            <View key={`code:${index}`} style={styles.codeBlock}>
              {block.language ? <Text style={styles.codeLanguage}>{block.language}</Text> : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text selectable style={styles.codeText}>
                  {block.text}
                </Text>
              </ScrollView>
            </View>
          );
        }
        if (block.type === 'quote') {
          return (
            <View
              key={`quote:${index}`}
              style={[styles.quote, block.callout ? styles.callout : null]}
            >
              {block.callout ? <Text style={styles.calloutLabel}>{block.callout}</Text> : null}
              <Text selectable style={styles.quoteText}>
                <InlineMarkdown text={block.text} />
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
                    <InlineMarkdown text={item.text} />
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
                        <InlineMarkdown text={row[cellIndex] ?? ''} />
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
            <InlineMarkdown text={block.text} />
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  markdown: { gap: 10 },
  body: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 21 },
  heading: { color: colors.text, fontWeight: '900', letterSpacing: -0.2 },
  headingLarge: { fontSize: 19, lineHeight: 25, marginTop: 3 },
  headingSmall: { fontSize: 16, lineHeight: 22, marginTop: 2 },
  strong: { fontWeight: '900', color: '#eef8fa' },
  emphasis: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through', color: colors.muted },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  inlineCode: {
    color: '#b7ece4',
    backgroundColor: 'rgba(98,217,199,0.09)',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  codeBlock: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: '#071014',
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  codeLanguage: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 7,
  },
  codeText: { color: '#c7d8dc', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  callout: { borderLeftColor: colors.accent, backgroundColor: 'rgba(98,217,199,0.055)' },
  calloutLabel: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 5,
  },
  quoteText: { color: '#b9c9cd', fontSize: 13, lineHeight: 20 },
  list: { gap: 5 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  listMarker: { width: 22, color: colors.accent, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  tableFrame: { borderWidth: 1, borderColor: colors.border, borderRadius: 9 },
  table: { minWidth: 280 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHead: { backgroundColor: 'rgba(255,255,255,0.035)' },
  tableCell: {
    width: 150,
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  tableHeadText: { fontWeight: '900', color: '#dcebed' },
});
