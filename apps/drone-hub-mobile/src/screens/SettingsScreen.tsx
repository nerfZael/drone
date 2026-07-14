import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Bot from 'lucide-react-native/icons/bot';
import Link2 from 'lucide-react-native/icons/link-2';
import Smartphone from 'lucide-react-native/icons/smartphone';
import { Button, Card, ConfirmDialog, ErrorBanner, Label, textStyles } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { LocalAssistantSettingsCard } from '../local-assistant/LocalAssistantSettingsCard';

export type SettingsTab = 'assistant' | 'devices' | 'pairing';

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: typeof Bot }> = [
  { id: 'assistant', label: 'Assistant', icon: Bot },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'pairing', label: 'Pairing', icon: Link2 },
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

  return (
    <View style={styles.shell}>
      <View style={styles.tabs}>
        {SETTINGS_TABS.map((item) => {
          const active = item.id === tab;
          const Icon = item.icon;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onTabChange(item.id)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Icon
                color={active ? colors.accent : colors.muted}
                size={14}
                strokeWidth={active ? 2.4 : 2}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <ErrorBanner message={error ?? mesh.error} />
        {tab === 'assistant' ? (
          <>
            <View>
              <Label>Assistant</Label>
              <Text style={[textStyles.title, styles.title]}>Model and credentials.</Text>
              <Text style={textStyles.body}>
                Choose how Assistant runs on this phone and manage its secure provider access.
              </Text>
            </View>
            <LocalAssistantSettingsCard />
          </>
        ) : tab === 'devices' ? (
          <>
            <View>
              <Label>Devices</Label>
              <Text style={[textStyles.title, styles.title]}>Identity and routes.</Text>
              <Text style={textStyles.body}>
                Names and addresses are hints. Device keys prove identity across the mesh.
              </Text>
            </View>
            <Card>
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
              />
              <Text style={textStyles.mono}>{mesh.identity?.id}</Text>
              <Button
                onPress={() => void renamePhone()}
                disabled={!phoneName.trim() || phoneName.trim() === currentPhoneName}
                loading={renaming}
                style={styles.renameButton}
              >
                Save phone name
              </Button>
            </Card>
            <Card>
              <Label>Device network</Label>
              <Text style={[textStyles.mono, styles.network]}>{mesh.profile?.networkId}</Text>
            </Card>
            <View style={styles.routes}>
              {(mesh.profile?.connections ?? []).map((connection) => (
                <Card key={connection.deviceId}>
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
                        onPress={() => void mesh.makePrimary(connection.deviceId)}
                      >
                        Make primary bridge
                      </Button>
                    </View>
                  ) : null}
                </Card>
              ))}
            </View>
            <Button onPress={() => void diagnose()} loading={checking}>
              Run connection check
            </Button>
          </>
        ) : (
          <>
            <View>
              <Label>Pairing</Label>
              <Text style={[textStyles.title, styles.title]}>Trust and access.</Text>
              <Text style={textStyles.body}>
                Add another trusted Hub or remove this phone from its current mesh.
              </Text>
            </View>
            <Card>
              <Label>Device mesh</Label>
              <Text style={[textStyles.heading, styles.meshTitle]}>Pairing and access</Text>
              <Text style={textStyles.body}>
                Pair another Hub without removing your existing routes and permissions.
              </Text>
              <View style={styles.meshActions}>
                <Button onPress={onPair}>Pair another Hub</Button>
                <Button tone="danger" onPress={() => setConfirmForget(true)}>
                  Forget mesh
                </Button>
              </View>
            </Card>
            <Card>
              <Label>Security</Label>
              <Text style={[textStyles.body, styles.security]}>
                The private identity is encrypted by Android secure storage. Requests are signed,
                expire after one minute, and are checked again on the target. Provider credential
                copies are encrypted specifically for this phone before forwarding.
              </Text>
            </Card>
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
  tabs: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 12,
    marginVertical: 10,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  tab: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  tabActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  tabText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  tabTextActive: { color: colors.accentAlt },
  page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28, gap: 14 },
  title: { marginTop: 6, marginBottom: 8 },
  nameInput: {
    minHeight: 44,
    color: colors.text,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 8,
  },
  renameButton: { marginTop: 12 },
  network: { marginTop: 7, color: colors.accent },
  routes: { gap: 9 },
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
  security: { marginTop: 8 },
  meshTitle: { marginTop: 6, marginBottom: 7 },
  meshActions: { gap: 9, marginTop: 14 },
});
