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
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
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
import {
  parseMobileFileReference,
  splitMobileFileReferences,
  type MobileFileReference,
} from './file-reference';
import { RelativeMessageTimestamp } from './RelativeMessageTimestamp';
import type { LocalAssistantThread } from './local-assistant-types';
import { LinkedPullRequestAttachments } from '../drones/LinkedPullRequestAttachment';
import type { MobileLinkedPullRequestContext } from '../drones/use-drone-linked-pull-requests';
import {
  groupMobileTranscriptRuns,
  workingDurationLabel,
  type MobileAgentPlan,
  type MobileTranscriptRun,
} from './mobile-transcript-runs';
import { shouldToggleMessageTimestamp } from './message-touch-model';

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

function ChangedFilesSummary({
  item,
  onLoadDiff,
}: {
  item: Extract<AssistantRenderItem, { type: 'runSummary' }>;
  onLoadDiff?: (input: { artifactId: string; path: string }) => Promise<{
    patch: string;
    truncated?: boolean;
  }>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [openDiffKey, setOpenDiffKey] = React.useState('');
  const [diffs, setDiffs] = React.useState<
    Record<
      string,
      | { status: 'loading' }
      | { status: 'loaded'; patch: string; truncated: boolean }
      | { status: 'error'; message: string; retryable: boolean }
    >
  >({});
  const summary = item.fileChanges;
  const openDiff = (artifactId: string, filePath: string, force = false) => {
    if (!onLoadDiff) return;
    const key = `${artifactId}\u0000${filePath}`;
    if (!force && openDiffKey === key) {
      setOpenDiffKey('');
      return;
    }
    setOpenDiffKey(key);
    if (!force && diffs[key]) return;
    setDiffs((current) => ({ ...current, [key]: { status: 'loading' } }));
    void onLoadDiff({ artifactId, path: filePath })
      .then((result) => {
        setDiffs((current) => ({
          ...current,
          [key]: {
            status: 'loaded',
            patch: String(result.patch ?? ''),
            truncated: result.truncated === true,
          },
        }));
      })
      .catch((error: any) => {
        const errorCode = String(error?.code ?? '');
        const hubStatus = Number(/^HUB_(\d+)$/.exec(errorCode)?.[1] ?? 0);
        const terminal =
          errorCode === 'INVALID_REQUEST' ||
          (hubStatus >= 400 && hubStatus < 500 && hubStatus !== 408 && hubStatus !== 429);
        setDiffs((current) => ({
          ...current,
          [key]: {
            status: 'error',
            message: String(error?.message ?? error ?? 'Unable to load historical diff.'),
            retryable: !terminal,
          },
        }));
      });
  };
  return (
    <View style={styles.changedFilesCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${summary.counts.changed} changed files`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.changedFilesHeader, pressed && styles.changedFilesPressed]}
      >
        <View style={styles.changedFilesTitleBlock}>
          <Text style={styles.changedFilesTitle}>Changed files</Text>
          <Text style={styles.changedFilesSubtitle}>
            {summary.counts.changed} {summary.counts.changed === 1 ? 'file' : 'files'}
          </Text>
        </View>
        <View style={styles.changedFilesCounts}>
          {summary.counts.additions > 0 ? (
            <Text style={styles.changedFilesAdditions}>+{summary.counts.additions}</Text>
          ) : null}
          {summary.counts.deletions > 0 ? (
            <Text style={styles.changedFilesDeletions}>-{summary.counts.deletions}</Text>
          ) : null}
          {expanded ? (
            <ChevronDown color={colors.muted} size={14} />
          ) : (
            <ChevronRight color={colors.muted} size={14} />
          )}
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.changedFilesList}>
          {summary.workspaces.map((workspace) => (
            <View key={workspace.targetId}>
              {summary.workspaces.length > 1 ? (
                <Text style={styles.changedFilesWorkspace}>{workspace.label}</Text>
              ) : null}
              {workspace.entries.map((entry) => {
                const artifactId = workspace.diffArtifactId;
                const diffKey = artifactId ? `${artifactId}\u0000${entry.path}` : '';
                const open = Boolean(diffKey && openDiffKey === diffKey);
                const diff = diffKey ? diffs[diffKey] : undefined;
                const row = (
                  <View style={styles.changedFilesRow}>
                    <Text style={styles.changedFilesStatus}>
                      {entry.status === 'added'
                        ? 'A'
                        : entry.status === 'deleted'
                          ? 'D'
                          : entry.status === 'renamed'
                            ? 'R'
                            : 'M'}
                    </Text>
                    <Text numberOfLines={1} style={styles.changedFilesPath}>
                      {entry.path}
                    </Text>
                    {!entry.binary && (entry.additions > 0 || entry.deletions > 0) ? (
                      <Text style={styles.changedFilesLineCounts}>
                        {entry.additions > 0 ? `+${entry.additions}` : ''}
                        {entry.additions > 0 && entry.deletions > 0 ? ' ' : ''}
                        {entry.deletions > 0 ? `-${entry.deletions}` : ''}
                      </Text>
                    ) : null}
                    {artifactId && onLoadDiff ? (
                      open ? (
                        <ChevronDown color={colors.muted} size={12} />
                      ) : (
                        <ChevronRight color={colors.muted} size={12} />
                      )
                    ) : null}
                  </View>
                );
                return (
                  <View key={`${entry.status}:${entry.path}`}>
                    {artifactId && onLoadDiff ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Show the diff captured for ${entry.path}`}
                        accessibilityState={{ expanded: open }}
                        onPress={() => openDiff(artifactId, entry.path)}
                        style={({ pressed }) => pressed && styles.changedFilesPressed}
                      >
                        {row}
                      </Pressable>
                    ) : (
                      row
                    )}
                    {open && diff ? (
                      <View style={styles.changedFilesDiffPanel}>
                        {diff.status === 'loading' ? (
                          <View style={styles.changedFilesDiffLoading}>
                            <ActivityIndicator color={colors.accent} size="small" />
                            <Text style={styles.changedFilesDiffHint}>
                              Loading historical diff…
                            </Text>
                          </View>
                        ) : diff.status === 'error' && diff.retryable ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Retry loading historical diff"
                            onPress={() => openDiff(artifactId!, entry.path, true)}
                            style={({ pressed }) => [
                              styles.changedFilesDiffError,
                              pressed && styles.changedFilesPressed,
                            ]}
                          >
                            <Text style={styles.changedFilesDiffErrorText}>{diff.message}</Text>
                            <Text style={styles.changedFilesDiffRetry}>Retry</Text>
                          </Pressable>
                        ) : diff.status === 'error' ? (
                          <View style={styles.changedFilesDiffError}>
                            <Text style={styles.changedFilesDiffErrorText}>{diff.message}</Text>
                          </View>
                        ) : (
                          <>
                            <ScrollView
                              nestedScrollEnabled
                              showsVerticalScrollIndicator
                              style={styles.changedFilesDiffScroll}
                            >
                              <ScrollView
                                horizontal
                                nestedScrollEnabled
                                showsHorizontalScrollIndicator
                              >
                                <Text selectable style={styles.changedFilesDiffText}>
                                  {diff.patch.slice(0, 80_000)}
                                </Text>
                              </ScrollView>
                            </ScrollView>
                            {diff.truncated || diff.patch.length > 80_000 ? (
                              <Text style={styles.changedFilesDiffHint}>
                                Diff preview was limited for performance.
                              </Text>
                            ) : null}
                          </>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
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
    <View
      accessibilityLabel="Loading conversation"
      accessibilityRole="progressbar"
      style={styles.loadingTranscript}
    >
      <View style={styles.loadingSpinner}>
        <View style={styles.loadingSpinnerBase} />
        <Animated.View style={[styles.loadingSpinnerArc, { transform: [{ rotate }] }]} />
        <View style={styles.loadingSpinnerCore} />
      </View>
      <Text style={styles.loadingTranscriptText}>Loading conversation…</Text>
    </View>
  );
}

function LinkedMessageText({
  text,
  user,
  onOpenFileReference,
}: {
  text: string;
  user: boolean;
  onOpenFileReference?: (reference: MobileFileReference) => void;
}) {
  return (
    <Text selectable style={[styles.messageText, user && styles.userMessageText]}>
      {splitMobileFileReferences(text).map((segment, index) =>
        segment.type === 'text' || !onOpenFileReference ? (
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
      )}
    </Text>
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
        const wasActive = current.active;
        touch.current.active = false;
        clearLongPress();
        if (shouldToggleMessageTimestamp({ ...current, active: wasActive })) onTap();
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

const DEFAULT_VISIBLE_PLAN_ITEMS = 8;

function timestampMs(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  return Date.parse(String(value ?? ''));
}

function AgentRunSummary({
  active,
  startedAt,
  completedAt,
  toolCallCount,
  expanded,
  onToggle,
}: {
  active: boolean;
  startedAt?: string | number;
  completedAt?: string | number;
  toolCallCount: number;
  expanded: boolean;
  onToggle?: () => void;
}) {
  const fallbackStart = React.useRef(Date.now()).current;
  const parsedStart = timestampMs(startedAt);
  const start = Number.isFinite(parsedStart) ? parsedStart : fallbackStart;
  const parsedEnd = timestampMs(completedAt);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  const end = active ? now : Number.isFinite(parsedEnd) ? parsedEnd : start;
  const label = `${active ? 'Working' : 'Worked'} for ${workingDurationLabel(end - start)}`;
  const content = (
    <>
      <Text style={styles.runSummaryLabel}>{label}</Text>
      {toolCallCount > 0 ? (
        <Text style={styles.runSummaryDetail}>
          {toolCallCount} tool {toolCallCount === 1 ? 'call' : 'calls'}
        </Text>
      ) : null}
      {onToggle ? (
        expanded ? (
          <ChevronDown color={colors.mutedDim} size={14} strokeWidth={1.8} />
        ) : (
          <ChevronRight color={colors.mutedDim} size={14} strokeWidth={1.8} />
        )
      ) : null}
    </>
  );

  if (!onToggle) return <View style={styles.runSummary}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Collapse tool calls' : 'Expand tool calls'}
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => [styles.runSummary, pressed && styles.runSummaryPressed]}
    >
      {content}
    </Pressable>
  );
}

function MobileAgentPlanList({
  plan,
  running = false,
}: {
  plan?: MobileAgentPlan;
  running?: boolean;
}) {
  const [planExpanded, setPlanExpanded] = React.useState(running);
  const [stepsExpanded, setStepsExpanded] = React.useState(false);
  React.useEffect(() => {
    if (running) setPlanExpanded(true);
  }, [running]);
  if (!plan?.items.length) return null;
  const complete = plan.items.filter((item) => item.status === 'completed').length;
  const showItems = running || planExpanded;
  const hiddenCount = Math.max(0, plan.items.length - DEFAULT_VISIBLE_PLAN_ITEMS);
  const visibleItems = stepsExpanded ? plan.items : plan.items.slice(0, DEFAULT_VISIBLE_PLAN_ITEMS);
  return (
    <View accessibilityLabel="Plan" style={styles.plan}>
      {running ? (
        <View style={[styles.planToggle, showItems && styles.planToggleExpanded]}>
          <Text style={styles.planToggleText}>Plan</Text>
          <Text style={styles.planProgress}>
            ({complete}/{plan.items.length})
          </Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={planExpanded ? 'Hide plan' : 'Show plan'}
          accessibilityState={{ expanded: planExpanded }}
          onPress={() => setPlanExpanded((value) => !value)}
          style={({ pressed }) => [
            styles.planToggle,
            showItems && styles.planToggleExpanded,
            pressed && styles.planTogglePressed,
          ]}
        >
          {planExpanded ? (
            <ChevronDown color={colors.muted} size={13} strokeWidth={1.8} />
          ) : (
            <ChevronRight color={colors.muted} size={13} strokeWidth={1.8} />
          )}
          <Text style={styles.planToggleText}>{planExpanded ? 'Hide plan' : 'Show plan'}</Text>
          <Text style={styles.planProgress}>
            ({complete}/{plan.items.length})
          </Text>
        </Pressable>
      )}
      {showItems ? (
        <View style={styles.planItems}>
          {visibleItems.map((item, index) => {
            const done = item.status === 'completed';
            const active = item.status === 'in_progress';
            const cancelled = item.status === 'cancelled';
            return (
              <View key={item.id || `${index}:${item.text}`} style={styles.planItem}>
                <View style={styles.planStatusSlot}>
                  {done ? (
                    <View style={styles.planDone}>
                      <Check color={colors.online} size={9} strokeWidth={2.6} />
                    </View>
                  ) : active && running ? (
                    <ActivityIndicator color={colors.accent} size={13} />
                  ) : (
                    <View
                      style={[
                        styles.planDot,
                        active && styles.planDotActive,
                        cancelled && styles.planDotCancelled,
                      ]}
                    />
                  )}
                </View>
                <Text
                  style={[
                    styles.planItemText,
                    done && styles.planItemDone,
                    active && styles.planItemActive,
                    cancelled && styles.planItemCancelled,
                  ]}
                >
                  {item.text}
                </Text>
              </View>
            );
          })}
          {hiddenCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: stepsExpanded }}
              onPress={() => setStepsExpanded((value) => !value)}
              style={({ pressed }) => pressed && styles.planTogglePressed}
            >
              <Text style={styles.planMore}>
                {stepsExpanded ? 'Show fewer steps' : `Show ${hiddenCount} more`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function TranscriptRun({
  run,
  renderItem,
}: {
  run: MobileTranscriptRun;
  renderItem: (item: AssistantRenderItem) => any;
}) {
  const [toolsExpanded, setToolsExpanded] = React.useState(false);
  return (
    <View>
      {renderItem(run.user)}
      <View style={styles.runBody}>
        <AgentRunSummary
          active={run.active}
          startedAt={run.startedAt}
          completedAt={run.completedAt}
          toolCallCount={run.toolCallCount}
          expanded={toolsExpanded}
          onToggle={run.toolCallCount > 0 ? () => setToolsExpanded((value) => !value) : undefined}
        />
      </View>
      {run.items.map((item) => {
        const tool = item.type === 'tool' || item.type === 'toolGroup';
        if (tool && !toolsExpanded) return null;
        return tool ? (
          <View key={item.key} style={styles.runBody}>
            {renderItem(item)}
          </View>
        ) : (
          renderItem(item)
        );
      })}
      <View style={styles.runBody}>
        <MobileAgentPlanList plan={run.plan} running={run.active} />
      </View>
    </View>
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
  onOpenFileReference,
  onLoadRunFileDiff,
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
  onOpenFileReference?: (reference: MobileFileReference) => void;
  onLoadRunFileDiff?: (input: { artifactId: string; path: string }) => Promise<{
    patch: string;
    truncated?: boolean;
  }>;
}) {
  const items = React.useMemo(
    () => compactRepeatedToolItems(renderItemsFromMessages(messages)),
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
  const renderItem = (item: AssistantRenderItem): any => {
    if (item.type === 'tool') return <ToolRow key={item.key} item={item} />;
    if (item.type === 'toolGroup') {
      return <ToolGroupRow key={item.key} item={item} />;
    }
    if (item.type === 'runSummary') {
      return <ChangedFilesSummary key={item.key} item={item} onLoadDiff={onLoadRunFileDiff} />;
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
            <NativeMarkdown text={text} onOpenFileReference={onOpenFileReference} />
            <LinkedPullRequestAttachments text={text} context={linkedPullRequests} />
          </>
        ) : text ? (
          <LinkedMessageText text={text} user={user} onOpenFileReference={onOpenFileReference} />
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
            {files.map((file, index) => {
              const fileReference = parseMobileFileReference(
                String(file?.path ?? file?.filePath ?? ''),
              );
              return (
                <Pressable
                  key={String(file?.id ?? file?.name ?? index)}
                  accessibilityRole={fileReference && onOpenFileReference ? 'button' : undefined}
                  accessibilityHint={
                    fileReference && onOpenFileReference
                      ? 'Opens a read-only file preview'
                      : undefined
                  }
                  disabled={!fileReference || !onOpenFileReference}
                  onPress={() => fileReference && onOpenFileReference?.(fileReference)}
                  style={({ pressed }) => [
                    styles.attachment,
                    fileReference && onOpenFileReference && styles.attachmentLinked,
                    pressed && styles.attachmentPressed,
                  ]}
                >
                  <Text style={styles.attachmentIcon}>▧</Text>
                  <View style={styles.attachmentCopy}>
                    <Text numberOfLines={1} style={styles.attachmentName}>
                      {String(file?.name ?? 'Attachment')}
                    </Text>
                    <Text numberOfLines={1} style={styles.attachmentMeta}>
                      {String(file?.mime ?? file?.mimeType ?? 'file')}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {item.message.meshTruncated ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Load the full message"
            accessibilityState={{
              disabled:
                !item.message.id || !onLoadFullMessage || fullMessageLoadingId === item.message.id,
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
  };
  const groups = groupMobileTranscriptRuns(items, {
    running,
    hasSeparateActivePrompt: activePrompts.length > 0,
  });
  const activePrompt = activePrompts.at(-1);
  const lastGroup = groups.at(-1);
  const groupedActiveRun = lastGroup?.type === 'run' && lastGroup.active;
  return (
    <View style={styles.messages}>
      {groups.map((group) =>
        group.type === 'run' ? (
          <TranscriptRun key={group.key} run={group} renderItem={renderItem} />
        ) : (
          <React.Fragment key={group.key}>{renderItem(group.item)}</React.Fragment>
        ),
      )}
      {activePrompts.length > 0 ? (
        <QueuedPromptRows
          prompts={activePrompts}
          cancellingId={cancellingPromptId}
          onCancel={onCancelQueuedPrompt}
        />
      ) : null}
      {running && activePrompt ? (
        <View style={styles.runBody}>
          <AgentRunSummary
            active
            startedAt={activePrompt.startedAt}
            toolCallCount={0}
            expanded={false}
          />
          <MobileAgentPlanList plan={activePrompt.agentPlan} running />
        </View>
      ) : null}
      {running && currentReasoning.trim() ? (
        <View style={styles.reasoning}>
          <View style={styles.reasoningHead}>
            <TypingDots label={`${assistantLabel} is working`} />
            <Text style={styles.reasoningLabel}>Reasoning</Text>
          </View>
          <Text style={styles.reasoningText}>{currentReasoning.trim()}</Text>
        </View>
      ) : running && !groupedActiveRun && !activePrompt ? (
        <View style={styles.waiting}>
          <AgentRunSummary active toolCallCount={0} expanded={false} />
          <TypingDots label={`${assistantLabel} is working`} />
        </View>
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
  changedFilesCard: {
    marginHorizontal: 10,
    marginVertical: 8,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  changedFilesHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  changedFilesPressed: { backgroundColor: colors.whiteWashSoft },
  changedFilesTitleBlock: { flex: 1 },
  changedFilesTitle: { color: colors.text, fontSize: 12, fontWeight: '600' },
  changedFilesSubtitle: { color: colors.muted, fontSize: 10, marginTop: 2 },
  changedFilesCounts: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  changedFilesAdditions: { color: colors.online, fontSize: 10, fontFamily: 'monospace' },
  changedFilesDeletions: { color: colors.danger, fontSize: 10, fontFamily: 'monospace' },
  changedFilesList: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 5 },
  changedFilesWorkspace: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingBottom: 4,
    paddingTop: 5,
  },
  changedFilesRow: {
    minHeight: 29,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  changedFilesStatus: {
    width: 12,
    color: colors.accent,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  changedFilesPath: { flex: 1, color: colors.text, fontSize: 10, fontFamily: 'monospace' },
  changedFilesLineCounts: { color: colors.muted, fontSize: 9, fontFamily: 'monospace' },
  changedFilesDiffPanel: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface0,
    paddingVertical: 8,
  },
  changedFilesDiffScroll: { maxHeight: 300 },
  changedFilesDiffLoading: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  changedFilesDiffHint: { color: colors.muted, fontSize: 9, paddingHorizontal: 12, paddingTop: 6 },
  changedFilesDiffError: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
  },
  changedFilesDiffErrorText: { flex: 1, color: colors.danger, fontSize: 10, lineHeight: 14 },
  changedFilesDiffRetry: { color: colors.accent, fontSize: 10, fontWeight: '600' },
  changedFilesDiffText: {
    color: colors.text,
    fontSize: 9,
    lineHeight: 14,
    fontFamily: 'monospace',
    paddingHorizontal: 12,
  },
  messages: { gap: 0 },
  runBody: { marginHorizontal: 10 },
  runSummary: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    paddingVertical: 7,
  },
  runSummaryPressed: { opacity: 0.72 },
  runSummaryLabel: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  runSummaryDetail: {
    flex: 1,
    color: colors.mutedDim,
    fontSize: 11,
  },
  plan: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: 9,
    marginBottom: 9,
  },
  planToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 24 },
  planToggleExpanded: { marginBottom: 7 },
  planTogglePressed: { opacity: 0.68 },
  planToggleText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  planProgress: {
    color: colors.mutedDim,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  planItems: { gap: 6 },
  planItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  planStatusSlot: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planDone: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.onlineBorder,
    backgroundColor: colors.onlineDark,
  },
  planDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  planDotActive: { borderColor: colors.accent, backgroundColor: colors.accentWash },
  planDotCancelled: { borderColor: colors.mutedDim, opacity: 0.45 },
  planItemText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  planItemDone: {
    color: colors.mutedDim,
    textDecorationLine: 'line-through',
    textDecorationColor: colors.muted,
  },
  planItemActive: { color: colors.text, fontWeight: '600' },
  planItemCancelled: { color: colors.mutedDim, textDecorationLine: 'line-through', opacity: 0.6 },
  planMore: { color: colors.muted, fontSize: 11, fontWeight: '600', marginTop: 3 },
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
    backgroundColor: colors.userBubble,
    borderWidth: 1,
    borderColor: colors.userBubbleBorder,
    borderRadius: 10,
    borderBottomRightRadius: 3,
  },
  messageText: { color: colors.assistantText, fontSize: 14, lineHeight: 21 },
  userMessageText: { color: colors.userBubbleText },
  fileLink: {
    color: colors.accentAlt,
    fontWeight: '700',
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  messageTime: {
    alignSelf: 'flex-start',
    color: colors.mutedDim,
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '400',
    marginTop: 7,
  },
  userMessageTime: {
    alignSelf: 'flex-end',
    color: colors.secondary,
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '400',
    marginRight: 3,
    marginBottom: 4,
  },
  messageRole: {
    color: colors.secondary,
    fontSize: 9,
    fontWeight: '600',
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
  fullMessageText: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 9,
  },
  attachmentLinked: { borderColor: colors.accentBorder, backgroundColor: colors.accentWash },
  attachmentPressed: { opacity: 0.7 },
  attachmentIcon: { color: colors.accent, fontSize: 18 },
  attachmentCopy: { flex: 1, minWidth: 0 },
  attachmentName: { color: colors.text, fontSize: 11, fontWeight: '600' },
  attachmentMeta: { color: colors.muted, fontSize: 9, marginTop: 2 },
  tool: {
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.whiteWashSoft,
    marginHorizontal: 0,
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
    color: colors.onAccent,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '700',
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
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  toolCount: {
    color: colors.subtle,
    fontSize: 9,
    fontWeight: '500',
  },
  toolDetails: {
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.mantle,
  },
  detailLabel: { color: colors.accent, fontSize: 7, fontWeight: '600', letterSpacing: 1 },
  detailText: { color: colors.muted, fontSize: 10, lineHeight: 15, fontFamily: 'monospace' },
  groupDetails: {
    gap: 2,
    padding: 5,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.mantle,
  },
  transfer: {
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.whiteWashSoft,
    marginHorizontal: 0,
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
  transferFiles: { gap: 5, padding: 8, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
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
  waiting: { alignSelf: 'stretch', gap: 8, marginHorizontal: 10, marginVertical: 10 },
  reasoningHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reasoningLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
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
    fontWeight: '600',
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
  emptyTitle: { color: colors.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  emptyBody: {
    color: colors.muted,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
  },
});
