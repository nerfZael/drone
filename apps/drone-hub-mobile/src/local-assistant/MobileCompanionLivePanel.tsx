import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Ui';
import { colors } from '../theme';
import type { useMobileCompanionLive } from './use-mobile-companion-live';

export function MobileCompanionLivePanel({ live, stopTurn, working }: {
  live: ReturnType<typeof useMobileCompanionLive>; stopTurn(): void; working: boolean;
}) {
  const active = live.status === 'connecting' || live.status === 'listening';
  if (!active && !live.error && !live.captions) return null;
  return <View style={styles.panel} accessibilityLabel="Companion Live voice">
    <View style={styles.row}>
      {live.status === 'connecting' ? <ActivityIndicator color={colors.accent} size="small" /> : null}
      <Text style={styles.title}>{live.status === 'connecting' ? live.muted ? 'Connecting · Mic muted' : live.capturing ? 'Recording · Connecting Live…' : 'Opening microphone…' : active ? live.muted ? 'Live · Mic muted' : 'Live · Listening' : 'Live ended'}</Text>
    </View>
    <Text style={styles.copy}>{live.targetName}{live.backendModel ? ` · ${live.backendModel}` : ''}</Text>
    {live.error ? <Text style={styles.error}>{live.error}</Text> : null}
    {live.captions ? <Text selectable style={styles.copy}>{live.captions}</Text> : <Text style={styles.copy}>Speech is captured while Live connects. Captions appear once connected.</Text>}
    {live.queued > 0 ? <Text style={styles.copy}>Waiting for transcript. Follow-up delivery follows Companion settings.</Text> : null}
    <View style={styles.row}>
      {active ? <>
        <Button tone="quiet" onPress={live.toggleMute}>{live.muted ? 'Unmute' : 'Mute'}</Button>
        <Button tone="quiet" onPress={live.stop}>End voice</Button>
      </> : null}
      {working ? <Button tone="quiet" onPress={stopTurn}>Stop Companion turn</Button> : null}
    </View>
    {active ? <Text style={styles.copy}>End voice keeps backend work running. Close Companion cancels it. Start a new voice conversation after switching workspaces.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.accentBorder },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  copy: { color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  error: { color: colors.danger, fontSize: 11 },
});
