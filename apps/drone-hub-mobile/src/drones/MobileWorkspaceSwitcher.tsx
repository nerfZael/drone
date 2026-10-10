import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import Folder from 'lucide-react-native/icons/folder';
import FolderPlus from 'lucide-react-native/icons/folder-plus';
import House from 'lucide-react-native/icons/house';
import Search from 'lucide-react-native/icons/search';
import Settings2 from 'lucide-react-native/icons/settings-2';
import X from 'lucide-react-native/icons/x';
import type { DroneControlOperation } from '@drone/device-protocol';
import { ConfirmDialog, ContextMenu, ErrorBanner, TextInputDialog } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import type { MobileDroneSummary } from './drone-sidebar-model';
import {
  browseWorkspaces,
  choiceFromWorkspace,
  createUserWorkspace,
  linkUserWorkspace,
  listUserWorkspaces,
  removeUserWorkspace,
  renameUserWorkspace,
  workspaceSections,
  type BrowsableWorkspace,
  type ExplorerWorkspaceChoice,
  type MobileUserWorkspace,
} from './mobile-workspaces';

type RequestDroneControl = (
  destinationId: string,
  operation: DroneControlOperation,
  payload?: any,
  signal?: AbortSignal,
) => Promise<any>;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The last list each Hub returned, so reopening the sheet shows it at once while a fresh one loads. */
const lastLists = new Map<string, BrowsableWorkspace[]>();

/**
 * The Files page's workspace control: a chip naming what the explorer shows, which opens a sheet to switch to any
 * workspace on the Hub's device (what the chat can use first, drones five at a time) or manage the workspaces the
 * user added. While switched, a house button returns to the drone's own files.
 */
export function MobileWorkspaceSwitcher({
  targetId,
  drone,
  current,
  requestDroneControl,
  loadChatWorkspaceIds,
  onChoose,
}: {
  targetId: string;
  drone: MobileDroneSummary;
  current: ExplorerWorkspaceChoice | null;
  requestDroneControl: RequestDroneControl;
  /** The ids of the workspaces the open chat can use, when the Hub can tell. */
  loadChatWorkspaceIds?: (signal: AbortSignal) => Promise<string[]>;
  onChoose(choice: ExplorerWorkspaceChoice | null): void;
}) {
  const [open, setOpen] = React.useState(false);
  const label = current?.name ?? drone.name;
  return (
    <View style={styles.control}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Workspace: ${label}. Switch workspace`}
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={({ pressed }) => [styles.chip, current && styles.chipSwitched, pressed && styles.pressed]}
      >
        <Folder color={current ? colors.accent : colors.muted} size={13} strokeWidth={2} />
        <Text numberOfLines={1} style={[styles.chipText, current && styles.chipTextSwitched]}>{label}</Text>
        <ChevronDown color={current ? colors.accent : colors.mutedDim} size={13} strokeWidth={2} />
      </Pressable>
      {current ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Back to ${drone.name}`}
          onPress={() => onChoose(null)}
          hitSlop={8}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <House color={colors.muted} size={15} strokeWidth={2} />
        </Pressable>
      ) : null}
      {open ? (
        <WorkspaceSheet
          targetId={targetId}
          drone={drone}
          current={current}
          requestDroneControl={requestDroneControl}
          loadChatWorkspaceIds={loadChatWorkspaceIds}
          onChoose={(choice) => {
            setOpen(false);
            onChoose(choice);
          }}
          onClose={() => setOpen(false)}
          onCurrentRefreshed={onChoose}
          onCurrentGone={() => onChoose(null)}
        />
      ) : null}
    </View>
  );
}

function WorkspaceSheet({
  targetId,
  drone,
  current,
  requestDroneControl,
  loadChatWorkspaceIds,
  onChoose,
  onClose,
  onCurrentRefreshed,
  onCurrentGone,
}: {
  targetId: string;
  drone: MobileDroneSummary;
  current: ExplorerWorkspaceChoice | null;
  requestDroneControl: RequestDroneControl;
  loadChatWorkspaceIds?: (signal: AbortSignal) => Promise<string[]>;
  onChoose(choice: ExplorerWorkspaceChoice | null): void;
  onClose(): void;
  /** The workspace shown now has a new path or name, or no longer exists; the sheet stays open. */
  onCurrentRefreshed(choice: ExplorerWorkspaceChoice): void;
  onCurrentGone(): void;
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = React.useState<'switch' | 'manage'>('switch');
  const [workspaces, setWorkspaces] = React.useState<BrowsableWorkspace[] | null>(lastLists.get(targetId) ?? null);
  const [chatIds, setChatIds] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [list, ids] = await Promise.all([
        browseWorkspaces(requestDroneControl, targetId, signal),
        loadChatWorkspaceIds ? loadChatWorkspaceIds(signal ?? new AbortController().signal).catch(() => null) : Promise.resolve(null),
      ]);
      if (signal?.aborted) return;
      lastLists.set(targetId, list);
      setWorkspaces(list);
      if (ids) setChatIds(ids);
      setError(null);
      // The workspace shown now may have moved, been renamed or been removed since it was chosen.
      if (current?.kind === 'folder') {
        const fresh = list.find((item) => item.id === current.id);
        if (!fresh) onCurrentGone();
        else if (fresh.path !== current.path || fresh.name !== current.name) onCurrentRefreshed(choiceFromWorkspace(fresh));
      }
    } catch (cause) {
      if (!signal?.aborted) setError(errorText(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [loadChatWorkspaceIds, requestDroneControl, targetId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const sections = workspaceSections(workspaces ?? [], { drone, chatIds, query, expanded, currentId: current?.id ?? null });
  const row = (key: string, workspace: BrowsableWorkspace | null, title: string, detail?: string) => {
    const selected = workspace ? current?.id === workspace.id : !current;
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={title}
        onPress={() => onChoose(workspace ? choiceFromWorkspace(workspace) : null)}
        style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
      >
        {workspace ? <Folder color={selected ? colors.accent : colors.muted} size={17} strokeWidth={1.9} /> : <House color={selected ? colors.accent : colors.muted} size={17} strokeWidth={1.9} />}
        <View style={styles.rowBody}>
          <Text numberOfLines={1} style={[styles.rowTitle, selected && styles.rowTitleSelected]}>{title}</Text>
          {detail ? <Text numberOfLines={1} style={styles.rowDetail}>{detail}</Text> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={mode === 'manage' ? () => setMode('switch') : onClose}>
      <View style={styles.layer}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close workspaces" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.grabber} />
          {mode === 'manage' ? (
            <ManageWorkspaces
              targetId={targetId}
              requestDroneControl={requestDroneControl}
              onBack={() => {
                setMode('switch');
                void reload();
              }}
            />
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Workspaces</Text>
                {loading ? <ActivityIndicator color={colors.accent} size="small" /> : null}
                <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={styles.iconButton}>
                  <X color={colors.muted} size={18} strokeWidth={2} />
                </Pressable>
              </View>
              <View style={styles.search}>
                <Search color={colors.mutedDim} size={15} strokeWidth={2} />
                <ThemedTextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search workspaces"
                  placeholderTextColor={colors.mutedDim}
                  accessibilityLabel="Search workspaces"
                  autoCorrect={false}
                  autoCapitalize="none"
                  style={styles.searchInput}
                />
              </View>
              <ErrorBanner message={error} />
              <ScrollView keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.listContent}>
                <Text style={styles.heading}>This drone</Text>
                {row('own', null, drone.name)}
                {sections.chat.length ? (
                  <>
                    <Text style={styles.heading}>This chat can use</Text>
                    {sections.chat.map((workspace) => row(`chat:${workspace.id}`, workspace, workspace.name, workspace.path))}
                  </>
                ) : null}
                {sections.groups.map((group) => (
                  <React.Fragment key={group.category}>
                    <Text style={styles.heading}>{group.category}</Text>
                    {group.items.map((workspace) => row(workspace.id, workspace, workspace.name, workspace.path ?? workspace.status))}
                    {group.hidden > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setExpanded((previous) => new Set(previous).add(group.category))}
                        style={({ pressed }) => [styles.more, pressed && styles.pressed]}
                      >
                        <Text style={styles.moreText}>+ {group.hidden} more</Text>
                      </Pressable>
                    ) : null}
                  </React.Fragment>
                ))}
                {workspaces && query.trim() && !sections.chat.length && !sections.groups.length ? (
                  <Text style={styles.empty}>No workspace matches “{query.trim()}”.</Text>
                ) : null}
                {!workspaces && !error ? <Text style={styles.empty}>Loading workspaces…</Text> : null}
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMode('manage')}
                style={({ pressed }) => [styles.footerButton, pressed && styles.rowPressed]}
              >
                <Settings2 color={colors.muted} size={16} strokeWidth={2} />
                <Text style={styles.footerText}>Manage workspaces</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** The workspaces the user added on the Hub's device: add one, add a folder by path, rename, remove. */
function ManageWorkspaces({
  targetId,
  requestDroneControl,
  onBack,
}: {
  targetId: string;
  requestDroneControl: RequestDroneControl;
  onBack(): void;
}) {
  const [workspaces, setWorkspaces] = React.useState<MobileUserWorkspace[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<MobileUserWorkspace | null>(null);
  const [dialog, setDialog] = React.useState<
    { kind: 'create' | 'link' | 'rename'; value: string; workspace?: MobileUserWorkspace } | null
  >(null);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<MobileUserWorkspace | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      setWorkspaces(await listUserWorkspaces(requestDroneControl, targetId));
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [requestDroneControl, targetId]);
  React.useEffect(() => { void reload(); }, [reload]);

  const submitDialog = async () => {
    if (!dialog) return;
    setBusy(true);
    setDialogError(null);
    try {
      const value = dialog.value.trim();
      if (dialog.kind === 'create') await createUserWorkspace(requestDroneControl, targetId, value);
      else if (dialog.kind === 'link') await linkUserWorkspace(requestDroneControl, targetId, value);
      else await renameUserWorkspace(requestDroneControl, targetId, dialog.workspace!.id, value);
      setDialog(null);
      await reload();
    } catch (cause) {
      setDialogError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await removeUserWorkspace(requestDroneControl, targetId, removing.id);
      setRemoving(null);
      await reload();
    } catch (cause) {
      setRemoving(null);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const dialogCopy = {
    create: { title: 'New workspace', message: 'A new folder in the workspaces folder on the Hub’s computer.', confirm: 'Create' },
    link: { title: 'Add folder', message: 'The full path of a folder on the Hub’s computer, like /home/you/notes. It stays where it is.', confirm: 'Add' },
    rename: { title: 'Rename workspace', message: 'Only the name changes; the folder keeps its path.', confirm: 'Rename' },
  } as const;

  return (
    <>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to workspaces" onPress={onBack} hitSlop={8} style={styles.iconButton}>
          <ChevronLeft color={colors.muted} size={20} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Manage workspaces</Text>
      </View>
      <Text style={styles.note}>
        Folders on the Hub’s computer that agents can be given access to. Removing one only takes it off this list; its files stay.
      </Text>
      <ErrorBanner message={error} />
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {workspaces === null && !error ? <Text style={styles.empty}>Loading…</Text> : null}
        {workspaces?.length === 0 ? <Text style={styles.empty}>No workspaces yet.</Text> : null}
        {workspaces?.map((workspace) => (
          <Pressable
            key={workspace.id}
            accessibilityRole="button"
            accessibilityLabel={`${workspace.name}, ${workspace.kind === 'created' ? 'created' : 'linked folder'}${workspace.missing ? ', missing' : ''}. Options`}
            onPress={() => setMenu(workspace)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Folder color={workspace.missing ? colors.mutedDim : colors.muted} size={17} strokeWidth={1.9} />
            <View style={styles.rowBody}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {workspace.name}
                {workspace.missing ? <Text style={styles.missing}>  Missing</Text> : null}
              </Text>
              <Text numberOfLines={1} style={styles.rowDetail}>{workspace.root}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => { setDialogError(null); setDialog({ kind: 'create', value: '' }); }}
          style={({ pressed }) => [styles.actionButton, styles.actionPrimary, pressed && styles.pressed]}
        >
          <FolderPlus color={colors.onAccent} size={16} strokeWidth={2} />
          <Text style={styles.actionPrimaryText}>New workspace</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => { setDialogError(null); setDialog({ kind: 'link', value: '' }); }}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>Add folder</Text>
        </Pressable>
      </View>
      <ContextMenu
        visible={menu !== null}
        title={menu?.name ?? ''}
        actions={menu ? [
          { label: 'Rename', onPress: () => { setDialogError(null); setDialog({ kind: 'rename', value: menu.name, workspace: menu }); } },
          { label: 'Remove', destructive: true, onPress: () => setRemoving(menu) },
        ] : []}
        onClose={() => setMenu(null)}
      />
      <TextInputDialog
        visible={dialog !== null}
        title={dialog ? dialogCopy[dialog.kind].title : ''}
        message={dialog ? dialogCopy[dialog.kind].message : ''}
        value={dialog?.value ?? ''}
        error={dialogError}
        confirmLabel={dialog ? dialogCopy[dialog.kind].confirm : ''}
        busy={busy}
        maxLength={dialog?.kind === 'link' ? 1024 : 80}
        onChangeText={(value) => { setDialogError(null); setDialog((currentDialog) => (currentDialog ? { ...currentDialog, value } : currentDialog)); }}
        onCancel={() => setDialog(null)}
        onConfirm={() => void submitDialog()}
      />
      <ConfirmDialog
        visible={removing !== null}
        title={`Remove “${removing?.name ?? ''}”?`}
        message={`Agents lose access to it and it leaves the File Explorer. Its files stay in ${removing?.root ?? ''}.`}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  control: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  chip: {
    flexShrink: 1,
    minWidth: 0,
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface0,
  },
  chipSwitched: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  chipText: { flexShrink: 1, color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextSwitched: { color: colors.accent },
  iconButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  pressed: { opacity: 0.6 },
  layer: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.surface2, marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  title: { flex: 1, color: colors.textStrong, fontSize: 16, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.crust,
    marginBottom: 6,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 8 },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: 8 },
  heading: {
    color: colors.mutedDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 10, borderRadius: 10 },
  rowSelected: { backgroundColor: colors.accentDark },
  rowPressed: { backgroundColor: colors.surface0 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowTitleSelected: { color: colors.accent },
  rowDetail: { color: colors.mutedDim, fontSize: 11, marginTop: 2 },
  missing: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  more: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  moreText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  empty: { color: colors.muted, fontSize: 13, paddingHorizontal: 10, paddingVertical: 16 },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    marginTop: 4,
  },
  footerText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, paddingTop: 8 },
  actionButton: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface0,
  },
  actionPrimary: { borderColor: colors.accent, backgroundColor: colors.accent },
  actionPrimaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
  actionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
