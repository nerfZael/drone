import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import FileQuestion from 'lucide-react-native/icons/file-question-mark';
import Folder from 'lucide-react-native/icons/folder';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import type { DroneControlOperation } from '@drone/device-protocol';
import { NativeFileTypeIcon } from '../components/FileTypeIcon';
import { readMeshJsonContent } from '../mesh/read-mesh-json-content';
import { colors } from '../theme';

type FileExplorerEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'other';
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
      return [{ name, path, kind }];
    })
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        : left.kind === 'directory'
          ? -1
          : 1,
    );
}

export function MobileFileExplorer({
  targetId,
  droneId,
  chatName,
  rootPath,
  selectedPath,
  requestDroneControl,
  onOpenFile,
}: {
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
  directoriesRef.current = directories;
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const contextKey = `${targetId}\0${droneId}\0${chatName}\0${rootPath}`;

  const loadDirectory = React.useCallback(
    async (path: string, force = false) => {
      const requestContextVersion = contextVersionRef.current;
      const existing = directoriesRef.current[path];
      if (!force && (existing?.loading || existing?.loaded)) return;
      const requestSeq = (directoryRequestSeqRef.current[path] ?? 0) + 1;
      directoryRequestSeqRef.current[path] = requestSeq;
      setDirectories((current) => ({
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
        const nextState: DirectoryState = {
          entries: normalizeEntries(result?.entries),
          loading: false,
          error: null,
          loaded: true,
        };
        setDirectories((current) => ({
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
        setDirectories((current) => ({
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
    [chatName, droneId, requestDroneControl, targetId],
  );

  React.useEffect(() => {
    contextVersionRef.current += 1;
    directoryRequestSeqRef.current = {};
    setDirectories({});
    setExpanded(new Set());
    void loadDirectory(rootPath, true);
    return () => {
      contextVersionRef.current += 1;
    };
  }, [contextKey, loadDirectory, rootPath]);

  const toggleDirectory = (path: string) => {
    const willExpand = !expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (willExpand) next.add(path);
      else next.delete(path);
      return next;
    });
    if (willExpand) void loadDirectory(path);
  };

  const refreshExplorer = React.useCallback(() => {
    const paths = [rootPath, ...expanded].filter(
      (path, index, allPaths) => allPaths.indexOf(path) === index,
    );
    for (const path of paths) void loadDirectory(path, true);
  }, [expanded, loadDirectory, rootPath]);

  const root = directories[rootPath];
  const rows = React.useMemo(() => {
    const visible: VisibleExplorerRow[] = [];
    const visit = (path: string, depth: number) => {
      for (const entry of directories[path]?.entries ?? []) {
        const isDirectory = entry.kind === 'directory';
        const open = isDirectory && expanded.has(entry.path);
        visible.push({
          kind: 'entry',
          key: `${entry.kind}:${entry.path}`,
          entry,
          depth,
          open,
          selected: !isDirectory && entry.path === selectedPath,
        });
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
  }, [directories, expanded, rootPath, selectedPath]);
  return (
    <View style={styles.explorer}>
      <View style={styles.toolbar}>
        <Folder color={colors.accentAlt} size={15} strokeWidth={1.9} />
        <Text numberOfLines={1} style={styles.rootLabel}>
          Workspace
        </Text>
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
          if (item.kind === 'state') {
            return item.loading ? (
              <View style={[styles.inlineState, { paddingLeft: 26 + item.depth * 16 }]}>
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={styles.inlineText}>Loading…</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => void loadDirectory(item.path, true)}
                style={[styles.inlineState, { paddingLeft: 26 + item.depth * 16 }]}
              >
                <Text numberOfLines={1} style={styles.errorText}>
                  {item.error}
                </Text>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            );
          }
          const isDirectory = item.entry.kind === 'directory';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${isDirectory ? (item.open ? 'Collapse folder' : 'Expand folder') : 'Open file'} ${item.entry.name}`}
              accessibilityState={
                isDirectory ? { expanded: item.open } : { selected: item.selected }
              }
              onPress={() =>
                isDirectory ? toggleDirectory(item.entry.path) : onOpenFile(item.entry.path)
              }
              style={({ pressed }) => [
                styles.row,
                { paddingLeft: 12 + item.depth * 16 },
                item.selected && styles.rowSelected,
                pressed && styles.pressed,
              ]}
            >
              {isDirectory ? (
                item.open ? (
                  <ChevronDown color={colors.muted} size={14} strokeWidth={2} />
                ) : (
                  <ChevronRight color={colors.muted} size={14} strokeWidth={2} />
                )
              ) : (
                <View style={styles.chevronSpacer} />
              )}
              {isDirectory ? (
                <Folder color={colors.accentAlt} size={16} strokeWidth={1.8} />
              ) : (
                <NativeFileTypeIcon
                  path={item.entry.path}
                  size={16}
                  opacity={item.selected ? 1 : 0.86}
                />
              )}
              <Text numberOfLines={1} style={[styles.name, item.selected && styles.nameSelected]}>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingRight: 12,
  },
  rowSelected: { backgroundColor: colors.sidebarSelectionWash },
  chevronSpacer: { width: 14 },
  name: { minWidth: 0, flex: 1, color: colors.text, fontSize: 11, fontFamily: 'monospace' },
  nameSelected: { color: colors.accent, fontWeight: '700' },
  inlineState: {
    minHeight: 34,
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
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.35 },
});
