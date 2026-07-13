import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorBanner, Label, textStyles } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';

export function SettingsScreen() {
  const mesh = useMesh();
  const [checking, setChecking] = React.useState(false);
  const [results, setResults] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  const diagnose = async () => {
    setChecking(true);
    setError(null);
    const next: Record<string, string> = {};
    await Promise.all(
      (mesh.profile?.connections ?? []).map(async (connection) => {
        const started = Date.now();
        try {
          await mesh.request(connection.deviceId, 'device-core', 'device.ping', {
            echo: 'diagnostics',
          });
          next[connection.deviceId] = `${Date.now() - started} ms`;
        } catch (nextError: any) {
          next[connection.deviceId] = nextError?.message ?? 'Unavailable';
        }
      }),
    );
    setResults(next);
    setChecking(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View>
        <Label>Settings & diagnostics</Label>
        <Text style={[textStyles.title, styles.title]}>Know where the route ends.</Text>
        <Text style={textStyles.body}>
          These addresses are connection hints. The P-256 device keys—not URLs or names—prove
          identity.
        </Text>
      </View>
      <ErrorBanner message={error ?? mesh.error} />
      <Card>
        <Label>This phone</Label>
        <Text style={[textStyles.heading, styles.cardTitle]}>
          {mesh.identity?.name ?? 'Android phone'}
        </Text>
        <Text style={textStyles.mono}>{mesh.identity?.id}</Text>
      </Card>
      <Card>
        <Label>Device network</Label>
        <Text style={[textStyles.mono, styles.network]}>{mesh.profile?.networkId}</Text>
      </Card>
      <View style={styles.routes}>
        {(mesh.profile?.connections ?? []).map((connection) => (
          <Card key={connection.deviceId}>
            <View style={styles.routeHead}>
              <Text style={textStyles.heading}>
                {mesh.devices.find((device) => device.id === connection.deviceId)?.name ??
                  connection.deviceId}
              </Text>
              <View style={styles.routeStatus}>
                <Text style={styles.role}>{connection.role}</Text>
                <Text style={styles.result}>
                  {results[connection.deviceId] ??
                    (mesh.connectedDeviceIds.includes(connection.deviceId)
                      ? 'CONNECTED'
                      : 'OFFLINE')}
                </Text>
              </View>
            </View>
            <Text style={[textStyles.mono, styles.endpoint]}>{connection.endpoint}</Text>
            {connection.role === 'backup' ? (
              <View style={styles.primaryAction}>
                <Button tone="quiet" onPress={() => void mesh.makePrimary(connection.deviceId)}>
                  Make primary bridge
                </Button>
              </View>
            ) : null}
          </Card>
        ))}
      </View>
      <Button onPress={() => void diagnose()} loading={checking}>
        Run connection check
      </Button>
      <Card>
        <Label>Prototype security</Label>
        <Text style={[textStyles.body, styles.security]}>
          The private identity is encrypted by Android secure storage. Requests are signed, expire
          after one minute, and are checked again on the target. Forwarded payloads currently rely
          on TLS and are visible to a bridge Hub; destination-only encryption is a later production
          gate.
        </Text>
      </Card>
      <Button
        tone="danger"
        onPress={() =>
          Alert.alert('Forget device mesh?', 'You will need a new pairing code to reconnect.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Forget',
              style: 'destructive',
              onPress: () =>
                void mesh.forgetMesh().catch((nextError) => setError(nextError.message)),
            },
          ])
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
  cardTitle: { marginTop: 5, marginBottom: 5 },
  network: { marginTop: 7, color: colors.accent },
  routes: { gap: 9 },
  routeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  routeStatus: { alignItems: 'flex-end', gap: 3 },
  role: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  result: { color: colors.online, fontSize: 9, fontWeight: '900', maxWidth: '45%' },
  endpoint: { marginTop: 8 },
  primaryAction: { marginTop: 12 },
  security: { marginTop: 8 },
});
