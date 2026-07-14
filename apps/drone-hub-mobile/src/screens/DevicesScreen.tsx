import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Laptop from 'lucide-react-native/icons/laptop';
import Network from 'lucide-react-native/icons/network';
import Smartphone from 'lucide-react-native/icons/smartphone';
import { Card, ErrorBanner, Label, textStyles } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';

export function DevicesScreen() {
  const mesh = useMesh();
  const [refreshing, setRefreshing] = React.useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await mesh.refreshDevices();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.intro}>
        <View style={styles.introCopy}>
          <Label>Private mesh</Label>
          <Text style={styles.title}>Trusted devices</Text>
          <Text style={textStyles.body}>Signed routes that can reach this phone.</Text>
        </View>
        <View style={styles.summary}>
          <Network color={colors.accent} size={16} strokeWidth={2.2} />
          <Text style={styles.summaryValue}>{mesh.devices.length}</Text>
        </View>
      </View>
      <ErrorBanner message={mesh.error} />
      <View style={styles.list}>
        {mesh.devices.map((device) => {
          const self = device.id === mesh.identity?.id;
          const connected = self || mesh.connectedDeviceIds.includes(device.id);
          const DeviceIcon = self || /android|ios|phone/i.test(device.platform)
            ? Smartphone
            : Laptop;
          return (
            <Card
              key={device.id}
              style={{ ...styles.deviceCard, ...(connected ? styles.connectedCard : {}) }}
            >
              <View style={styles.deviceHead}>
                <View style={[styles.deviceIcon, connected && styles.deviceIconConnected]}>
                  <DeviceIcon
                    color={connected ? colors.online : colors.muted}
                    size={18}
                    strokeWidth={2}
                  />
                </View>
                <View style={styles.deviceCopy}>
                  <View style={styles.nameRow}>
                    <Text numberOfLines={1} style={styles.deviceName}>
                      {device.name}
                    </Text>
                    {self ? <Text style={styles.self}>THIS PHONE</Text> : null}
                  </View>
                  <Text numberOfLines={1} style={[textStyles.mono, styles.deviceId]}>
                    {device.platform} · {device.id}
                  </Text>
                </View>
                <View style={[styles.status, connected && styles.statusConnected]}>
                  <View style={[styles.dot, connected && styles.dotConnected]} />
                  <Text style={[styles.statusText, connected && styles.statusTextConnected]}>
                    {connected ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>
              {!self ? (
                <Text style={styles.permission}>
                  {device.grants.flatMap((grant) => grant.operations).length} operations allowed
                </Text>
              ) : null}
            </Card>
          );
        })}
        {mesh.devices.length === 0 ? (
          <View style={styles.empty}>
            <Network color={colors.subtle} size={28} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>No trusted devices yet</Text>
            <Text style={styles.emptyBody}>Pull to refresh after pairing a Drone Hub.</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, gap: 16 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 2 },
  introCopy: { flex: 1, minWidth: 0 },
  title: {
    color: colors.textStrong,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 5,
    marginBottom: 5,
  },
  summary: {
    minWidth: 54,
    height: 42,
    paddingHorizontal: 11,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.accentDark,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  summaryValue: { color: colors.accent, fontSize: 15, fontWeight: '900' },
  list: { gap: 10 },
  deviceCard: { padding: 14, borderRadius: 16 },
  connectedCard: { borderColor: colors.onlineBorder },
  deviceHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  deviceIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface1,
  },
  deviceIconConnected: { backgroundColor: colors.onlineDark },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.subtle },
  dotConnected: {
    backgroundColor: colors.online,
    shadowColor: colors.online,
    shadowOpacity: 0.7,
    shadowRadius: 6,
  },
  deviceCopy: { flex: 1, gap: 2, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  deviceName: { color: colors.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  deviceId: { fontSize: 9 },
  self: {
    color: colors.accent,
    backgroundColor: colors.accentDark,
    borderRadius: 5,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  permission: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 9,
    marginLeft: 51,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.whiteWash,
  },
  statusConnected: { backgroundColor: colors.onlineDark },
  statusText: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  statusTextConnected: { color: colors.online },
  empty: { alignItems: 'center', paddingVertical: 64, paddingHorizontal: 24 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 13 },
  emptyBody: { color: colors.muted, fontSize: 12, marginTop: 5, textAlign: 'center' },
});
