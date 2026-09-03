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
} from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import FileQuestion from 'lucide-react-native/icons/file-question-mark';
import Folder from 'lucide-react-native/icons/folder';
import Plus from 'lucide-react-native/icons/plus';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import type { DroneControlOperation } from '@drone/device-protocol';
import { NativeFileTypeIcon } from '../components/FileTypeIcon';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { readMeshJsonContent } from '../mesh/read-mesh-json-content';
import { colors } from '../theme';
import { BoundedSwrCache } from './bounded-swr-cache';
import { mobileDirectoryCacheKey } from './mobile-file-cache-key';

type FileExplorerEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'other';
  isGitIgnored: boolean;
};

type DirectoryState = {
  entries: FileExplorerEntry[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
};

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

type ExplorerActionMode = 'rename' | 'create-file' | 'create-directory';

type ExplorerEditorState = {
  mode: ExplorerActionMode;
  entry: FileExplorerEntry | null;
  targetDirectory: string;
  anchorPath: string | null;
};

type RequestDroneControl = (
  destinationId: string,
  operation: DroneControlOperation,
  payload?: any,
) => Promise<any>;

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
        ? left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        : left.kind === 'directory'
          ? -1
          : 1,
    );
}

function sameExplorerEntries(
  left: readonly FileExplorerEntry[],
  right: readonly FileExplorerEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.name === right[index]?.name &&
        entry.path === right[index]?.path &&
        entry.kind === right[index]?.kind &&
        entry.isGitIgnored === right[index]?.isGitIgnored,
    )
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
  requestDroneControl,
  onOpenFile,
}: {
  active: boolean;
  targetId: string;
  droneId: string;
  chatName: string;
  rootPath: string;
  selectedPath: string;
  requestDroneControl: RequestDroneControl;
  onOpenFile(path: string): void;
}) {
  const [directories, setDirectories] = React.useState<Record<string, DirectoryState>>({});
  const directoriesRef = React.useRef(directories);
  const contextVersionRef = React.useRef(0);
  const directoryRequestSeqRef = React.useRef<Record<string, number>>({});
  const directoryCacheRef = React.useRef<BoundedSwrCache<Record<string, DirectoryState>> | null>(
    null,
  );
  if (!directoryCacheRef.current) {
    directoryCacheRef.current = new BoundedSwrCache({
      maxEntries: 4,
      maxAgeMs: 2 * 60_000,
    });
  }
  directoriesRef.current = directories;
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const [actionMenuEntry, setActionMenuEntry] = React.useState<
    FileExplorerEntry | null | undefined
  >(undefined);
  const [editor, setEditor] = React.useState<ExplorerEditorState | null>(null);
  const [actionInput, setActionInput] = React.useState('');
  const [actionLoading, setActionLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const actionInputRef = React.useRef<NativeTextInput | null>(null);
  const suppressPressUntilRef = React.useRef(0);
  const contextKey = mobileDirectoryCacheKey({ targetId, droneId, chatName, rootPath });

  const commitDirectories = React.useCallback(
    (update: (current: Record<string, DirectoryState>) => Record<string, DirectoryState>) => {
      setDirectories((current) => {
        const next = update(current);
        directoriesRef.current = next;
        directoryCacheRef.current!.set(contextKey, next);
        return next;
      });
    },
    [contextKey],
  );

  const loadDirectory = React.useCallback(
    async (path: string, force = false) => {
      const requestContextVersion = contextVersionRef.current;
      const existing = directoriesRef.current[path];
      if (!force && (existing?.loading || existing?.loaded)) return;
      const requestSeq = (directoryRequestSeqRef.current[path] ?? 0) + 1;
      directoryRequestSeqRef.current[path] = requestSeq;
      commitDirectories((current) => ({
        ...current,
        [path]: {
          entries: current[path]?.entries ?? [],
          loading: true,
          error: null,
          loaded: current[path]?.loaded ?? false,
        },
      }));
      try {
        let result = await requestDroneControl(targetId, 'files.list', {
          droneId,
          chatName,
          path,
          contentOffset: 0,
        });
        if (result?.contentChunk) {
          let firstChunkAvailable = true;
          const firstChunk = result.contentChunk;
          result = await readMeshJsonContent(async (contentOffset) => {
            if (
              contextVersionRef.current !== requestContextVersion ||
              directoryRequestSeqRef.current[path] !== requestSeq
            ) {
              throw new Error('The selected workspace changed while files were loading');
            }
            if (contentOffset === 0 && firstChunkAvailable) {
              firstChunkAvailable = false;
              return firstChunk;
            }
            const next = await requestDroneControl(targetId, 'files.list', {
              droneId,
              chatName,
              path,
              contentOffset,
            });
            return next?.contentChunk ?? {};
          });
        }
        if (
          contextVersionRef.current !== requestContextVersion ||
          directoryRequestSeqRef.current[path] !== requestSeq
        )
          return;
        const resolvedPath = String(result?.path ?? path);
        const normalizedEntries = normalizeEntries(result?.entries);
        const previousEntries = directoriesRef.current[path]?.entries ?? [];
        const nextState: DirectoryState = {
          entries: sameExplorerEntries(previousEntries, normalizedEntries)
            ? previousEntries
            : normalizedEntries,
          loading: false,
          error: null,
          loaded: true,
        };
        commitDirectories((current) => ({
          ...current,
          [path]: nextState,
          ...(resolvedPath !== path ? { [resolvedPath]: nextState } : {}),
        }));
      } catch (nextError: any) {
        if (
          contextVersionRef.current !== requestContextVersion ||
          directoryRequestSeqRef.current[path] !== requestSeq
        )
          return;
        const message = String(nextError?.message ?? nextError ?? 'Unable to list files.');
        commitDirectories((current) => ({
          ...current,
          [path]: {
            entries: current[path]?.entries ?? [],
            loading: false,
            error: /not granted|not permitted|access|denied/i.test(message)
              ? `${message}. Enable “drone-control: files.list” for this phone in Devices.`
              : message,
            loaded: false,
          },
        }));
      }
    },
    [chatName, commitDirectories, droneId, requestDroneControl, targetId],
  );

  React.useEffect(() => {
    contextVersionRef.current += 1;
    directoryRequestSeqRef.current = {};
    const cached = directoryCacheRef.current!.get(contextKey) ?? {};
    directoriesRef.current = cached;
    setDirectories(cached);
    setExpanded(new Set());
    setActionMenuEntry(undefined);
    setEditor(null);
    setActionInput('');
    setActionError(null);
    return () => {
      contextVersionRef.current += 1;
    };
  }, [contextKey]);

  React.useEffect(() => {
    if (!active) return;
    const cachedRoot = directoriesRef.current[rootPath];
    void loadDirectory(rootPath, Boolean(cachedRoot?.loaded || cachedRoot?.loading));
  }, [active, loadDirectory, rootPath]);

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
      const targetDirectory = entry ? mobileExplorerParentPath(entry.path, rootPath) : rootPath;
      setActionMenuEntry(undefined);
      setActionError(null);
      setActionInput(mode === 'rename' ? (entry?.name ?? '') : '');
      setEditor({
        mode,
        entry,
        targetDirectory,
        anchorPath: entry?.path ?? null,
      });
    },
    [rootPath],
  );

  const cancelAction = React.useCallback(() => {
    if (actionLoading) return;
    setEditor(null);
    setActionInput('');
    setActionError(null);
  }, [actionLoading]);

  const submitAction = React.useCallback(async () => {
    if (!editor || actionLoading) return;
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
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await requestDroneControl(targetId, 'file.action', {
        droneId,
        chatName,
        action: editor.mode,
        name,
        ...(editor.mode === 'rename'
          ? { path: editor.entry?.path }
          : { targetDir: editor.targetDirectory }),
      });
      const createdPath = String(
        result?.path ?? mobileExplorerJoinPath(editor.targetDirectory, name),
      );
      const targetPath = String(
        result?.targetPath ?? mobileExplorerJoinPath(editor.targetDirectory, name),
      );
      setEditor(null);
      setActionInput('');
      await loadDirectory(editor.targetDirectory, true);
      if (
        editor.mode === 'create-file' ||
        (editor.mode === 'rename' && editor.entry?.path === selectedPath)
      ) {
        onOpenFile(editor.mode === 'rename' ? targetPath : createdPath);
      }
    } catch (nextError: any) {
      const message = String(nextError?.message ?? nextError ?? 'Unable to update this item.');
      setActionError(
        /not granted|not permitted|access|denied/i.test(message)
          ? `${message}. Enable “drone-control: file.action” for this phone in Devices.`
          : message,
      );
    } finally {
      setActionLoading(false);
    }
  }, [
    actionInput,
    actionLoading,
    cancelAction,
    chatName,
    droneId,
    editor,
    loadDirectory,
    onOpenFile,
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
    if (editor && editor.mode !== 'rename' && editor.anchorPath === null) {
      visible.push({
        kind: 'editor',
        key: `editor:${editor.mode}:root`,
        depth: 0,
        mode: editor.mode,
        entry: null,
      });
    }
    const visit = (path: string, depth: number) => {
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
            selected: !isDirectory && entry.path === selectedPath,
          });
        }
        if (editor && editor.mode !== 'rename' && editor.anchorPath === entry.path) {
          visible.push({
            kind: 'editor',
            key: `editor:${editor.mode}:${entry.path}`,
            depth,
            mode: editor.mode,
            entry,
          });
        }
        if (!open) continue;
        const child = directories[entry.path];
        if (child?.loading || child?.error) {
          visible.push({
            kind: 'state',
            key: `state:${entry.path}`,
            path: entry.path,
            depth: depth + 1,
            loading: child.loading,
            error: child.error,
          });
        } else {
          visit(entry.path, depth + 1);
        }
      }
    };
    visit(rootPath, 0);
    return visible;
  }, [directories, editor, expanded, rootPath, selectedPath]);
  return (
    <View style={styles.explorer}>
      <View style={styles.toolbar}>
        <Folder color={colors.accentAlt} size={15} strokeWidth={1.9} />
        <Text numberOfLines={1} style={styles.rootLabel}>
          Workspace
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create workspace item"
          disabled={actionLoading}
          hitSlop={8}
          onPress={() => setActionMenuEntry(null)}
          style={({ pressed }) => [actionLoading && styles.disabled, pressed && styles.pressed]}
        >
          <Plus color={colors.muted} size={16} strokeWidth={2} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh files"
          disabled={root?.loading}
          hitSlop={8}
          onPress={refreshExplorer}
          style={({ pressed }) => [root?.loading && styles.disabled, pressed && styles.pressed]}
        >
          <RefreshCw color={colors.muted} size={15} strokeWidth={2} />
        </Pressable>
      </View>
      <FlatList
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
              style={[styles.guide, { left: 18 + guideDepth * 16 }]}
            />
          ));
          if (item.kind === 'state') {
            return item.loading ? (
              <View style={[styles.inlineState, { paddingLeft: 12 + item.depth * 16 }]}>
                {guideLines}
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={styles.inlineText}>Loading…</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => void loadDirectory(item.path, true)}
                style={[styles.inlineState, { paddingLeft: 12 + item.depth * 16 }]}
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
              item.mode === 'create-directory' || item.entry?.kind === 'directory';
            return (
              <View
                accessibilityLabel={
                  item.mode === 'rename'
                    ? 'Rename item'
                    : item.mode === 'create-file'
                      ? 'New file name'
                      : 'New folder name'
                }
                style={[styles.row, styles.editorRow, { paddingLeft: 12 + item.depth * 16 }]}
              >
                {guideLines}
                <View style={styles.leadingSlot}>
                  {directoryEditor ? (
                    <ChevronRight color={colors.mutedDim} size={14} strokeWidth={2} />
                  ) : (
                    <NativeFileTypeIcon path={actionInput || 'untitled'} size={16} opacity={0.9} />
                  )}
                </View>
                <ThemedTextInput
                  ref={actionInputRef}
                  accessibilityLabel={
                    item.mode === 'rename'
                      ? 'Rename item'
                      : item.mode === 'create-file'
                        ? 'New file name'
                        : 'New folder name'
                  }
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
                {actionLoading ? <ActivityIndicator color={colors.accent} size="small" /> : null}
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
                isDirectory ? { expanded: item.open } : { selected: item.selected }
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
                { paddingLeft: 12 + item.depth * 16 },
                item.selected && styles.rowSelected,
                ignored && styles.rowIgnored,
                pressed && styles.pressed,
              ]}
            >
              {guideLines}
              {isDirectory ? (
                item.open ? (
                  <ChevronDown color={colors.mutedDim} size={14} strokeWidth={2} />
                ) : (
                  <ChevronRight color={colors.mutedDim} size={14} strokeWidth={2} />
                )
              ) : (
                <NativeFileTypeIcon
                  path={item.entry.path}
                  size={16}
                  opacity={ignored ? 0.45 : item.selected ? 1 : 0.8}
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
                <Text style={styles.actionMenuText}>Rename</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="menuitem"
              onPress={() => beginAction('create-file', actionMenuEntry ?? null)}
              style={({ pressed }) => [styles.actionMenuItem, pressed && styles.actionMenuPressed]}
            >
              <Text style={styles.actionMenuText}>New file here</Text>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              onPress={() => beginAction('create-directory', actionMenuEntry ?? null)}
              style={({ pressed }) => [styles.actionMenuItem, pressed && styles.actionMenuPressed]}
            >
              <Text style={styles.actionMenuText}>New folder here</Text>
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
  toolbar: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  rootLabel: {
    minWidth: 0,
    flex: 1,
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  content: { paddingVertical: 5, paddingBottom: 18 },
  emptyContent: { flexGrow: 1 },
  row: {
    minHeight: 36,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
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
  leadingSlot: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  name: { minWidth: 0, flex: 1, color: colors.text, fontSize: 11, fontFamily: 'monospace' },
  nameSelected: { color: colors.accent, fontWeight: '700' },
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
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
  },
  inlineState: {
    minHeight: 34,
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
  inlineText: { color: colors.muted, fontSize: 10 },
  errorText: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.danger,
    fontSize: 10,
    textAlign: 'center',
  },
  retryText: { color: colors.accent, fontSize: 10, fontWeight: '800' },
  menuBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 14,
    backgroundColor: colors.overlaySoft,
  },
  actionMenu: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    backgroundColor: colors.panelRaised,
  },
  actionMenuTitle: {
    color: colors.muted,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionMenuItem: {
    minHeight: 48,
    justifyContent: 'center',
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
  cancelActionText: { color: colors.accent, fontSize: 10, fontWeight: '800' },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.35 },
});
