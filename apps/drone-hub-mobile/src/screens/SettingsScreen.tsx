import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Activity from 'lucide-react-native/icons/activity';
import Bot from 'lucide-react-native/icons/bot';
import Check from 'lucide-react-native/icons/check';
import Link2 from 'lucide-react-native/icons/link-2';
import Star from 'lucide-react-native/icons/star';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { TopTabs, type TopTabOption } from '../components/TopTabs';
import { Button, ConfirmDialog, ErrorBanner, Label, textStyles } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { LocalAssistantSettingsCard } from '../local-assistant/LocalAssistantSettingsCard';

export type SettingsTab = 'assistant' | 'devices' | 'pairing';

const SETTINGS_TABS: Array<TopTabOption<SettingsTab>> = [
  { value: 'assistant', label: 'Assistant', icon: Bot },
  { value: 'devices', label: 'Devices', icon: Smartphone },
  { value: 'pairing', label: 'Pairing', icon: Link2 },
];

export function SettingsScreen({
  tab,
  onTabChange,
  onPair,
}: {
  tab: SettingsTab;
  onTabChange(tab: SettingsTab): void;
  onPair(): void;
}) {
  const mesh = useMesh();
  const [checking, setChecking] = React.useState(false);
  const currentPhoneName =
    mesh.devices.find((device) => device.id === mesh.identity?.id)?.name ??
    mesh.identity?.name ??
    'Android phone';
  const [phoneName, setPhoneName] = React.useState(currentPhoneName);
  const [renaming, setRenaming] = React.useState(false);
  const [confirmForget, setConfirmForget] = React.useState(false);
  const [forgetting, setForgetting] = React.useState(false);
  const [results, setResults] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setPhoneName(currentPhoneName), [currentPhoneName]);

  const renamePhone = async () => {
    setRenaming(true);
    setError(null);
    try {
      await mesh.renameSelf(phoneName);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setRenaming(false);
    }
  };

  const diagnose = async () => {
    setChecking(true);
    setError(null);
    const next: Record<string, string> = {};
    await Promise.all(
      (mesh.profile?.connections ?? []).map(async (connection) => {
        const started = Date.now();
        try {
          await mesh.request(connection.deviceId, 'device-core', 'device.ping', {
            echo: 'diagnostics',
          });
          next[connection.deviceId] = `${Date.now() - started} ms`;
        } catch (nextError: any) {
          next[connection.deviceId] = nextError?.message ?? 'Unavailable';
        }
      }),
    );
    setResults(next);
    setChecking(false);
  };

  const visibleError = error ?? mesh.error;

  return (
    <View style={styles.shell}>
      <TopTabs value={tab} options={SETTINGS_TABS} onChange={onTabChange} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        {visibleError ? (
          <View style={styles.errorBanner}>
            <ErrorBanner message={visibleError} />
          </View>
        ) : null}
        {tab === 'assistant' ? (
          <LocalAssistantSettingsCard />
        ) : tab === 'devices' ? (
          <>
            <View style={styles.section}>
              <Label>This phone</Label>
              <TextInput
                value={phoneName}
                onChangeText={setPhoneName}
                placeholder="Android phone"
                placeholderTextColor={colors.subtle}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={80}
                style={styles.nameInput}
                underlineColorAndroid="transparent"
              />
              <Text style={textStyles.mono}>{mesh.identity?.id}</Text>
              <Button
                icon={Check}
                onPress={() => void renamePhone()}
                disabled={!phoneName.trim() || phoneName.trim() === currentPhoneName}
                loading={renaming}
                style={styles.renameButton}
              >
                Save phone name
              </Button>
            </View>
            <View style={styles.section}>
              <Label>Device network</Label>
              <Text style={[textStyles.mono, styles.network]}>{mesh.profile?.networkId}</Text>
            </View>
            <View style={styles.section}>
              <Label>Connections</Label>
              <View style={styles.routes}>
                {(mesh.profile?.connections ?? []).map((connection, index) => (
                  <View
                    key={connection.deviceId}
                    style={[styles.route, index > 0 && styles.routeDivider]}
                  >
                    <View style={styles.routeHead}>
                      <Text style={textStyles.heading}>
                        {mesh.devices.find((device) => device.id === connection.deviceId)?.name ??
                          connection.deviceId}
                      </Text>
                      <View style={styles.routeStatus}>
                        <Text style={styles.role}>{connection.role}</Text>
                        <Text style={styles.result}>
                          {results[connection.deviceId] ??
                            (mesh.connectedDeviceIds.includes(connection.deviceId)
                              ? 'CONNECTED'
                              : 'OFFLINE')}
                        </Text>
                      </View>
                    </View>
                    <Text style={[textStyles.mono, styles.endpoint]}>{connection.endpoint}</Text>
                    {connection.role === 'backup' ? (
                      <View style={styles.primaryAction}>
                        <Button
                          tone="quiet"
                          icon={Star}
                          onPress={() => void mesh.makePrimary(connection.deviceId)}
                          style={styles.inlineButton}
                        >
                          Make primary bridge
                        </Button>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
              <Button
                tone="quiet"
                icon={Activity}
                onPress={() => void diagnose()}
                loading={checking}
                style={styles.checkButton}
              >
                Run connection check
              </Button>
            </View>
          </>
        ) : (
          <>
            <View style={styles.section}>
              <Label>Device mesh</Label>
              <Text style={textStyles.body}>
                Replace an unreachable Hub route by scanning a fresh code. Your existing device
                identity and permissions are preserved.
              </Text>
              <View style={styles.meshActions}>
                <Button icon={Link2} onPress={onPair} style={styles.meshButton}>
                  Update connection
                </Button>
                <Button
                  tone="danger"
                  icon={Trash2}
                  onPress={() => setConfirmForget(true)}
                  style={styles.meshButton}
                >
                  Forget mesh
                </Button>
              </View>
            </View>
            <View style={styles.section}>
              <Label>Security</Label>
              <Text style={[textStyles.body, styles.security]}>
                The private identity is encrypted by Android secure storage. Requests are signed,
                expire after one minute, and are checked again on the target. Provider credential
                copies are encrypted specifically for this phone before forwarding.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
      <ConfirmDialog
        visible={confirmForget}
        title="Forget this mesh?"
        message="This removes all saved device routes and permissions from the phone. Your phone identity remains, but you will need a new pairing code to reconnect."
        confirmLabel="Forget mesh"
        destructive
        busy={forgetting}
        onCancel={() => setConfirmForget(false)}
        onConfirm={() =>
          void (async () => {
            setForgetting(true);
            setError(null);
            try {
              await mesh.forgetMesh();
              setConfirmForget(false);
            } catch (nextError: any) {
              setError(nextError?.message ?? String(nextError));
            } finally {
              setForgetting(false);
            }
          })()
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  page: { paddingHorizontal: 18, paddingBottom: 28 },
  errorBanner: { marginTop: 10 },
  section: {
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  nameInput: {
    minHeight: 44,
    color: colors.text,
    borderColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
    paddingVertical: 9,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 8,
  },
  renameButton: { alignSelf: 'flex-start', marginTop: 14 },
  network: { marginTop: 7, color: colors.accent },
  routes: { marginTop: 8 },
  route: { paddingVertical: 12 },
  routeDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  routeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  routeStatus: { alignItems: 'flex-end', gap: 3 },
  role: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  result: { color: colors.online, fontSize: 9, fontWeight: '900', maxWidth: '45%' },
  endpoint: { marginTop: 8 },
  primaryAction: { marginTop: 12 },
  inlineButton: { alignSelf: 'flex-start' },
  checkButton: { alignSelf: 'flex-start', marginTop: 10 },
  security: { marginTop: 8 },
  meshActions: { flexDirection: 'row', gap: 9, marginTop: 16 },
  meshButton: { flex: 1, paddingHorizontal: 10 },
});
