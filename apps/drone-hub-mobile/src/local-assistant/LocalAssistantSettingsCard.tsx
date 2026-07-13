import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, ErrorBanner, Label, textStyles } from '../components/Ui';
import { ProviderCredentialImport } from '../provider-credentials/ProviderCredentialImport';
import { colors } from '../theme';
import {
  clearLocalAssistantApiKey,
  loadLocalAssistantSettings,
  saveLocalAssistantSettings,
} from './local-assistant-settings';

export function LocalAssistantSettingsCard() {
  const [model, setModel] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [hasApiKey, setHasApiKey] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void loadLocalAssistantSettings()
      .then((settings) => {
        setModel(settings.model);
        setHasApiKey(settings.hasApiKey);
      })
      .catch((nextError) => setError(nextError?.message ?? String(nextError)));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await saveLocalAssistantSettings({ model, apiKey });
      setModel(settings.model);
      setHasApiKey(settings.hasApiKey);
      setApiKey('');
      setSaved(true);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Label>Assistant on this phone</Label>
      <Text style={[textStyles.heading, styles.title]}>Direct model connection</Text>
      <Text style={textStyles.body}>
        The key stays in Android secure storage and is sent to OpenAI when this phone runs an
        assistant. You can enter it here or explicitly copy it from an authorized Hub.
      </Text>
      <ErrorBanner message={error} />
      <View style={styles.fields}>
        <TextInput
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="gpt-5.6-luna"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder={hasApiKey ? 'API key saved — enter to replace' : 'OpenAI API key'}
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
      </View>
      <View style={styles.actions}>
        <Button loading={busy} onPress={() => void save()} style={styles.actionButton}>
          Save assistant settings
        </Button>
        {hasApiKey ? (
          <Button
            tone="danger"
            style={styles.clearButton}
            onPress={() =>
              void clearLocalAssistantApiKey()
                .then((settings) => {
                  setHasApiKey(settings.hasApiKey);
                  setSaved(false);
                })
                .catch((nextError) => setError(nextError.message))
            }
          >
            Clear key
          </Button>
        ) : null}
      </View>
      <Text style={[styles.state, saved && styles.saved]}>
        {saved ? 'Saved on this phone' : hasApiKey ? 'API key is configured' : 'API key required'}
      </Text>
      <ProviderCredentialImport
        onImported={() => {
          setHasApiKey(true);
          setSaved(true);
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 6, marginBottom: 7 },
  fields: { gap: 9, marginTop: 14 },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  actions: { gap: 8, marginTop: 10 },
  actionButton: { flex: 1 },
  clearButton: { minHeight: 40 },
  state: { color: colors.warning, fontSize: 10, fontWeight: '800', marginTop: 10 },
  saved: { color: colors.online },
});
