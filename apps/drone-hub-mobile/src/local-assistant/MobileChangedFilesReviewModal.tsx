import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ListTree from 'lucide-react-native/icons/list-tree';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import type {
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
  AgentRunFileChangeWorkspace,
} from '@blip/protocol';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { MobileChangedFilesBrowser } from './MobileChangedFilesBrowser';
import { MobileChangedFilesDiff } from './MobileChangedFilesDiff';
import {
  createMobileChangedFilesReviewState,
  MOBILE_REVIEW_FILE_PAGE_SIZE,
  mobileChangedFilesReviewNeighbor,
  mobileChangedFilesReviewReducer,
  mobileChangedFilesReviewSelectedEntry,
  mobileChangedFilesReviewSelectionIndex,
  type MobileChangedFilesReviewSelection,
} from './mobile-changed-files-review-model';
import { buildMobileDiffRenderModel, mobileDiffLoadError } from './mobile-diff-review-model';

export type MobileChangedFilesReviewModalProps = {
  fileChanges: AgentRunFileChanges;
  initialSelection: {
    workspaceTargetId: string;
    entry: AgentRunFileChangeEntry;
  };
  onLoadDiff?: (input: { artifactId: string; path: string }) => Promise<{
    patch: string;
    truncated?: boolean;
  }>;
  onLoadFiles?: (input: { artifactId: string; offset: number; limit: number }) => Promise<{
    entries: AgentRunFileChangeEntry[];
    nextOffset: number | null;
    metadataTruncated?: boolean;
  }>;
  onClose(): void;
};

export function MobileChangedFilesReviewModal({
  fileChanges,
  initialSelection,
  onLoadDiff,
  onLoadFiles,
  onClose,
}: MobileChangedFilesReviewModalProps) {
  const [state, dispatch] = React.useReducer(mobileChangedFilesReviewReducer, undefined, () =>
    createMobileChangedFilesReviewState(fileChanges, initialSelection),
  );
  const [browserOpen, setBrowserOpen] = React.useState(true);
  const [diffRefreshNonce, setDiffRefreshNonce] = React.useState(0);
  const selected = mobileChangedFilesReviewSelectedEntry(fileChanges, state);
  const selectionIndex = mobileChangedFilesReviewSelectionIndex(fileChanges, state);
  const previousSelection = mobileChangedFilesReviewNeighbor(fileChanges, state, -1);
  const nextSelection = mobileChangedFilesReviewNeighbor(fileChanges, state, 1);
  const selectedArtifactId = selected?.workspace.diffArtifactId ?? '';
  const selectedPath = selected?.entry.path ?? '';
  const selectedDiffKey = selected ? `${selected.workspace.targetId}\u0000${selectedPath}` : '';
  const canRefreshDiff = Boolean(selectedArtifactId && onLoadDiff && !selected?.entry.binary);

  const loadWorkspace = React.useCallback(
    (workspace: AgentRunFileChangeWorkspace, append: boolean) => {
      const current = state.workspaces[workspace.targetId];
      if (!current || current.status === 'loading') return;
      if ('entries' in workspace || !workspace.diffArtifactId || !onLoadFiles) {
        dispatch({
          type: 'files-loaded',
          workspaceTargetId: workspace.targetId,
          entries: current.entries,
          nextOffset: null,
          metadataTruncated: current.metadataTruncated,
          append: false,
        });
        return;
      }
      const offset = append ? current.nextOffset : 0;
      if (offset == null) return;
      dispatch({
        type: 'files-loading',
        workspaceTargetId: workspace.targetId,
        append,
      });
      void onLoadFiles({
        artifactId: workspace.diffArtifactId,
        offset,
        limit: MOBILE_REVIEW_FILE_PAGE_SIZE,
      })
        .then((result) => {
          dispatch({
            type: 'files-loaded',
            workspaceTargetId: workspace.targetId,
            entries: result.entries,
            nextOffset: result.nextOffset,
            metadataTruncated: result.metadataTruncated === true,
            append,
          });
        })
        .catch((error: any) => {
          dispatch({
            type: 'files-error',
            workspaceTargetId: workspace.targetId,
            message: String(error?.message ?? error ?? 'Unable to load changed files.'),
          });
        });
    },
    [onLoadFiles, state.workspaces],
  );

  React.useEffect(() => {
    for (const workspace of fileChanges.workspaces) {
      if (state.workspaces[workspace.targetId]?.status !== 'idle') continue;
      loadWorkspace(workspace, false);
    }
  }, [fileChanges.workspaces, loadWorkspace, state.workspaces]);

  React.useEffect(() => {
    if (!selected || !selectedDiffKey) return;
    dispatch({ type: 'diff-loading', key: selectedDiffKey });
    if (selected.entry.binary) {
      dispatch({
        type: 'diff-loaded',
        key: selectedDiffKey,
        model: buildMobileDiffRenderModel({
          entry: selected.entry,
          patch: '',
          truncated: false,
        }),
      });
      return;
    }
    if (!selectedArtifactId || !onLoadDiff) {
      dispatch({
        type: 'diff-loaded',
        key: selectedDiffKey,
        model: {
          kind: 'unavailable',
          message: 'A historical patch was not retained for this file.',
          truncated: false,
        },
      });
      return;
    }
    let active = true;
    void onLoadDiff({ artifactId: selectedArtifactId, path: selectedPath })
      .then((result) => {
        if (!active) return;
        dispatch({
          type: 'diff-loaded',
          key: selectedDiffKey,
          model: buildMobileDiffRenderModel({
            entry: selected.entry,
            patch: String(result.patch ?? ''),
            truncated: result.truncated === true,
          }),
        });
      })
      .catch((error: any) => {
        if (!active) return;
        dispatch({
          type: 'diff-error',
          key: selectedDiffKey,
          error: mobileDiffLoadError(error),
        });
      });
    return () => {
      active = false;
    };
  }, [
    diffRefreshNonce,
    onLoadDiff,
    selectedArtifactId,
    selectedDiffKey,
    selectedPath,
    selected?.entry,
  ]);

  const selectFile = React.useCallback((selection: MobileChangedFilesReviewSelection) => {
    dispatch({ type: 'select', selection });
    setBrowserOpen(false);
  }, []);

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close changed files review"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <ChevronLeft color={colors.text} size={22} strokeWidth={2} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              Changed files
            </Text>
            <Text numberOfLines={1} style={styles.headerPath}>
              {selected?.entry.path ?? 'Select a file to review'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={browserOpen ? 'Hide changed files' : 'Show changed files'}
            accessibilityState={{ expanded: browserOpen }}
            hitSlop={8}
            onPress={() => setBrowserOpen((current) => !current)}
            style={({ pressed }) => [
              styles.iconButton,
              browserOpen && styles.iconButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <ListTree
              color={browserOpen ? colors.accent : colors.muted}
              size={19}
              strokeWidth={2}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh selected diff"
            disabled={!canRefreshDiff || state.diff.status === 'loading'}
            hitSlop={8}
            onPress={() => setDiffRefreshNonce((value) => value + 1)}
            style={({ pressed }) => [
              styles.iconButton,
              (!canRefreshDiff || state.diff.status === 'loading') && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <RefreshCw color={colors.muted} size={18} strokeWidth={2} />
          </Pressable>
        </View>

        {browserOpen ? (
          <MobileChangedFilesBrowser
            fileChanges={fileChanges}
            workspaces={state.workspaces}
            selection={state.selection}
            canRefresh={(workspace) =>
              !('entries' in workspace) && Boolean(workspace.diffArtifactId && onLoadFiles)
            }
            onSelect={selectFile}
            onRefresh={(workspace) => loadWorkspace(workspace, false)}
            onLoadMore={(workspace) => loadWorkspace(workspace, true)}
          />
        ) : null}

        <View style={styles.selectionBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous changed file"
            disabled={!previousSelection}
            onPress={() => previousSelection && selectFile(previousSelection)}
            style={({ pressed }) => [
              styles.navigationButton,
              !previousSelection && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <ChevronLeft color={colors.text} size={17} strokeWidth={2.2} />
            <Text style={styles.navigationLabel}>Previous</Text>
          </Pressable>
          <Text accessibilityLabel="Selected file position" style={styles.selectionCount}>
            {selectionIndex.current} / {selectionIndex.total}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next changed file"
            disabled={!nextSelection}
            onPress={() => nextSelection && selectFile(nextSelection)}
            style={({ pressed }) => [
              styles.navigationButton,
              !nextSelection && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.navigationLabel}>Next</Text>
            <ChevronRight color={colors.text} size={17} strokeWidth={2.2} />
          </Pressable>
        </View>

        <MobileChangedFilesDiff
          selected={selected}
          diffKey={selectedDiffKey}
          state={state.diff}
          onRetry={() => setDiffRefreshNonce((value) => value + 1)}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 2,
    paddingRight: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.mantle,
  },
  backButton: {
    width: 28,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  headerCopy: { minWidth: 0, flex: 1 },
  headerTitle: { color: colors.textStrong, fontSize: 15, fontWeight: '700' },
  headerPath: { marginTop: 2, color: colors.muted, fontSize: 10, fontFamily: 'monospace' },
  iconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.controlSurface,
  },
  iconButtonActive: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDark,
  },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.35 },
  selectionBar: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface0,
    paddingHorizontal: 8,
  },
  navigationButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 7,
  },
  navigationLabel: { color: colors.text, fontSize: 10, fontWeight: '600' },
  selectionCount: { color: colors.muted, fontSize: 10, fontFamily: 'monospace' },
});
