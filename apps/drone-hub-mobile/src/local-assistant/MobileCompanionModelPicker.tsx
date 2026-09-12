import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';
import { formatReasoningLabel } from '@drone/assistant-chat';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';

const PROVIDERS = { openai: 'OpenAI', codex: 'Codex', gemini: 'Gemini', openrouter: 'OpenRouter' } as const;
type Provider = keyof typeof PROVIDERS;
type Choice = { provider: Provider; id: string; name: string; thinkingLevel: string };
type Settings = { provider: Provider; model: string; thinkingLevel: string };
type Response = { settings: Settings; models: Choice[]; credentials: Record<Provider, boolean> };

/** Mounted afresh when the menu opens, so desktop changes are picked up too. */
export function MobileCompanionModelPicker({ deviceId }: { deviceId: string }) {
  const { request, profile } = useMesh();
  const supported = Boolean(deviceId && profile?.capabilitiesByDevice[deviceId]?.some((capability) =>
    capability.id === COMPANION_CAPABILITY.id &&
    capability.operations.includes('model.settings.get') && capability.operations.includes('model.settings.update')));
  const [data, setData] = React.useState<Response | null>(null);
  const [providerDraft, setProviderDraft] = React.useState<Provider | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [modelsOpen, setModelsOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const generation = React.useRef(0);
  const writing = React.useRef(false);
  const load = React.useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const response = await request(deviceId, COMPANION_CAPABILITY.id, 'model.settings.get') as Response;
      if (token === generation.current) setData(response);
    } catch (error) {
      if (token === generation.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [deviceId, request]);
  React.useEffect(() => {
    if (supported) void load();
    return () => { generation.current++; };
  }, [load, supported]);

  const select = async (choice: Choice) => {
    if (writing.current || loading || !data) return;
    writing.current = true;
    const token = ++generation.current;
    setSaving(true);
    setError('');
    try {
      const response = await request(deviceId, COMPANION_CAPABILITY.id, 'model.settings.update', {
        provider: choice.provider, model: choice.id, thinkingLevel: choice.thinkingLevel,
      }) as Response;
      if (token !== generation.current) return;
      setData(response);
      setProviderDraft(null);
      setModelsOpen(false);
      setQuery('');
    } catch (error) {
      if (token === generation.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      writing.current = false;
      if (token === generation.current) setSaving(false);
    }
  };
  const provider = providerDraft ?? data?.settings.provider ?? 'openai';
  const currentModel = provider === data?.settings.provider ? data.settings.model : '';
  const options = (data?.models ?? []).filter((choice) => choice.provider === provider);
  const models = options.filter((choice, index) => options.findIndex((other) => other.id === choice.id) === index);
  const reasoning = options.filter((choice) => choice.id === currentModel);
  const modelName = models.find((choice) => choice.id === currentModel)?.name ?? currentModel;
  const busy = loading || saving;
  const button = (label: string, selected: boolean, onPress: () => void, key = label) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={onPress}
      style={[styles.choice, selected && styles.selected]}>
      <Text style={[styles.text, selected && styles.selectedText]}>{label}{selected ? ' ✓' : ''}</Text>
    </Pressable>
  );
  if (!supported) return <Text style={styles.note}>Update the Hub and allow Companion model settings to choose a provider and model.</Text>;
  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Provider</Text>
      <View style={styles.row}>
        {(Object.entries(PROVIDERS) as [Provider, string][]).map(([id, label]) => button(label, provider === id, () => {
          setProviderDraft(id); setModelsOpen(true); setQuery('');
        }))}
      </View>
      <Text style={styles.heading}>Model</Text>
      {button(modelName || 'Choose model', false, () => setModelsOpen((open) => !open))}
      {modelsOpen || !currentModel ? <>
        <TextInput accessibilityLabel="Search Companion models" placeholder="Search models"
          placeholderTextColor={colors.muted} value={query} onChangeText={setQuery}
          autoCapitalize="none" autoCorrect={false} style={[styles.choice, styles.text]} />
        {models.filter((choice) => `${choice.name} ${choice.id}`.toLowerCase().includes(query.trim().toLowerCase())).map((choice) =>
          button(choice.name, choice.id === currentModel, () => {
            const exact = options.find((option) => option.id === choice.id && option.thinkingLevel === data?.settings.thinkingLevel);
            void select(exact ?? choice);
          }, choice.id))}
        {!loading && models.length === 0 ? <Text style={styles.note}>No models available for this provider.</Text> : null}
        {models.length > 0 && !models.some((choice) => `${choice.name} ${choice.id}`.toLowerCase().includes(query.trim().toLowerCase()))
          ? <Text style={styles.note}>No matching models.</Text> : null}
      </> : null}
      {reasoning.length > 0 ? <>
        <Text style={styles.heading}>Reasoning</Text>
        <View style={styles.row}>{reasoning.map((choice) => button(formatReasoningLabel(choice.thinkingLevel),
          choice.thinkingLevel === data?.settings.thinkingLevel, () => void select(choice), choice.thinkingLevel))}</View>
      </> : null}
      {busy ? <View style={styles.row}><ActivityIndicator color={colors.accent} /><Text style={styles.note}>{saving ? 'Saving…' : 'Loading models…'}</Text></View> : null}
      {data && !data.credentials[provider] ? <Text style={styles.error}>{PROVIDERS[provider]} credentials are missing. Add them in General settings on the Hub.</Text> : null}
      {error ? <View accessibilityRole="alert"><Text style={styles.error}>{error}</Text>
        {data ? <Text style={styles.note}>Choose the model again to retry.</Text> : button('Retry', false, () => void load())}
      </View> : null}
      <Text style={styles.note}>Choose a model to save. Shared with desktop; applies to new Companion runs.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: 12, gap: 6 },
  heading: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  choice: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  selected: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  text: { color: colors.text, fontSize: 13 },
  selectedText: { color: colors.accentAlt },
  note: { color: colors.muted, fontSize: 11, lineHeight: 16, paddingVertical: 4 },
  error: { color: colors.danger, fontSize: 12 },
});
