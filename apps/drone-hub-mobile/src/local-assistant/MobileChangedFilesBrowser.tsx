import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import type {
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
  AgentRunFileChangeWorkspace,
} from '@blip/protocol';
import { colors } from '../theme';
import { NativeFileTypeIcon } from '../components/FileTypeIcon';
import { MobileChangedFileStatusBadge } from './MobileChangedFileStatusBadge';
import { MobileChangedFilesTree } from './MobileChangedFilesTree';
import {
  MOBILE_REVIEW_FILE_PAGE_SIZE,
  type MobileChangedFilesReviewSelection,
  type MobileChangedFilesReviewWorkspaceState,
} from './mobile-changed-files-review-model';
import { mobileChangedFileStatusPresentation } from './mobile-diff-review-model';

export function MobileChangedFilesBrowser({
  fileChanges,
  workspaces,
  selection,
  canRefresh,
  onSelect,
  onRefresh,
  onLoadMore,
}: {
  fileChanges: AgentRunFileChanges;
  workspaces: Record<string, MobileChangedFilesReviewWorkspaceState>;
  selection: MobileChangedFilesReviewSelection | null;
  canRefresh(workspace: AgentRunFileChangeWorkspace): boolean;
  onSelect(selection: MobileChangedFilesReviewSelection): void;
  onRefresh(workspace: AgentRunFileChangeWorkspace): void;
  onLoadMore(workspace: AgentRunFileChangeWorkspace): void;
}) {
  return (
    <View style={styles.browser}>
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator
        contentContainerStyle={styles.browserContent}
      >
        {fileChanges.workspaces.map((workspace) => (
          <WorkspaceBrowser
            key={workspace.targetId}
            workspace={workspace}
            state={workspaces[workspace.targetId]}
            selectedPath={selection?.workspaceTargetId === workspace.targetId ? selection.path : ''}
            showLabel={
              fileChanges.workspaces.length > 1 || workspace.targetId.startsWith('artifacts:')
            }
            canRefresh={canRefresh(workspace)}
            onSelect={(entry) =>
              onSelect({ workspaceTargetId: workspace.targetId, path: entry.path })
            }
            onRefresh={() => onRefresh(workspace)}
            onLoadMore={() => onLoadMore(workspace)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function WorkspaceBrowser({
  workspace,
  state,
  selectedPath,
  showLabel,
  canRefresh,
  onSelect,
  onRefresh,
  onLoadMore,
}: {
  workspace: AgentRunFileChangeWorkspace;
  state: MobileChangedFilesReviewWorkspaceState | undefined;
  selectedPath: string;
  showLabel: boolean;
  canRefresh: boolean;
  onSelect(entry: AgentRunFileChangeEntry): void;
  onRefresh(): void;
  onLoadMore(): void;
}) {
  return (
    <View>
      <View style={styles.workspaceHeader}>
        <Text numberOfLines={1} style={styles.workspaceLabel}>
          {showLabel ? workspace.label : `Files · ${state?.entries.length ?? 0}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Refresh changed files for ${workspace.label}`}
          disabled={!canRefresh || state?.status === 'loading'}
          hitSlop={8}
          onPress={onRefresh}
          style={({ pressed }) => [
            (!canRefresh || state?.status === 'loading') && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <RefreshCw color={colors.muted} size={14} strokeWidth={2} />
        </Pressable>
      </View>
      <MobileChangedFilesTree
        entries={state?.entries ?? []}
        renderFile={(entry, name) => {
          const presentation = mobileChangedFileStatusPresentation(entry);
          const selected = entry.path === selectedPath;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Review ${presentation.label.toLowerCase()} file ${entry.path}`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(entry)}
              style={({ pressed }) => [
                styles.fileRow,
                selected && styles.fileRowSelected,
                pressed && styles.pressed,
              ]}
            >
              <MobileChangedFileStatusBadge tone={presentation.tone} code={presentation.code} />
              <NativeFileTypeIcon
                path={entry.path}
                size={16}
                opacity={selected ? 1 : 0.86}
              />
              <Text
                numberOfLines={1}
                style={[styles.fileName, selected && styles.fileNameSelected]}
              >
                {name}
              </Text>
              {!entry.binary && (entry.additions > 0 || entry.deletions > 0) ? (
                <View style={styles.fileStats}>
                  {entry.additions > 0 ? (
                    <Text style={styles.fileAdditions}>+{entry.additions}</Text>
                  ) : null}
                  {entry.deletions > 0 ? (
                    <Text style={styles.fileDeletions}>-{entry.deletions}</Text>
                  ) : null}
                </View>
              ) : entry.binary ? (
                <Text style={styles.binaryFileStats}>binary</Text>
              ) : null}
            </Pressable>
          );
        }}
      />
      {state?.status === 'loading' ? (
        <View style={styles.inlineState}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.inlineStateText}>
            {state.operation === 'load-more' ? 'Loading more files…' : 'Loading changed files…'}
          </Text>
        </View>
      ) : state?.status === 'error' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading changed files"
          onPress={state.operation === 'load-more' ? onLoadMore : onRefresh}
          style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}
        >
          <Text numberOfLines={2} style={styles.inlineError}>
            {state.error}
          </Text>
          <Text style={styles.inlineActionText}>Retry</Text>
        </Pressable>
      ) : state?.entries.length === 0 ? (
        <View style={styles.inlineState}>
          <Text style={styles.inlineStateText}>No changed files are available.</Text>
        </View>
      ) : state?.nextOffset != null ? (
        <Pressable
          accessibilityRole="button"
          onPress={onLoadMore}
          style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}
        >
          <Text style={styles.inlineActionText}>Show {MOBILE_REVIEW_FILE_PAGE_SIZE} more</Text>
        </Pressable>
      ) : state?.metadataTruncated ? (
        <Text style={styles.metadataNote}>
          {'entries' in workspace
            ? 'Changed file list is truncated.'
            : 'Stored list limited to 5,000 files.'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  browser: {
    maxHeight: 260,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.mantle,
  },
  browserContent: { paddingVertical: 6 },
  workspaceHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  workspaceLabel: {
    minWidth: 0,
    flex: 1,
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  fileRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  fileRowSelected: { backgroundColor: colors.selectionWash },
  fileName: { minWidth: 0, flex: 1, color: colors.text, fontSize: 10, fontFamily: 'monospace' },
  fileNameSelected: { color: colors.accent },
  fileStats: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fileAdditions: { color: colors.online, fontSize: 9, fontFamily: 'monospace' },
  fileDeletions: { color: colors.danger, fontSize: 9, fontFamily: 'monospace' },
  binaryFileStats: { color: colors.muted, fontSize: 9, fontFamily: 'monospace' },
  inlineState: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  inlineStateText: { color: colors.muted, fontSize: 10 },
  inlineAction: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
  },
  inlineActionText: { color: colors.accent, fontSize: 10, fontWeight: '700' },
  inlineError: { minWidth: 0, flex: 1, color: colors.danger, fontSize: 10 },
  metadataNote: {
    color: colors.mutedDim,
    fontSize: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.35 },
});
