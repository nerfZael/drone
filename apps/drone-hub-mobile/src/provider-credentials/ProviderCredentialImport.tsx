import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ConfirmDialog, ErrorBanner, textStyles } from '../components/Ui';
import { saveImportedCodexAuthJson } from '../local-assistant/local-assistant-codex-auth';
import {
  saveImportedGroqApiKey,
  saveImportedOpenAiApiKey,
  saveLocalAssistantProvider,
} from '../local-assistant/local-assistant-settings';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { fetchProviderCredential } from './fetch-provider-credential';
import type { ProviderCredentialId } from './provider-credential-crypto';

function credentialLabel(credential: ProviderCredentialId): string {
  return credential === 'codex'
    ? 'Codex login'
    : credential === 'groq'
      ? 'GROQ API key'
      : 'OpenAI API key';
}

export function ProviderCredentialImport({
  onImported,
  onImportStarted,
}: {
  onImported(credential: ProviderCredentialId): void;
  onImportStarted?(credential: ProviderCredentialId): void;
}) {
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
  const [saved, setSaved] = React.useState<ProviderCredentialId | null>(null);
  const [pendingCopy, setPendingCopy] = React.useState<{
    credential: ProviderCredentialId;
    sourceDeviceId: string;
    sourceName: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const source = sources.find((device) => device.id === sourceDeviceId) ?? sources[0];
  const self = mesh.devices.find((device) => device.id === mesh.identity?.id);

  const allowed = (credential: ProviderCredentialId) =>
    Boolean(
      self?.administrator &&
        self.grants.some(
          (grant) =>
            grant.capability === 'provider-credentials' &&
            (grant.operations.includes(`${credential}.export`) || grant.operations.includes('*')),
        ),
    );

  const copy = (credential: ProviderCredentialId) => {
    if (!source || !mesh.identity) return;
    setPendingCopy({
      credential,
      sourceDeviceId: source.id,
      sourceName: source.name,
    });
  };

  const confirmCopy = async () => {
    if (!pendingCopy || !mesh.identity) return;
    const copySource = sources.find((device) => device.id === pendingCopy.sourceDeviceId);
    if (!copySource) {
      setPendingCopy(null);
      setError('The credential source is no longer available.');
      return;
    }
    const credential = pendingCopy.credential;
    setBusy(true);
    setError(null);
    setSaved(null);
    onImportStarted?.(credential);
    try {
      const imported = await fetchProviderCredential({
        sourceDeviceId: copySource.id,
        recipientDeviceId: mesh.identity.id,
        sourceIdentityPublicKey: copySource.publicKey,
        credential,
        request: mesh.request,
      });
      if (credential === 'openai') {
        if (imported.kind !== 'openai-api-key' || !String(imported.apiKey ?? '').trim())
          throw new Error('source returned an invalid OpenAI API key');
        await saveImportedOpenAiApiKey(String(imported.apiKey));
      } else if (credential === 'codex') {
        if (imported.kind !== 'codex-auth-json' || !String(imported.authJson ?? '').trim())
          throw new Error('source returned an invalid Codex login');
        await saveImportedCodexAuthJson(String(imported.authJson));
      } else {
        if (imported.kind !== 'groq-api-key' || !String(imported.apiKey ?? '').trim())
          throw new Error('source returned an invalid GROQ API key');
        await saveImportedGroqApiKey(String(imported.apiKey));
      }
      if (credential !== 'groq') await saveLocalAssistantProvider(credential);
      onImported(credential);
      setSaved(credential);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy(false);
      setPendingCopy(null);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>COPY FROM A TRUSTED HUB</Text>
      <Text style={textStyles.body}>
        The source must grant this administrator phone the matching export operation. Each copy is
        encrypted specifically for this phone before it enters the mesh.
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
          <View style={styles.copyActions}>
            <Button disabled={!allowed('openai')} loading={busy} onPress={() => copy('openai')}>
              Copy OpenAI key
            </Button>
            <Button disabled={!allowed('codex')} loading={busy} onPress={() => copy('codex')}>
              Copy Codex login
            </Button>
            <Button disabled={!allowed('groq')} loading={busy} onPress={() => copy('groq')}>
              Copy GROQ key
            </Button>
          </View>
          {!allowed('openai') || !allowed('codex') || !allowed('groq') ? (
            <Text style={styles.permissionHint}>
              Enable the disabled export operation for this phone in the source Hub's device
              permissions.
            </Text>
          ) : null}
        </>
      )}
      {saved ? (
        <Text style={styles.saved}>
          {saved === 'codex'
            ? 'Codex login'
            : saved === 'groq'
              ? 'GROQ API key'
              : 'OpenAI API key'}{' '}
          copied into secure storage
        </Text>
      ) : null}
      <ConfirmDialog
        visible={Boolean(pendingCopy)}
        title={`Copy ${pendingCopy ? credentialLabel(pendingCopy.credential) : 'credential'}?`}
        message={`Copy the ${pendingCopy ? credentialLabel(pendingCopy.credential).toLowerCase() : 'credential'} from ${pendingCopy?.sourceName ?? 'this device'} into this phone's secure storage?`}
        confirmLabel="Copy securely"
        busy={busy}
        onCancel={() => setPendingCopy(null)}
        onConfirm={() => void confirmCopy()}
      />
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
  copyActions: { gap: 8 },
  permissionHint: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  emptyRow: { gap: 8, alignItems: 'flex-start' },
  empty: { color: colors.muted, fontSize: 11 },
  saved: { color: colors.online, fontSize: 10, fontWeight: '800' },
});
