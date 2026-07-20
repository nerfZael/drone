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
import Laptop from 'lucide-react-native/icons/laptop';
import Network from 'lucide-react-native/icons/network';
import Smartphone from 'lucide-react-native/icons/smartphone';
import type { CapabilityDescriptor, CapabilityGrant, MeshDevice } from '@drone/device-protocol';
import { Button, ConfirmDialog, ErrorBanner, textStyles } from '../components/Ui';
import { currentDeviceFirst, permissionChangeCount } from '../devices/device-permissions-model';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';

function operationKeys(grants: CapabilityGrant[]): Set<string> {
  return new Set(
    grants.flatMap((grant) =>
      grant.operations.map((operation) => `${grant.capability}:${operation}`),
    ),
  );
}

function grantsFromOperations(
  capabilities: CapabilityDescriptor[],
  selected: Set<string>,
): CapabilityGrant[] {
  return capabilities
    .map((capability) => ({
      capability: capability.id,
      version: capability.version,
      operations: capability.operations.filter((operation) =>
        selected.has(`${capability.id}:${operation}`),
      ),
    }))
    .filter((grant) => grant.operations.length > 0);
}

export function DevicesScreen() {
  const mesh = useMesh();
  const [refreshing, setRefreshing] = React.useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState('');
  const [permissionsExpanded, setPermissionsExpanded] = React.useState(false);
  const [capabilities, setCapabilities] = React.useState<CapabilityDescriptor[]>([]);
  const [selectedOperations, setSelectedOperations] = React.useState<Set<string>>(new Set());
  const [savedOperations, setSavedOperations] = React.useState<Set<string>>(new Set());
  const [canEditAccess, setCanEditAccess] = React.useState(false);
  const [permissionsLoading, setPermissionsLoading] = React.useState(false);
  const [permissionsSaving, setPermissionsSaving] = React.useState(false);
  const [confirmSave, setConfirmSave] = React.useState(false);
  const [pendingDeviceId, setPendingDeviceId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const permissionsRequestVersion = React.useRef(0);
  const orderedDevices = React.useMemo(
    () => currentDeviceFirst(mesh.devices, mesh.identity?.id),
    [mesh.devices, mesh.identity?.id],
  );
  const changes = React.useMemo(
    () => permissionChangeCount(savedOperations, selectedOperations),
    [savedOperations, selectedOperations],
  );
  const permissionsDirty = changes > 0;
  const selectedDevice = mesh.devices.find((device) => device.id === selectedDeviceId) ?? null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await mesh.refreshDevices();
    } finally {
      setRefreshing(false);
    }
  };

  const loadDevicePermissions = async (device: MeshDevice) => {
    const requestVersion = ++permissionsRequestVersion.current;
    setSelectedDeviceId(device.id);
    setPermissionsExpanded(true);
    setCapabilities([]);
    setSelectedOperations(new Set());
    setSavedOperations(new Set());
    setCanEditAccess(false);
    setPermissionsLoading(true);
    setError(null);
    try {
      const [description, listing] = await Promise.all([
        mesh.request(device.id, 'device-core', 'device.describe'),
        mesh.request(device.id, 'device-core', 'devices.list'),
      ]);
      const nextCapabilities = (
        Array.isArray(description?.capabilities) ? description.capabilities : []
      ).filter(
        (capability: CapabilityDescriptor) =>
          capability.id !== 'device-core' && capability.id !== 'workspace',
      );
      const phone = (Array.isArray(listing?.devices) ? listing.devices : []).find(
        (item: MeshDevice) => item.id === mesh.identity?.id,
      ) as MeshDevice | undefined;
      if (!phone) throw new Error('This phone is not registered on the selected device');
      if (permissionsRequestVersion.current !== requestVersion) return;
      const nextOperations = operationKeys(phone.grants);
      setCapabilities(nextCapabilities);
      setSelectedOperations(new Set(nextOperations));
      setSavedOperations(new Set(nextOperations));
      setCanEditAccess(phone.administrator === true);
    } catch (nextError: any) {
      if (permissionsRequestVersion.current === requestVersion)
        setError(nextError?.message ?? String(nextError));
    } finally {
      if (permissionsRequestVersion.current === requestVersion) setPermissionsLoading(false);
    }
  };

  const chooseDevice = (device: MeshDevice) => {
    if (device.id === mesh.identity?.id) return;
    if (device.id === selectedDeviceId) {
      setPermissionsExpanded((expanded) => !expanded);
      return;
    }
    if (permissionsDirty) {
      setPendingDeviceId(device.id);
      return;
    }
    void loadDevicePermissions(device);
  };

  const savePermissions = async () => {
    if (!selectedDeviceId || !canEditAccess) return;
    setPermissionsSaving(true);
    setError(null);
    try {
      const result = await mesh.request(
        selectedDeviceId,
        'device-core',
        'device.access.update-self',
        { grants: grantsFromOperations(capabilities, selectedOperations) },
      );
      const nextOperations = Array.isArray(result?.grants)
        ? operationKeys(result.grants)
        : new Set(selectedOperations);
      setSelectedOperations(new Set(nextOperations));
      setSavedOperations(new Set(nextOperations));
      await mesh.refreshDevices();
      setConfirmSave(false);
    } catch (nextError: any) {
      setConfirmSave(false);
      setError(nextError?.message ?? String(nextError));
    } finally {
      setPermissionsSaving(false);
    }
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.panelRaised}
          />
        }
      >
        <ErrorBanner message={error} />
        <View style={styles.list}>
          {orderedDevices.map((device) => {
            const self = device.id === mesh.identity?.id;
            const connected = self || mesh.connectedDeviceIds.includes(device.id);
            const selected = device.id === selectedDeviceId;
            const expanded = selected && permissionsExpanded;
            const connectionError = self ? null : mesh.connectionErrorsByDevice[device.id];
            const DeviceIcon =
              self || /android|ios|phone/i.test(device.platform) ? Smartphone : Laptop;
            const Disclosure = expanded ? ChevronDown : ChevronRight;
            return (
              <View key={device.id}>
                <Pressable
                  accessibilityRole={self ? undefined : 'button'}
                  accessibilityLabel={self ? undefined : `Configure access on ${device.name}`}
                  accessibilityState={self ? undefined : { expanded }}
                  disabled={self}
                  onPress={() => chooseDevice(device)}
                  style={({ pressed }) => [
                    styles.deviceCard,
                    connected && styles.connectedCard,
                    selected && styles.selectedCard,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.deviceIcon, connected && styles.deviceIconConnected]}>
                    <DeviceIcon
                      color={connected ? colors.online : colors.muted}
                      size={18}
                      strokeWidth={2}
                    />
                  </View>
                  <View style={styles.deviceCopy}>
                    <View style={styles.nameRow}>
                      <Text numberOfLines={1} style={styles.deviceName}>
                        {device.name}
                      </Text>
                      {self ? <Text style={styles.self}>THIS PHONE</Text> : null}
                    </View>
                    <Text numberOfLines={1} style={[textStyles.mono, styles.deviceId]}>
                      {device.platform}
                    </Text>
                    {connectionError ? (
                      <Text style={styles.connectionError}>{connectionError}</Text>
                    ) : null}
                  </View>
                  <View style={styles.status}>
                    <View style={[styles.dot, connected && styles.dotConnected]} />
                    <Text style={[styles.statusText, connected && styles.statusTextConnected]}>
                      {connected ? 'Online' : 'Offline'}
                    </Text>
                  </View>
                  <View style={styles.disclosureSlot}>
                    {!self ? <Disclosure color={colors.muted} size={15} strokeWidth={2} /> : null}
                  </View>
                </Pressable>

                {expanded ? (
                  <View style={styles.permissionPanel}>
                    {permissionsLoading ? (
                      <View style={styles.loading}>
                        <ActivityIndicator color={colors.accent} size="small" />
                        <Text style={styles.loadingText}>Loading permissions…</Text>
                      </View>
                    ) : (
                      <>
                        {!canEditAccess ? (
                          <Text style={styles.permissionHint}>
                            This phone can view its access here, but administrator access is
                            required to change it.
                          </Text>
                        ) : null}
                        {capabilities.map((capability) => (
                          <View key={capability.id} style={styles.capability}>
                            <Text style={styles.capabilityName}>{capability.id}</Text>
                            <View style={styles.operations}>
                              {capability.operations.map((operation) => {
                                const key = `${capability.id}:${operation}`;
                                const enabled = selectedOperations.has(key);
                                const changed = enabled !== savedOperations.has(key);
                                return (
                                  <Pressable
                                    key={key}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{
                                      checked: enabled,
                                      disabled: !canEditAccess,
                                    }}
                                    disabled={!canEditAccess}
                                    onPress={() =>
                                      setSelectedOperations((current) => {
                                        const next = new Set(current);
                                        if (next.has(key)) next.delete(key);
                                        else next.add(key);
                                        return next;
                                      })
                                    }
                                    style={({ pressed }) => [
                                      styles.operation,
                                      enabled && styles.operationEnabled,
                                      changed && styles.operationChanged,
                                      pressed && styles.pressed,
                                    ]}
                                  >
                                    <View
                                      style={[styles.checkbox, enabled && styles.checkboxEnabled]}
                                    >
                                      {enabled ? (
                                        <Check color={colors.onAccent} size={11} strokeWidth={3} />
                                      ) : null}
                                    </View>
                                    <Text
                                      style={[
                                        styles.operationText,
                                        enabled && styles.operationTextEnabled,
                                      ]}
                                    >
                                      {operation}
                                    </Text>
                                    {changed ? <View style={styles.changedDot} /> : null}
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        ))}
                        {permissionsDirty ? (
                          <View style={styles.unsavedBanner}>
                            <View style={styles.unsavedCopy}>
                              <View style={styles.unsavedDot} />
                              <Text style={styles.unsavedText}>
                                {changes} unsaved {changes === 1 ? 'change' : 'changes'}
                              </Text>
                            </View>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => setSelectedOperations(new Set(savedOperations))}
                              style={({ pressed }) => [
                                styles.discardInline,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.discardInlineText}>Discard</Text>
                            </Pressable>
                          </View>
                        ) : null}
                        <Button
                          disabled={
                            !canEditAccess || capabilities.length === 0 || !permissionsDirty
                          }
                          loading={permissionsSaving}
                          onPress={() => setConfirmSave(true)}
                          style={styles.saveButton}
                        >
                          Save permissions
                        </Button>
                      </>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
          {mesh.devices.length === 0 ? (
            <View style={styles.empty}>
              <Network color={colors.subtle} size={28} strokeWidth={1.6} />
              <Text style={styles.emptyTitle}>No trusted devices yet</Text>
              <Text style={styles.emptyBody}>Pull to refresh after pairing a Drone Hub.</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={confirmSave}
        title="Save permission changes?"
        message={`Apply ${changes} permission ${changes === 1 ? 'change' : 'changes'} for this phone on ${selectedDevice?.name ?? 'the selected device'}?`}
        confirmLabel="Save permissions"
        busy={permissionsSaving}
        onCancel={() => setConfirmSave(false)}
        onConfirm={() => void savePermissions()}
      />
      <ConfirmDialog
        visible={Boolean(pendingDeviceId)}
        title="Discard permission changes?"
        message={`You have ${changes} unsaved ${changes === 1 ? 'change' : 'changes'}. Discard them and open another device?`}
        confirmLabel="Discard changes"
        destructive
        onCancel={() => setPendingDeviceId('')}
        onConfirm={() => {
          const nextDevice = mesh.devices.find((device) => device.id === pendingDeviceId);
          setPendingDeviceId('');
          if (nextDevice) void loadDevicePermissions(nextDevice);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: 12, paddingBottom: 28, gap: 10 },
  list: { gap: 8 },
  deviceCard: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  connectedCard: { borderColor: colors.onlineBorder },
  selectedCard: { borderColor: colors.border, backgroundColor: colors.selectionWash },
  deviceIcon: {
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface1,
  },
  deviceIconConnected: { backgroundColor: colors.onlineDark },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.subtle },
  dotConnected: { backgroundColor: colors.online },
  deviceCopy: { flex: 1, gap: 3, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  deviceName: { color: colors.text, fontSize: 14, fontWeight: '800', flexShrink: 1 },
  deviceId: { fontSize: 8 },
  connectionError: { color: colors.warning, fontSize: 9, lineHeight: 13 },
  self: {
    color: colors.accent,
    backgroundColor: colors.accentDark,
    borderRadius: 4,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusText: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  statusTextConnected: { color: colors.online },
  disclosureSlot: { width: 15, alignItems: 'center', justifyContent: 'center' },
  permissionPanel: {
    marginTop: -1,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.accentBorder,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    backgroundColor: colors.background,
  },
  loading: { minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  permissionHint: { color: colors.warning, fontSize: 10, lineHeight: 15 },
  capability: { gap: 7 },
  capabilityName: {
    color: colors.accent,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '800',
  },
  operations: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  operation: {
    minHeight: 31,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  operationEnabled: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  operationChanged: { borderColor: colors.warning },
  checkbox: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  checkboxEnabled: { borderColor: colors.accent, backgroundColor: colors.accent },
  operationText: { color: colors.muted, fontFamily: 'monospace', fontSize: 9 },
  operationTextEnabled: { color: colors.text },
  changedDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.warning },
  unsavedBanner: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningDark,
  },
  unsavedCopy: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  unsavedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.warning },
  unsavedText: { color: colors.warning, fontSize: 10, fontWeight: '800' },
  discardInline: { paddingHorizontal: 7, paddingVertical: 6 },
  discardInlineText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  saveButton: { alignSelf: 'stretch', minHeight: 40 },
  empty: { alignItems: 'center', paddingVertical: 64, paddingHorizontal: 24 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 13 },
  emptyBody: { color: colors.muted, fontSize: 12, marginTop: 5, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
