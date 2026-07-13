import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  messageText,
  renderItemsFromMessages,
  toolLabel,
  type AssistantToolRenderItem,
} from '@drone/assistant-chat';
import { colors } from '../theme';
import type { LocalAssistantThread } from './local-assistant-types';

function ToolRow({ item }: { item: AssistantToolRenderItem }) {
  const failed = item.result?.isError === true;
  const pending = !item.result;
  return (
    <View style={[styles.toolRow, failed && styles.toolRowError]}>
      <View style={[styles.toolGlyph, failed && styles.toolGlyphError]}>
        <Text style={styles.toolGlyphText}>{pending ? '…' : failed ? '!' : '✓'}</Text>
      </View>
      <View style={styles.toolCopy}>
        <Text style={styles.toolTitle}>{toolLabel(item.call?.name ?? item.result?.toolName)}</Text>
        <Text numberOfLines={2} style={styles.toolSummary}>
          {failed
            ? item.result?.errorMessage
            : pending
              ? 'Waiting for the remote workspace'
              : messageText(item.result!).trim() || 'Completed'}
        </Text>
      </View>
    </View>
  );
}

export function LocalAssistantTranscript({ thread }: { thread: LocalAssistantThread }) {
  const items = React.useMemo(() => renderItemsFromMessages(thread.messages), [thread.messages]);
  if (items.length === 0) {
    return (
      <View style={styles.emptyTranscript}>
        <View style={styles.emptyOrbit}>
          <View style={styles.emptyCore} />
        </View>
        <Text style={styles.emptyTitle}>The assistant lives here.</Text>
        <Text style={styles.emptyBody}>
          Ask a question, or attach a remote workspace and let this phone inspect and edit it.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.messages}>
      {items.map((item) => {
        if (item.type === 'tool') return <ToolRow key={item.key} item={item} />;
        if (item.type === 'toolGroup') {
          return (
            <View key={item.key} style={styles.toolGroup}>
              <Text style={styles.toolGroupTitle}>
                {item.items.length} × {toolLabel(item.items[0]?.call?.name)}
              </Text>
              {item.items.map((tool) => (
                <ToolRow key={tool.key} item={tool} />
              ))}
            </View>
          );
        }
        const text = messageText(item.message).trim();
        if (!text) return null;
        const user = item.message.role === 'user';
        return (
          <View key={item.key} style={[styles.messageRow, user && styles.messageRowUser]}>
            <View style={[styles.messageBubble, user ? styles.userBubble : styles.assistantBubble]}>
              <Text style={styles.messageRole}>{user ? 'YOU' : 'PHONE ASSISTANT'}</Text>
              <Text style={styles.messageText}>{text}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  messages: { gap: 10 },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  messageRowUser: { justifyContent: 'flex-end' },
  messageBubble: { maxWidth: '88%', borderRadius: 15, paddingHorizontal: 13, paddingVertical: 11 },
  assistantBubble: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 4,
    borderColor: colors.border,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: colors.accentDark,
    borderTopRightRadius: 4,
    borderColor: '#28635d',
    borderWidth: 1,
  },
  messageRole: {
    color: colors.accent,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  messageText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  toolRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: '#091418',
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  toolRowError: { borderColor: '#653139' },
  toolGlyph: {
    width: 25,
    height: 25,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentDark,
  },
  toolGlyphError: { backgroundColor: '#35191d' },
  toolGlyphText: { color: colors.accent, fontSize: 11, fontWeight: '900' },
  toolCopy: { flex: 1, minWidth: 0 },
  toolTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  toolSummary: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  toolGroup: { gap: 6, borderLeftColor: colors.accentDark, borderLeftWidth: 2, paddingLeft: 8 },
  toolGroupTitle: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  emptyTranscript: {
    flex: 1,
    minHeight: 340,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  emptyOrbit: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 19,
  },
  emptyCore: {
    width: 18,
    height: 18,
    borderRadius: 6,
    backgroundColor: colors.accent,
    transform: [{ rotate: '45deg' }],
  },
  emptyTitle: { color: colors.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  emptyBody: {
    color: colors.muted,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
  },
});
