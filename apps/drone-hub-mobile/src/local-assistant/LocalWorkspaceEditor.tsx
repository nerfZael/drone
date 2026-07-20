import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Button, ConfirmDialog, ErrorBanner, Label } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { useLocalAssistant } from './LocalAssistantContext';
import type { LocalAssistantThread, LocalWorkspaceTarget } from './local-assistant-types';

type RemoteWorkspace = {
  id: string;
  name: string;
  read: boolean;
  write: boolean;
  execute: boolean;
};

type DeviceWorkspaces = {
  id: string;
  name: string;
  connected: boolean;
  loading: boolean;
  error: string | null;
  workspaces: RemoteWorkspace[];
};

function targetKey(target: Pick<LocalWorkspaceTarget, 'targetDeviceId' | 'workspaceId'>): string {
  return `${target.targetDeviceId}\0${target.workspaceId}`;
}

function targetSignature(target: LocalWorkspaceTarget | undefined): string {
  if (!target) return '';
  return `${targetKey(target)}:${Number(target.read)}${Number(target.write)}${Number(target.execute)}`;
}

function sortedTargets(targets: LocalWorkspaceTarget[]): LocalWorkspaceTarget[] {
  return [...targets].sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
}

function changedTargetCount(saved: LocalWorkspaceTarget[], draft: LocalWorkspaceTarget[]): number {
  const before = new Map(saved.map((target) => [targetKey(target), targetSignature(target)]));
  const after = new Map(draft.map((target) => [targetKey(target), targetSignature(target)]));
  return new Set([...before.keys(), ...after.keys()]).size === 0
    ? 0
    : [...new Set([...before.keys(), ...after.keys()])].filter(
        (key) => before.get(key) !== after.get(key),
      ).length;
}

function PermissionToggle({
  label,
  checked,
  disabled,
  onPress,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.permission,
        disabled && styles.permissionDisabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Check color={colors.onAccent} size={10} strokeWidth={3} /> : null}
      </View>
      <Text style={[styles.permissionText, checked && styles.permissionTextChecked]}>{label}</Text>
    </Pressable>
  );
}

export function LocalWorkspaceEditor({
  thread,
  onRequestClose,
  onApplied,
  onDirtyChange,
}: {
  thread: LocalAssistantThread;
  onRequestClose(): void;
  onApplied(): void;
  onDirtyChange(dirty: boolean): void;
}) {
  const mesh = useMesh();
  const assistant = useLocalAssistant();
  const [draft, setDraft] = React.useState(() => sortedTargets(thread.workspaceTargets));
  const [devices, setDevices] = React.useState<DeviceWorkspaces[]>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(thread.workspaceTargets.map((target) => target.targetDeviceId)),
  );
  const [busy, setBusy] = React.useState(false);
  const [confirmApply, setConfirmApply] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const changes = changedTargetCount(thread.workspaceTargets, draft);
  const dirty = changes > 0;
  const availableDevices = React.useMemo(
    () =>
      mesh.devices.filter(
        (device) =>
          device.id !== mesh.identity?.id &&
          !device.revokedAt &&
          (mesh.profile?.capabilitiesByDevice[device.id] ?? []).some(
            (capability) => capability.id === 'workspace',
          ),
      ),
    [mesh.devices, mesh.identity?.id, mesh.profile?.capabilitiesByDevice],
  );
  const availableKey = JSON.stringify(
    availableDevices
      .map((device) => ({
        id: device.id,
        name: device.name,
        connected: mesh.connectedDeviceIds.includes(device.id),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  const discoveredKeys = new Set(
    devices.flatMap((device) =>
      device.workspaces.map((workspace) => `${device.id}\0${workspace.id}`),
    ),
  );
  const unavailableTargets = draft.filter((target) => {
    const device = devices.find((candidate) => candidate.id === target.targetDeviceId);
    if (!device)
      return !availableDevices.some((candidate) => candidate.id === target.targetDeviceId);
    return !device.loading && !device.error && !discoveredKeys.has(targetKey(target));
  });

  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  React.useEffect(() => {
    let active = true;
    setDevices(
      availableDevices.map((device) => ({
        id: device.id,
        name: device.name,
        connected: mesh.connectedDeviceIds.includes(device.id),
        loading: true,
        error: null,
        workspaces: [],
      })),
    );
    void Promise.all(
      availableDevices.map(async (device) => {
        try {
          const result = await mesh.request(device.id, 'workspace', 'workspaces.list', {});
          const workspaces = (Array.isArray(result?.workspaces) ? result.workspaces : [])
            .filter((workspace: any) => workspace?.id && workspace?.name)
            .map((workspace: any) => ({
              id: String(workspace.id),
              name: String(workspace.name),
              read: workspace.read === true,
              write: workspace.write === true,
              execute: workspace.execute === true,
            }));
          if (!active) return;
          setDevices((current) =>
            current.map((item) =>
              item.id === device.id ? { ...item, loading: false, workspaces } : item,
            ),
          );
        } catch (nextError: any) {
          if (!active) return;
          setDevices((current) =>
            current.map((item) =>
              item.id === device.id
                ? { ...item, loading: false, error: nextError?.message ?? String(nextError) }
                : item,
            ),
          );
        }
      }),
    );
    return () => {
      active = false;
    };
  }, [availableKey, mesh.request, reload]);

  const updatePermission = (
    device: DeviceWorkspaces,
    workspace: RemoteWorkspace,
    permission: 'read' | 'write' | 'execute',
  ) => {
    const key = `${device.id}\0${workspace.id}`;
    setDraft((current) => {
      const existing = current.find((target) => targetKey(target) === key) ?? {
        targetDeviceId: device.id,
        deviceName: device.name,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        read: false,
        write: false,
        execute: false,
      };
      let next = { ...existing, deviceName: device.name, workspaceName: workspace.name };
      if (permission === 'read') {
        next = { ...next, read: !next.read };
      } else if (permission === 'write') {
        next = { ...next, write: !next.write };
      } else {
        next = { ...next, execute: !next.execute };
      }
      const rest = current.filter((target) => targetKey(target) !== key);
      return sortedTargets(next.read || next.write || next.execute ? [...rest, next] : rest);
    });
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await assistant.updateThread(thread.id, { workspaceTargets: draft });
      onDirtyChange(false);
      setConfirmApply(false);
      onApplied();
    } catch (nextError: any) {
      setConfirmApply(false);
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Label>Chat access</Label>
          <Text style={styles.title}>Devices and workspaces</Text>
          <Text style={styles.body}>
            This chat starts with no access. Choose a subset of the workspaces each destination
            has already granted to this phone.
          </Text>
        </View>
        <View style={styles.headingActions}>
          <Pressable accessibilityRole="button" onPress={() => setReload((value) => value + 1)}>
            <Text style={styles.refresh}>Refresh</Text>
          </Pressable>
          <Pressable accessibilityLabel="Return to chat" onPress={onRequestClose} hitSlop={10}>
            <Text style={styles.close}>×</Text>
          </Pressable>
        </View>
      </View>

      <ErrorBanner message={error} />
      <View style={styles.deviceList}>
        {devices.map((device) => {
          const open = expanded.has(device.id);
          const selectedCount = draft.filter(
            (target) => target.targetDeviceId === device.id,
          ).length;
          const Disclosure = open ? ChevronDown : ChevronRight;
          return (
            <View key={device.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(device.id)) next.delete(device.id);
                    else next.add(device.id);
                    return next;
                  })
                }
                style={({ pressed }) => [
                  styles.deviceRow,
                  open && styles.deviceRowOpen,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.deviceDot, device.connected && styles.deviceDotOnline]} />
                <View style={styles.deviceCopy}>
                  <Text style={styles.deviceName}>{device.name}</Text>
                  <Text style={styles.deviceMeta}>
                    {device.connected ? 'Online' : 'Offline'}
                    {selectedCount ? ` · ${selectedCount} selected` : ''}
                  </Text>
                </View>
                {device.loading ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Disclosure color={colors.muted} size={15} strokeWidth={2} />
                )}
              </Pressable>
              {open ? (
                <View style={styles.workspacePanel}>
                  {device.error ? <Text style={styles.warning}>{device.error}</Text> : null}
                  {!device.loading && !device.error && device.workspaces.length === 0 ? (
                    <Text style={styles.emptyText}>
                      This device has not granted any workspace to this phone.
                    </Text>
                  ) : null}
                  {device.workspaces.map((workspace) => {
                    const selected = draft.find(
                      (target) =>
                        target.targetDeviceId === device.id && target.workspaceId === workspace.id,
                    );
                    const saved = thread.workspaceTargets.find(
                      (target) =>
                        target.targetDeviceId === device.id && target.workspaceId === workspace.id,
                    );
                    const changed = targetSignature(selected) !== targetSignature(saved);
                    return (
                      <View
                        key={workspace.id}
                        style={[styles.workspaceRow, changed && styles.workspaceRowChanged]}
                      >
                        <View style={styles.workspaceCopy}>
                          <Text style={styles.workspaceName}>{workspace.name}</Text>
                          <Text style={styles.workspaceMeta}>
                            Destination allows{' '}
                            {[
                              workspace.read && 'read',
                              workspace.write && 'write',
                              workspace.execute && 'commands',
                            ]
                              .filter(Boolean)
                              .join(', ')}
                            {changed ? ' · changed' : ''}
                          </Text>
                        </View>
                        <View style={styles.permissions}>
                          <PermissionToggle
                            label="READ"
                            checked={selected?.read === true}
                            disabled={!workspace.read}
                            onPress={() => updatePermission(device, workspace, 'read')}
                          />
                          <PermissionToggle
                            label="WRITE"
                            checked={selected?.write === true}
                            disabled={!workspace.write}
                            onPress={() => updatePermission(device, workspace, 'write')}
                          />
                          <PermissionToggle
                            label="RUN"
                            checked={selected?.execute === true}
                            disabled={!workspace.execute}
                            onPress={() => updatePermission(device, workspace, 'execute')}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
        {devices.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No paired device advertises workspace access. Configure a workspace on a destination
              Hub, then refresh Devices.
            </Text>
          </View>
        ) : null}
      </View>

      {unavailableTargets.length > 0 ? (
        <View style={styles.unavailable}>
          <Text style={styles.warning}>No longer granted by the destination</Text>
          {unavailableTargets.map((target) => (
            <View key={targetKey(target)} style={styles.unavailableRow}>
              <Text style={styles.unavailableName}>
                {target.deviceName} / {target.workspaceName}
              </Text>
              <Pressable
                onPress={() =>
                  setDraft((current) =>
                    current.filter((candidate) => targetKey(candidate) !== targetKey(target)),
                  )
                }
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {dirty ? (
        <View style={styles.unsavedBanner}>
          <Text style={styles.unsavedText}>
            {changes} unsaved {changes === 1 ? 'change' : 'changes'}
          </Text>
          <Pressable
            onPress={() => setConfirmDiscard(true)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={styles.discardText}>Discard</Text>
          </Pressable>
        </View>
      ) : null}
      <Button disabled={!dirty} onPress={() => setConfirmApply(true)}>
        Apply Changes
      </Button>

      <ConfirmDialog
        visible={confirmApply}
        title="Apply chat access changes?"
        message={`Update ${changes} workspace ${changes === 1 ? 'selection' : 'selections'} for “${thread.title}”?`}
        confirmLabel="Apply changes"
        busy={busy}
        onCancel={() => setConfirmApply(false)}
        onConfirm={() => void apply()}
      />
      <ConfirmDialog
        visible={confirmDiscard}
        title="Discard access changes?"
        message="Restore this chat’s last saved workspace access?"
        confirmLabel="Discard changes"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setDraft(sortedTargets(thread.workspaceTargets));
          setConfirmDiscard(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 2 },
  headingCopy: { flex: 1 },
  headingActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  refresh: { color: colors.accent, fontSize: 10, fontWeight: '800' },
  title: { color: colors.text, fontSize: 21, fontWeight: '800', marginTop: 5 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  close: { color: colors.muted, fontSize: 25 },
  deviceList: { gap: 7 },
  deviceRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  deviceRowOpen: { borderColor: colors.accentBorder, backgroundColor: colors.accentWash },
  deviceDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.subtle },
  deviceDotOnline: { backgroundColor: colors.online },
  deviceCopy: { flex: 1 },
  deviceName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  deviceMeta: { color: colors.muted, fontSize: 9, fontWeight: '700', marginTop: 3 },
  workspacePanel: {
    paddingHorizontal: 12,
    paddingBottom: 5,
  },
  workspaceRow: {
    gap: 9,
    paddingHorizontal: 2,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  workspaceRowChanged: { borderLeftWidth: 2, borderLeftColor: colors.warning, paddingLeft: 8 },
  workspaceCopy: { flex: 1 },
  workspaceName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  workspaceMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  permissions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  permission: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  permissionDisabled: { opacity: 0.3 },
  checkbox: {
    width: 13,
    height: 13,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  checkboxChecked: { borderColor: colors.accent, backgroundColor: colors.accent },
  permissionText: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  permissionTextChecked: { color: colors.text },
  warning: { color: colors.warning, fontSize: 10, lineHeight: 15 },
  unavailable: {
    gap: 7,
    padding: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  unavailableRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unavailableName: { flex: 1, color: colors.muted, fontSize: 10 },
  removeText: { color: colors.danger, fontSize: 10, fontWeight: '800' },
  empty: { padding: 18, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  emptyText: { color: colors.muted, fontSize: 10, lineHeight: 16 },
  unsavedBanner: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningDark,
  },
  unsavedText: { color: colors.warning, fontSize: 10, fontWeight: '800' },
  discardText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  pressed: { opacity: 0.72 },
});
