import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Activity from 'lucide-react-native/icons/activity';
import Bot from 'lucide-react-native/icons/bot';
import Check from 'lucide-react-native/icons/check';
import Link2 from 'lucide-react-native/icons/link-2';
import Star from 'lucide-react-native/icons/star';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Type from 'lucide-react-native/icons/type';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { TopTabs, type TopTabOption } from '../components/TopTabs';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { Button, ConfirmDialog, ErrorBanner, Label, textStyles } from '../components/Ui';
import { mobileDeviceConnectionLabel } from '../drones/mobile-device-reachability';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { LocalAssistantSettingsCard } from '../local-assistant/LocalAssistantSettingsCard';
import { MobileVoiceInputSettingsCard } from '../local-assistant/MobileVoiceInputSettingsCard';
import { MobileReadingSettingsCard } from './MobileReadingSettingsCard';
import { MobileFilesSettingsCard } from './MobileFilesSettingsCard';

export type SettingsTab = 'display' | 'assistant' | 'devices';

const SETTINGS_TABS: Array<TopTabOption<SettingsTab>> = [
  { value: 'display', label: 'Display', icon: Type },
  { value: 'assistant', label: 'Built-in', icon: Bot },
  { value: 'devices', label: 'Connections', icon: Smartphone },
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
  const [advanced, setAdvanced] = React.useState(false);

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
        {tab === 'display' ? (
          <>
            <MobileReadingSettingsCard />
            <MobileFilesSettingsCard />
          </>
        ) : tab === 'assistant' ? (
          <>
            <LocalAssistantSettingsCard />
            <MobileVoiceInputSettingsCard />
          </>
        ) : (
          <>
            <View style={styles.section}>
              <Button icon={Link2} onPress={onPair}>
                Add or reconnect a device
              </Button>
            </View>
            <View style={styles.section}>
              <Label>This phone</Label>
              <ThemedTextInput
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
            <Button tone="quiet" onPress={() => setAdvanced((value) => !value)}>
              {advanced ? 'Hide connection details' : 'Connection details & troubleshooting'}
            </Button>
            {advanced && (
              <>
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
                            {mesh.devices.find((device) => device.id === connection.deviceId)
                              ?.name ?? connection.deviceId}
                          </Text>
                          <View style={styles.routeStatus}>
                            <Text style={styles.role}>{connection.role}</Text>
                            <Text style={styles.result}>
                              {results[connection.deviceId] ??
                                mobileDeviceConnectionLabel(
                                  mesh.connectionStatesByDevice[connection.deviceId] ?? 'offline',
                                ).toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text style={[textStyles.mono, styles.endpoint]}>
                          {connection.endpoint}
                        </Text>
                        {connection.role === 'backup' ? (
                          <View style={styles.primaryAction}>
                            <Button
                              tone="quiet"
                              icon={Star}
                              onPress={() => void mesh.makePrimary(connection.deviceId)}
                              style={styles.inlineButton}
                            >
                              Make primary
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
                <View style={styles.section}>
                  <Label>Reset connections</Label>
                  <Text style={textStyles.body}>
                    Remove saved connections from this phone. This does not delete your chats or
                    files.
                  </Text>
                  <View style={styles.meshActions}>
                    <Button
                      tone="danger"
                      icon={Trash2}
                      onPress={() => setConfirmForget(true)}
                      style={styles.meshButton}
                    >
                      Forget connections
                    </Button>
                  </View>
                </View>
                <View style={styles.section}>
                  <Label>Device identity & security</Label>
                  <Text style={textStyles.mono}>{mesh.identity?.id}</Text>
                  <Text style={[textStyles.mono, styles.network]}>{mesh.profile?.networkId}</Text>
                  <Text style={[textStyles.body, styles.security]}>
                    Private keys stay in secure storage. Credential transfers are encrypted for this
                    phone.
                  </Text>
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
      <ConfirmDialog
        visible={confirmForget}
        title="Forget saved connections?"
        message="This removes all saved device routes and permissions from the phone. Your phone identity remains, but you will need a new pairing code to reconnect."
        confirmLabel="Forget connections"
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
    borderColor: colors.borderStrong,
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
