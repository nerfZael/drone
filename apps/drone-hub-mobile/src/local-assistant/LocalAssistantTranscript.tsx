import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  compactRepeatedToolItems,
  messageImageParts,
  messageText,
  renderItemsFromMessages,
  toolLabel,
  type AssistantMessage,
  type AssistantRenderItem,
  type AssistantToolRenderItem,
} from '@drone/assistant-chat';
import { colors } from '../theme';
import { QueuedPromptRows, type MobileQueuedPrompt } from '../components/QueuedPromptRows';
import { ContextMenu } from '../components/Ui';
import { NativeMarkdown } from './NativeMarkdown';
import { RelativeMessageTimestamp } from './RelativeMessageTimestamp';
import type { LocalAssistantThread } from './local-assistant-types';
import { LinkedPullRequestAttachments } from '../drones/LinkedPullRequestAttachment';
import type { MobileLinkedPullRequestContext } from '../drones/use-drone-linked-pull-requests';

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

function ConversationLoadingState() {
  const rotation = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View accessibilityLabel="Loading conversation" accessibilityRole="progressbar" style={styles.loadingTranscript}>
      <View style={styles.loadingSpinner}>
        <View style={styles.loadingSpinnerBase} />
        <Animated.View style={[styles.loadingSpinnerArc, { transform: [{ rotate }] }]} />
        <View style={styles.loadingSpinnerCore} />
      </View>
      <Text style={styles.loadingTranscriptText}>Loading conversation…</Text>
    </View>
  );
}

function TappableMessageView({
  children,
  onTap,
  onLongPress,
}: {
  children: any;
  onTap: () => void;
  onLongPress?: () => void;
}) {
  const touch = React.useRef({
    x: 0,
    y: 0,
    moved: false,
    active: false,
    longPressed: false,
    timer: null as ReturnType<typeof setTimeout> | null,
  });
  const clearLongPress = React.useCallback(() => {
    if (touch.current.timer) clearTimeout(touch.current.timer);
    touch.current.timer = null;
  }, []);
  React.useEffect(() => clearLongPress, [clearLongPress]);
  return (
    <View
      style={styles.message}
      onTouchStart={(event) => {
        clearLongPress();
        touch.current = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
          moved: false,
          active: true,
          longPressed: false,
          timer: onLongPress
            ? setTimeout(() => {
                if (!touch.current.active || touch.current.moved) return;
                touch.current.longPressed = true;
                onLongPress();
              }, 500)
            : null,
        };
      }}
      onTouchMove={(event) => {
        const current = touch.current;
        if (!current.active || current.moved) return;
        const dx = event.nativeEvent.pageX - current.x;
        const dy = event.nativeEvent.pageY - current.y;
        if (Math.hypot(dx, dy) > 8) {
          current.moved = true;
          clearLongPress();
        }
      }}
      onTouchEnd={() => {
        const current = touch.current;
        touch.current.active = false;
        clearLongPress();
        if (!current.moved && !current.longPressed) onTap();
      }}
      onTouchCancel={() => {
        touch.current.active = false;
        clearLongPress();
      }}
    >
      {children}
    </View>
  );
}

function ToolStatus({ failed, pending }: { failed: boolean; pending: boolean }) {
  return (
    <View style={styles.toolStatusSlot}>
      {pending ? (
        <View style={styles.toolStatusPending} />
      ) : (
        <View style={[styles.toolStatusCircle, failed && styles.toolStatusError]}>
          <Text style={styles.toolStatusText}>{failed ? '!' : '✓'}</Text>
        </View>
      )}
    </View>
  );
}

function formatTransferBytes(value: unknown): string {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function TransferToolRow({
  item,
  nested = false,
}: {
  item: AssistantToolRenderItem;
  nested?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const progress: any =
    item.result?.details && (item.result.details as any).type === 'workspace_transfer'
      ? item.result.details
      : null;
  const files = Array.isArray(progress?.files) ? progress.files : [];
  const total = Number(progress?.totalBytes ?? 0);
  const transferred = Number(progress?.transferredBytes ?? 0);
  const percent =
    total > 0
      ? Math.min(100, (transferred / total) * 100)
      : progress?.phase === 'completed'
        ? 100
        : 0;
  const failed = item.result?.isError === true || progress?.phase === 'failed';
  return (
    <View style={[styles.transfer, nested && styles.transferNested, failed && styles.toolError]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Transfer files, ${failed ? 'failed' : progress?.phase === 'completed' ? 'completed' : 'running'}`}
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.transferHead, pressed && styles.toolHeadPressed]}
      >
        <ToolStatus failed={failed} pending={!failed && progress?.phase !== 'completed'} />
        <View style={styles.toolCopy}>
          <View style={styles.transferTitleRow}>
            <Text style={styles.toolTitle}>Transfer files</Text>
            <Text style={styles.transferBytes}>
              {progress
                ? `${formatTransferBytes(transferred)} / ${formatTransferBytes(total)}`
                : 'Preparing…'}
            </Text>
          </View>
          <Text numberOfLines={1} style={styles.toolSummary}>
            {progress
              ? `${progress.source?.targetLabel ?? 'Source'} → ${progress.destination?.targetLabel ?? 'Destination'}`
              : 'Scanning files to transfer'}
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                failed && styles.progressFailed,
                { width: `${percent}%` },
              ]}
            />
          </View>
          <View style={styles.transferMeta}>
            <Text style={styles.transferMetaText}>
              {progress?.phase === 'planning'
                ? 'Scanning folder…'
                : `${progress?.completedFiles ?? 0} of ${progress?.fileCount ?? 0} files`}
            </Text>
            <Text style={styles.transferMetaText}>
              {progress?.retries
                ? `${progress.retries} ${progress.retries === 1 ? 'retry' : 'retries'}`
                : `${Math.round(percent)}%`}
            </Text>
          </View>
          {failed && progress?.failure?.error ? (
            <Text style={styles.transferError}>
              {progress.failure.error}
              {progress.failure.cleanupError ? ` Cleanup: ${progress.failure.cleanupError}` : ''}
            </Text>
          ) : null}
          {failed && progress?.resumeToken ? (
            <Text style={styles.transferMetaText}>
              Resume available after {progress.completedFiles ?? 0} committed files.
            </Text>
          ) : null}
        </View>
      </Pressable>
      {open && files.length > 0 ? (
        <View style={styles.transferFiles}>
          {files.map((file: any, index: number) => {
            const filePercent =
              file.size > 0
                ? Math.min(100, (Number(file.transferredBytes ?? 0) / file.size) * 100)
                : file.status === 'completed'
                  ? 100
                  : 0;
            return (
              <View key={`${file.destinationPath}-${index}`} style={styles.transferFile}>
                <View style={styles.transferFileHead}>
                  <Text numberOfLines={1} style={styles.transferFileName}>
                    {file.sourcePath}
                  </Text>
                  <Text
                    style={[
                      styles.transferFileBytes,
                      file.status === 'retrying' && styles.transferRetry,
                    ]}
                  >
                    {file.status === 'retrying' ? `Retry ${file.retries}/5 · ` : ''}
                    {formatTransferBytes(file.transferredBytes)} / {formatTransferBytes(file.size)}
                  </Text>
                </View>
                <View style={styles.fileProgressTrack}>
                  <View
                    style={[
                      styles.fileProgressFill,
                      file.status === 'retrying' && styles.fileProgressRetry,
                      file.status === 'failed' && styles.progressFailed,
                      { width: `${filePercent}%` },
                    ]}
                  />
                </View>
                {file.error && (file.status === 'retrying' || file.status === 'failed') ? (
                  <Text numberOfLines={1} style={styles.transferError}>
                    {file.error}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {Number(progress?.filesTruncated ?? 0) > 0 ? (
            <Text style={styles.transferMetaText}>
              {progress.filesTruncated} additional file rows omitted from local history.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ToolRow({ item, nested = false }: { item: AssistantToolRenderItem; nested?: boolean }) {
  const [open, setOpen] = React.useState(false);
  if ((item.call?.name ?? item.result?.toolName) === 'transfer_files') {
    return <TransferToolRow item={item} nested={nested} />;
  }
  const failed = item.result?.isError === true;
  const pending = !item.result;
  const args = item.call?.args;
  const result = item.result
    ? messageText(item.result).trim() || String(item.result.errorMessage ?? '').trim()
    : '';
  return (
    <View style={[styles.tool, nested && styles.toolNested, failed && styles.toolError]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${toolLabel(item.call?.name ?? item.result?.toolName)}, ${pending ? 'running' : failed ? 'failed' : 'completed'}`}
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.toolHead, pressed && styles.toolHeadPressed]}
      >
        <ToolStatus failed={failed} pending={pending} />
        <View style={styles.toolCopy}>
          <Text numberOfLines={1} style={styles.toolTitle}>
            {toolLabel(item.call?.name ?? item.result?.toolName)}
          </Text>
        </View>
      </Pressable>
      {open ? (
        <View style={styles.toolDetails}>
          {args !== undefined ? (
            <>
              <Text style={styles.detailLabel}>ARGUMENTS</Text>
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
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
    </View>
  );
}

function ToolGroupRow({ item }: { item: Extract<AssistantRenderItem, { type: 'toolGroup' }> }) {
  const [open, setOpen] = React.useState(false);
  const failed = item.items.some((tool) => tool.result?.isError === true);
  const pending = item.items.some((tool) => !tool.result);
  const name = toolLabel(item.items[0]?.call?.name ?? item.items[0]?.result?.toolName);
  return (
    <View style={[styles.tool, failed && styles.toolError]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${item.items.length} calls, ${pending ? 'running' : failed ? 'failed' : 'completed'}`}
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.toolHead, pressed && styles.toolHeadPressed]}
      >
        <ToolStatus failed={failed} pending={pending} />
        <View style={styles.toolCopy}>
          <View style={styles.toolTitleRow}>
            <Text numberOfLines={1} style={styles.toolTitle}>
              {name}
            </Text>
            <Text style={styles.toolCount}>×{item.items.length}</Text>
          </View>
        </View>
      </Pressable>
      {open ? (
        <View style={styles.groupDetails}>
          {item.items.map((tool) => (
            <ToolRow key={tool.key} item={tool} nested />
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

function messageTimestamp(message: AssistantMessage): string | number | undefined {
  return message.createdAt ?? message.timestamp;
}

function hasVisibleMessageContent(message: AssistantMessage): boolean {
  return Boolean(
    visibleMessageText(message).trim() ||
    messageImageParts(message).length > 0 ||
    attachments(message).length > 0 ||
    message.errorMessage,
  );
}

export function MobileAssistantTranscript({
  messages,
  running = false,
  currentReasoning = '',
  queuedPrompts = [],
  cancellingPromptId = '',
  onCancelQueuedPrompt,
  loading = false,
  emptyTitle = 'The assistant lives here.',
  emptyBody = 'Ask a question, or attach a remote workspace and let this phone inspect and edit it.',
  assistantLabel = 'Assistant',
  messageActionsDisabled = false,
  onDeleteMessageRequest,
  onLoadFullMessage,
  fullMessageLoadingId = '',
  linkedPullRequests,
}: {
  messages: AssistantMessage[];
  running?: boolean;
  currentReasoning?: string;
  queuedPrompts?: MobileQueuedPrompt[];
  cancellingPromptId?: string;
  onCancelQueuedPrompt?: (promptId: string) => void;
  loading?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  assistantLabel?: string;
  messageActionsDisabled?: boolean;
  onDeleteMessageRequest?: (input: {
    message: AssistantMessage;
    sourceMessageIndex: number;
    deleteFollowing: boolean;
  }) => void;
  onLoadFullMessage?: (message: AssistantMessage) => void;
  fullMessageLoadingId?: string;
  linkedPullRequests?: MobileLinkedPullRequestContext;
}) {
  const items = React.useMemo(
    () =>
      compactRepeatedToolItems(
        renderItemsFromMessages(messages).filter(
          (item) => item.type !== 'message' || hasVisibleMessageContent(item.message),
        ),
      ),
    [messages],
  );
  const [visibleMessageTimestamps, setVisibleMessageTimestamps] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [messageActionTarget, setMessageActionTarget] = React.useState<{
    message: AssistantMessage;
    sourceMessageIndex: number;
  } | null>(null);
  const toggleMessageTimestamp = React.useCallback((key: string) => {
    setVisibleMessageTimestamps((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  if (loading) {
    return <ConversationLoadingState />;
  }
  const activePrompts = queuedPrompts.filter((prompt) => prompt.status === 'pending');
  const inactivePrompts = queuedPrompts.filter((prompt) => prompt.status !== 'pending');
  if (items.length === 0 && !running && queuedPrompts.length === 0) {
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
        const timestamp = messageTimestamp(item.message);
        const timestampKey = `${item.key}:${String(timestamp ?? '')}`;
        const timestampVisible = visibleMessageTimestamps.has(timestampKey);
        const openMessageActions =
          onDeleteMessageRequest && !messageActionsDisabled
            ? () =>
                setMessageActionTarget({
                  message: item.message,
                  sourceMessageIndex: item.sourceMessageIndex,
                })
            : undefined;
        const content = (
          <>
            {text && assistant ? (
              <>
                <NativeMarkdown text={text} />
                <LinkedPullRequestAttachments text={text} context={linkedPullRequests} />
              </>
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
            {item.message.meshTruncated ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Load the full message"
                accessibilityState={{
                  disabled:
                    !item.message.id ||
                    !onLoadFullMessage ||
                    fullMessageLoadingId === item.message.id,
                }}
                disabled={
                  !item.message.id || !onLoadFullMessage || fullMessageLoadingId === item.message.id
                }
                onPress={() => onLoadFullMessage?.(item.message)}
                style={({ pressed }) => [
                  styles.fullMessageButton,
                  pressed && styles.fullMessageButtonPressed,
                ]}
              >
                {fullMessageLoadingId === item.message.id ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Text style={styles.fullMessageText}>Load full message</Text>
                )}
              </Pressable>
            ) : null}
          </>
        );
        if (user) {
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityHint={
                openMessageActions
                  ? 'Tap to show the timestamp. Press and hold for message actions.'
                  : 'Shows or hides this message timestamp'
              }
              accessibilityState={{ expanded: timestampVisible }}
              onPress={() => toggleMessageTimestamp(timestampKey)}
              onLongPress={openMessageActions}
              delayLongPress={500}
              style={styles.userMessageGroup}
            >
              {timestampVisible ? (
                <RelativeMessageTimestamp timestamp={timestamp} style={styles.userMessageTime} />
              ) : null}
              <View style={[styles.message, styles.userMessage]}>{content}</View>
            </Pressable>
          );
        }
        return (
          <TappableMessageView
            key={item.key}
            onTap={() => toggleMessageTimestamp(timestampKey)}
            onLongPress={openMessageActions}
          >
            {content}
            {timestampVisible ? (
              <RelativeMessageTimestamp timestamp={timestamp} style={styles.messageTime} />
            ) : null}
          </TappableMessageView>
        );
      })}
      {activePrompts.length > 0 ? (
        <QueuedPromptRows
          prompts={activePrompts}
          cancellingId={cancellingPromptId}
          onCancel={onCancelQueuedPrompt}
        />
      ) : null}
      {running ? (
        currentReasoning.trim() ? (
          <View style={styles.reasoning}>
            <Text style={styles.messageRole}>{assistantLabel}</Text>
            <View style={styles.reasoningHead}>
              <TypingDots label={`${assistantLabel} is working`} />
              <Text style={styles.reasoningLabel}>Reasoning</Text>
            </View>
            <Text style={styles.reasoningText}>{currentReasoning.trim()}</Text>
          </View>
        ) : (
          <View style={styles.waiting}>
            <Text style={styles.messageRole}>{assistantLabel}</Text>
            <TypingDots label={`${assistantLabel} is working`} />
          </View>
        )
      ) : null}
      {inactivePrompts.length > 0 ? (
        <QueuedPromptRows
          prompts={inactivePrompts}
          cancellingId={cancellingPromptId}
          onCancel={onCancelQueuedPrompt}
        />
      ) : null}
      <ContextMenu
        visible={Boolean(messageActionTarget)}
        title="Message actions"
        actions={[
          {
            label: 'Delete message',
            destructive: true,
            onPress: () => {
              if (!messageActionTarget) return;
              onDeleteMessageRequest?.({ ...messageActionTarget, deleteFollowing: false });
            },
          },
          {
            label: 'Delete message and everything below',
            destructive: true,
            onPress: () => {
              if (!messageActionTarget) return;
              onDeleteMessageRequest?.({ ...messageActionTarget, deleteFollowing: true });
            },
          },
        ]}
        onClose={() => setMessageActionTarget(null)}
      />
    </View>
  );
}

export function LocalAssistantTranscript({
  thread,
  running = false,
  currentReasoning = '',
  messageActionsDisabled = false,
  onDeleteMessageRequest,
}: {
  thread: LocalAssistantThread;
  running?: boolean;
  currentReasoning?: string;
  messageActionsDisabled?: boolean;
  onDeleteMessageRequest?: (input: {
    message: AssistantMessage;
    sourceMessageIndex: number;
    deleteFollowing: boolean;
  }) => void;
}) {
  return (
    <MobileAssistantTranscript
      messages={thread.messages}
      running={running}
      currentReasoning={currentReasoning}
      messageActionsDisabled={messageActionsDisabled}
      onDeleteMessageRequest={onDeleteMessageRequest}
    />
  );
}

const styles = StyleSheet.create({
  messages: { gap: 0 },
  message: { width: '100%', paddingHorizontal: 10, paddingVertical: 13 },
  userMessageGroup: {
    width: 'auto',
    maxWidth: '86%',
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    marginHorizontal: 10,
    marginVertical: 7,
  },
  userMessage: {
    width: 'auto',
    maxWidth: '100%',
    alignSelf: 'flex-end',
    paddingHorizontal: 13,
    paddingVertical: 10,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.surface2,
    borderRadius: 10,
    borderBottomRightRadius: 3,
  },
  messageText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  userMessageText: { color: colors.textStrong },
  messageTime: {
    alignSelf: 'flex-start',
    color: colors.subtle,
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginTop: 7,
  },
  userMessageTime: {
    alignSelf: 'flex-end',
    color: colors.muted,
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginRight: 3,
    marginBottom: 4,
  },
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
  fullMessageButton: {
    minHeight: 32,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
    paddingHorizontal: 11,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentWash,
  },
  fullMessageButtonPressed: { opacity: 0.72 },
  fullMessageText: { color: colors.accent, fontSize: 11, fontWeight: '800' },
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
    borderRadius: 6,
    borderColor: colors.surface1,
    borderWidth: 1,
    backgroundColor: colors.whiteWashSoft,
    marginHorizontal: 10,
    marginVertical: 2,
  },
  toolNested: { marginHorizontal: 0, backgroundColor: colors.crust },
  toolError: { borderColor: colors.dangerBorder },
  toolHead: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  toolHeadPressed: { backgroundColor: colors.whiteWash },
  toolStatusSlot: {
    width: 13,
    height: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolStatusPending: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  toolStatusCircle: {
    width: 13,
    height: 13,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.online,
  },
  toolStatusError: { backgroundColor: colors.danger },
  toolStatusText: {
    color: colors.crust,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '900',
    includeFontPadding: false,
  },
  toolCopy: { flex: 1, minWidth: 0 },
  toolTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  toolTitle: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  toolCount: {
    color: colors.subtle,
    fontSize: 9,
    fontWeight: '800',
  },
  toolDetails: {
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.surface1,
    backgroundColor: colors.mantle,
  },
  detailLabel: { color: colors.accent, fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  detailText: { color: colors.muted, fontSize: 10, lineHeight: 15, fontFamily: 'monospace' },
  groupDetails: {
    gap: 2,
    padding: 5,
    borderTopWidth: 1,
    borderTopColor: colors.surface1,
    backgroundColor: colors.mantle,
  },
  transfer: {
    borderRadius: 6,
    borderColor: colors.surface1,
    borderWidth: 1,
    backgroundColor: colors.whiteWashSoft,
    marginHorizontal: 10,
    marginVertical: 2,
    overflow: 'hidden',
  },
  transferNested: { marginHorizontal: 0, backgroundColor: colors.crust },
  transferHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  transferTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  toolSummary: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  transferBytes: { color: colors.muted, fontSize: 8, fontFamily: 'monospace' },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: colors.surface0,
    marginTop: 9,
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
  progressFailed: { backgroundColor: colors.danger },
  transferMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  transferMetaText: { color: colors.subtle, fontSize: 8, fontFamily: 'monospace' },
  transferFiles: { gap: 5, padding: 8, borderTopWidth: 1, borderTopColor: colors.surface1 },
  transferFile: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 5,
    backgroundColor: colors.background,
    padding: 7,
  },
  transferFileHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  transferFileName: { color: colors.text, fontSize: 9, flex: 1, minWidth: 0 },
  transferFileBytes: { color: colors.subtle, fontSize: 7, fontFamily: 'monospace' },
  transferRetry: { color: colors.warning },
  fileProgressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.surface0,
    marginTop: 6,
  },
  fileProgressFill: { height: '100%', borderRadius: 2, backgroundColor: colors.online },
  fileProgressRetry: { backgroundColor: colors.warning },
  transferError: { color: colors.subtle, fontSize: 7, marginTop: 5 },
  reasoning: {
    marginHorizontal: 10,
    marginVertical: 12,
    padding: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  waiting: { alignSelf: 'flex-start', gap: 2, marginHorizontal: 10, marginVertical: 10 },
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
  loadingTranscript: {
    flex: 1,
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingSpinner: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  loadingSpinnerBase: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.whiteWashSoft,
  },
  loadingSpinnerArc: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    borderTopColor: colors.accent,
  },
  loadingSpinnerCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  loadingTranscriptText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
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
