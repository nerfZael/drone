import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import { Button, Card, ErrorBanner, Label, textStyles } from '../components/Ui';
import { ProviderCredentialImport } from '../provider-credentials/ProviderCredentialImport';
import { colors } from '../theme';
import {
  assistantReasoningName,
  compactAssistantModelName,
} from './AssistantComposer';
import { AssistantModelPicker } from './AssistantModelPicker';
import {
  clearLocalAssistantApiKey,
  loadLocalAssistantSettings,
  saveLocalAssistantSettings,
} from './local-assistant-settings';
import { clearLocalAssistantCodexAuth } from './local-assistant-codex-auth';
import {
  DEFAULT_LOCAL_ASSISTANT_MODEL,
  DEFAULT_LOCAL_ASSISTANT_THINKING_LEVEL,
  localAssistantModelOptions,
  normalizeLocalAssistantThinkingLevel,
  type LocalAssistantThinkingLevel,
} from './local-assistant-model';

export function LocalAssistantSettingsCard() {
  const [provider, setProvider] = React.useState<'openai' | 'codex'>('openai');
  const [model, setModel] = React.useState(DEFAULT_LOCAL_ASSISTANT_MODEL);
  const [thinkingLevel, setThinkingLevel] = React.useState<LocalAssistantThinkingLevel>(
    DEFAULT_LOCAL_ASSISTANT_THINKING_LEVEL,
  );
  const [apiKey, setApiKey] = React.useState('');
  const [hasApiKey, setHasApiKey] = React.useState(false);
  const [hasCodexAuth, setHasCodexAuth] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void loadLocalAssistantSettings()
      .then((settings) => {
        setProvider(settings.provider);
        setModel(settings.model);
        setThinkingLevel(settings.thinkingLevel);
        setHasApiKey(settings.hasApiKey);
        setHasCodexAuth(settings.hasCodexAuth);
      })
      .catch((nextError) => setError(nextError?.message ?? String(nextError)));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await saveLocalAssistantSettings({
        provider,
        model,
        thinkingLevel,
        apiKey,
      });
      setProvider(settings.provider);
      setModel(settings.model);
      setThinkingLevel(settings.thinkingLevel);
      setHasApiKey(settings.hasApiKey);
      setHasCodexAuth(settings.hasCodexAuth);
      setApiKey('');
      setSaved(true);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Label>Assistant on this phone</Label>
      <Text style={[textStyles.heading, styles.title]}>Direct model connection</Text>
      <Text style={textStyles.body}>
        Credentials stay in Android secure storage and are sent only to the selected model service.
        Copying is explicit and requires permission on the source Hub.
      </Text>
      <ErrorBanner message={error} />
      <View style={styles.providerChoices}>
        <Button
          tone={provider === 'openai' ? 'accent' : 'quiet'}
          onPress={() => {
            setProvider('openai');
            setSaved(false);
          }}
          style={styles.providerButton}
        >
          OpenAI API
        </Button>
        <Button
          tone={provider === 'codex' ? 'accent' : 'quiet'}
          onPress={() => {
            setProvider('codex');
            setSaved(false);
          }}
          style={styles.providerButton}
        >
          Codex subscription
        </Button>
      </View>
      <View style={styles.fields}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose default assistant model and reasoning"
          onPress={() => setModelOpen(true)}
          style={({ pressed }) => [styles.modelField, pressed && styles.pressed]}
        >
          <View style={styles.modelCopy}>
            <Text style={styles.modelFieldLabel}>MODEL & REASONING</Text>
            <Text numberOfLines={1} style={styles.modelFieldValue}>
              {compactAssistantModelName(model)} {assistantReasoningName(thinkingLevel)}
            </Text>
          </View>
          <ChevronDown color={colors.accent} size={18} strokeWidth={2.2} />
        </Pressable>
        {provider === 'openai' ? (
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
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button loading={busy} onPress={() => void save()} style={styles.actionButton}>
          Save assistant settings
        </Button>
        {provider === 'openai' && hasApiKey ? (
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
        ) : provider === 'codex' && hasCodexAuth ? (
          <Button
            tone="danger"
            style={styles.clearButton}
            onPress={() =>
              void clearLocalAssistantCodexAuth()
                .then(() => {
                  setHasCodexAuth(false);
                  setSaved(false);
                })
                .catch((nextError) => setError(nextError.message))
            }
          >
            Clear Codex login
          </Button>
        ) : null}
      </View>
      {saved ? (
        <Text style={[styles.state, styles.saved]}>Saved on this phone</Text>
      ) : provider === 'codex' && !hasCodexAuth ? (
        <Text style={styles.state}>Codex login required</Text>
      ) : provider === 'openai' && !hasApiKey ? (
        <Text style={styles.state}>OpenAI API key required</Text>
      ) : null}
      <ProviderCredentialImport
        onImported={(credential) => {
          if (credential === 'groq') return;
          setProvider(credential);
          if (credential === 'openai') setHasApiKey(true);
          else setHasCodexAuth(true);
          setSaved(true);
        }}
      />
      <AssistantModelPicker
        open={modelOpen}
        currentProvider={provider}
        currentModel={model}
        currentThinkingLevel={thinkingLevel}
        options={localAssistantModelOptions(provider)}
        onClose={() => setModelOpen(false)}
        onSelect={(choice, selection) => {
          setModel(choice.id);
          setThinkingLevel(normalizeLocalAssistantThinkingLevel(choice.thinkingLevel));
          setSaved(false);
          if (selection === 'reasoning') setModelOpen(false);
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 6, padding: 14, shadowOpacity: 0, elevation: 0 },
  title: { marginTop: 6, marginBottom: 7 },
  providerChoices: { flexDirection: 'row', gap: 8, marginTop: 14 },
  providerButton: { flex: 1, minHeight: 40 },
  fields: { gap: 9, marginTop: 14 },
  modelField: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  modelCopy: { flex: 1, minWidth: 0 },
  modelFieldLabel: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  modelFieldValue: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 4 },
  input: {
    minHeight: 46,
    borderRadius: 6,
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
  pressed: { opacity: 0.72 },
});
