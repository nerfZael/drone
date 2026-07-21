import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QrCode from 'lucide-react-native/icons/qr-code';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import { Button, Card, ErrorBanner, Label, textStyles } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { useMesh } from '../mesh/MeshContext';
import { readPairingCode } from '../mesh/pair-device';
import { colors } from '../theme';

export function PairScreen({ onComplete }: { onComplete(): void }) {
  const mesh = useMesh();
  const updatingConnection = Boolean(mesh.profile);
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = React.useState('');
  const [scanning, setScanning] = React.useState(false);
  const [pairing, setPairing] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const pairingRef = React.useRef(false);

  React.useEffect(() => () => abort.current?.abort(), []);

  const pair = async (raw: string) => {
    if (pairingRef.current) return;
    pairingRef.current = true;
    setPairing(true);
    setScanning(false);
    setError(null);
    setStatus(
      updatingConnection
        ? 'Verifying this phone and updating its saved connection…'
        : 'Request sent. Approve this new phone on the other Hub.',
    );
    abort.current = new AbortController();
    try {
      await mesh.pair(readPairingCode(raw.trim()), abort.current.signal);
      onComplete();
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
      setStatus('');
    } finally {
      pairingRef.current = false;
      setPairing(false);
    }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) {
        setError(
          'Camera permission is needed to scan a pairing code. You can paste the code instead.',
        );
        return;
      }
    }
    setScanning(true);
  };

  return (
    <View style={styles.page}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <ShieldCheck color={colors.accent} size={27} strokeWidth={2} />
        </View>
        <View style={styles.heroCopy}>
          <Label>Private device mesh</Label>
          <Text style={[textStyles.title, styles.title]}>
            {updatingConnection ? 'Update a connection.' : 'Pair without an account.'}
          </Text>
          <Text style={textStyles.body}>
            {updatingConnection
              ? 'Scan a fresh code from a Hub you already trust. Your phone proves its existing identity, updates the route, and keeps its permissions.'
              : 'Scan a short-lived code from a Drone Hub computer. That computer must approve this phone before anything is shared.'}
          </Text>
        </View>
      </View>

      {scanning ? (
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
          <View style={styles.cardHeading}>
            <View style={styles.cardIcon}>
              <QrCode color={colors.accentAlt} size={18} strokeWidth={2.2} />
            </View>
            <Text style={textStyles.heading}>
              {updatingConnection ? 'Replace an unreachable route' : 'Add your first route'}
            </Text>
          </View>
          <Text style={[textStyles.body, styles.copy]}>
            The QR code contains an address and one-time secret. Your permanent private key stays in
            Android secure storage and signs the connection request.
          </Text>
          <Button onPress={() => void openScanner()} disabled={pairing}>
            {updatingConnection ? 'Scan connection QR' : 'Scan pairing QR'}
          </Button>
          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.or}>OR PASTE</Text>
            <View style={styles.line} />
          </View>
          <ThemedTextInput
            value={code}
            onChangeText={setCode}
            placeholder={updatingConnection ? 'Paste connection JSON' : 'Paste pairing JSON'}
            placeholderTextColor={colors.subtle}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Button
            tone="quiet"
            onPress={() => void pair(code)}
            disabled={!code.trim()}
            loading={pairing}
          >
            {updatingConnection ? 'Update connection' : 'Request approval'}
          </Button>
        </Card>
      )}

      {status ? (
        <Card>
          <Text style={styles.waiting}>{status}</Text>
          <Button tone="quiet" onPress={() => abort.current?.abort()} disabled={!pairing}>
            Cancel
          </Button>
        </Card>
      ) : null}
      <ErrorBanner message={error ?? mesh.error} />
      {mesh.identity ? <Text style={styles.identity}>THIS DEVICE · {mesh.identity.id}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 32, gap: 18 },
  hero: { gap: 15 },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDark,
  },
  heroCopy: { maxWidth: 500 },
  title: { marginTop: 6, marginBottom: 8 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentDark,
  },
  copy: { marginTop: 6, marginBottom: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
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
  identity: {
    color: colors.subtle,
    fontSize: 9,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 4,
  },
});
