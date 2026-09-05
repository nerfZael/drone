import React from 'react';
import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Card, ErrorBanner, textStyles } from '../components/Ui';
import { TopTabs } from '../components/TopTabs';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { useMesh } from '../mesh/MeshContext';
import { readPairingCode } from '../mesh/pair-device';
import { discoverHub, type DiscoveredHub } from '../mesh/discover-hub';
import { mobileDeviceIdForPublicKey } from '../security/device-identity';
import { colors } from '../theme';
import { PhoneDiscoverabilityCard } from './PhoneDiscoverabilityCard';

export function PairScreen({ onComplete }: { onComplete(): void }) {
  const mesh = useMesh();
  const updatingConnection = Boolean(mesh.profile);
  const [method, setMethod] = React.useState<'nearby' | 'qr' | 'address' | 'code'>('nearby');
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = React.useState('');
  const [scanning, setScanning] = React.useState(false);
  const [pairing, setPairing] = React.useState(false);
  const [address, setAddress] = React.useState('');
  const [finding, setFinding] = React.useState(false);
  const [hub, setHub] = React.useState<DiscoveredHub | null>(null);
  const [status, setStatus] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const pairingRef = React.useRef(false);
  const alive = React.useRef(true);
  const cameraPending = React.useRef(false);
  const methodRef = React.useRef(method);
  methodRef.current = method;

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);

  const pair = async (raw: string, discovered = false) => {
    if (pairingRef.current) return;
    pairingRef.current = true;
    setPairing(true);
    setScanning(false);
    setError(null);
    setStatus(
      updatingConnection
        ? 'Connecting… New connections need approval on the other Hub.'
        : 'Approve this phone on the other Hub.',
    );
    const controller = new AbortController();
    abort.current = controller;
    try {
      await mesh.pair(readPairingCode(raw.trim()), controller.signal, discovered);
      if (alive.current && !controller.signal.aborted) onComplete();
    } catch (nextError: any) {
      if (alive.current) {
        if (!controller.signal.aborted) setError(nextError?.message ?? String(nextError));
        setStatus('');
      }
    } finally {
      pairingRef.current = false;
      if (alive.current) {
        setPairing(false);
        setStatus('');
      }
    }
  };

  const findHub = async () => {
    if (pairingRef.current) return;
    pairingRef.current = true;
    setFinding(true);
    setHub(null);
    setError(null);
    setStatus('Looking for a DroneHub on Tailscale…');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const found = await discoverHub(address, {
        nonce: Crypto.randomUUID(),
        signal: controller.signal,
        keyId: mobileDeviceIdForPublicKey,
        fetchImpl: expoFetch as unknown as typeof fetch,
      });
      if (alive.current && !controller.signal.aborted) setHub(found);
    } catch (error: any) {
      if (alive.current && !controller.signal.aborted) setError(error?.message ?? String(error));
    } finally {
      pairingRef.current = false;
      if (alive.current) {
        setFinding(false);
        setStatus('');
      }
    }
  };

  const requestHubApproval = (selectedHub = hub) => {
    if (!selectedHub) return;
    void pair(
      JSON.stringify({
        version: 1,
        endpoint: selectedHub.endpoint,
        inviterDeviceId: selectedHub.id,
        token: Array.from(Crypto.getRandomBytes(32), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      }),
      true,
    );
  };

  const openScanner = async () => {
    if (cameraPending.current) return;
    cameraPending.current = true;
    try {
      const granted = permission?.granted || (await requestPermission()).granted;
      if (!alive.current || methodRef.current !== 'qr') return;
      if (!granted) {
        setError('Allow camera access to scan, or use Code instead.');
      } else {
        setError(null);
        setScanning(true);
      }
    } catch (error: any) {
      if (alive.current && methodRef.current === 'qr')
        setError(error?.message ?? 'Could not open camera.');
    } finally {
      cameraPending.current = false;
    }
  };

  return (
    <View style={styles.page}>
      <Text style={textStyles.title}>Add device</Text>
      {!pairing && (
        <>
          <TopTabs
            value={method}
            disabled={finding}
            options={[
              { value: 'nearby', label: 'Nearby' },
              { value: 'qr', label: 'Scan QR' },
              { value: 'address', label: 'Address' },
              { value: 'code', label: 'Code' },
            ]}
            onChange={(next) => {
              abort.current?.abort();
              setMethod(next);
              setScanning(false);
              setError(null);
              setStatus('');
            }}
          />
          {method === 'nearby' && (
            <PhoneDiscoverabilityCard
              identity={mesh.identity}
              disabled={pairing || finding || scanning}
              onConfirm={(found) => requestHubApproval(found)}
            />
          )}
          {method === 'address' && (
            <Card>
              <Text style={textStyles.heading}>Hub address</Text>
              <ThemedTextInput
                value={address}
                onChangeText={(value) => {
                  setAddress(value);
                  setHub(null);
                }}
                placeholder="desktop.your-tailnet.ts.net"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!finding && !pairing}
                style={[styles.input, { minHeight: 48 }]}
              />
              <Button
                onPress={() => void findHub()}
                disabled={!address.trim() || pairing || finding}
                loading={finding}
              >
                Find Hub
              </Button>
              {hub && (
                <View style={{ gap: 10, marginTop: 12 }}>
                  <Text style={textStyles.heading}>Found {hub.name}</Text>
                  <Text style={textStyles.body}>{hub.endpoint}</Text>
                  <Button onPress={() => requestHubApproval()} disabled={pairing || finding}>
                    Request pairing
                  </Button>
                </View>
              )}
            </Card>
          )}

          {method === 'qr' &&
            (scanning ? (
              <Card style={styles.cameraCard}>
                <CameraView
                  style={styles.camera}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={({ data }) => void pair(data)}
                />
                <View style={styles.reticle} pointerEvents="none" />
                <Button tone="quiet" onPress={() => setScanning(false)}>
                  Cancel scan
                </Button>
              </Card>
            ) : (
              <Card>
                <Text style={textStyles.body}>
                  On the desktop, open Devices → Add device → Use a QR code.
                </Text>
                <Button onPress={() => void openScanner()} disabled={pairing || finding}>
                  Open camera
                </Button>
              </Card>
            ))}
          {method === 'code' && (
            <Card>
              <Text style={textStyles.heading}>Pairing code</Text>
              <ThemedTextInput
                value={code}
                onChangeText={setCode}
                placeholder="Paste a pairing code from the other Hub"
                placeholderTextColor={colors.subtle}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <Button
                tone="quiet"
                onPress={() => void pair(code)}
                disabled={!code.trim() || finding}
                loading={pairing}
              >
                Connect
              </Button>
            </Card>
          )}
        </>
      )}

      {status ? (
        <Card>
          <Text style={styles.waiting}>{status}</Text>
          <Button
            tone="quiet"
            onPress={() => abort.current?.abort()}
            disabled={!pairing && !finding}
          >
            Cancel
          </Button>
        </Card>
      ) : null}
      <ErrorBanner message={error ?? mesh.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 32, gap: 18 },
  input: {
    minHeight: 92,
    color: colors.text,
    backgroundColor: colors.panel,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 11,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  cameraCard: { gap: 12, position: 'relative' },
  camera: { height: 350, borderRadius: 12, overflow: 'hidden' },
  reticle: {
    position: 'absolute',
    top: 75,
    left: 52,
    right: 52,
    height: 230,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 18,
  },
  waiting: { color: colors.warning, fontSize: 14, lineHeight: 20, marginBottom: 12 },
});
