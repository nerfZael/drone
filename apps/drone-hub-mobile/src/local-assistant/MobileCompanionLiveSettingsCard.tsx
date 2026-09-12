import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { COMPANION_CAPABILITY, isGranted } from '@drone/device-protocol';
import { Button, ErrorBanner, Label } from '../components/Ui';
import { useMobileCompanion } from './MobileCompanionContext';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { useMobileCompanionLiveSettings } from './use-mobile-companion-live-settings';
import { ThemedTextInput } from '../components/ThemedTextInput';

export function MobileCompanionLiveSettingsCard() {
  const mesh = useMesh();
  const companion = useMobileCompanion();
  const hubs = mesh.devices.filter((device) => device.id !== mesh.identity?.id &&
    mesh.profile?.capabilitiesByDevice[device.id]?.some((capability) => capability.id === COMPANION_CAPABILITY.id &&
      capability.version === COMPANION_CAPABILITY.version && capability.operations.includes('live.settings.get')));
  const [selected, setSelected] = React.useState('');
  const target = hubs.find((device) => device.id === selected) ?? hubs[0];
  const targetCapability = target ? mesh.profile?.capabilitiesByDevice[target.id]?.find((capability) =>
    capability.id === COMPANION_CAPABILITY.id && capability.version === COMPANION_CAPABILITY.version) : undefined;
  const promptSupported = Boolean(targetCapability?.operations.includes('live.prompt.get'));
  const self = mesh.devices.find((device) => device.id === mesh.identity?.id);
  const promptReadable = Boolean(self && isGranted(self.grants, COMPANION_CAPABILITY.id, COMPANION_CAPABILITY.version, 'live.prompt.get'));
  const preference = useMobileCompanionLiveSettings(target?.id ?? '', promptSupported && promptReadable);
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [promptSaved, setPromptSaved] = React.useState(false);
  React.useEffect(() => {
    if (preference.saving) return;
    setSystemPrompt(preference.systemPrompt);
    setPromptSaved(false);
  }, [preference.systemPrompt]);
  const writable = Boolean(self && isGranted(self.grants, COMPANION_CAPABILITY.id, COMPANION_CAPABILITY.version, 'live.settings.update'));
  const promptWritable = Boolean(self && isGranted(self.grants, COMPANION_CAPABILITY.id, COMPANION_CAPABILITY.version, 'live.prompt.update'));
  return <View style={styles.card}>
    <Label>Companion Live voice</Label>
    {hubs.length > 1 ? <View style={styles.targets}>{hubs.map((hub) => <Pressable key={hub.id}
      accessibilityRole="radio" accessibilityState={{ selected: hub.id === target?.id }}
      disabled={preference.saving} onPress={() => setSelected(hub.id)}>
      <Text style={[styles.copy, hub.id === target?.id && styles.selected]}>{hub.name}</Text>
    </Pressable>)}</View> : null}
    {target ? <>
      <View style={styles.row}>
        <Text style={styles.copy}>Live voice on {target.name}</Text>
        {preference.loading || preference.saving ? <ActivityIndicator color={colors.accent} /> : null}
        <Switch accessibilityLabel="Companion Live voice" value={preference.enabled}
          disabled={preference.loading || preference.saving || !writable || Boolean(preference.error)}
          onValueChange={(enabled) => { void preference.save(enabled).then((saved) => {
            if (saved === false && companion.live.targetDeviceId === target.id) companion.live.stop();
          }); }} />
      </View>
      <Text style={styles.copy}>Off by default. Saves immediately on this Hub and also changes desktop Companion. Tap the Companion microphone to start a two-way Live conversation. The Hub’s Companion model and ASAP/Queue setting still apply.</Text>
      <Text style={styles.copy}>Live uses the Hub’s OpenAI API key. Voice ends when the app goes into the background.</Text>
      {promptSupported && promptReadable ? <><View style={styles.promptHeader}>
        <View style={styles.promptCopy}>
          <Text style={styles.promptTitle}>GPT-Live system prompt</Text>
          <Text style={styles.copy}>Edit the complete GPT-Live system prompt, including personality, speaking style, and delegation behavior. Drone Hub sends this text as saved without appending instructions. It stays separate from the delegated Companion backend prompt. Tool permissions remain enforced by Drone Hub.</Text>
        </View>
        <Button tone="quiet" disabled={preference.saving || !promptWritable || systemPrompt === preference.defaultSystemPrompt}
          onPress={() => { setSystemPrompt(preference.defaultSystemPrompt); setPromptSaved(false); }}>Restore</Button>
      </View>
      <ThemedTextInput accessibilityLabel="GPT-Live Companion system prompt" value={systemPrompt}
        editable={!preference.saving && promptWritable} multiline maxLength={preference.maxSystemPromptChars}
        onChangeText={(value) => { setSystemPrompt(value); setPromptSaved(false); }}
        placeholder="Describe the voice personality and speaking style"
        placeholderTextColor={colors.muted} style={styles.promptInput} />
      <Text style={styles.counter}>{systemPrompt.length} / {preference.maxSystemPromptChars}</Text>
      <Button disabled={preference.saving || !promptWritable || systemPrompt === preference.systemPrompt}
        loading={preference.saving} onPress={() => void preference.saveSystemPrompt(systemPrompt).then(setPromptSaved)}>
        Save Live prompt
      </Button>
      <Text style={styles.copy}>{promptSaved && systemPrompt === preference.systemPrompt
        ? 'Saved. Applies when the next Live session starts.'
        : systemPrompt !== preference.systemPrompt ? 'Unsaved changes. Active Live sessions are unchanged.' : 'Applies to new Live sessions.'}</Text>
      {!promptWritable ? <Text style={styles.copy}>Allow Live prompt changes for this phone in the Hub device settings.</Text> : null}</> :
        <Text style={styles.copy}>{promptSupported
          ? 'Allow Live prompt access for this phone in the Hub device settings.'
          : 'Update the selected Drone Hub to edit the GPT-Live system prompt from mobile.'}</Text>}
      {!writable ? <Text style={styles.copy}>Allow Live settings changes for this phone in the Hub device settings.</Text> : null}
      {preference.error ? <><ErrorBanner message={preference.error} /><Button tone="quiet" onPress={() => void preference.load().catch(() => undefined)}>Retry</Button></> : null}
    </> : <Text style={styles.copy}>Connect to an updated Drone Hub to configure Companion Live voice.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.panelRaised },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  targets: { gap: 10 }, selected: { color: colors.accent },
  promptHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  promptCopy: { flex: 1, gap: 4 },
  promptTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  promptInput: { minHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.text, backgroundColor: colors.panel, padding: 10, textAlignVertical: 'top' },
  counter: { color: colors.muted, fontSize: 11, textAlign: 'right' },
});
