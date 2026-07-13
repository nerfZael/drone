import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, ErrorBanner, textStyles } from '../components/Ui';
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
      <ErrorBanner message={mesh.error} />
      <View style={styles.list}>
        {mesh.devices.map((device) => {
          const self = device.id === mesh.identity?.id;
          const connected = self || mesh.connectedDeviceIds.includes(device.id);
          return (
            <Card
              key={device.id}
              style={{ ...styles.deviceCard, ...(connected ? styles.connectedCard : {}) }}
            >
              <View style={styles.deviceHead}>
                <View style={[styles.dot, connected && styles.dotConnected]} />
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
              </View>
              {!self ? (
                <Text style={styles.permission}>
                  {device.grants.flatMap((grant) => grant.operations).length} operations allowed
                </Text>
              ) : null}
            </Card>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 14, gap: 8 },
  list: { gap: 7 },
  deviceCard: { padding: 11, borderRadius: 12 },
  connectedCard: { borderColor: '#285d4b' },
  deviceHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#496069' },
  dotConnected: {
    backgroundColor: colors.online,
    shadowColor: colors.online,
    shadowOpacity: 0.8,
    shadowRadius: 7,
  },
  deviceCopy: { flex: 1, gap: 2, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  deviceName: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
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
    fontSize: 9,
    marginTop: 6,
    marginLeft: 16,
  },
});
