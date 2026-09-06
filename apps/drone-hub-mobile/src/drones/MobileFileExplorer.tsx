import { workspaceLinkParent } from '@drone/hub-model';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  type TextInput as NativeTextInput,
  View,
  type ViewProps,
} from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import FileQuestion from 'lucide-react-native/icons/file-question-mark';
import Check from 'lucide-react-native/icons/check';
import X from 'lucide-react-native/icons/x';
import Pencil from 'lucide-react-native/icons/pencil';
import { mobileExplorerCreationAction } from './mobile-explorer-creation';
import Plus from 'lucide-react-native/icons/plus';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import type { DroneControlOperation } from '@drone/device-protocol';
import { NativeFileTypeIcon, NativeFolderTypeIcon } from '../components/FileTypeIcon';
import { useMobileExplorerFolderIcons } from '../mobile-explorer-folder-icons';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import { BoundedSwrCache } from './bounded-swr-cache';
import {
  MobileDirectoryContextCache,
  mobileDirectoryErrorMode,
  retainMobileExplorerEntries,
  type MobileDirectoryState as DirectoryState,
  type MobileExplorerEntry as FileExplorerEntry,
} from './mobile-directory-cache';
import { MobileDirectoryRequestTracker } from './mobile-directory-request-tracker';
import {
  mobileDirectoryCacheKey,
  mobileFileActionInvalidationPaths,
} from './mobile-file-cache-key';

type VisibleExplorerRow =
  | {
      kind: 'entry';
      key: string;
      entry: FileExplorerEntry;
      depth: number;
      open: boolean;
      selected: boolean;
    }
  | {
      kind: 'state';
      key: string;
      path: string;
      depth: number;
      loading: boolean;
      error: string | null;
    }
  | {
      kind: 'editor';
      key: string;
      depth: number;
      mode: ExplorerActionMode;
      entry: FileExplorerEntry | null;
    };

type ExplorerActionMode = 'rename' | 'create';

type ExplorerEditorState = {
  mode: ExplorerActionMode;
  entry: FileExplorerEntry | null;
  targetDirectory: string;
};

type RequestDroneControl = (
  destinationId: string,
  operation: DroneControlOperation,
  payload?: any,
  signal?: AbortSignal,
) => Promise<any>;

const explorerNameCollator = new Intl.Collator(undefined, { sensitivity: 'base' });

function normalizeEntries(raw: unknown): FileExplorerEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((value: any): FileExplorerEntry[] => {
      const name = String(value?.name ?? '').trim();
      const path = String(value?.path ?? '').trim();
      const kind =
        value?.kind === 'directory' ? 'directory' : value?.kind === 'file' ? 'file' : 'other';
      if (!name || !path || kind === 'other' || (kind === 'directory' && name === '.git'))
        return [];
      return [{ name, path, kind, isGitIgnored: value?.isGitIgnored === true }];
    })
    .sort((left, right) =>
      left.kind === right.kind
        ? explorerNameCollator.compare(left.name, right.name)
        : left.kind === 'directory'
          ? -1
          : 1,
    );
}

export function mobileExplorerParentPath(pathRaw: string, rootPathRaw: string): string {
  const rawRootPath = String(rootPathRaw ?? '');
  const rootPath = /^\/+$/.test(rawRootPath) ? '/' : rawRootPath.replace(/[\\/]+$/g, '');
  const path = String(pathRaw ?? '').replace(/[\\/]+$/g, '');
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (separatorIndex < 0) return rootPath;
  if (separatorIndex === 2 && /^[a-z]:[\\/]/i.test(path)) return path.slice(0, 3);
  const parent = path.slice(0, separatorIndex);
  return parent || (path.startsWith('/') ? '/' : rootPath);
}

export function mobileExplorerJoinPath(parentRaw: string, nameRaw: string): string {
  const rawParent = String(parentRaw ?? '');
  if (/^\/+$/.test(rawParent)) return `/${nameRaw}`;
  const parent = rawParent.replace(/[\\/]+$/g, '');
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent ? `${parent}${separator}${nameRaw}` : nameRaw;
}

function fileNameStemSelectionEnd(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}

export function MobileFileExplorer({
  active,
  targetId,
  droneId,
  chatName,
  rootPath,
  selectedPath,
  reveal,
  requestDroneControl,
  onOpenFile,
  onPathsChanged,
  renderHeader,
  onRequestExpand,
}: {
  active: boolean;
  targetId: string;
  droneId: string;
  chatName: string;
  rootPath: string;
  selectedPath: string;
  reveal?: { path: string; sequence: number } | null;
  requestDroneControl: RequestDroneControl;
  onOpenFile(path: string): void;
  onPathsChanged(paths: readonly string[]): void;
  renderHeader(actions: ViewProps['children']): ViewProps['children'];
  onRequestExpand(): void;
}) {
  const folderIcons = useMobileExplorerFolderIcons();
  const [directories, setDirectories] = React.useState<Record<string, DirectoryState>>({});
  const directoriesRef = React.useRef(directories);
  const directoryContextRef = React.useRef(new MobileDirectoryContextCache());
  const contextVersionRef = React.useRef(0);
  const directoryRequestSeqRef = React.useRef<Record<string, number>>({});
  const directoryAbortControllersRef = React.useRef(new Map<string, AbortController>());
  const directoryRequestsRef = React.useRef(new MobileDirectoryRequestTracker());
  const loadDirectoryRef = React.useRef<((path: string, force?: boolean) => Promise<void>) | null>(
    null,
  );
  const directoryCacheRef = React.useRef<BoundedSwrCache<MobileDirectoryContextCache> | null>(null);
  if (!directoryCacheRef.current) {
    directoryCacheRef.current = new BoundedSwrCache({
      maxEntries: 4,
      maxAgeMs: 2 * 60_000,
    });
  }
  directoriesRef.current = directories;
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const [refreshing, setRefreshing] = React.useState<ReadonlySet<string>>(() => new Set());
  const refreshingRef = React.useRef(refreshing);
  refreshingRef.current = refreshing;
  const [actionMenuEntry, setActionMenuEntry] = React.useState<
    FileExplorerEntry | null | undefined
  >(undefined);
  const listRef = React.useRef<FlatList<VisibleExplorerRow>>(null);
  const [editor, setEditor] = React.useState<ExplorerEditorState | null>(null);
  const [actionInput, setActionInput] = React.useState('');
  const [actionLoading, setActionLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const actionInputRef = React.useRef<NativeTextInput | null>(null);
  const suppressPressUntilRef = React.useRef(0);
  const contextKey = mobileDirectoryCacheKey({ targetId, droneId, chatName, rootPath });
  const currentContextKeyRef = React.useRef(contextKey);
  currentContextKeyRef.current = contextKey;

  const adoptDirectories = React.useCallback(
    (next: Record<string, DirectoryState>) => {
      directoriesRef.current = next;
      for (const path of Object.keys(directoryRequestSeqRef.current)) {
        if (!(path in next)) delete directoryRequestSeqRef.current[path];
      }
      const retainedRefreshing = [...refreshingRef.current].filter((path) => path in next);
      if (retainedRefreshing.length !== refreshingRef.current.size) {
        const nextRefreshing = new Set(retainedRefreshing);
        refreshingRef.current = nextRefreshing;
        setRefreshing(nextRefreshing);
      }
      directoryCacheRef.current!.set(contextKey, directoryContextRef.current);
      setDirectories((current) => (current === next ? current : next));
      setExpanded((current) => {
        const retained = [...current].filter((path) => path in next);
        return retained.length === current.size ? current : new Set(retained);
      });
    },
    [contextKey],
  );

  const commitDirectories = React.useCallback(
    (updates: ReadonlyArray<{ path: string; state: DirectoryState }>) => {
      adoptDirectories(directoryContextRef.current.update(updates, rootPath));
    },
    [adoptDirectories, rootPath],
  );

  const loadDirectory = React.useCallback(
    async (path: string, force = false) => {
      const requestContextVersion = contextVersionRef.current;
      const requestContextKey = contextKey;
      const existing = directoriesRef.current[path];
      if (!force && existing?.loaded) return;
      const requestToken = directoryRequestsRef.current.begin(path, force);
      if (!requestToken) return;
      const background = existing?.loaded === true;
      const requestSeq = (directoryRequestSeqRef.current[path] ?? 0) + 1;
      directoryRequestSeqRef.current[path] = requestSeq;
      const requestController = new AbortController();
      directoryAbortControllersRef.current.set(path, requestController);
      if (background) {
        const nextRefreshing = new Set(refreshingRef.current).add(path);
        refreshingRef.current = nextRefreshing;
        setRefreshing(nextRefreshing);
      } else {
        commitDirectories([
          {
            path,
            state: {
              entries: existing?.entries ?? [],
              loading: true,
              error: null,
              loaded: false,
            },
          },
        ]);
      }
      try {
        let result = await requestDroneControl(
          targetId,
          'files.list',
          {
            droneId,
            chatName,
            path,
            contentOffset: 0,
          },
          requestController.signal,
        );

        if (
          currentContextKeyRef.current !== requestContextKey ||
          contextVersionRef.current !== requestContextVersion ||
          directoryRequestSeqRef.current[path] !== requestSeq
        )
          return;
        const resolvedPath = String(result?.path ?? path);
        const normalizedEntries = normalizeEntries(result?.entries);
        const previousEntries = directoriesRef.current[path]?.entries ?? [];
        const nextState: DirectoryState = {
          entries: retainMobileExplorerEntries(previousEntries, normalizedEntries),
          loading: false,
          error: null,
          loaded: true,
        };
        commitDirectories([
          { path, state: nextState },
          ...(resolvedPath !== path ? [{ path: resolvedPath, state: nextState }] : []),
        ]);
      } catch (nextError: any) {
        if (
          currentContextKeyRef.current !== requestContextKey ||
          contextVersionRef.current !== requestContextVersion ||
          directoryRequestSeqRef.current[path] !== requestSeq
        )
          return;
        const message = String(nextError?.message ?? nextError ?? 'Unable to list files.');
        const current = directoriesRef.current[path];
        commitDirectories([
          {
            path,
            state: {
              entries: current?.entries ?? [],
              loading: false,
              error: /not granted|not permitted|access|denied/i.test(message)
                ? `${message}. Enable “drone-control: files.list” for this phone in Devices.`
                : message,
              loaded: current?.loaded === true,
            },
          },
        ]);
      } finally {
        if (directoryAbortControllersRef.current.get(path) === requestController) {
          directoryAbortControllersRef.current.delete(path);
        }
        const requestIsCurrent =
          currentContextKeyRef.current === requestContextKey &&
          contextVersionRef.current === requestContextVersion &&
          directoryRequestSeqRef.current[path] === requestSeq;
        if (requestIsCurrent && refreshingRef.current.has(path)) {
          const next = new Set(refreshingRef.current);
          next.delete(path);
          refreshingRef.current = next;
          setRefreshing(next);
        }
        const runTrailing = directoryRequestsRef.current.finish(path, requestToken);
        if (requestIsCurrent && runTrailing) {
          void loadDirectoryRef.current?.(path, true);
        }
      }
    },
    [chatName, commitDirectories, contextKey, droneId, requestDroneControl, targetId],
  );
  loadDirectoryRef.current = loadDirectory;

  React.useEffect(() => {
    for (const controller of directoryAbortControllersRef.current.values()) controller.abort();
    directoryAbortControllersRef.current.clear();
    contextVersionRef.current += 1;
    directoryRequestSeqRef.current = {};
    directoryRequestsRef.current.reset();
    const cached = directoryCacheRef.current!.get(contextKey) ?? new MobileDirectoryContextCache();
    directoryContextRef.current = cached;
    directoriesRef.current = cached.directories;
    setDirectories(cached.directories);
    setExpanded(new Set());
    const nextRefreshing = new Set<string>();
    refreshingRef.current = nextRefreshing;
    setRefreshing(nextRefreshing);
    setActionMenuEntry(undefined);
    setEditor(null);
    setActionInput('');
    setActionError(null);
    setActionLoading(false);
    return () => {
      for (const controller of directoryAbortControllersRef.current.values()) controller.abort();
      directoryAbortControllersRef.current.clear();
      contextVersionRef.current += 1;
      directoryRequestsRef.current.reset();
    };
  }, [contextKey]);

  React.useEffect(() => {
    if (!active) return;
    const cachedRoot = directoriesRef.current[rootPath];
    void loadDirectory(rootPath, Boolean(cachedRoot?.loaded || cachedRoot?.loading));
  }, [active, loadDirectory, rootPath]);

  React.useEffect(() => {
    if (!active || !reveal) return;
    const paths: string[] = [];
    let path = reveal.path;
    while (path !== rootPath) {
      paths.push(path);
      const parent = workspaceLinkParent(path);
      if (parent === path) break;
      path = parent;
    }
    setExpanded((current) => new Set([...current, ...paths]));
    for (const directory of paths.reverse()) void loadDirectory(directory);
  }, [active, reveal, rootPath, loadDirectory]);

  const toggleDirectory = (path: string) => {
    const willExpand = !expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (willExpand) next.add(path);
      else next.delete(path);
      return next;
    });
    if (willExpand) {
      const cachedDirectory = directoriesRef.current[path];
      void loadDirectory(path, Boolean(cachedDirectory?.loaded || cachedDirectory?.loading));
    }
  };

  const refreshExplorer = React.useCallback(() => {
    const paths = [rootPath, ...expanded].filter(
      (path, index, allPaths) => allPaths.indexOf(path) === index,
    );
    for (const path of paths) void loadDirectory(path, true);
  }, [expanded, loadDirectory, rootPath]);

  const beginAction = React.useCallback(
    (mode: ExplorerActionMode, entry: FileExplorerEntry | null) => {
      onRequestExpand();
      if (!entry) listRef.current?.scrollToOffset({ offset: 0, animated: false });
      const targetDirectory =
        mode === 'create' && entry?.kind === 'directory'
          ? entry.path
          : entry
            ? mobileExplorerParentPath(entry.path, rootPath)
            : rootPath;
      if (mode === 'create' && entry?.kind === 'directory') {
        setExpanded((current) => new Set([...current, entry.path]));
        void loadDirectory(entry.path);
      }
      setActionMenuEntry(undefined);
      setActionError(null);
      setActionInput(mode === 'rename' ? (entry?.name ?? '') : '');
      setEditor({
        mode,
        entry,
        targetDirectory,
      });
    },
    [loadDirectory, onRequestExpand, rootPath],
  );

  const cancelAction = React.useCallback(() => {
    if (actionLoading) return;
    setEditor(null);
    setActionInput('');
    setActionError(null);
  }, [actionLoading]);

  const submitAction = React.useCallback(async () => {
    if (!editor || actionLoading) return;
    const requestContextVersion = contextVersionRef.current;
    const requestContextKey = contextKey;
    const name = actionInput.trim();
    if (!name) {
      setActionError('Enter a name.');
      return;
    }
    if (name === '.' || name === '..' || /[\\/\0\r\n\t]/.test(name)) {
      setActionError('Names cannot contain slashes or invalid whitespace.');
      return;
    }
    if (editor.mode === 'rename' && name === editor.entry?.name) {
      cancelAction();
      return;
    }
    const action = editor.mode === 'rename' ? 'rename' : mobileExplorerCreationAction(name);
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await requestDroneControl(targetId, 'file.action', {
        droneId,
        chatName,
        action,
        name,
        ...(editor.mode === 'rename'
          ? { path: editor.entry?.path }
          : { targetDir: editor.targetDirectory }),
      });
      if (
        currentContextKeyRef.current !== requestContextKey ||
        contextVersionRef.current !== requestContextVersion
      )
        return;
      const createdPath = String(
        result?.path ?? mobileExplorerJoinPath(editor.targetDirectory, name),
      );
      const targetPath = String(
        result?.targetPath ?? mobileExplorerJoinPath(editor.targetDirectory, name),
      );
      const invalidatedPaths = mobileFileActionInvalidationPaths({
        action,
        sourcePath: editor.entry?.path,
        createdPath,
        targetPath,
      });
      const nextDirectories = directoryContextRef.current.deletePaths(invalidatedPaths);
      if (nextDirectories !== directoriesRef.current) {
        adoptDirectories(nextDirectories);
      }
      onPathsChanged(invalidatedPaths);
      setEditor(null);
      setActionInput('');
      await loadDirectory(editor.targetDirectory, true);
      if (
        action === 'create-file' ||
        (editor.mode === 'rename' && editor.entry?.path === selectedPath)
      ) {
        onOpenFile(editor.mode === 'rename' ? targetPath : createdPath);
      }
    } catch (nextError: any) {
      if (
        currentContextKeyRef.current !== requestContextKey ||
        contextVersionRef.current !== requestContextVersion
      )
        return;
      const message = String(nextError?.message ?? nextError ?? 'Unable to update this item.');
      setActionError(
        /not granted|not permitted|access|denied/i.test(message)
          ? `${message}. Enable “drone-control: file.action” for this phone in Devices.`
          : message,
      );
    } finally {
      if (
        currentContextKeyRef.current === requestContextKey &&
        contextVersionRef.current === requestContextVersion
      )
        setActionLoading(false);
    }
  }, [
    actionInput,
    actionLoading,
    adoptDirectories,
    cancelAction,
    chatName,
    contextKey,
    droneId,
    editor,
    loadDirectory,
    onOpenFile,
    onPathsChanged,
    requestDroneControl,
    selectedPath,
    targetId,
  ]);

  const root = directories[rootPath];
  React.useEffect(() => {
    if (!editor) return;
    const frame = requestAnimationFrame(() => {
      actionInputRef.current?.focus();
      const end =
        editor.mode === 'rename' ? fileNameStemSelectionEnd(actionInput) : actionInput.length;
      actionInputRef.current?.setNativeProps({ selection: { start: 0, end } });
    });
    return () => cancelAnimationFrame(frame);
    // Selection is intentionally based on the initial value only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const rows = React.useMemo(() => {
    const visible: VisibleExplorerRow[] = [];
    const visit = (path: string, depth: number) => {
      if (editor?.mode === 'create' && editor.targetDirectory === path) {
        visible.push({
          kind: 'editor',
          key: `editor:create:${path}`,
          depth,
          mode: 'create',
          entry: null,
        });
      }
      for (const entry of directories[path]?.entries ?? []) {
        const isDirectory = entry.kind === 'directory';
        const open = isDirectory && expanded.has(entry.path);
        if (editor?.mode === 'rename' && editor.entry?.path === entry.path) {
          visible.push({
            kind: 'editor',
            key: `editor:rename:${entry.path}`,
            depth,
            mode: 'rename',
            entry,
          });
        } else {
          visible.push({
            kind: 'entry',
            key: `${entry.kind}:${entry.path}`,
            entry,
            depth,
            open,
            selected: entry.path === selectedPath,
          });
        }
        if (!open) continue;
        const child = directories[entry.path];
        if ((child?.loading && !child.loaded) || (child?.error && !child.loaded)) {
          visible.push({
            kind: 'state',
            key: `state:${entry.path}`,
            path: entry.path,
            depth: depth + 1,
            loading: child.loading,
            error: child.error,
          });
          continue;
        }
        if (child?.error) {
          visible.push({
            kind: 'state',
            key: `state:${entry.path}`,
            path: entry.path,
            depth: depth + 1,
            loading: false,
            error: child.error,
          });
        } else if (refreshing.has(entry.path)) {
          visible.push({
            kind: 'state',
            key: `state:${entry.path}`,
            path: entry.path,
            depth: depth + 1,
            loading: true,
            error: null,
          });
        }
        visit(entry.path, depth + 1);
      }
    };
    visit(rootPath, 0);
    return visible;
  }, [directories, editor, expanded, refreshing, rootPath, selectedPath]);
  const scrolledRevealRef = React.useRef<object | null>(null);
  const [revealScrollAttempt, setRevealScrollAttempt] = React.useState(0);
  const revealScrollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    setRevealScrollAttempt(0);
    return () => {
      if (revealScrollTimer.current) clearTimeout(revealScrollTimer.current);
    };
  }, [reveal]);
  React.useEffect(() => {
    if (!active || !reveal || scrolledRevealRef.current === reveal) return;
    const index = rows.findIndex((row) => row.kind === 'entry' && row.entry.path === reveal.path);
    if (index < 0) return;
    const frame = requestAnimationFrame(() => {
      scrolledRevealRef.current = reveal;
      listRef.current?.scrollToIndex({ index, viewPosition: 0.4, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, reveal, rows, revealScrollAttempt]);
  return (
    <View style={styles.explorer}>
      {renderHeader(
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create workspace item"
            disabled={actionLoading}
            hitSlop={8}
            onPress={() => beginAction('create', null)}
            style={({ pressed }) => [
              styles.headerAction,
              actionLoading && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Plus color={colors.muted} size={16} strokeWidth={2} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh files"
            disabled={root?.loading || refreshing.has(rootPath)}
            hitSlop={8}
            onPress={refreshExplorer}
            style={({ pressed }) => [
              styles.headerAction,
              (root?.loading || refreshing.has(rootPath)) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <RefreshCw color={colors.muted} size={15} strokeWidth={2} />
          </Pressable>
        </View>,
      )}
      {mobileDirectoryErrorMode(root) === 'stale' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry workspace refresh"
          onPress={() => void loadDirectory(rootPath, true)}
          style={styles.staleErrorBanner}
        >
          <Text numberOfLines={2} style={styles.staleErrorText}>
            Refresh failed: {root?.error}
          </Text>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
      {editor?.mode === 'create' ? (
        <Text style={styles.creationHint}>
          Add an extension for a file; no extension creates a folder.
        </Text>
      ) : null}
      <FlatList
        ref={listRef}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          scrolledRevealRef.current = null;
          if (revealScrollAttempt < 3) {
            if (revealScrollTimer.current) clearTimeout(revealScrollTimer.current);
            revealScrollTimer.current = setTimeout(
              () => setRevealScrollAttempt((attempt) => attempt + 1),
              100,
            );
          }
        }}
        keyboardShouldPersistTaps="handled"
        data={rows}
        keyExtractor={(row) => row.key}
        initialNumToRender={24}
        maxToRenderPerBatch={32}
        windowSize={9}
        contentContainerStyle={[styles.content, rows.length === 0 && styles.emptyContent]}
        renderItem={({ item }) => {
          const guideLines = Array.from({ length: item.depth }, (_, guideDepth) => (
            <View
              key={guideDepth}
              pointerEvents="none"
              style={[styles.guide, { left: 21 + guideDepth * 8 }]}
            />
          ));
          if (item.kind === 'state') {
            return item.loading ? (
              <View style={[styles.inlineState, { paddingLeft: 12 + item.depth * 8 }]}>
                {guideLines}
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={styles.inlineText}>Loading…</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => void loadDirectory(item.path, true)}
                style={[styles.inlineState, { paddingLeft: 12 + item.depth * 8 }]}
              >
                {guideLines}
                <Text numberOfLines={1} style={styles.errorText}>
                  {item.error}
                </Text>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            );
          }
          if (item.kind === 'editor') {
            const directoryEditor =
              item.mode === 'create'
                ? mobileExplorerCreationAction(actionInput) === 'create-directory'
                : item.entry?.kind === 'directory';
            return (
              <View
                accessibilityLabel={
                  item.mode === 'rename' ? 'Rename item' : 'New file or folder name'
                }
                style={[styles.row, styles.editorRow, { paddingLeft: 12 + item.depth * 8 }]}
              >
                {guideLines}
                {directoryEditor ? (
                  <View style={styles.chevronSlot}>
                    <ChevronRight color={colors.mutedDim} size={14} strokeWidth={2} />
                  </View>
                ) : (
                  <View style={styles.fileInset} />
                )}
                {directoryEditor ? (
                  folderIcons ? (
                    <NativeFolderTypeIcon path={actionInput || 'folder'} size={18} opacity={0.9} />
                  ) : null
                ) : (
                  <NativeFileTypeIcon path={actionInput || 'untitled'} size={18} opacity={0.9} />
                )}
                <ThemedTextInput
                  ref={actionInputRef}
                  accessibilityLabel={
                    item.mode === 'rename' ? 'Rename item' : 'New file or folder name'
                  }
                  autoFocus
                  placeholder="file.ext or folder"
                  autoCapitalize="none"
                  autoCorrect={false}
                  blurOnSubmit={false}
                  editable={!actionLoading}
                  returnKeyType="done"
                  value={actionInput}
                  onChangeText={(value) => {
                    setActionInput(value);
                    setActionError(null);
                  }}
                  onSubmitEditing={() => void submitAction()}
                  style={styles.inlineNameInput}
                />
                {actionLoading ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Create or rename item"
                      onPress={() => void submitAction()}
                      style={styles.headerAction}
                    >
                      <Check color={colors.accent} size={18} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cancel naming item"
                      onPress={cancelAction}
                      style={styles.headerAction}
                    >
                      <X color={colors.muted} size={18} />
                    </Pressable>
                  </>
                )}
              </View>
            );
          }
          const isDirectory = item.entry.kind === 'directory';
          const ignored = item.entry.isGitIgnored;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${isDirectory ? (item.open ? 'Collapse folder' : 'Expand folder') : 'Open file'} ${item.entry.name}`}
              accessibilityState={
                isDirectory
                  ? { expanded: item.open, selected: item.selected }
                  : { selected: item.selected }
              }
              onPress={() => {
                if (suppressPressUntilRef.current > Date.now()) return;
                isDirectory ? toggleDirectory(item.entry.path) : onOpenFile(item.entry.path);
              }}
              onLongPress={() => {
                suppressPressUntilRef.current = Date.now() + 800;
                setActionMenuEntry(item.entry);
              }}
              delayLongPress={420}
              style={({ pressed }) => [
                styles.row,
                { paddingLeft: 12 + item.depth * 8 },
                item.selected && styles.rowSelected,
                ignored && styles.rowIgnored,
                pressed && styles.pressed,
              ]}
            >
              {guideLines}
              {isDirectory ? (
                <View style={styles.chevronSlot}>
                  {item.open ? (
                    <ChevronDown color={colors.mutedDim} size={14} strokeWidth={2} />
                  ) : (
                    <ChevronRight color={colors.mutedDim} size={14} strokeWidth={2} />
                  )}
                </View>
              ) : (
                <View style={styles.fileInset} />
              )}
              {isDirectory ? (
                folderIcons ? (
                  <NativeFolderTypeIcon
                    path={item.entry.path}
                    open={item.open}
                    size={18}
                    opacity={ignored ? 0.45 : 0.95}
                  />
                ) : null
              ) : (
                <NativeFileTypeIcon
                  path={item.entry.path}
                  size={18}
                  opacity={ignored ? 0.45 : item.selected ? 1 : 0.85}
                />
              )}
              <Text
                numberOfLines={1}
                style={[
                  styles.name,
                  item.selected && styles.nameSelected,
                  ignored && styles.nameIgnored,
                ]}
              >
                {item.entry.name}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          root?.loading && !root.loaded ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.inlineText}>Loading workspace…</Text>
            </View>
          ) : root?.error && !root.loaded ? (
            <Pressable
              onPress={() => void loadDirectory(rootPath, true)}
              style={styles.centerState}
            >
              <FileQuestion color={colors.danger} size={24} strokeWidth={1.7} />
              <Text style={styles.errorText}>{root.error}</Text>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          ) : root?.loaded ? (
            <View style={styles.centerState}>
              <Text style={styles.inlineText}>This workspace is empty.</Text>
            </View>
          ) : null
        }
      />
      <Modal
        transparent
        visible={actionMenuEntry !== undefined}
        animationType="fade"
        onRequestClose={() => setActionMenuEntry(undefined)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close file actions"
          style={styles.menuBackdrop}
          onPress={() => setActionMenuEntry(undefined)}
        >
          <View
            accessibilityRole="menu"
            accessibilityLabel="File explorer actions"
            style={styles.actionMenu}
            onStartShouldSetResponder={() => true}
          >
            <Text numberOfLines={1} style={styles.actionMenuTitle}>
              {actionMenuEntry?.name ?? 'Workspace'}
            </Text>
            {actionMenuEntry ? (
              <Pressable
                accessibilityRole="menuitem"
                onPress={() => beginAction('rename', actionMenuEntry)}
                style={({ pressed }) => [
                  styles.actionMenuItem,
                  pressed && styles.actionMenuPressed,
                ]}
              >
                <Pencil color={colors.muted} size={18} />
                <Text style={styles.actionMenuText}>Rename</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="menuitem"
              onPress={() => beginAction('create', actionMenuEntry ?? null)}
              style={({ pressed }) => [styles.actionMenuItem, pressed && styles.actionMenuPressed]}
            >
              <Plus color={colors.accent} size={18} />
              <Text style={styles.actionMenuText}>
                {actionMenuEntry?.kind === 'directory' ? 'New item inside folder' : 'New item here'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setActionMenuEntry(undefined)}
              style={styles.actionMenuItem}
            >
              <X color={colors.muted} size={18} />
              <Text style={styles.actionMenuText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      {actionError ? (
        <View style={styles.actionErrorBanner}>
          <Text numberOfLines={2} style={styles.actionErrorText}>
            {actionError}
          </Text>
          <Pressable accessibilityRole="button" onPress={cancelAction} hitSlop={8}>
            <Text style={styles.cancelActionText}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  explorer: { flex: 1, minHeight: 0, backgroundColor: colors.mantle },
  headerAction: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  creationHint: { color: colors.muted, fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 },
  content: { paddingVertical: 4, paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
  row: {
    minHeight: 42,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 12,
  },
  rowSelected: {
    backgroundColor: colors.sidebarSelectionWash,
    borderLeftWidth: 2,
    borderLeftColor: colors.sidebarSelectionEdge,
  },
  rowIgnored: { opacity: 0.58 },
  guide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(127, 132, 156, 0.28)',
  },
  chevronSlot: {
    width: 14,
    height: 14,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInset: { width: 4 },
  name: { minWidth: 0, flex: 1, color: colors.text, fontSize: 13.5, lineHeight: 18 },
  nameSelected: { color: colors.textStrong, fontWeight: '700' },
  nameIgnored: { color: colors.mutedDim },
  editorRow: {
    backgroundColor: colors.sidebarSelectionWash,
    borderLeftWidth: 2,
    borderLeftColor: colors.sidebarSelectionEdge,
  },
  inlineNameInput: {
    minWidth: 0,
    flex: 1,
    height: 30,
    paddingHorizontal: 0,
    paddingVertical: 0,
    color: colors.textStrong,
    backgroundColor: 'transparent',
    fontSize: 13.5,
    fontWeight: '700',
  },
  inlineState: {
    minHeight: 38,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 12,
  },
  centerState: {
    flex: 1,
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    padding: 16,
  },
  inlineText: { color: colors.muted, fontSize: 12 },
  errorText: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.danger,
    fontSize: 11,
    textAlign: 'center',
  },
  retryText: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  menuBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.overlaySoft,
  },
  actionMenu: {
    width: '100%',
    maxWidth: 360,
    padding: 8,
    elevation: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 20,
    backgroundColor: colors.panelRaised,
  },
  actionMenuTitle: {
    color: colors.muted,
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionMenuItem: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actionMenuPressed: { backgroundColor: colors.accentWash },
  actionMenuText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  actionErrorBanner: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.dangerBorder,
    backgroundColor: colors.dangerDark,
  },
  actionErrorText: { minWidth: 0, flex: 1, color: colors.danger, fontSize: 9, lineHeight: 13 },
  staleErrorBanner: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.warningBorder,
    backgroundColor: colors.warningDark,
  },
  staleErrorText: { minWidth: 0, flex: 1, color: colors.warning, fontSize: 9 },
  cancelActionText: { color: colors.accent, fontSize: 10, fontWeight: '800' },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.35 },
});
