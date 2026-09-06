import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Star from 'lucide-react-native/icons/star';
import type {
  ChatWorkspaceAccess,
  ChatWorkspaceCatalog,
  ChatWorkspaceOption,
} from '@drone/assistant-chat';
import { Button, ErrorBanner } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import {
  toggleWorkspace,
  workspaceAccessSignature,
  workspaceCategory,
} from './workspace-access-model';

export type WorkspaceAccessEditorProps = {
  load(deviceId?: string, signal?: AbortSignal): Promise<ChatWorkspaceCatalog>;
  save(access: ChatWorkspaceAccess, revision: string): Promise<unknown>;
  disabled?: boolean;
  /** Device running the chat; its drone list changes refresh the local workspaces. */
  hubDeviceId?: string;
  onRequestClose(): void;
  onApplied(): void;
  onDirtyChange(dirty: boolean): void;
};

const PERMISSIONS = [
  { key: 'read', label: 'R', name: 'Read' },
  { key: 'write', label: 'W', name: 'Write' },
  { key: 'execute', label: 'X', name: 'Execute' },
] as const;

// Folders and repositories come first: a hub can run dozens of container drones
// and the shared folders must not end up below all of them.
const CATEGORIES = ['Repositories', 'Folders', 'Host drones', 'Container drones'] as const;
const AUTO_COLLAPSE_CATEGORY_SIZE = 6;

function optionMeta(option: ChatWorkspaceOption): string {
  const parts = [option.runtime, option.path, option.status].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  if (option.kind === 'drone') return 'Drone workspace';
  if (option.kind === 'host') return 'Folder on this device';
  return 'Shared folder';
}

export function WorkspaceAccessEditor(props: WorkspaceAccessEditorProps) {
  const mesh = useMesh();
  const callbacks = React.useRef(props);
  callbacks.current = props;
  const [catalog, setCatalog] = React.useState<ChatWorkspaceCatalog | null>(null);
  const [draft, setDraft] = React.useState<ChatWorkspaceAccess | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [categoryToggles, setCategoryToggles] = React.useState<Set<string>>(new Set());
  const [loaded, setLoaded] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const alive = React.useRef(true);
  const controllers = React.useRef(new Set<AbortController>());
  const loadedRef = React.useRef<Set<string>>(new Set());
  loadedRef.current = loaded;
  const dirty = Boolean(
    catalog &&
    draft &&
    workspaceAccessSignature(catalog.access) !== workspaceAccessSignature(draft),
  );
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  const disabled = props.disabled || saving || initialLoading;

  React.useEffect(() => {
    callbacks.current.onDirtyChange(dirty);
  }, [dirty]);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const controller of controllers.current) controller.abort();
      callbacks.current.onDirtyChange(false);
    };
  }, []);

  const track = React.useCallback((signal?: AbortSignal) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    return controller;
  }, []);

  /** Reloads one device's workspaces in place; a dirty draft is never touched. */
  const loadDevice = React.useCallback(
    async (deviceId: string) => {
      const controller = track();
      setLoading((current) => new Set(current).add(deviceId));
      try {
        const result = await callbacks.current.load(deviceId, controller.signal);
        if (controller.signal.aborted) return;
        setCatalog((current) =>
          current
            ? {
                ...current,
                workspaces: [
                  ...current.workspaces.filter((option) => option.deviceId !== deviceId),
                  ...result.workspaces.filter((option) => option.deviceId === deviceId),
                ],
                devices: current.devices.map((device) =>
                  device.id === deviceId
                    ? (result.devices.find((item) => item.id === deviceId) ?? device)
                    : device,
                ),
              }
            : current,
        );
        setLoaded((current) => new Set(current).add(deviceId));
      } catch (loadError: any) {
        if (controller.signal.aborted) return;
        setCatalog((current) =>
          current
            ? {
                ...current,
                devices: current.devices.map((device) =>
                  device.id === deviceId
                    ? { ...device, error: loadError?.message ?? String(loadError) }
                    : device,
                ),
              }
            : current,
        );
      } finally {
        controllers.current.delete(controller);
        if (alive.current)
          setLoading((current) => {
            const next = new Set(current);
            next.delete(deviceId);
            return next;
          });
      }
    },
    [track],
  );

  /**
   * Reloads the base catalog plus every device already expanded. The saved
   * selection updates underneath, but unsaved edits stay as they are.
   */
  const reload = React.useCallback(
    async (mode: 'initial' | 'pull' | 'silent') => {
      const controller = track();
      if (mode === 'initial') setInitialLoading(true);
      if (mode === 'pull') setRefreshing(true);
      if (mode !== 'silent') setError(null);
      try {
        const result = await callbacks.current.load(undefined, controller.signal);
        if (controller.signal.aborted) return;
        const previouslyLoaded =
          mode === 'initial' ? new Set<string>() : new Set(loadedRef.current);
        const baseDevices = new Set(result.workspaces.map((workspace) => workspace.deviceId));
        setCatalog((current) =>
          current && mode !== 'initial'
            ? {
                ...result,
                workspaces: [
                  ...result.workspaces,
                  ...current.workspaces.filter(
                    (option) =>
                      !baseDevices.has(option.deviceId) && previouslyLoaded.has(option.deviceId),
                  ),
                ],
              }
            : result,
        );
        setDraft((current) => (current && dirtyRef.current ? current : result.access));
        setLoaded(new Set([...baseDevices, ...previouslyLoaded]));
        if (mode === 'initial') {
          const others = result.devices.filter((device) => !baseDevices.has(device.id));
          setCollapsed(new Set(others.slice(1).map((device) => device.id)));
          const first = others[0];
          if (first && !first.error) void loadDevice(first.id);
        } else {
          for (const deviceId of previouslyLoaded) {
            if (!baseDevices.has(deviceId)) void loadDevice(deviceId);
          }
        }
      } catch (loadError: any) {
        if (!controller.signal.aborted && mode !== 'silent')
          setError(loadError?.message ?? String(loadError));
      } finally {
        controllers.current.delete(controller);
        if (alive.current && !controller.signal.aborted) {
          setInitialLoading(false);
          setRefreshing(false);
        }
      }
    },
    [loadDevice, track],
  );

  React.useEffect(() => {
    void reload('initial');
  }, [reload]);

  // Live refresh: shared-folder policy edits on any device, and drone changes on
  // the device running the chat, both arrive as mesh events.
  React.useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const schedule = (key: string, run: () => void) => {
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          run();
        }, 400),
      );
    };
    const unsubscribeWorkspaces = mesh.subscribe('workspace', 'workspaces.changed', (event) => {
      const deviceId = event.sourceDeviceId;
      if (!deviceId) return;
      if (deviceId === props.hubDeviceId) schedule('base', () => void reload('silent'));
      else if (loadedRef.current.has(deviceId))
        schedule(`device:${deviceId}`, () => void loadDevice(deviceId));
    });
    const unsubscribeDrones = mesh.subscribe('drone-control', 'drones.changed', (event) => {
      if (!props.hubDeviceId || event.sourceDeviceId !== props.hubDeviceId) return;
      schedule('base', () => void reload('silent'));
    });
    return () => {
      unsubscribeWorkspaces();
      unsubscribeDrones();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [loadDevice, mesh, props.hubDeviceId, reload]);

  async function apply() {
    if (!draft || !catalog || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await callbacks.current.save(draft, catalog.revision);
      if (alive.current) {
        callbacks.current.onDirtyChange(false);
        callbacks.current.onApplied();
      }
    } catch (saveError: any) {
      if (alive.current) setError(saveError?.message ?? String(saveError));
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  const options = new Map<string, ChatWorkspaceOption>();
  for (const target of draft?.targets ?? []) options.set(target.id, target);
  for (const option of catalog?.workspaces ?? []) options.set(option.id, option);
  const search = query.trim().toLowerCase();
  const selectedCount = draft?.targets.length ?? 0;
  const needsDefault = Boolean(draft && draft.targets.length > 0 && !draft.defaultTargetId);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Workspaces
          {selectedCount > 0 ? <Text style={styles.titleCount}> · {selectedCount}</Text> : null}
        </Text>
        <ThemedTextInput
          accessibilityLabel="Search workspaces"
          placeholder="Search"
          placeholderTextColor={colors.secondary}
          value={query}
          onChangeText={setQuery}
          style={styles.search}
        />
      </View>
      <ErrorBanner message={error} />
      {props.disabled ? (
        <Text style={styles.hint}>Stop the agent before changing workspace access.</Text>
      ) : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload('pull')}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.panelRaised}
          />
        }
      >
        {initialLoading && !catalog ? (
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        ) : null}
        {catalog?.devices.map((device) => {
          const selected = draft?.targets.filter((target) => target.deviceId === device.id) ?? [];
          const rows = [...options.values()].filter(
            (option) =>
              option.deviceId === device.id &&
              (!search ||
                `${device.name} ${option.name} ${option.path ?? ''} ${option.runtime ?? ''}`
                  .toLowerCase()
                  .includes(search)),
          );
          if (search && rows.length === 0) return null;
          const open = Boolean(search) || !collapsed.has(device.id);
          const isLoading = loading.has(device.id);
          const isLoaded = loaded.has(device.id);
          const Disclosure = open ? ChevronDown : ChevronRight;
          return (
            <View key={device.id} style={styles.section}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => {
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(device.id)) next.delete(device.id);
                    else next.add(device.id);
                    return next;
                  });
                  if (!open && !isLoaded && !isLoading) void loadDevice(device.id);
                }}
                style={({ pressed }) => [styles.deviceRow, pressed && styles.pressed]}
              >
                <Disclosure color={colors.muted} size={16} strokeWidth={2.2} />
                <Text numberOfLines={1} style={styles.deviceName}>
                  {device.name}
                </Text>
                {isLoading ? <ActivityIndicator color={colors.accent} size="small" /> : null}
                {selected.length > 0 ? (
                  <Text style={styles.deviceCount}>{selected.length} selected</Text>
                ) : null}
              </Pressable>
              {open ? (
                <View style={styles.sectionBody}>
                  {device.error ? (
                    <View style={styles.noticeRow}>
                      <Text style={styles.notice}>{device.error}</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void loadDevice(device.id)}
                        style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}
                      >
                        <Text style={styles.link}>Retry</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {isLoaded && rows.length === 0 && !device.error ? (
                    <Text style={styles.notice}>
                      {search
                        ? 'No matching workspaces.'
                        : 'Nothing shared with this chat. Share folders with the device running this chat in Hub settings.'}
                    </Text>
                  ) : null}
                  {CATEGORIES.map((category) => {
                    const entries = rows.filter((row) => workspaceCategory(row) === category);
                    if (entries.length === 0) return null;
                    const categoryKey = `${device.id}:${category}`;
                    const selectedInCategory = entries.filter((entry) =>
                      selected.some((target) => target.id === entry.id),
                    ).length;
                    // Long drone lists start collapsed unless something in them is selected.
                    const collapsedByDefault =
                      (category === 'Container drones' || category === 'Host drones') &&
                      entries.length > AUTO_COLLAPSE_CATEGORY_SIZE &&
                      selectedInCategory === 0;
                    const categoryOpen =
                      Boolean(search) || categoryToggles.has(categoryKey) !== collapsedByDefault;
                    return (
                      <View key={category}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ expanded: categoryOpen }}
                          onPress={() =>
                            setCategoryToggles((current) => {
                              const next = new Set(current);
                              if (next.has(categoryKey)) next.delete(categoryKey);
                              else next.add(categoryKey);
                              return next;
                            })
                          }
                          style={({ pressed }) => [styles.categoryRow, pressed && styles.pressed]}
                        >
                          <Text style={styles.category}>
                            {category} · {entries.length}
                            {selectedInCategory > 0 ? ` · ${selectedInCategory} selected` : ''}
                          </Text>
                          {categoryOpen ? (
                            <ChevronDown color={colors.mutedDim} size={13} strokeWidth={2.2} />
                          ) : (
                            <ChevronRight color={colors.mutedDim} size={13} strokeWidth={2.2} />
                          )}
                        </Pressable>
                        {categoryOpen
                          ? entries.map((option) => {
                              const target = selected.find((item) => item.id === option.id);
                              const available = catalog.workspaces.some(
                                (item) => item.id === option.id,
                              );
                              const isDefault = draft?.defaultTargetId === option.id;
                              const selectable =
                                !disabled &&
                                (Boolean(target) ||
                                  (available && (option.read || option.write || option.execute)));
                              return (
                                <View key={option.id} style={styles.row}>
                                  <Pressable
                                    accessibilityRole="checkbox"
                                    accessibilityLabel={`${option.name}, ${optionMeta(option)}`}
                                    accessibilityState={{
                                      checked: Boolean(target),
                                      disabled: !selectable,
                                    }}
                                    disabled={!selectable}
                                    onPress={() =>
                                      setDraft((current) =>
                                        current ? toggleWorkspace(current, option) : current,
                                      )
                                    }
                                    style={({ pressed }) => [
                                      styles.rowMain,
                                      !selectable && !target && styles.rowUnavailable,
                                      pressed && styles.pressed,
                                    ]}
                                  >
                                    <View style={[styles.checkbox, target && styles.checkboxOn]}>
                                      {target ? (
                                        <Check color={colors.onAccent} size={12} strokeWidth={3} />
                                      ) : null}
                                    </View>
                                    <View style={styles.copy}>
                                      <Text numberOfLines={1} style={styles.name}>
                                        {option.name}
                                      </Text>
                                      <Text numberOfLines={1} style={styles.meta}>
                                        {available ? optionMeta(option) : 'Unavailable'}
                                      </Text>
                                    </View>
                                  </Pressable>
                                  {target ? (
                                    <View style={styles.permissions}>
                                      {PERMISSIONS.map((permission) => {
                                        const on = target[permission.key];
                                        const offered = available && option[permission.key];
                                        if (!on && !offered) return null;
                                        const locked = disabled || (!on && !offered);
                                        return (
                                          <Pressable
                                            key={permission.key}
                                            accessibilityRole="checkbox"
                                            accessibilityLabel={`${permission.name} access to ${option.name}`}
                                            accessibilityState={{ checked: on, disabled: locked }}
                                            disabled={locked}
                                            hitSlop={4}
                                            onPress={() =>
                                              setDraft((current) => {
                                                if (!current) return current;
                                                const next = { ...target, [permission.key]: !on };
                                                if (!next.read && !next.write && !next.execute)
                                                  return toggleWorkspace(current, option);
                                                return {
                                                  ...current,
                                                  targets: current.targets.map((item) =>
                                                    item.id === option.id ? next : item,
                                                  ),
                                                };
                                              })
                                            }
                                            style={({ pressed }) => [
                                              styles.chip,
                                              on && styles.chipOn,
                                              locked && styles.chipLocked,
                                              pressed && styles.pressed,
                                            ]}
                                          >
                                            <Text
                                              style={[styles.chipText, on && styles.chipTextOn]}
                                            >
                                              {permission.label}
                                            </Text>
                                          </Pressable>
                                        );
                                      })}
                                      <Pressable
                                        accessibilityRole="radio"
                                        accessibilityLabel={`Use ${option.name} as the default workspace`}
                                        accessibilityState={{ selected: isDefault, disabled }}
                                        disabled={disabled || isDefault}
                                        hitSlop={4}
                                        onPress={() =>
                                          setDraft((current) =>
                                            current
                                              ? { ...current, defaultTargetId: option.id }
                                              : current,
                                          )
                                        }
                                        style={({ pressed }) => [
                                          styles.star,
                                          pressed && !isDefault && styles.pressed,
                                        ]}
                                      >
                                        <Star
                                          color={isDefault ? colors.warning : colors.mutedDim}
                                          fill={isDefault ? colors.warning : 'transparent'}
                                          size={14}
                                          strokeWidth={2}
                                        />
                                      </Pressable>
                                    </View>
                                  ) : null}
                                </View>
                              );
                            })
                          : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
        {catalog && selectedCount === 0 ? (
          <Text style={styles.notice}>
            No workspace selected. Private chat artifacts keep their existing setting.
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerHint} numberOfLines={1}>
          {needsDefault ? 'Star one workspace as the default.' : ''}
        </Text>
        <Button
          tone="quiet"
          disabled={disabled || !catalog}
          onPress={() => setDraft(catalog!.defaults)}
        >
          Reset
        </Button>
        <Button
          disabled={disabled || !dirty || needsDefault}
          loading={saving}
          onPress={() => void apply()}
        >
          Apply
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, gap: 8 },
  title: { color: colors.textStrong, fontSize: 18, fontWeight: '700' },
  titleCount: { color: colors.muted, fontWeight: '600' },
  search: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    color: colors.text,
    fontSize: 13,
  },
  hint: { paddingHorizontal: 16, paddingBottom: 6, color: colors.warning, fontSize: 11 },
  scroll: { flex: 1 },
  list: { paddingBottom: 20 },
  spinner: { paddingVertical: 24 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle },
  deviceRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  deviceName: { minWidth: 0, flex: 1, color: colors.text, fontSize: 13.5, fontWeight: '700' },
  deviceCount: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  sectionBody: { paddingBottom: 6 },
  categoryRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 14,
  },
  category: {
    minWidth: 0,
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
    color: colors.mutedDim,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 10 },
  rowMain: {
    minWidth: 0,
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  rowUnavailable: { opacity: 0.45 },
  checkbox: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  checkboxOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  copy: { minWidth: 0, flex: 1, gap: 1 },
  name: { color: colors.text, fontSize: 13, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 10.5 },
  permissions: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 6 },
  chip: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: colors.controlSurface,
  },
  chipOn: { backgroundColor: colors.accent },
  chipLocked: { opacity: 0.4 },
  chipText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  chipTextOn: { color: colors.onAccent },
  star: {
    width: 28,
    height: 28,
    marginLeft: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 8 },
  notice: {
    minWidth: 0,
    flexShrink: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.muted,
    fontSize: 11.5,
    lineHeight: 16,
  },
  inlineAction: { paddingHorizontal: 8, paddingVertical: 8 },
  link: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  footerHint: { minWidth: 0, flex: 1, color: colors.warning, fontSize: 11 },
  pressed: { opacity: 0.72 },
});
