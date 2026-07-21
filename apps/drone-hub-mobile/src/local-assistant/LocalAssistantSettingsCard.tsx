import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Check from 'lucide-react-native/icons/check';
import ExternalLink from 'lucide-react-native/icons/external-link';
import LogIn from 'lucide-react-native/icons/log-in';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { Button, ErrorBanner, Label, textStyles } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { ProviderCredentialImport } from '../provider-credentials/ProviderCredentialImport';
import { colors } from '../theme';
import { assistantReasoningName, compactAssistantModelName } from './AssistantComposer';
import { AssistantModelPicker } from './AssistantModelPicker';
import {
  clearLocalAssistantApiKey,
  loadLocalAssistantSettings,
  saveLocalAssistantProvider,
  saveLocalAssistantSettings,
} from './local-assistant-settings';
import {
  clearLocalAssistantCodexAuth,
  saveLocalAssistantCodexAuth,
} from './local-assistant-codex-auth';
import {
  completeCodexDeviceAuthorization,
  requestCodexDeviceAuthorization,
  type CodexDeviceAuthorization,
} from './codex-device-auth';
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
  const [codexAuthorization, setCodexAuthorization] =
    React.useState<CodexDeviceAuthorization | null>(null);
  const [codexSigningIn, setCodexSigningIn] = React.useState(false);
  const codexSignInAbortRef = React.useRef<AbortController | null>(null);

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

  React.useEffect(
    () => () => {
      const controller = codexSignInAbortRef.current;
      codexSignInAbortRef.current = null;
      controller?.abort();
    },
    [],
  );

  const cancelCodexSignIn = () => {
    codexSignInAbortRef.current?.abort();
    codexSignInAbortRef.current = null;
    setCodexAuthorization(null);
    setCodexSigningIn(false);
  };

  const finishCodexSignIn = async (
    authorization: CodexDeviceAuthorization,
    controller: AbortController,
  ) => {
    try {
      const auth = await completeCodexDeviceAuthorization(authorization, controller.signal);
      if (controller.signal.aborted) return;
      await saveLocalAssistantProvider('codex');
      await saveLocalAssistantCodexAuth(auth);
      if (controller.signal.aborted) return;
      setProvider('codex');
      setHasCodexAuth(true);
      setSaved(true);
      setCodexAuthorization(null);
    } catch (nextError: any) {
      if (nextError?.name !== 'AbortError') setError(nextError?.message ?? String(nextError));
    } finally {
      if (codexSignInAbortRef.current === controller) {
        codexSignInAbortRef.current = null;
        setCodexAuthorization(null);
        setCodexSigningIn(false);
      }
    }
  };

  const startCodexSignIn = async () => {
    cancelCodexSignIn();
    setError(null);
    setSaved(false);
    setCodexSigningIn(true);
    const controller = new AbortController();
    codexSignInAbortRef.current = controller;
    try {
      const authorization = await requestCodexDeviceAuthorization(controller.signal);
      if (controller.signal.aborted) return;
      setCodexAuthorization(authorization);
      void finishCodexSignIn(authorization, controller);
    } catch (nextError: any) {
      if (nextError?.name !== 'AbortError') setError(nextError?.message ?? String(nextError));
      if (codexSignInAbortRef.current === controller) {
        codexSignInAbortRef.current = null;
        setCodexSigningIn(false);
      }
    }
  };

  const openCodexSignIn = async () => {
    if (!codexAuthorization) return;
    try {
      await Linking.openURL(codexAuthorization.verificationUrl);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'Could not open the OpenAI sign-in page');
    }
  };

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
    <View style={styles.section}>
      <Label>Built-in agent on this phone</Label>
      <Text style={[textStyles.heading, styles.title]}>Direct model connection</Text>
      <Text style={textStyles.body}>
        Credentials stay in Android secure storage and are sent only to the selected model service.
        Sign in directly on this phone, enter an API key, or explicitly copy credentials from a
        trusted Hub.
      </Text>
      <ErrorBanner message={error} />
      <View style={styles.providerChoices}>
        <Button
          tone={provider === 'openai' ? 'accent' : 'quiet'}
          onPress={() => {
            cancelCodexSignIn();
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
          accessibilityLabel="Choose default built-in model and reasoning"
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
          <ThemedTextInput
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
        <Button
          icon={Check}
          loading={busy}
          onPress={() => void save()}
          style={styles.actionButton}
        >
          Save built-in settings
        </Button>
        {provider === 'openai' && hasApiKey ? (
          <Button
            tone="danger"
            icon={Trash2}
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
            icon={Trash2}
            style={styles.clearButton}
            onPress={() =>
              void (async () => {
                cancelCodexSignIn();
                await clearLocalAssistantCodexAuth();
              })()
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
      {provider === 'codex' && !hasCodexAuth ? (
        codexAuthorization ? (
          <View style={styles.codexSignInCard}>
            <Text style={styles.codexSignInEyebrow}>ONE-TIME CODE</Text>
            <Text selectable style={styles.codexUserCode}>
              {codexAuthorization.userCode}
            </Text>
            <Text style={styles.codexSignInHelp}>
              Open OpenAI, sign in, and enter this code. Keep this screen open; Drone Hub will
              finish automatically.
            </Text>
            <View style={styles.codexSignInActions}>
              <Button icon={ExternalLink} onPress={() => void openCodexSignIn()}>
                Open OpenAI sign-in
              </Button>
              <Button tone="quiet" onPress={cancelCodexSignIn}>
                Cancel
              </Button>
            </View>
            <Text style={styles.codexWaiting}>Waiting securely for OpenAI…</Text>
          </View>
        ) : (
          <Button
            tone="quiet"
            icon={LogIn}
            loading={codexSigningIn}
            onPress={() => void startCodexSignIn()}
            style={styles.codexSignInButton}
          >
            Sign in with Codex on this phone
          </Button>
        )
      ) : null}
      {saved ? (
        <Text style={[styles.state, styles.saved]}>Saved on this phone</Text>
      ) : provider === 'codex' && !hasCodexAuth ? (
        <Text style={styles.state}>Codex login required</Text>
      ) : provider === 'openai' && !hasApiKey ? (
        <Text style={styles.state}>OpenAI API key required</Text>
      ) : null}
      <ProviderCredentialImport
        onImportStarted={(credential) => {
          if (credential !== 'groq') cancelCodexSignIn();
        }}
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
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingVertical: 18 },
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
    borderColor: colors.borderStrong,
    backgroundColor: colors.whiteWashSoft,
  },
  modelCopy: { flex: 1, minWidth: 0 },
  modelFieldLabel: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  modelFieldValue: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 4 },
  input: {
    minHeight: 46,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.whiteWashSoft,
    color: colors.text,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  actions: { gap: 8, marginTop: 10 },
  actionButton: { alignSelf: 'stretch' },
  clearButton: { alignSelf: 'flex-start', minHeight: 42 },
  codexSignInButton: { alignSelf: 'stretch', marginTop: 10 },
  codexSignInCard: {
    gap: 9,
    marginTop: 12,
    padding: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.whiteWashSoft,
  },
  codexSignInEyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  codexUserCode: {
    color: colors.textStrong,
    fontSize: 27,
    fontWeight: '900',
    letterSpacing: 3,
  },
  codexSignInHelp: { color: colors.text, fontSize: 12, lineHeight: 18 },
  codexSignInActions: { gap: 8 },
  codexWaiting: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  state: { color: colors.warning, fontSize: 10, fontWeight: '800', marginTop: 10 },
  saved: { color: colors.online },
  pressed: { opacity: 0.72 },
});
