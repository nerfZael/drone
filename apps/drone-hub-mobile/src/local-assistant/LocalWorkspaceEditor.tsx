import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, ErrorBanner, Label } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { useLocalAssistant } from './LocalAssistantContext';
import type { LocalAssistantThread, LocalWorkspaceTarget } from './local-assistant-types';

function Toggle({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return (
    <Pressable onPress={onPress} style={[styles.toggle, active && styles.toggleActive]}>
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function LocalWorkspaceEditor({
  thread,
  onClose,
}: {
  thread: LocalAssistantThread;
  onClose(): void;
}) {
  const mesh = useMesh();
  const assistant = useLocalAssistant();
  const availableDevices = mesh.devices.filter(
    (device) =>
      device.id !== mesh.identity?.id &&
      !device.revokedAt &&
      (mesh.profile?.capabilitiesByDevice[device.id] ?? []).some(
        (capability) => capability.id === 'workspace',
      ),
  );
  const initial = thread.workspaceTarget;
  const [deviceId, setDeviceId] = React.useState(initial?.targetDeviceId ?? '');
  const [rootId, setRootId] = React.useState(initial?.rootId ?? '');
  const [read, setRead] = React.useState(initial?.read ?? true);
  const [write, setWrite] = React.useState(initial?.write ?? false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    if (!deviceId || !rootId.trim()) {
      setError('Choose a workspace device and enter its configured root ID.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const target: LocalWorkspaceTarget = {
        targetDeviceId: deviceId,
        rootId: rootId.trim(),
        read: read || write,
        write,
      };
      await assistant.updateThread(thread.id, { workspaceTarget: target });
      onClose();
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await assistant.updateThread(thread.id, { workspaceTarget: null });
      onClose();
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.editor}>
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <Label>Remote workspace</Label>
          <Text style={styles.title}>Bind this phone thread</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.close}>×</Text>
        </Pressable>
      </View>
      <Text style={styles.body}>
        On the destination Hub, grant this phone workspace operations and add a matching rule for
        the phone device ID, thread ID, root, and access level.
      </Text>
      <View style={styles.identityBlock}>
        <Text style={styles.identityLabel}>PHONE DEVICE</Text>
        <Text selectable style={styles.identityValue}>
          {mesh.identity?.id}
        </Text>
        <Text style={styles.identityLabel}>THREAD</Text>
        <Text selectable style={styles.identityValue}>
          {thread.id}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.deviceChoices}
      >
        {availableDevices.map((device) => (
          <Pressable
            key={device.id}
            onPress={() => setDeviceId(device.id)}
            style={[styles.deviceChoice, deviceId === device.id && styles.deviceChoiceActive]}
          >
            <View
              style={[
                styles.deviceDot,
                mesh.connectedDeviceIds.includes(device.id) && styles.deviceDotOnline,
              ]}
            />
            <Text style={styles.deviceChoiceText}>{device.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {availableDevices.length === 0 ? (
        <Text style={styles.warning}>
          No device advertises the workspace capability. Refresh Devices after its Hub connects.
        </Text>
      ) : null}
      <TextInput
        value={rootId}
        onChangeText={setRootId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Workspace root ID, for example main-project"
        placeholderTextColor={colors.muted}
        style={styles.rootInput}
      />
      <View style={styles.accessRow}>
        <Toggle label="READ" active={read || write} onPress={() => !write && setRead(!read)} />
        <Toggle
          label="WRITE"
          active={write}
          onPress={() => {
            setWrite(!write);
            if (!write) setRead(true);
          }}
        />
      </View>
      <ErrorBanner message={error} />
      <View style={styles.actions}>
        <Button loading={busy} onPress={() => void save()} style={styles.save}>
          Use this workspace
        </Button>
        {thread.workspaceTarget ? (
          <Button disabled={busy} tone="danger" onPress={() => void remove()}>
            Remove
          </Button>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 16,
    gap: 13,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  headCopy: { flex: 1 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 5 },
  close: { color: colors.muted, fontSize: 25 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  identityBlock: { borderRadius: 12, backgroundColor: colors.background, padding: 11, gap: 4 },
  identityLabel: {
    color: colors.warning,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 3,
  },
  identityValue: { color: colors.muted, fontSize: 9, fontFamily: 'monospace' },
  deviceChoices: { gap: 7 },
  deviceChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 39,
    paddingHorizontal: 11,
    borderRadius: 11,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
  },
  deviceChoiceActive: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  deviceChoiceText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  deviceDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  deviceDotOnline: { backgroundColor: colors.online },
  warning: { color: colors.warning, fontSize: 11, lineHeight: 16 },
  rootInput: {
    minHeight: 46,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.background,
    color: colors.text,
    paddingHorizontal: 12,
    fontSize: 12,
  },
  accessRow: { flexDirection: 'row', gap: 8 },
  toggle: {
    height: 36,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
  },
  toggleActive: { backgroundColor: colors.accentDark, borderColor: colors.accent },
  toggleText: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  toggleTextActive: { color: colors.accent },
  actions: { gap: 8 },
  save: { flex: 1 },
});
