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
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Pause from 'lucide-react-native/icons/pause';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import X from 'lucide-react-native/icons/x';
import type {
  AgentRunFileChangeEntry,
  AgentRunFileChangeWorkspace,
  BlipCompactionHistoryDetails,
} from '@blip/protocol';
import {
  agentRunFileStatusLabel,
  agentRunLineChangeBreakdown,
  agentRunNetLineChangeLabel,
  agentRunWorkspacePreviewEntries,
  messageImageParts,
  messageText,
  renderItemsFromMessages,
  toolActivityIsSettled,
  toolLabel,
  type AssistantMessage,
  type AssistantRenderItem,
  type AssistantToolRenderItem,
} from '@drone/assistant-chat';
import { colors } from '../theme';
import { QueuedPromptRows, type MobileQueuedPrompt } from '../components/QueuedPromptRows';
import { ContextMenu } from '../components/Ui';
import { NativeMarkdown } from './NativeMarkdown';
import { MobileLoadingState } from './MobileLoadingState';
import { MobileReasoningBlock } from './MobileReasoningBlock';
import { MobileChangedFilesTree } from './MobileChangedFilesTree';
import { nativeMarkdownHasCodeBlock } from './native-markdown-model';
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
  limitMobileRunToolItems,
  mobileTranscriptGroupStartedAt,
  mobileRunIsThinking,
  partitionMobileRunItems,
  sortMobileTranscriptTimeline,
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
  onLoadFiles,
  initiallyExpanded = false,
}: {
  item: Extract<AssistantRenderItem, { type: 'runSummary' }>;
  onLoadDiff?: (input: { artifactId: string; path: string }) => Promise<{
    patch: string;
    truncated?: boolean;
  }>;
  onLoadFiles?: (input: { artifactId: string; offset: number; limit: number }) => Promise<{
    entries: AgentRunFileChangeEntry[];
    nextOffset: number | null;
    metadataTruncated?: boolean;
  }>;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(initiallyExpanded);
  const previousInitiallyExpanded = React.useRef(initiallyExpanded);
  React.useEffect(() => {
    if (previousInitiallyExpanded.current === initiallyExpanded) return;
    previousInitiallyExpanded.current = initiallyExpanded;
    setExpanded(initiallyExpanded);
  }, [initiallyExpanded]);
  const [openDiffKey, setOpenDiffKey] = React.useState('');
  const [selectedDiff, setSelectedDiff] = React.useState<{
    key: string;
    state:
      | { status: 'loading' }
      | { status: 'loaded'; patch: string; truncated: boolean }
      | { status: 'error'; message: string; retryable: boolean };
  } | null>(null);
  const diffRequestGeneration = React.useRef(0);
  const [workspaceFiles, setWorkspaceFiles] = React.useState<
    Record<
      string,
      {
        status: 'loading' | 'loaded' | 'error';
        entries: AgentRunFileChangeEntry[];
        nextOffset: number | null;
        message?: string;
        metadataTruncated?: boolean;
      }
    >
  >({});
  const summary = item.fileChanges;
  const lineChanges = agentRunLineChangeBreakdown(summary.counts);
  React.useEffect(() => {
    if (!expanded) return;
    for (const workspace of summary.workspaces) {
      if ('entries' in workspace || workspaceFiles[workspace.targetId]) continue;
      if (!workspace.diffArtifactId || !onLoadFiles) {
        setWorkspaceFiles((current) => ({
          ...current,
          [workspace.targetId]: {
            status: 'loaded',
            entries: workspace.previewEntries,
            nextOffset: null,
            metadataTruncated: workspace.metadataTruncated,
          },
        }));
        continue;
      }
      setWorkspaceFiles((current) => ({
        ...current,
        [workspace.targetId]: { status: 'loading', entries: [], nextOffset: null },
      }));
      void onLoadFiles({ artifactId: workspace.diffArtifactId, offset: 0, limit: 20 })
        .then((result) => {
          setWorkspaceFiles((current) => ({
            ...current,
            [workspace.targetId]: {
              status: 'loaded',
              entries: result.entries,
              nextOffset: result.nextOffset,
              metadataTruncated: result.metadataTruncated,
            },
          }));
        })
        .catch((error: any) => {
          setWorkspaceFiles((current) => ({
            ...current,
            [workspace.targetId]: {
              status: 'error',
              entries: [],
              nextOffset: null,
              message: String(error?.message ?? error ?? 'Unable to load changed files.'),
            },
          }));
        });
    }
  }, [expanded, onLoadFiles, summary.workspaces, workspaceFiles]);

  const entriesForWorkspace = (workspace: AgentRunFileChangeWorkspace) =>
    'entries' in workspace
      ? workspace.entries
      : (workspaceFiles[workspace.targetId]?.entries ?? workspace.previewEntries);

  const loadMoreFiles = (workspace: AgentRunFileChangeWorkspace) => {
    if ('entries' in workspace || !workspace.diffArtifactId || !onLoadFiles) return;
    const current = workspaceFiles[workspace.targetId];
    if (!current || current.nextOffset == null || current.status === 'loading') return;
    setWorkspaceFiles((states) => ({
      ...states,
      [workspace.targetId]: { ...current, status: 'loading' },
    }));
    void onLoadFiles({
      artifactId: workspace.diffArtifactId,
      offset: current.nextOffset,
      limit: 20,
    })
      .then((result) => {
        setWorkspaceFiles((states) => ({
          ...states,
          [workspace.targetId]: {
            status: 'loaded',
            entries: [...current.entries, ...result.entries],
            nextOffset: result.nextOffset,
            metadataTruncated: result.metadataTruncated,
          },
        }));
      })
      .catch((error: any) => {
        setWorkspaceFiles((states) => ({
          ...states,
          [workspace.targetId]: {
            ...current,
            status: 'error',
            message: String(error?.message ?? error ?? 'Unable to load more changed files.'),
          },
        }));
      });
  };
  const openDiff = (artifactId: string, filePath: string, force = false) => {
    if (!onLoadDiff) return;
    const key = `${artifactId}\u0000${filePath}`;
    if (!force && openDiffKey === key) {
      diffRequestGeneration.current += 1;
      setOpenDiffKey('');
      setSelectedDiff(null);
      return;
    }
    setOpenDiffKey(key);
    const requestGeneration = ++diffRequestGeneration.current;
    setSelectedDiff({ key, state: { status: 'loading' } });
    void onLoadDiff({ artifactId, path: filePath })
      .then((result) => {
        if (diffRequestGeneration.current !== requestGeneration) return;
        setSelectedDiff({
          key,
          state: {
            status: 'loaded',
            patch: String(result.patch ?? ''),
            truncated: result.truncated === true,
          },
        });
      })
      .catch((error: any) => {
        if (diffRequestGeneration.current !== requestGeneration) return;
        const errorCode = String(error?.code ?? '');
        const hubStatus = Number(/^HUB_(\d+)$/.exec(errorCode)?.[1] ?? 0);
        const terminal =
          errorCode === 'INVALID_REQUEST' ||
          (hubStatus >= 400 && hubStatus < 500 && hubStatus !== 408 && hubStatus !== 429);
        setSelectedDiff({
          key,
          state: {
            status: 'error',
            message: String(error?.message ?? error ?? 'Unable to load historical diff.'),
            retryable: !terminal,
          },
        });
      });
  };
  return (
    <View style={styles.changedFilesCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${summary.counts.changed} changed files`}
        accessibilityState={{ expanded }}
        onPress={() => {
          if (expanded) {
            diffRequestGeneration.current += 1;
            setOpenDiffKey('');
            setSelectedDiff(null);
          }
          setExpanded((current) => !current);
        }}
        style={({ pressed }) => [
          styles.changedFilesHeader,
          pressed && styles.changedFilesHeaderPressed,
        ]}
      >
        <View style={styles.changedFilesHeaderHighlight}>
          <Text numberOfLines={1} style={styles.changedFilesTitle}>
            Changed files <Text style={styles.changedFilesCount}>({summary.counts.changed})</Text>
          </Text>
          <View style={styles.changedFilesCounts}>
            <Text style={styles.changedFilesAdditions}>+{lineChanges.added}</Text>
            <Text style={styles.changedFilesModified}>~{lineChanges.modified}</Text>
            <Text style={styles.changedFilesDeletions}>-{lineChanges.deleted}</Text>
            <View accessibilityElementsHidden style={styles.changedFilesCountsSeparator} />
            <Text
              accessibilityLabel={`${agentRunNetLineChangeLabel(lineChanges.net)} net lines`}
              style={styles.changedFilesNet}
            >
              {agentRunNetLineChangeLabel(lineChanges.net)}
            </Text>
            {expanded ? (
              <ChevronDown color={colors.muted} size={14} />
            ) : (
              <ChevronRight color={colors.muted} size={14} />
            )}
          </View>
        </View>
      </Pressable>
      {expanded ? (
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={styles.changedFilesListScroll}
          contentContainerStyle={styles.changedFilesList}
        >
          {summary.workspaces.map((workspace) => (
            <View key={workspace.targetId}>
              {summary.workspaces.length > 1 || workspace.targetId.startsWith('artifacts:') ? (
                <Text style={styles.changedFilesWorkspace}>{workspace.label}</Text>
              ) : null}
              <MobileChangedFilesTree
                entries={entriesForWorkspace(workspace)}
                renderFile={(entry, name) => {
                  const artifactId = workspace.diffArtifactId;
                  const diffKey = artifactId ? `${artifactId}\u0000${entry.path}` : '';
                  const open = Boolean(diffKey && openDiffKey === diffKey);
                  const diff = selectedDiff?.key === diffKey ? selectedDiff.state : undefined;
                  const renderRow = (pressed = false) => (
                    <View style={styles.changedFilesRow}>
                      <Text
                        style={[
                          styles.changedFilesStatus,
                          pressed && styles.changedFilesStatusPressed,
                        ]}
                      >
                        {agentRunFileStatusLabel(entry)}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.changedFilesPath, pressed && styles.changedFilesPathPressed]}
                      >
                        {name}
                      </Text>
                      {!entry.binary && (entry.additions > 0 || entry.deletions > 0) ? (
                        <Text
                          style={[
                            styles.changedFilesLineCounts,
                            pressed && styles.changedFilesLineCountsPressed,
                          ]}
                        >
                          {[
                            entry.additions > 0 ? `+${entry.additions}` : '',
                            entry.deletions > 0 ? `-${entry.deletions}` : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        </Text>
                      ) : null}
                      {artifactId && onLoadDiff ? (
                        open ? (
                          <ChevronDown color={pressed ? colors.accent : colors.muted} size={12} />
                        ) : (
                          <ChevronRight color={pressed ? colors.accent : colors.muted} size={12} />
                        )
                      ) : null}
                    </View>
                  );
                  return (
                    <View>
                      {artifactId && onLoadDiff ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Show the diff captured for ${entry.path}`}
                          accessibilityState={{ expanded: open }}
                          onPress={() => openDiff(artifactId, entry.path)}
                        >
                          {({ pressed }) => renderRow(pressed)}
                        </Pressable>
                      ) : (
                        renderRow()
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
                }}
              />
              {'entries' in workspace ? null : workspaceFiles[workspace.targetId]?.status ===
                'loading' ? (
                <View style={styles.changedFilesDiffLoading}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Text style={styles.changedFilesDiffHint}>
                    {workspaceFiles[workspace.targetId]!.entries.length > 0
                      ? 'Loading more files…'
                      : 'Loading changed files…'}
                  </Text>
                </View>
              ) : workspaceFiles[workspace.targetId]?.status === 'error' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    const current = workspaceFiles[workspace.targetId];
                    if (current?.entries.length) loadMoreFiles(workspace);
                    else {
                      setWorkspaceFiles((states) => {
                        const next = { ...states };
                        delete next[workspace.targetId];
                        return next;
                      });
                    }
                  }}
                  style={styles.changedFilesDiffError}
                >
                  <Text style={styles.changedFilesDiffErrorText}>
                    {workspaceFiles[workspace.targetId]!.message}
                  </Text>
                  <Text style={styles.changedFilesDiffRetry}>Retry</Text>
                </Pressable>
              ) : workspaceFiles[workspace.targetId]?.nextOffset != null ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => loadMoreFiles(workspace)}
                  style={styles.changedFilesDiffError}
                >
                  <Text style={styles.changedFilesDiffRetry}>Show 20 more</Text>
                </Pressable>
              ) : workspaceFiles[workspace.targetId]?.metadataTruncated ? (
                <Text style={styles.changedFilesDiffHint}>Stored list limited to 5,000 files.</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function ConversationLoadingState() {
  return (
    <MobileLoadingState accessibilityLabel="Loading conversation" label="Loading conversation…" />
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

type MobileToolStatus = 'pending' | 'blocked' | 'ok' | 'error' | 'partial-error';

function ToolStatus({
  status,
  accessibilityLabel,
}: {
  status: MobileToolStatus;
  accessibilityLabel?: string;
}) {
  const pending = status === 'pending';
  const blocked = status === 'blocked';
  const failed = status === 'error';
  const partial = status === 'partial-error';
  return (
    <View
      accessible={!pending}
      accessibilityLabel={
        accessibilityLabel ??
        (blocked
          ? 'Blocked pending approval'
          : failed
            ? 'Tool failed'
            : partial
              ? 'Some tool calls failed'
              : undefined)
      }
      style={styles.toolStatusSlot}
    >
      {blocked ? (
        <Pause color={colors.warning} size={12} strokeWidth={2.2} />
      ) : pending ? (
        <ActivityIndicator accessible={false} color={colors.accent} size={12} />
      ) : (
        <View
          style={[
            styles.toolStatusCircle,
            failed && styles.toolStatusError,
            partial && styles.toolStatusPartial,
          ]}
        >
          {failed ? (
            <X color={colors.onAccent} size={9} strokeWidth={2.5} />
          ) : partial ? (
            <TriangleAlert color={colors.onAccent} size={8} strokeWidth={2.2} />
          ) : (
            <Check color={colors.onAccent} size={9} strokeWidth={2.5} />
          )}
        </View>
      )}
    </View>
  );
}

function toolItemFailed(item: AssistantToolRenderItem): boolean {
  if (item.result?.isError) return true;
  const details = item.result?.details;
  return Boolean(
    details &&
    typeof details === 'object' &&
    !Array.isArray(details) &&
    (details as Record<string, unknown>).type === 'workspace_transfer' &&
    (details as Record<string, unknown>).phase === 'failed',
  );
}

function humanizeToolField(value: string): string {
  const words = value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : 'Value';
}

function structuredToolValueFromText(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const MOBILE_TOOL_MAX_DEPTH = 6;
const MOBILE_TOOL_MAX_ITEMS = 50;

function toolScalarText(value: unknown): string {
  if (value == null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

function ToolStructuredValue({
  value,
  depth = 0,
  ancestors = [],
}: {
  value: unknown;
  depth?: number;
  ancestors?: readonly object[];
}) {
  if (!value || typeof value !== 'object') {
    return (
      <Text selectable style={[styles.detailText, value == null && styles.detailPlaceholder]}>
        {toolScalarText(value)}
      </Text>
    );
  }
  if (ancestors.includes(value)) {
    return <Text style={styles.detailPlaceholder}>Circular reference</Text>;
  }
  if (depth >= MOBILE_TOOL_MAX_DEPTH) {
    const size = Array.isArray(value) ? value.length : Object.keys(value).length;
    return (
      <Text style={styles.detailPlaceholder}>
        Nested {Array.isArray(value) ? `${size} items` : `${size} fields`}
      </Text>
    );
  }
  const nextAncestors = [...ancestors, value];
  if (Array.isArray(value)) {
    if (value.length === 0) return <Text style={styles.detailPlaceholder}>Empty list</Text>;
    if (value.every((item) => item == null || typeof item !== 'object')) {
      const visible = value.slice(0, MOBILE_TOOL_MAX_ITEMS);
      const hidden = value.length - visible.length;
      return (
        <Text selectable style={styles.detailText}>
          {visible.map(toolScalarText).join(', ')}
          {hidden > 0 ? `, +${hidden} more` : ''}
        </Text>
      );
    }
    const visible = value.slice(0, MOBILE_TOOL_MAX_ITEMS);
    const hidden = value.length - visible.length;
    return (
      <View style={styles.detailList}>
        {visible.map((item, index) => (
          <View key={index} style={styles.detailArrayRow}>
            <Text style={styles.detailIndex}>{index + 1}</Text>
            <View style={styles.detailValue}>
              <ToolStructuredValue value={item} depth={depth + 1} ancestors={nextAncestors} />
            </View>
          </View>
        ))}
        {hidden > 0 ? <Text style={styles.detailPlaceholder}>+{hidden} more items</Text> : null}
      </View>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <Text style={styles.detailPlaceholder}>No fields</Text>;
  const visible = entries.slice(0, MOBILE_TOOL_MAX_ITEMS);
  const hidden = entries.length - visible.length;
  return (
    <View style={styles.detailList}>
      {visible.map(([key, item]) => (
        <View key={key} style={styles.detailField}>
          <Text style={styles.detailFieldLabel}>{humanizeToolField(key)}</Text>
          <ToolStructuredValue value={item} depth={depth + 1} ancestors={nextAncestors} />
        </View>
      ))}
      {hidden > 0 ? <Text style={styles.detailPlaceholder}>+{hidden} more fields</Text> : null}
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
  blocked = false,
}: {
  item: AssistantToolRenderItem;
  nested?: boolean;
  blocked?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const progress: any =
    item.result?.details && (item.result.details as any).type === 'workspace_transfer'
      ? item.result.details
      : null;
  const files = Array.isArray(progress?.files) ? progress.files : [];
  const settled = toolActivityIsSettled(item);
  const expandable = files.length > 0;
  const total = Number(progress?.totalBytes ?? 0);
  const transferred = Number(progress?.transferredBytes ?? 0);
  const failed = item.result?.isError === true || progress?.phase === 'failed';
  const percent =
    total > 0 ? Math.min(100, (transferred / total) * 100) : settled && !failed ? 100 : 0;
  const sourceLabel = progress?.source?.targetLabel ?? item.call?.args?.sourceTarget;
  const destinationLabel = progress?.destination?.targetLabel ?? item.call?.args?.destinationTarget;
  const amountLabel = progress
    ? `${formatTransferBytes(transferred)} / ${formatTransferBytes(total)}`
    : failed
      ? 'Failed'
      : settled
        ? 'Complete'
        : 'Preparing…';
  const summaryLabel =
    blocked && !settled
      ? 'Blocked pending approval'
      : sourceLabel || destinationLabel
        ? `${sourceLabel ?? 'Source'} → ${destinationLabel ?? 'Destination'}`
        : settled
          ? 'File transfer finished'
          : 'Scanning files to transfer';
  const progressLabel =
    blocked && !settled
      ? 'Approval required'
      : !progress
        ? failed
          ? 'Transfer failed'
          : settled
            ? 'Transfer complete'
            : 'Scanning files…'
        : progress.phase === 'planning'
          ? 'Scanning folder…'
          : `${progress.completedFiles ?? 0} of ${progress.fileCount ?? 0} files`;
  return (
    <View style={[styles.transfer, nested && styles.transferNested]}>
      <Pressable
        accessible={expandable}
        accessibilityRole={expandable ? 'button' : undefined}
        accessibilityLabel={`Transfer files, ${failed ? 'failed' : settled ? 'completed' : blocked ? 'blocked pending approval' : 'running'}`}
        accessibilityState={expandable ? { expanded: open } : undefined}
        disabled={!expandable}
        hitSlop={4}
        onPress={expandable ? () => setOpen((value) => !value) : undefined}
        style={({ pressed }) => [
          styles.transferHead,
          pressed && expandable && styles.toolHeadPressed,
        ]}
      >
        <ToolStatus
          status={!settled ? (blocked ? 'blocked' : 'pending') : failed ? 'error' : 'ok'}
        />
        <View style={styles.toolCopy}>
          <View style={styles.transferTitleRow}>
            <View style={styles.toolTitleRow}>
              <Text style={styles.toolTitle}>Transfer files</Text>
              {expandable ? (
                open ? (
                  <ChevronDown color={colors.mutedDim} size={14} strokeWidth={1.8} />
                ) : (
                  <ChevronRight color={colors.mutedDim} size={14} strokeWidth={1.8} />
                )
              ) : null}
            </View>
            <Text style={styles.transferBytes}>{amountLabel}</Text>
          </View>
          <Text numberOfLines={1} style={styles.toolSummary}>
            {summaryLabel}
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
            <Text style={styles.transferMetaText}>{progressLabel}</Text>
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
        <View style={[styles.transferFiles, nested && styles.transferFilesNested]}>
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

function ToolRow({
  item,
  nested = false,
  blocked = false,
}: {
  item: AssistantToolRenderItem;
  nested?: boolean;
  blocked?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  if ((item.call?.name ?? item.result?.toolName) === 'transfer_files') {
    return <TransferToolRow item={item} nested={nested} blocked={blocked} />;
  }
  const failed = toolItemFailed(item);
  const pending = !toolActivityIsSettled(item);
  const rawArgs = item.call?.args;
  const args =
    typeof rawArgs === 'string' ? (structuredToolValueFromText(rawArgs) ?? rawArgs) : rawArgs;
  const result = item.result
    ? messageText(item.result).trim() || String(item.result.errorMessage ?? '').trim()
    : '';
  const structuredResult = result ? structuredToolValueFromText(result) : undefined;
  const label = toolLabel(item.call?.name ?? item.result?.toolName);
  return (
    <View style={[styles.tool, nested && styles.toolNested]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${pending ? (blocked ? 'blocked pending approval' : 'running') : failed ? 'failed' : 'completed'}`}
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.toolHead, pressed && styles.toolHeadPressed]}
      >
        <ToolStatus
          status={pending ? (blocked ? 'blocked' : 'pending') : failed ? 'error' : 'ok'}
        />
        <View style={styles.toolCopy}>
          <View style={styles.toolTitleRow}>
            <Text numberOfLines={1} style={styles.toolTitle}>
              {label}
            </Text>
            {open ? (
              <ChevronDown color={colors.mutedDim} size={14} strokeWidth={1.8} />
            ) : (
              <ChevronRight color={colors.mutedDim} size={14} strokeWidth={1.8} />
            )}
          </View>
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.toolDetails, nested && styles.toolDetailsNested]}>
          {args !== undefined ? (
            <>
              <Text style={styles.detailLabel}>Arguments</Text>
              <View style={styles.detailPayload}>
                <ToolStructuredValue value={args} />
              </View>
            </>
          ) : null}
          <Text style={styles.detailLabel}>Result</Text>
          <View style={styles.detailPayload}>
            {structuredResult !== undefined ? (
              <ToolStructuredValue value={structuredResult} />
            ) : (
              <Text selectable style={styles.detailText}>
                {result ||
                  (pending
                    ? blocked
                      ? 'Blocked pending approval.'
                      : 'Waiting…'
                    : 'No result payload.')}
              </Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ToolGroupRow({
  item,
  blocked = false,
}: {
  item: Extract<AssistantRenderItem, { type: 'toolGroup' }>;
  blocked?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const failedCount = item.items.filter(toolItemFailed).length;
  const pending = item.items.some((tool) => !toolActivityIsSettled(tool));
  const partial = !pending && failedCount > 0 && failedCount < item.items.length;
  const failed = !pending && failedCount === item.items.length;
  const name = toolLabel(item.items[0]?.call?.name ?? item.items[0]?.result?.toolName);
  const stateLabel = pending
    ? blocked
      ? 'blocked pending approval'
      : 'running'
    : partial
      ? `${failedCount} of ${item.items.length} calls failed`
      : failed
        ? 'all calls failed'
        : 'completed';
  return (
    <View style={styles.tool}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${item.items.length} calls, ${stateLabel}`}
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.toolHead, pressed && styles.toolHeadPressed]}
      >
        <ToolStatus
          status={
            pending
              ? blocked
                ? 'blocked'
                : 'pending'
              : partial
                ? 'partial-error'
                : failed
                  ? 'error'
                  : 'ok'
          }
          accessibilityLabel={
            partial
              ? `${failedCount} of ${item.items.length} tool calls failed`
              : failed
                ? `All ${item.items.length} tool calls failed`
                : undefined
          }
        />
        <View style={styles.toolCopy}>
          <View style={styles.toolTitleRow}>
            <Text numberOfLines={1} style={styles.toolTitle}>
              {name}
            </Text>
            <Text style={styles.toolCount}>×{item.items.length}</Text>
            {open ? (
              <ChevronDown color={colors.mutedDim} size={14} strokeWidth={1.8} />
            ) : (
              <ChevronRight color={colors.mutedDim} size={14} strokeWidth={1.8} />
            )}
            {failedCount > 0 ? (
              <Text style={styles.toolFailureCount}>{failedCount} failed</Text>
            ) : null}
          </View>
        </View>
      </Pressable>
      {open ? (
        <View style={styles.groupDetails}>
          {item.items.map((tool) => (
            <ToolRow key={tool.key} item={tool} nested blocked={blocked && !tool.result} />
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

function compactTokenCount(tokens: number): string {
  const rounded = Math.max(0, Math.round(tokens));
  if (rounded < 1_000) return String(rounded);
  const divisor = rounded >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = divisor === 1_000_000 ? 'M' : 'K';
  return `${(rounded / divisor).toFixed(1).replace(/\.0$/, '')}${suffix}`;
}

function MobileCompactionRow({ details }: { details: BlipCompactionHistoryDetails }) {
  const after =
    details.tokensAfter === null
      ? 'size unavailable'
      : `${compactTokenCount(details.tokensAfter)} tokens`;
  const label = [
    'Context compacted',
    `${compactTokenCount(details.tokensBefore)} → ${after}`,
    details.trigger === 'manual' ? 'Manual' : 'Automatic',
    details.fallbackUsed ? 'Fallback summary' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} style={styles.compaction}>
      <View style={styles.compactionLine} />
      <Text style={styles.compactionText}>{label}</Text>
      <View style={styles.compactionLine} />
    </View>
  );
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
  completedDurationMs,
  toolCallCount,
  expanded,
  onToggle,
  awaitingApproval = false,
  approvalStartedAt,
}: {
  active: boolean;
  startedAt?: string | number;
  completedAt?: string | number;
  completedDurationMs?: number;
  toolCallCount: number;
  expanded: boolean;
  onToggle?: () => void;
  awaitingApproval?: boolean;
  approvalStartedAt?: string | number;
}) {
  const fallbackStart = React.useRef(Date.now()).current;
  const parsedStart = timestampMs(startedAt);
  const start = Number.isFinite(parsedStart) ? parsedStart : fallbackStart;
  const parsedEnd = timestampMs(completedAt);
  const parsedApprovalStart = timestampMs(approvalStartedAt);
  const [now, setNow] = React.useState(() => Date.now());
  const [pauseClock, setPauseClock] = React.useState<{
    accumulatedMs: number;
    startedAt: number | null;
  }>(() => ({
    accumulatedMs: 0,
    startedAt: awaitingApproval
      ? Number.isFinite(parsedApprovalStart)
        ? parsedApprovalStart
        : Date.now()
      : null,
  }));

  React.useEffect(() => {
    if (!active || awaitingApproval) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active, awaitingApproval]);

  React.useEffect(() => {
    const timestamp = !active && Number.isFinite(parsedEnd) ? parsedEnd : Date.now();
    setPauseClock((current) => {
      if (awaitingApproval) {
        const startedAt = Number.isFinite(parsedApprovalStart)
          ? parsedApprovalStart
          : (current.startedAt ?? timestamp);
        if (current.startedAt !== null && current.startedAt <= startedAt) return current;
        return { ...current, startedAt };
      }
      if (current.startedAt === null) return current;
      return {
        accumulatedMs: current.accumulatedMs + Math.max(0, timestamp - current.startedAt),
        startedAt: null,
      };
    });
  }, [active, awaitingApproval, parsedApprovalStart, parsedEnd]);

  const rawEnd = active ? now : Number.isFinite(parsedEnd) ? parsedEnd : start;
  const end = awaitingApproval && pauseClock.startedAt !== null ? pauseClock.startedAt : rawEnd;
  const resumingPauseMs =
    !awaitingApproval && pauseClock.startedAt !== null
      ? Math.max(0, rawEnd - pauseClock.startedAt)
      : 0;
  const measuredDurationMs = Math.max(
    0,
    end - start - pauseClock.accumulatedMs - resumingPauseMs,
  );
  const durationMs =
    (!active || awaitingApproval) && Number.isFinite(completedDurationMs)
      ? Math.max(0, Number(completedDurationMs))
      : measuredDurationMs;
  const duration = workingDurationLabel(durationMs);
  const callLabel =
    toolCallCount > 0 ? `${toolCallCount} tool ${toolCallCount === 1 ? 'call' : 'calls'}` : '';
  const label = awaitingApproval
    ? 'Approval required'
    : `${active ? 'Working' : 'Worked'} for ${duration}`;
  const content = (
    <>
      <Text style={[styles.runSummaryLabel, awaitingApproval && styles.runSummaryLabelApproval]}>
        {label}
      </Text>
      {toolCallCount > 0 ? (
        <Text style={styles.runSummaryDetail}>
          {awaitingApproval ? `Worked ${duration} · ${callLabel}` : callLabel}
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
      accessibilityLabel={expanded ? 'Collapse run details' : 'Expand run details'}
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
  const [stepsExpanded, setStepsExpanded] = React.useState(false);
  if (!plan?.items.length) return null;
  const complete = plan.items.filter((item) => item.status === 'completed').length;
  const hiddenCount = Math.max(0, plan.items.length - DEFAULT_VISIBLE_PLAN_ITEMS);
  const visibleItems = stepsExpanded ? plan.items : plan.items.slice(0, DEFAULT_VISIBLE_PLAN_ITEMS);
  return (
    <View style={styles.plan}>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`Plan, ${complete} of ${plan.items.length} steps complete`}
        style={styles.planToggle}
      >
        <Text style={styles.planToggleText}>Plan</Text>
        <Text style={styles.planProgress}>
          ({complete}/{plan.items.length})
        </Text>
      </View>
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
    </View>
  );
}

function TranscriptRun({
  run,
  renderItem,
  showThinking,
  awaitingApproval = false,
  approvalStartedAt,
}: {
  run: MobileTranscriptRun;
  renderItem: (item: AssistantRenderItem, blocked?: boolean) => any;
  showThinking: boolean;
  awaitingApproval?: boolean;
  approvalStartedAt?: string | number;
}) {
  const [toolExpansion, setToolExpansion] = React.useState<'auto' | 'manual' | 'collapsed'>(
    run.active || awaitingApproval ? 'auto' : 'collapsed',
  );
  const userControlledExpansion = React.useRef(false);
  React.useEffect(() => {
    if (!run.active && !awaitingApproval) {
      userControlledExpansion.current = false;
      setToolExpansion('collapsed');
      return;
    }
    if (userControlledExpansion.current) return;
    setToolExpansion('auto');
  }, [awaitingApproval, run.active]);
  const { activityItems, trailingItems } = partitionMobileRunItems(run);
  const activityExpanded = toolExpansion !== 'collapsed';
  const visibleActivityItems =
    toolExpansion === 'auto' ? limitMobileRunToolItems(activityItems) : activityItems;
  const hasActivityDetails = activityItems.length > 0;
  const hasPlan = Boolean(run.plan?.items.length);
  const hasRunDetails = hasActivityDetails || hasPlan;
  const thinking = activityExpanded && showThinking && mobileRunIsThinking(run);
  return (
    <View>
      {renderItem(run.user)}
      <View style={styles.runBody}>
        <AgentRunSummary
          active={run.active}
          startedAt={run.startedAt}
          completedAt={run.completedAt}
          completedDurationMs={run.durationMs}
          toolCallCount={run.toolCallCount}
          expanded={activityExpanded}
          awaitingApproval={awaitingApproval}
          approvalStartedAt={approvalStartedAt}
          onToggle={
            hasRunDetails
              ? () => {
                  userControlledExpansion.current = true;
                  setToolExpansion((current) => (current === 'collapsed' ? 'manual' : 'collapsed'));
                }
              : undefined
          }
        />
        {hasRunDetails && activityExpanded ? (
          <View
            style={[
              styles.runDetails,
              hasActivityDetails && hasPlan && styles.runDetailsSideBySide,
            ]}
          >
            {hasActivityDetails ? (
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator
                style={[styles.activityRail, hasPlan && styles.activityRailSideBySide]}
                contentContainerStyle={styles.activityRailContent}
              >
                {visibleActivityItems.map((item) => (
                  <View key={item.key} style={styles.activityItem}>
                    {renderItem(item, awaitingApproval)}
                  </View>
                ))}
                {thinking && !awaitingApproval ? (
                  <View
                    accessible
                    accessibilityLabel="Assistant is thinking"
                    accessibilityLiveRegion="polite"
                    accessibilityRole="progressbar"
                    style={styles.thinkingActivity}
                  >
                    <ActivityIndicator accessible={false} color={colors.accent} size={12} />
                    <Text style={styles.thinkingActivityText}>Thinking…</Text>
                  </View>
                ) : null}
              </ScrollView>
            ) : null}
            {hasPlan ? (
              <View style={[styles.runPlan, hasActivityDetails && styles.runPlanSideBySide]}>
                <MobileAgentPlanList plan={run.plan} running={run.active} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {trailingItems.map((item) => (
        <React.Fragment key={item.key}>{renderItem(item)}</React.Fragment>
      ))}
    </View>
  );
}

export function MobileAssistantTranscript({
  messages,
  running = false,
  currentReasoning = '',
  awaitingApproval = false,
  approvalStartedAt,
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
  onLoadRunFiles,
}: {
  messages: AssistantMessage[];
  running?: boolean;
  currentReasoning?: string;
  awaitingApproval?: boolean;
  approvalStartedAt?: string | number;
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
  onLoadRunFiles?: (input: { artifactId: string; offset: number; limit: number }) => Promise<{
    entries: AgentRunFileChangeEntry[];
    nextOffset: number | null;
    metadataTruncated?: boolean;
  }>;
}) {
  const items = React.useMemo(() => renderItemsFromMessages(messages), [messages]);
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
  const historicalPrompts = queuedPrompts.filter(
    (prompt) => prompt.status === 'failed' || prompt.status === 'stopped',
  );
  const queuedOnlyPrompts = queuedPrompts.filter((prompt) => prompt.status === 'queued');
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
  let latestRunSummaryKey = '';
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type !== 'runSummary') continue;
    latestRunSummaryKey = items[index]!.key;
    break;
  }
  const renderItem = (item: AssistantRenderItem, blocked = false): any => {
    if (item.type === 'tool')
      return <ToolRow key={item.key} item={item} blocked={blocked && !item.result} />;
    if (item.type === 'toolGroup') {
      return <ToolGroupRow key={item.key} item={item} blocked={blocked} />;
    }
    if (item.type === 'runSummary') {
      return (
        <ChangedFilesSummary
          key={item.key}
          item={item}
          onLoadDiff={onLoadRunFileDiff}
          onLoadFiles={onLoadRunFiles}
          initiallyExpanded={item.key === latestRunSummaryKey}
        />
      );
    }
    if (item.type === 'compaction') {
      return <MobileCompactionRow key={item.key} details={item.details} />;
    }
    const text = visibleMessageText(item.message).trim();
    const structuredAssistantContent =
      item.message.role === 'assistant' && Array.isArray(item.message.content)
        ? item.message.content
        : null;
    const hasThinking = Boolean(
      structuredAssistantContent?.some(
        (part) => part?.type === 'thinking' && String(part.thinking ?? '').trim(),
      ),
    );
    const images = messageImageParts(item.message);
    const files = attachments(item.message);
    if (
      !text &&
      !hasThinking &&
      images.length === 0 &&
      files.length === 0 &&
      !item.message.errorMessage
    )
      return null;
    const user = item.message.role === 'user';
    const assistant = item.message.role === 'assistant';
    const userCodeBlock = user && nativeMarkdownHasCodeBlock(text);
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
        {assistant && structuredAssistantContent ? (
          <>
            {structuredAssistantContent.map((part, index) => {
              if (part?.type === 'thinking') {
                return (
                  <MobileReasoningBlock
                    key={`thinking:${index}`}
                    text={String(part.thinking ?? '')}
                  />
                );
              }
              if (part?.type !== 'text' || !String(part.text ?? '').trim()) return null;
              return (
                <NativeMarkdown
                  key={`text:${index}`}
                  text={String(part.text ?? '')}
                  tone="assistant"
                  onOpenFileReference={onOpenFileReference}
                />
              );
            })}
            {text ? (
              <LinkedPullRequestAttachments text={text} context={linkedPullRequests} />
            ) : null}
          </>
        ) : text && (assistant || userCodeBlock) ? (
          <>
            <NativeMarkdown
              text={text}
              tone={user ? 'user' : 'assistant'}
              onOpenFileReference={onOpenFileReference}
            />
            {assistant ? (
              <LinkedPullRequestAttachments text={text} context={linkedPullRequests} />
            ) : null}
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
        {item.message.meshTruncated && item.message.id && onLoadFullMessage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show the full message"
            accessibilityState={{
              disabled: fullMessageLoadingId === item.message.id,
            }}
            disabled={fullMessageLoadingId === item.message.id}
            onPress={() => onLoadFullMessage(item.message)}
            style={({ pressed }) => [
              styles.fullMessageButton,
              pressed && styles.fullMessageButtonPressed,
            ]}
          >
            {fullMessageLoadingId === item.message.id ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <Text style={styles.fullMessageText}>Show full message</Text>
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
  const latestRunGroup = [...groups].reverse().find((group) => group.type === 'run');
  const groupedActiveRun = lastGroup?.type === 'run' && lastGroup.active;
  const activePromptReasoning = activePrompt ? currentReasoning.trim() : '';
  const activePromptHasPlan = Boolean(activePrompt?.agentPlan?.items.length);
  const showStandaloneReasoning =
    running && Boolean(currentReasoning.trim()) && !groupedActiveRun && !activePrompt;
  const historicalTimeline = sortMobileTranscriptTimeline([
    ...groups.map((group, order) => ({
      kind: 'group' as const,
      group,
      order,
      atMs: timestampMs(mobileTranscriptGroupStartedAt(group)),
    })),
    ...historicalPrompts.map((prompt, index) => ({
      kind: 'prompt' as const,
      prompt,
      order: groups.length + index,
      atMs: timestampMs(prompt.startedAt),
    })),
  ]);
  return (
    <View style={styles.messages}>
      {historicalTimeline.map((entry) =>
        entry.kind === 'prompt' ? (
          <QueuedPromptRows key={`prompt:${entry.prompt.id}`} prompts={[entry.prompt]} />
        ) : entry.group.type === 'run' ? (
          <TranscriptRun
            key={entry.group.key}
            run={entry.group}
            renderItem={renderItem}
            showThinking={!showStandaloneReasoning}
            awaitingApproval={awaitingApproval && entry.group.key === latestRunGroup?.key}
            approvalStartedAt={approvalStartedAt}
          />
        ) : (
          <React.Fragment key={entry.group.key}>{renderItem(entry.group.item)}</React.Fragment>
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
            expanded={Boolean(activePromptReasoning || activePromptHasPlan)}
          />
          {activePromptReasoning || activePromptHasPlan ? (
            <View
              style={[
                styles.runDetails,
                activePromptReasoning && activePromptHasPlan && styles.runDetailsSideBySide,
              ]}
            >
              {activePromptReasoning ? (
                <View
                  style={[
                    styles.runReasoning,
                    activePromptHasPlan && styles.runReasoningSideBySide,
                  ]}
                >
                  <View style={styles.reasoningHead}>
                    <TypingDots label={`${assistantLabel} is working`} />
                    <Text style={styles.reasoningLabel}>Reasoning</Text>
                  </View>
                  <Text style={styles.reasoningText}>{activePromptReasoning}</Text>
                </View>
              ) : null}
              {activePromptHasPlan ? (
                <View style={[styles.runPlan, activePromptReasoning && styles.runPlanSideBySide]}>
                  <MobileAgentPlanList plan={activePrompt.agentPlan} running />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {showStandaloneReasoning ? (
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
      {queuedOnlyPrompts.length > 0 ? (
        <QueuedPromptRows
          prompts={queuedOnlyPrompts}
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
    marginVertical: 5,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: colors.whiteWashSoft,
  },
  changedFilesHeader: {
    minHeight: 34,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  changedFilesHeaderPressed: { opacity: 0.72 },
  changedFilesHeaderHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  changedFilesPressed: { backgroundColor: colors.whiteWashSoft },
  changedFilesTitle: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  changedFilesCount: { color: colors.mutedDim },
  changedFilesCounts: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  changedFilesCountsSeparator: {
    width: 1,
    height: 12,
    backgroundColor: colors.borderStrong,
  },
  changedFilesNet: {
    color: colors.accent,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  changedFilesAdditions: { color: colors.online, fontSize: 10, fontFamily: 'monospace' },
  changedFilesModified: { color: colors.warning, fontSize: 10, fontFamily: 'monospace' },
  changedFilesDeletions: { color: colors.danger, fontSize: 10, fontFamily: 'monospace' },
  changedFilesListScroll: {
    maxHeight: 288,
    marginHorizontal: 4,
    borderRadius: 6,
  },
  changedFilesList: { paddingVertical: 5 },
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
    opacity: 0.78,
  },
  changedFilesStatusPressed: { opacity: 1 },
  changedFilesPath: { flex: 1, color: colors.text, fontSize: 10, fontFamily: 'monospace' },
  changedFilesPathPressed: { color: colors.accent },
  changedFilesLineCounts: {
    color: colors.muted,
    fontSize: 9,
    fontFamily: 'monospace',
    opacity: 0.75,
  },
  changedFilesLineCountsPressed: { color: colors.text, opacity: 1 },
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
  runDetails: { paddingVertical: 6 },
  runDetailsSideBySide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  runPlan: { minWidth: 0, paddingVertical: 3 },
  runPlanSideBySide: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
    paddingLeft: 12,
  },
  runReasoning: {
    minWidth: 0,
    paddingVertical: 5,
  },
  runReasoningSideBySide: { flex: 1 },
  compaction: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  compactionLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  compactionText: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  activityRail: {
    maxHeight: 288,
    marginLeft: 10,
    marginRight: 10,
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
    opacity: 0.82,
  },
  activityRailSideBySide: {
    flex: 1,
    minWidth: 0,
    marginLeft: 0,
    marginRight: 0,
  },
  activityRailContent: {
    paddingLeft: 10,
    paddingVertical: 3,
  },
  activityItem: { minWidth: 0 },
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
  runSummaryLabelApproval: { color: colors.warning },
  runSummaryDetail: {
    flex: 1,
    color: colors.mutedDim,
    fontSize: 11,
  },
  plan: {
    minWidth: 0,
    paddingVertical: 3,
  },
  planToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 24 },
  planTogglePressed: { opacity: 0.68 },
  planToggleText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  planProgress: {
    color: colors.mutedDim,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  planItems: { gap: 6, marginTop: 7 },
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
    minHeight: 28,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
    paddingHorizontal: 1,
    paddingVertical: 4,
  },
  fullMessageButtonPressed: { opacity: 0.72 },
  fullMessageText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
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
    marginHorizontal: 0,
    marginVertical: 1,
  },
  toolNested: { marginHorizontal: 0 },
  toolHead: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  toolHeadPressed: { opacity: 0.68 },
  toolStatusSlot: {
    width: 13,
    height: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolStatusCircle: {
    width: 13,
    height: 13,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.online,
  },
  toolStatusError: { backgroundColor: colors.danger },
  toolStatusPartial: { backgroundColor: colors.warning },
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
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  toolCount: {
    color: colors.subtle,
    fontSize: 9,
    fontWeight: '500',
  },
  toolFailureCount: {
    color: colors.mutedDim,
    fontSize: 9,
    fontWeight: '500',
  },
  toolDetails: {
    gap: 7,
    marginLeft: 6,
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
    paddingLeft: 15,
    paddingRight: 4,
    paddingBottom: 9,
    paddingTop: 2,
  },
  toolDetailsNested: { marginLeft: 21, borderLeftWidth: 0, paddingLeft: 0 },
  detailLabel: { color: colors.muted, fontSize: 11, fontWeight: '500' },
  detailPayload: {
    borderRadius: 4,
    backgroundColor: colors.mantle,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  detailText: { color: colors.muted, fontSize: 10, lineHeight: 15, fontFamily: 'monospace' },
  detailPlaceholder: {
    color: colors.mutedDim,
    fontSize: 10,
    lineHeight: 15,
    fontStyle: 'italic',
  },
  detailList: { gap: 7 },
  detailField: { gap: 2 },
  detailFieldLabel: { color: colors.mutedDim, fontSize: 9, fontWeight: '600' },
  detailArrayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  detailIndex: {
    width: 18,
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 15,
    fontFamily: 'monospace',
    textAlign: 'right',
  },
  detailValue: { flex: 1, minWidth: 0 },
  groupDetails: {
    gap: 8,
    marginLeft: 6,
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
    paddingLeft: 15,
    paddingRight: 4,
    paddingBottom: 9,
    paddingTop: 2,
  },
  transfer: {
    marginHorizontal: 0,
    marginVertical: 1,
  },
  transferNested: { marginHorizontal: 0 },
  transferHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
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
  transferFiles: {
    gap: 9,
    marginLeft: 6,
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
    paddingLeft: 15,
    paddingRight: 4,
    paddingBottom: 9,
    paddingTop: 2,
  },
  transferFilesNested: { marginLeft: 21, borderLeftWidth: 0, paddingLeft: 0 },
  transferFile: {
    paddingVertical: 2,
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
  thinkingActivity: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  thinkingActivityText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
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
