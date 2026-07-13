import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeshProvider, useMesh } from '../mesh/MeshContext';
import { DevicesScreen } from '../screens/DevicesScreen';
import { AssistantScreen } from '../screens/AssistantScreen';
import { DronesScreen } from '../screens/DronesScreen';
import { PairScreen } from '../screens/PairScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors } from '../theme';

type Tab = 'devices' | 'assistant' | 'drones' | 'pair' | 'settings';

function Shell() {
  const mesh = useMesh();
  const [tab, setTab] = React.useState<Tab>('devices');

  React.useEffect(() => {
    if (!mesh.profile) setTab('pair');
  }, [mesh.profile]);

  if (mesh.loading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadingText}>Preparing secure identity…</Text>
      </SafeAreaView>
    );
  }

  const content =
    !mesh.profile || tab === 'pair' ? (
      <ScrollView keyboardShouldPersistTaps="handled">
        <PairScreen onComplete={() => setTab('devices')} />
      </ScrollView>
    ) : tab === 'settings' ? (
      <SettingsScreen />
    ) : tab === 'drones' ? (
      <DronesScreen />
    ) : tab === 'assistant' ? (
      <AssistantScreen />
    ) : (
      <DevicesScreen onPair={() => setTab('pair')} />
    );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.mark}>
          <View style={styles.markInner} />
        </View>
        <Text style={styles.brand}>DRONE HUB</Text>
        <View style={[styles.route, mesh.connectedDeviceIds.length > 0 && styles.routeOnline]}>
          <Text style={styles.routeText}>
            {mesh.connectedDeviceIds.length > 0 ? 'MESH LIVE' : 'OFFLINE'}
          </Text>
        </View>
      </View>
      <View style={styles.content}>{content}</View>
      {mesh.profile ? (
        <View style={styles.nav}>
          <NavItem label="Devices" active={tab === 'devices'} onPress={() => setTab('devices')} />
          <NavItem
            label="Assistant"
            active={tab === 'assistant'}
            onPress={() => setTab('assistant')}
          />
          <NavItem label="Drones" active={tab === 'drones'} onPress={() => setTab('drones')} />
          <NavItem label="Pair" active={tab === 'pair'} onPress={() => setTab('pair')} />
          <NavItem
            label="Settings"
            active={tab === 'settings'}
            onPress={() => setTab('settings')}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function NavItem({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return (
    <Pressable onPress={onPress} style={styles.navItem}>
      <View style={[styles.navLine, active && styles.navLineActive]} />
      <Text style={[styles.navText, active && styles.navTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function MeshApp() {
  return (
    <MeshProvider>
      <Shell />
    </MeshProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { color: colors.muted, fontSize: 12 },
  header: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: 9,
  },
  mark: {
    width: 21,
    height: 21,
    borderRadius: 6,
    borderColor: colors.accent,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  markInner: { width: 7, height: 7, backgroundColor: colors.accent, borderRadius: 2 },
  brand: { color: colors.text, fontSize: 11, fontWeight: '900', letterSpacing: 1.7 },
  route: {
    marginLeft: 'auto',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  routeOnline: { borderColor: '#285d4b', backgroundColor: '#102a21' },
  routeText: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  content: { flex: 1 },
  nav: {
    minHeight: 63,
    paddingBottom: 8,
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  navLine: { width: 22, height: 2, borderRadius: 2, backgroundColor: 'transparent' },
  navLineActive: { backgroundColor: colors.accent },
  navText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  navTextActive: { color: colors.text },
});
