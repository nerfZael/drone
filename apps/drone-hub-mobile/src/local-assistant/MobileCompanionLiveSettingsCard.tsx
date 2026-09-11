import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { COMPANION_CAPABILITY, isGranted } from '@drone/device-protocol';
import { Button, ErrorBanner, Label } from '../components/Ui';
import { useMobileCompanion } from './MobileCompanionContext';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { useMobileCompanionLiveSettings } from './use-mobile-companion-live-settings';

export function MobileCompanionLiveSettingsCard() {
  const mesh = useMesh();
  const companion = useMobileCompanion();
  const hubs = mesh.devices.filter((device) => device.id !== mesh.identity?.id &&
    mesh.profile?.capabilitiesByDevice[device.id]?.some((capability) => capability.id === COMPANION_CAPABILITY.id &&
      capability.version === COMPANION_CAPABILITY.version && capability.operations.includes('live.settings.get')));
  const [selected, setSelected] = React.useState('');
  const target = hubs.find((device) => device.id === selected) ?? hubs[0];
  const preference = useMobileCompanionLiveSettings(target?.id ?? '');
  const self = mesh.devices.find((device) => device.id === mesh.identity?.id);
  const writable = Boolean(self && isGranted(self.grants, COMPANION_CAPABILITY.id, COMPANION_CAPABILITY.version, 'live.settings.update'));
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
});
