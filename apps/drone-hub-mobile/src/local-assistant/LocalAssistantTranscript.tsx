import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  messageImageParts,
  messageText,
  renderItemsFromMessages,
  toolLabel,
  type AssistantMessage,
  type AssistantRenderItem,
  type AssistantToolRenderItem,
} from '@drone/assistant-chat';
import { colors } from '../theme';
import { NativeMarkdown } from './NativeMarkdown';
import type { LocalAssistantThread } from './local-assistant-types';

function TypingDots({ label = 'Assistant is working' }: { label?: string }) {
  const dots = React.useRef([
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;

  React.useEffect(() => {
    const animations = dots.map((dot, index) =>
      Animated.sequence([
        Animated.delay(index * 160),
        Animated.loop(
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 0.35,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 1,
              duration: 1000,
              useNativeDriver: true,
            }),
          ]),
        ),
      ]),
    );
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [dots]);

  return (
    <View accessibilityLabel={label} style={styles.typingDots}>
      {dots.map((opacity, index) => (
        <Animated.View key={index} style={[styles.typingDot, { opacity }]} />
      ))}
    </View>
  );
}

function ToolRow({ item }: { item: AssistantToolRenderItem }) {
  const failed = item.result?.isError === true;
  const pending = !item.result;
  const [open, setOpen] = React.useState(false);
  const args = item.call?.args;
  const result = item.result
    ? messageText(item.result).trim() || String(item.result.errorMessage ?? '').trim()
    : '';
  return (
    <Pressable
      onPress={() => setOpen((value) => !value)}
      style={[styles.tool, failed && styles.toolError]}
    >
      <View style={styles.toolHead}>
        <View style={[styles.toolGlyph, failed && styles.toolGlyphError]}>
          <Text style={styles.toolGlyphText}>{pending ? '…' : failed ? '!' : '✓'}</Text>
        </View>
        <View style={styles.toolCopy}>
          <Text style={styles.toolTitle}>
            {toolLabel(item.call?.name ?? item.result?.toolName)}
          </Text>
          <Text numberOfLines={open ? undefined : 1} style={styles.toolSummary}>
            {failed
              ? item.result?.errorMessage
              : pending
                ? 'Waiting for result'
                : result || 'Completed'}
          </Text>
        </View>
        <Text style={styles.disclosure}>{open ? '−' : '+'}</Text>
      </View>
      {open ? (
        <View style={styles.toolDetails}>
          {args !== undefined ? (
            <>
              <Text style={styles.detailLabel}>ARGUMENTS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text selectable style={styles.detailText}>
                  {JSON.stringify(args, null, 2)}
                </Text>
              </ScrollView>
            </>
          ) : null}
          <Text style={styles.detailLabel}>RESULT</Text>
          <Text selectable style={styles.detailText}>
            {result || (pending ? 'Waiting…' : 'No result payload.')}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ToolGroupRow({ item }: { item: Extract<AssistantRenderItem, { type: 'toolGroup' }> }) {
  const [open, setOpen] = React.useState(false);
  const failed = item.items.some((tool) => tool.result?.isError === true);
  const pending = item.items.some((tool) => !tool.result);
  const name = toolLabel(item.items[0]?.call?.name ?? item.items[0]?.result?.toolName);
  return (
    <View style={[styles.tool, failed && styles.toolError]}>
      <Pressable onPress={() => setOpen((value) => !value)} style={styles.toolHead}>
        <View style={[styles.toolGlyph, failed && styles.toolGlyphError]}>
          <Text style={styles.toolGlyphText}>{pending ? '…' : failed ? '!' : '✓'}</Text>
        </View>
        <View style={styles.toolCopy}>
          <Text style={styles.toolTitle}>
            {name} × {item.items.length}
          </Text>
          <Text style={styles.toolSummary}>
            {pending ? 'Tools are running' : failed ? 'One or more calls failed' : 'Completed'}
          </Text>
        </View>
        <Text style={styles.disclosure}>{open ? '−' : '+'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.groupDetails}>
          {item.items.map((tool) => (
            <ToolRow key={tool.key} item={tool} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function attachments(message: any): any[] {
  return Array.isArray(message?.attachments)
    ? message.attachments
    : Array.isArray(message?.details?.attachments)
      ? message.details.attachments
      : [];
}

function visibleMessageText(message: AssistantMessage): string {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return messageText(message);
  return message.content
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text ?? ''))
    .filter(Boolean)
    .join('\n');
}

export function MobileAssistantTranscript({
  messages,
  running = false,
  currentReasoning = '',
  loading = false,
  emptyTitle = 'The assistant lives here.',
  emptyBody = 'Ask a question, or attach a remote workspace and let this phone inspect and edit it.',
  assistantLabel = 'Assistant',
}: {
  messages: AssistantMessage[];
  running?: boolean;
  currentReasoning?: string;
  loading?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  assistantLabel?: string;
}) {
  const items = React.useMemo(() => renderItemsFromMessages(messages), [messages]);
  if (loading) {
    return (
      <View style={styles.loadingTranscript}>
        <ActivityIndicator color={colors.accent} size="small" />
      </View>
    );
  }
  const lastUserIndex = messages.reduce(
    (latest, message, index) => (message.role === 'user' ? index : latest),
    -1,
  );
  const assistantStarted = messages.slice(lastUserIndex + 1).some((message) => {
    if (message.role !== 'assistant') return false;
    return Boolean(
      visibleMessageText(message).trim() ||
      messageImageParts(message).length > 0 ||
      attachments(message).length > 0 ||
      message.errorMessage,
    );
  });
  if (items.length === 0 && !running) {
    return (
      <View style={styles.emptyTranscript}>
        <View style={styles.emptyOrbit}>
          <View style={styles.emptyCore} />
        </View>
        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
        <Text style={styles.emptyBody}>{emptyBody}</Text>
      </View>
    );
  }
  return (
    <View style={styles.messages}>
      {items.map((item) => {
        if (item.type === 'tool') return <ToolRow key={item.key} item={item} />;
        if (item.type === 'toolGroup') {
          return <ToolGroupRow key={item.key} item={item} />;
        }
        const text = visibleMessageText(item.message).trim();
        const images = messageImageParts(item.message);
        const files = attachments(item.message);
        if (!text && images.length === 0 && files.length === 0 && !item.message.errorMessage)
          return null;
        const user = item.message.role === 'user';
        const assistant = item.message.role === 'assistant';
        return (
          <View key={item.key} style={[styles.message, user && styles.userMessage]}>
            {text && assistant ? (
              <NativeMarkdown text={text} />
            ) : text ? (
              <Text selectable style={[styles.messageText, user && styles.userMessageText]}>
                {text}
              </Text>
            ) : null}
            {item.message.errorMessage ? (
              <Text style={styles.messageError}>{item.message.errorMessage}</Text>
            ) : null}
            {images.length > 0 ? (
              <View style={styles.images}>
                {images.map((image, index) => (
                  <Image
                    key={`${image.mimeType}:${index}`}
                    source={{ uri: `data:${image.mimeType};base64,${image.data}` }}
                    resizeMode="contain"
                    style={styles.image}
                  />
                ))}
              </View>
            ) : null}
            {files.length > 0 ? (
              <View style={styles.attachments}>
                {files.map((file, index) => (
                  <View key={String(file?.id ?? file?.name ?? index)} style={styles.attachment}>
                    <Text style={styles.attachmentIcon}>▧</Text>
                    <View style={styles.attachmentCopy}>
                      <Text numberOfLines={1} style={styles.attachmentName}>
                        {String(file?.name ?? 'Attachment')}
                      </Text>
                      <Text numberOfLines={1} style={styles.attachmentMeta}>
                        {String(file?.mime ?? file?.mimeType ?? 'file')}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {running ? (
        currentReasoning.trim() ? (
          <View style={styles.reasoning}>
            {!assistantStarted ? <Text style={styles.messageRole}>{assistantLabel}</Text> : null}
            <View style={styles.reasoningHead}>
              <TypingDots label={`${assistantLabel} is working`} />
              <Text style={styles.reasoningLabel}>Reasoning</Text>
            </View>
            <Text style={styles.reasoningText}>{currentReasoning.trim()}</Text>
          </View>
        ) : (
          <View style={styles.waiting}>
            {!assistantStarted ? <Text style={styles.messageRole}>{assistantLabel}</Text> : null}
            <TypingDots label={`${assistantLabel} is working`} />
          </View>
        )
      ) : null}
    </View>
  );
}

export function LocalAssistantTranscript({
  thread,
  running = false,
  currentReasoning = '',
}: {
  thread: LocalAssistantThread;
  running?: boolean;
  currentReasoning?: string;
}) {
  return (
    <MobileAssistantTranscript
      messages={thread.messages}
      running={running}
      currentReasoning={currentReasoning}
    />
  );
}

const styles = StyleSheet.create({
  messages: { gap: 0 },
  message: { width: '100%', paddingHorizontal: 14, paddingVertical: 13 },
  userMessage: {
    width: 'auto',
    maxWidth: '86%',
    alignSelf: 'flex-end',
    marginHorizontal: 12,
    marginVertical: 5,
    backgroundColor: colors.accentDark,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: 16,
    borderBottomRightRadius: 5,
  },
  messageText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  userMessageText: { color: colors.textStrong },
  messageRole: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  messageError: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: 5 },
  images: { gap: 8, marginTop: 9 },
  image: { width: '100%', height: 220, borderRadius: 12, backgroundColor: colors.panel },
  attachments: { gap: 6, marginTop: 9 },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 9,
  },
  attachmentIcon: { color: colors.accent, fontSize: 18 },
  attachmentCopy: { flex: 1, minWidth: 0 },
  attachmentName: { color: colors.text, fontSize: 11, fontWeight: '700' },
  attachmentMeta: { color: colors.muted, fontSize: 9, marginTop: 2 },
  tool: {
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.panel,
    marginHorizontal: 12,
    marginVertical: 3,
  },
  toolError: { borderColor: colors.dangerBorder },
  toolHead: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  toolGlyph: {
    width: 25,
    height: 25,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentDark,
  },
  toolGlyphError: { backgroundColor: colors.dangerDark },
  toolGlyphText: { color: colors.accent, fontSize: 11, fontWeight: '900' },
  toolCopy: { flex: 1, minWidth: 0 },
  toolTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  toolSummary: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  disclosure: { color: colors.muted, fontSize: 18, width: 22, textAlign: 'center' },
  toolDetails: { gap: 6, padding: 11, borderTopWidth: 1, borderTopColor: colors.border },
  detailLabel: { color: colors.accent, fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  detailText: { color: colors.muted, fontSize: 10, lineHeight: 15, fontFamily: 'monospace' },
  groupDetails: { gap: 1, paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border },
  reasoning: {
    margin: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  waiting: { alignSelf: 'flex-start', gap: 2, marginHorizontal: 12, marginVertical: 10 },
  reasoningHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reasoningLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  reasoningText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 9 },
  typingDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  emptyTranscript: {
    flex: 1,
    minHeight: 340,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  loadingTranscript: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center' },
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
