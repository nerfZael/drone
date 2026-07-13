import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorBanner, textStyles } from '../components/Ui';
import { saveImportedOpenAiApiKey } from '../local-assistant/local-assistant-settings';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { fetchProviderCredential } from './fetch-provider-credential';

export function ProviderCredentialImport({ onImported }: { onImported(): void }) {
  const mesh = useMesh();
  const sources = mesh.devices.filter(
    (device) =>
      device.id !== mesh.identity?.id &&
      !device.revokedAt &&
      (mesh.profile?.capabilitiesByDevice[device.id] ?? []).some(
        (capability) => capability.id === 'provider-credentials',
      ),
  );
  const [sourceDeviceId, setSourceDeviceId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const source = sources.find((device) => device.id === sourceDeviceId) ?? sources[0];
  const self = mesh.devices.find((device) => device.id === mesh.identity?.id);

  const copy = () => {
    if (!source || !mesh.identity) return;
    Alert.alert(
      'Copy OpenAI API key?',
      `Copy the key from ${source.name} into this phone's secure storage?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy securely',
          onPress: () =>
            void (async () => {
              setBusy(true);
              setError(null);
              setSaved(false);
              try {
                const credential = await fetchProviderCredential({
                  sourceDeviceId: source.id,
                  recipientDeviceId: mesh.identity!.id,
                  sourceIdentityPublicKey: source.publicKey,
                  credential: 'openai',
                  request: mesh.request,
                });
                if (credential.kind !== 'openai-api-key' || !String(credential.apiKey ?? '').trim())
                  throw new Error('source returned an invalid OpenAI API key');
                await saveImportedOpenAiApiKey(String(credential.apiKey));
                onImported();
                setSaved(true);
              } catch (nextError: any) {
                setError(nextError?.message ?? String(nextError));
              } finally {
                setBusy(false);
              }
            })(),
        },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>COPY FROM A TRUSTED HUB</Text>
      <Text style={textStyles.body}>
        The source must grant this administrator phone the OpenAI export operation. Each copy is
        encrypted for this phone before it enters the mesh.
      </Text>
      {self && !self.administrator ? (
        <Text style={styles.warning}>This phone is not an administrator device.</Text>
      ) : null}
      <ErrorBanner message={error} />
      {sources.length === 0 ? (
        <View style={styles.emptyRow}>
          <Text style={styles.empty}>No credential source is advertised.</Text>
          <Button tone="quiet" onPress={() => void mesh.refreshDevices()}>
            Refresh devices
          </Button>
        </View>
      ) : (
        <>
          <View style={styles.sources}>
            {sources.map((device) => {
              const selected = device.id === source?.id;
              return (
                <Button
                  key={device.id}
                  tone={selected ? 'accent' : 'quiet'}
                  disabled={busy}
                  onPress={() => setSourceDeviceId(device.id)}
                  style={styles.sourceButton}
                >
                  {device.name}
                </Button>
              );
            })}
          </View>
          <Button disabled={!self?.administrator} loading={busy} onPress={copy}>
            Copy OpenAI key to this phone
          </Button>
        </>
      )}
      {saved ? <Text style={styles.saved}>API key copied into secure storage</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 9,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  heading: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  warning: { color: colors.warning, fontSize: 11 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  sourceButton: { minHeight: 38 },
  emptyRow: { gap: 8, alignItems: 'flex-start' },
  empty: { color: colors.muted, fontSize: 11 },
  saved: { color: colors.online, fontSize: 10, fontWeight: '800' },
});
