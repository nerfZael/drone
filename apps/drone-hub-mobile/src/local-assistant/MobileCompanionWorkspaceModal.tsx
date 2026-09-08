import React from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import X from 'lucide-react-native/icons/x';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COMPANION_CAPABILITY,
  COMPANION_WORKSPACE_OPERATIONS,
  isGranted,
} from '@drone/device-protocol';
import type { ChatWorkspaceAccess, ChatWorkspaceCatalog } from '@drone/assistant-chat';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { WorkspaceAccessEditor } from './WorkspaceAccessEditor';

/** Pin the editing destination when opened, independently of navigation behind the modal. */
export function MobileCompanionWorkspaceModal({
  deviceId,
  onClose,
}: {
  deviceId: string;
  onClose(): void;
}) {
  const mesh = useMesh();
  const insets = useSafeAreaInsets();
  const dirty = React.useRef(false);
  const saving = React.useRef(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const capability = mesh.profile?.capabilitiesByDevice[deviceId]?.find(
    (item) => item.id === COMPANION_CAPABILITY.id && item.version === COMPANION_CAPABILITY.version,
  );
  const self = mesh.devices.find((device) => device.id === mesh.identity?.id);
  const supported = COMPANION_WORKSPACE_OPERATIONS.every((operation) =>
    capability?.operations.includes(operation),
  );
  const granted = Boolean(
    self &&
    COMPANION_WORKSPACE_OPERATIONS.every((operation) =>
      isGranted(self.grants, COMPANION_CAPABILITY.id, COMPANION_CAPABILITY.version, operation),
    ),
  );
  const deviceName =
    mesh.devices.find((device) => device.id === deviceId)?.name ?? 'the connected Hub';
  const dismiss = () => {
    if (saving.current) return;
    if (!dirty.current) {
      onClose();
      return;
    }
    Alert.alert('Discard workspace changes?', 'Your workspace selection has not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };
  const load = React.useCallback(
    async (targetDeviceId?: string, signal?: AbortSignal) => {
      return (await mesh.request(
        deviceId,
        COMPANION_CAPABILITY.id,
        'workspaces.list',
        { deviceId: targetDeviceId },
        signal,
      )) as ChatWorkspaceCatalog;
    },
    [deviceId, mesh.request],
  );
  const save = React.useCallback(
    async (access: ChatWorkspaceAccess, revision: string) => {
      return mesh.request(deviceId, COMPANION_CAPABILITY.id, 'workspaces.update', {
        access,
        revision,
      });
    },
    [deviceId, mesh.request],
  );
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={styles.title}>Companion workspaces</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {deviceName}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Companion workspaces"
            disabled={isSaving}
            onPress={dismiss}
            style={styles.close}
          >
            <X size={22} color={colors.muted} />
          </Pressable>
        </View>
        {!supported || !granted ? (
          <Text accessibilityRole="alert" style={styles.notice}>
            {!supported
              ? `Update ${deviceName} to configure Companion workspaces from your phone.`
              : `Allow Companion workspace settings for this phone in ${deviceName} device permissions.`}
          </Text>
        ) : (
          <WorkspaceAccessEditor
            load={load}
            save={save}
            hubDeviceId={deviceId}
            readRequired
            description="Selected workspaces allow Read and transfers from them. Write allows edits and transfers to them. Execute allows commands, which can also modify files. Allowed operations run without approval."
            onDirtyChange={(value) => {
              dirty.current = value;
            }}
            onSavingChange={(value) => {
              saving.current = value;
              setIsSaving(value);
            }}
            onRequestClose={dismiss}
            onApplied={onClose}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.panelRaised },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  heading: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 3 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  notice: { color: colors.muted, fontSize: 14, lineHeight: 21, padding: 20 },
});
