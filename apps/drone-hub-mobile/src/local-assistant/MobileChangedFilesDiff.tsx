import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import FileQuestion from 'lucide-react-native/icons/file-question-mark';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import type { AgentRunFileChangeEntry, AgentRunFileChangeWorkspace } from '@blip/protocol';
import { colors } from '../theme';
import { MobileChangedFileStatusBadge } from './MobileChangedFileStatusBadge';
import type { MobileChangedFilesReviewDiffState } from './mobile-changed-files-review-model';
import {
  mobileChangedFileStatusPresentation,
  type MobileDiffLine,
  type MobileDiffRenderModel,
} from './mobile-diff-review-model';

export function MobileChangedFilesDiff({
  selected,
  diffKey,
  state,
  onRetry,
}: {
  selected: {
    workspace: AgentRunFileChangeWorkspace;
    entry: AgentRunFileChangeEntry;
  } | null;
  diffKey: string;
  state: MobileChangedFilesReviewDiffState;
  onRetry(): void;
}) {
  return (
    <>
      {selected ? (
        <SelectedFileHeader workspace={selected.workspace} entry={selected.entry} />
      ) : null}
      <View style={styles.diffStage}>
        <DiffState diffKey={diffKey} state={state} onRetry={onRetry} />
      </View>
    </>
  );
}

function SelectedFileHeader({
  workspace,
  entry,
}: {
  workspace: AgentRunFileChangeWorkspace;
  entry: AgentRunFileChangeEntry;
}) {
  const presentation = mobileChangedFileStatusPresentation(entry);
  return (
    <View style={styles.fileHeader}>
      <MobileChangedFileStatusBadge
        tone={presentation.tone}
        code={presentation.code}
        label={presentation.label}
      />
      <View style={styles.fileHeaderCopy}>
        <Text numberOfLines={1} style={styles.filePath}>
          {entry.path}
        </Text>
        <Text numberOfLines={1} style={styles.fileMeta}>
          {workspace.label}
          {entry.originalPath ? ` · from ${entry.originalPath}` : ''}
        </Text>
      </View>
      {entry.binary ? (
        <Text style={styles.binaryLabel}>BINARY</Text>
      ) : (
        <View style={styles.changeCounts}>
          <Text style={styles.additionText}>+{entry.additions}</Text>
          <Text style={styles.deletionText}>-{entry.deletions}</Text>
        </View>
      )}
    </View>
  );
}

function DiffState({
  diffKey,
  state,
  onRetry,
}: {
  diffKey: string;
  state: MobileChangedFilesReviewDiffState;
  onRetry(): void;
}) {
  if (!diffKey) {
    return (
      <CenteredState
        icon="empty"
        title="No file selected"
        message="Choose a changed file to inspect its captured diff."
      />
    );
  }
  if (
    state.status === 'idle' ||
    state.status === 'loading' ||
    ('key' in state && state.key !== diffKey)
  ) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.stateTitle}>Loading diff</Text>
        <Text style={styles.stateBody}>Reading the captured file changes…</Text>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <CenteredState
        icon={state.kind === 'too-large' ? 'warning' : 'error'}
        title={
          state.kind === 'too-large'
            ? 'Diff too large'
            : state.kind === 'unavailable'
              ? 'Diff unavailable'
              : 'Could not load diff'
        }
        message={state.message}
        actionLabel={state.retryable ? 'Try again' : undefined}
        onAction={state.retryable ? onRetry : undefined}
      />
    );
  }
  return <DiffContent model={state.model} />;
}

function DiffContent({ model }: { model: MobileDiffRenderModel }) {
  if (model.kind !== 'diff') {
    return (
      <CenteredState
        icon={model.kind === 'too-large' || model.kind === 'malformed' ? 'warning' : 'empty'}
        title={
          model.kind === 'binary'
            ? 'Binary file'
            : model.kind === 'empty'
              ? 'No line changes'
              : model.kind === 'too-large'
                ? 'Diff too large'
                : model.kind === 'unavailable'
                  ? 'Diff unavailable'
                  : 'Unreadable diff'
        }
        message={model.message}
        note={model.truncated ? 'The captured diff was truncated.' : undefined}
      />
    );
  }
  return (
    <ScrollView
      style={styles.diffScroll}
      contentContainerStyle={styles.diffVerticalContent}
      showsVerticalScrollIndicator
    >
      {model.truncated ? (
        <View style={styles.truncatedBanner}>
          <TriangleAlert color={colors.warning} size={15} strokeWidth={2} />
          <Text style={styles.truncatedText}>
            Diff output is truncated. The visible line numbers still match this captured patch.
          </Text>
        </View>
      ) : null}
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.diffHorizontalContent}
      >
        <View style={styles.diffTable}>
          {model.hunks.map((hunk, hunkIndex) => (
            <View key={`${hunk.header}:${hunkIndex}`}>
              <View style={styles.hunkHeader}>
                <Text selectable style={styles.hunkHeaderText}>
                  {hunk.header}
                </Text>
              </View>
              {hunk.lines.map((line, lineIndex) => (
                <DiffLine
                  key={`${hunkIndex}:${lineIndex}:${line.oldLine ?? ''}:${line.newLine ?? ''}`}
                  line={line}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

function DiffLine({ line }: { line: MobileDiffLine }) {
  const marker =
    line.kind === 'addition'
      ? '+'
      : line.kind === 'deletion'
        ? '−'
        : line.kind === 'context'
          ? ' '
          : '·';
  return (
    <View
      style={[
        styles.diffLine,
        line.kind === 'addition' && styles.diffLineAddition,
        line.kind === 'deletion' && styles.diffLineDeletion,
        line.kind === 'note' && styles.diffLineNote,
      ]}
    >
      <Text style={styles.lineNumber}>{line.oldLine ?? ''}</Text>
      <Text style={styles.lineNumber}>{line.newLine ?? ''}</Text>
      <Text
        style={[
          styles.lineMarker,
          line.kind === 'addition' && styles.additionText,
          line.kind === 'deletion' && styles.deletionText,
        ]}
      >
        {marker}
      </Text>
      <Text
        selectable
        style={[
          styles.codeLine,
          line.kind === 'addition' && styles.additionCode,
          line.kind === 'deletion' && styles.deletionCode,
          line.kind === 'note' && styles.noteCode,
        ]}
      >
        {line.content || ' '}
      </Text>
    </View>
  );
}

function CenteredState({
  icon,
  title,
  message,
  note,
  actionLabel,
  onAction,
}: {
  icon: 'empty' | 'warning' | 'error';
  title: string;
  message: string;
  note?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const Icon = icon === 'empty' ? FileQuestion : TriangleAlert;
  const color =
    icon === 'error' ? colors.danger : icon === 'warning' ? colors.warning : colors.muted;
  return (
    <View style={styles.centerState}>
      <Icon color={color} size={34} strokeWidth={1.7} />
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{message}</Text>
      {note ? <Text style={styles.stateNote}>{note}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <RefreshCw color={colors.onAccent} size={15} strokeWidth={2.2} />
          <Text style={styles.retryText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fileHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.mantle,
  },
  fileHeaderCopy: { minWidth: 0, flex: 1 },
  filePath: {
    color: colors.textStrong,
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  fileMeta: { marginTop: 3, color: colors.mutedDim, fontSize: 9 },
  changeCounts: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  additionText: { color: colors.online },
  deletionText: { color: colors.danger },
  binaryLabel: { color: colors.muted, fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  diffStage: { minHeight: 0, flex: 1 },
  centerState: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  stateTitle: { marginTop: 12, color: colors.textStrong, fontSize: 14, fontWeight: '700' },
  stateBody: {
    marginTop: 6,
    maxWidth: 360,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  stateNote: { marginTop: 8, color: colors.warning, fontSize: 10, textAlign: 'center' },
  retryButton: {
    minHeight: 36,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.onAccent, fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.65 },
  diffScroll: { flex: 1 },
  diffVerticalContent: { paddingBottom: 24 },
  diffHorizontalContent: { minWidth: '100%' },
  diffTable: { minWidth: 640, paddingVertical: 8 },
  truncatedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: 7,
    backgroundColor: colors.warningDark,
  },
  truncatedText: {
    minWidth: 0,
    flex: 1,
    color: colors.warning,
    fontSize: 10,
    lineHeight: 14,
  },
  hunkHeader: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDark,
  },
  hunkHeaderText: { color: colors.accent, fontSize: 9, fontFamily: 'monospace' },
  diffLine: {
    minHeight: 21,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.background,
  },
  diffLineAddition: { backgroundColor: colors.onlineDark },
  diffLineDeletion: { backgroundColor: colors.dangerDark },
  diffLineNote: { backgroundColor: colors.surface0 },
  lineNumber: {
    width: 44,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRightWidth: 1,
    borderRightColor: colors.borderSubtle,
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 15,
    fontFamily: 'monospace',
    textAlign: 'right',
  },
  lineMarker: {
    width: 18,
    paddingVertical: 3,
    color: colors.mutedDim,
    fontSize: 10,
    lineHeight: 15,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  codeLine: {
    minWidth: 520,
    paddingRight: 12,
    paddingVertical: 3,
    color: colors.text,
    fontSize: 10,
    lineHeight: 15,
    fontFamily: 'monospace',
  },
  additionCode: { color: colors.online },
  deletionCode: { color: colors.danger },
  noteCode: { color: colors.muted },
});
