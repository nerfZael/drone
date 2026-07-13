import React from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorBanner, Label, textStyles } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';

export function DevicesScreen({ onPair }: { onPair(): void }) {
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
      <View>
        <Label>Topology</Label>
        <Text style={[textStyles.title, styles.title]}>Your devices</Text>
        <Text style={textStyles.body}>
          Green routes are connected now. Offline devices stay known and can reconnect without
          pairing again.
        </Text>
      </View>
      <ErrorBanner message={mesh.error} />
      <View style={styles.summary}>
        <View>
          <Text style={styles.number}>{mesh.devices.length}</Text>
          <Text style={styles.metric}>KNOWN</Text>
        </View>
        <View style={styles.summaryRule} />
        <View>
          <Text style={[styles.number, { color: colors.online }]}>
            {mesh.connectedDeviceIds.length}
          </Text>
          <Text style={styles.metric}>ROUTES LIVE</Text>
        </View>
      </View>
      <View style={styles.list}>
        {mesh.devices.map((device) => {
          const self = device.id === mesh.identity?.id;
          const connected = self || mesh.connectedDeviceIds.includes(device.id);
          return (
            <Card key={device.id} style={connected ? styles.connectedCard : undefined}>
              <View style={styles.deviceHead}>
                <View style={[styles.dot, connected && styles.dotConnected]} />
                <View style={styles.deviceCopy}>
                  <View style={styles.nameRow}>
                    <Text style={textStyles.heading}>{device.name}</Text>
                    {self ? <Text style={styles.self}>THIS PHONE</Text> : null}
                  </View>
                  <Text style={textStyles.mono}>
                    {device.platform} · {device.id}
                  </Text>
                </View>
              </View>
              {!self ? (
                <Text style={styles.permission}>
                  {device.grants.flatMap((grant) => grant.operations).length} operations allowed on
                  that destination
                </Text>
              ) : null}
            </Card>
          );
        })}
      </View>
      <Button onPress={onPair}>Add another route</Button>
      <Button
        tone="danger"
        onPress={() =>
          Alert.alert(
            'Forget this mesh?',
            'The phone identity remains, but all device routes are removed.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Forget', style: 'destructive', onPress: () => void mesh.forgetMesh() },
            ],
          )
        }
      >
        Forget mesh
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  title: { marginTop: 6, marginBottom: 8 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 22,
  },
  number: { color: colors.text, fontSize: 25, fontWeight: '800' },
  metric: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.3 },
  summaryRule: { width: 1, height: 34, backgroundColor: colors.border },
  list: { gap: 10 },
  connectedCard: { borderColor: '#285d4b' },
  deviceHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#496069', marginTop: 6 },
  dotConnected: {
    backgroundColor: colors.online,
    shadowColor: colors.online,
    shadowOpacity: 0.8,
    shadowRadius: 7,
  },
  deviceCopy: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  self: {
    color: colors.accent,
    backgroundColor: colors.accentDark,
    borderRadius: 5,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  permission: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 12,
    paddingTop: 10,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
});
