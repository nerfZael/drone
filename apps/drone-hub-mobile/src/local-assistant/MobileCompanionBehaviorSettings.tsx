import React from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { COMPANION_CAPABILITY, isGranted } from '@drone/device-protocol';
import { Button, ErrorBanner } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { MobileCompanionInstructionsSettings } from './MobileCompanionInstructionsSettings';

type Settings = { promptDeliveryMode: 'asap' | 'queue'; systemPrompt: string; enabledTools: string[] };
type Response = {
  settings: Settings; defaultSystemPrompt: string; maxSystemPromptChars: number;
  tools: Array<{ name: string; label: string; description: string; requires: string | null }>;
};

export function MobileCompanionBehaviorSettings({ deviceId }: { deviceId: string }) {
  const mesh = useMesh();
  const operations = mesh.profile?.capabilitiesByDevice[deviceId]?.find(item => item.id === COMPANION_CAPABILITY.id)?.operations ?? [];
  const self = mesh.devices.find(item => item.id === mesh.identity?.id);
  const allowed = (operation: string) => Boolean(self && isGranted(self.grants, COMPANION_CAPABILITY.id, COMPANION_CAPABILITY.version, operation));
  const supported = operations.includes('behavior.settings.get');
  const readable = supported && allowed('behavior.settings.get');
  const writable = operations.includes('behavior.settings.update') && allowed('behavior.settings.update');
  const [data, setData] = React.useState<Response | null>(null);
  const [draft, setDraft] = React.useState<Settings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const generation = React.useRef(0);
  const writing = React.useRef(false);
  const load = React.useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setError(''); setSaved(false);
    try {
      const result = await mesh.request(deviceId, 'companion', 'behavior.settings.get') as Response;
      if (token === generation.current) { setData(result); setDraft(result.settings); }
    } catch (reason) { if (token === generation.current) setError(String(reason instanceof Error ? reason.message : reason)); }
    finally { if (token === generation.current) setLoading(false); }
  }, [deviceId, mesh.request]);
  React.useEffect(() => {
    if (readable) void load(); else setLoading(false);
    return () => { generation.current++; };
  }, [readable, load]);
  const save = async () => {
    if (!draft || !data || !writable || writing.current) return;
    writing.current = true; setSaving(true); setError(''); setSaved(false);
    const token = ++generation.current;
    const update = Object.fromEntries((Object.keys(draft) as Array<keyof Settings>)
      .filter(key => JSON.stringify(draft[key]) !== JSON.stringify(data.settings[key])).map(key => [key, draft[key]]));
    try {
      const result = await mesh.request(deviceId, 'companion', 'behavior.settings.update', update) as Response;
      if (token === generation.current) { setData(result); setDraft(result.settings); setSaved(true); }
    } catch (reason) { if (token === generation.current) setError(String(reason instanceof Error ? reason.message : reason)); }
    finally { writing.current = false; if (token === generation.current) setSaving(false); }
  };
  const toggleTool = (name: string, enabled: boolean) => {
    if (!draft || !data) return;
    const next = new Set(draft.enabledTools);
    if (enabled) {
      next.add(name);
      const dependency = data.tools.find(tool => tool.name === name)?.requires;
      if (dependency) next.add(dependency);
    } else {
      next.delete(name);
      for (const tool of data.tools) if (tool.requires === name) next.delete(tool.name);
    }
    setDraft({ ...draft, enabledTools: data.tools.map(tool => tool.name).filter(tool => next.has(tool)) }); setSaved(false);
  };
  const busy = loading || saving || !writable;
  const dirty = Boolean(data && draft && JSON.stringify(data.settings) !== JSON.stringify(draft));
  return <View style={styles.section}>
    <Text style={styles.heading}>Shared Companion behavior</Text>
    <Text style={styles.copy}>Saved on this Hub for desktop and mobile. Changes apply to new backend runs; a running request keeps its settings.</Text>
    {!supported ? <Text style={styles.copy}>Update this Hub to configure shared behavior from mobile.</Text> : !readable ?
      <Text style={styles.copy}>Allow Companion behavior settings access for this phone in the Hub device settings.</Text> : <>
      {loading ? <ActivityIndicator accessibilityLabel="Loading shared behavior" /> : null}
      {data && draft ? <>
        <Text style={styles.heading}>Follow-up delivery</Text>
        <View style={styles.row}>{(['asap', 'queue'] as const).map(mode => <Button key={mode} tone="quiet" disabled={busy}
          onPress={() => { setDraft({ ...draft, promptDeliveryMode: mode }); setSaved(false); }}>{`${mode === 'asap' ? 'ASAP' : 'Queue'}${draft.promptDeliveryMode === mode ? ' ✓' : ''}`}</Button>)}</View>
        <Text style={styles.copy}>ASAP steers the backend at its next processing point. Queue waits for its current request to finish.</Text>
        <Text style={styles.heading}>Delegated backend system prompt</Text>
        <Text style={styles.copy}>Instructions for the task agent. Separate from the Live voice personality above.</Text>
        <ThemedTextInput accessibilityLabel="Companion backend system prompt" multiline editable={!busy} value={draft.systemPrompt}
          maxLength={data.maxSystemPromptChars} style={styles.input} onChangeText={systemPrompt => { setDraft({ ...draft, systemPrompt }); setSaved(false); }} />
        <Button tone="quiet" disabled={busy || draft.systemPrompt === data.defaultSystemPrompt} onPress={() => { setDraft({ ...draft, systemPrompt: data.defaultSystemPrompt }); setSaved(false); }}>Restore default backend prompt</Button>
        <Button tone="quiet" onPress={() => setToolsOpen(value => !value)}>{`Enabled tools (${draft.enabledTools.length})${toolsOpen ? ' · Hide' : ' · Show'}`}</Button>
        {toolsOpen ? <><Text style={styles.copy}>Enabling a tool also enables its required read tool. Disabling a read tool disables tools that depend on it. Hub permissions still apply.</Text>
          {data.tools.map(tool => <View key={tool.name} style={styles.row}><View style={{ flex: 1 }}><Text style={styles.heading}>{tool.label}</Text><Text style={styles.copy}>{tool.description}</Text></View>
            <Switch accessibilityLabel={tool.label} disabled={busy} value={draft.enabledTools.includes(tool.name)} onValueChange={enabled => toggleTool(tool.name, enabled)} /></View>)}
        </> : null}
        <Button disabled={busy || !dirty} loading={saving} onPress={() => void save()}>Save shared behavior</Button>
        {dirty ? <Text style={styles.copy}>Unsaved changes</Text> : saved ? <Text style={styles.copy}>Saved on this Hub.</Text> : null}
        {!writable ? <Text style={styles.copy}>Allow Companion behavior settings changes for this phone in the Hub device settings.</Text> : null}
      </> : null}
      {error ? <><ErrorBanner message={error} />{!data ? <Button tone="quiet" disabled={loading} onPress={() => void load()}>Retry</Button> : null}</> : null}
    </>}
    <MobileCompanionInstructionsSettings key={deviceId} deviceId={deviceId} supported={operations.includes('instructions.get')}
      readable={allowed('instructions.get')} writable={operations.includes('instructions.update') && allowed('instructions.update')} />
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 16 },
  heading: { color: colors.text, fontSize: 13, fontWeight: '600' },
  copy: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { minHeight: 120, padding: 10, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, textAlignVertical: 'top' },
});
