import { throwIfAborted } from '@drone/device-protocol';
import React from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { requireOptionalNativeModule } from 'expo';
import * as Crypto from 'expo-crypto';
import {
  phonePairingSigningText,
  phonePairingCodeText,
  phonePairingCode,
  type PhonePairingPresence,
} from '@drone/device-protocol';
import { Button, Card, ErrorBanner, textStyles } from '../components/Ui';
import { mobileDeviceIdForPublicKey, type MobileDeviceIdentity } from '../security/device-identity';
import { verifyPhoneOffer } from '../mesh/verify-phone-offer';
import type { DiscoveredHub } from '../mesh/discover-hub';
import { parseNearbyHub, verifyNearbyHub, type NearbyHub } from '../mesh/nearby-hub';
import {
  startNativePairing,
  stopNativePairing,
  refreshNativePairing,
} from '../mesh/native-pairing-lifecycle';

type Listener = {
  start(descriptor: string): Promise<void>;
  refresh(descriptor: string): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: string,
    handler: (event: { body?: string; session?: string }) => void,
  ): { remove(): void };
};

export function PhoneDiscoverabilityCard({
  identity,
  disabled,
  onConfirm,
}: {
  identity: MobileDeviceIdentity | null;
  disabled: boolean;
  onConfirm(hub: DiscoveredHub): void;
}) {
  const [active, setActive] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [offer, setOffer] = React.useState<{ hub: DiscoveredHub; code: string } | null>(null);
  const [hubs, setHubs] = React.useState<NearbyHub[]>([]);
  const [checking, setChecking] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const paused = React.useRef(false);
  const verification = React.useRef<AbortController | null>(null);
  const startRef = React.useRef<() => Promise<void>>(async () => {});
  const session = React.useRef('');
  const stopRef = React.useRef<() => void>(() => {});
  React.useEffect(() => () => stopRef.current(), []);
  React.useEffect(() => {
    if (disabled) stopRef.current();
  }, [disabled]);
  React.useEffect(() => {
    if (!identity || disabled || paused.current || AppState.currentState !== 'active') return;
    void startRef.current();
  }, [identity, disabled]);
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stopRef.current();
      else if (!paused.current && !disabled) void startRef.current();
    });
    return () => subscription.remove();
  }, [disabled]);

  const start = async () => {
    if (!identity || session.current) return;
    stopRef.current();
    setError(null);
    setOffer(null);
    setHubs([]);
    setSearched(false);
    setStarting(true);
    const nonce = Crypto.randomUUID();
    session.current = nonce;
    let native: Listener | null = null;
    const subscriptions: { remove(): void }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let offerTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (session.current !== nonce) return;
      session.current = '';
      clearTimeout(timer);
      clearTimeout(searchTimer);
      clearTimeout(offerTimer);
      verification.current?.abort();
      verification.current = null;
      subscriptions.forEach((subscription) => subscription.remove());
      if (native) void stopNativePairing(native).catch(() => undefined);
      setActive(false);
      setStarting(false);
      setOffer(null);
      setHubs([]);
      setChecking(false);
    };
    stopRef.current = stop;
    try {
      if (Platform.OS !== 'android')
        throw new Error(
          'Nearby discovery is currently available in the Android build. Use QR or Find a Hub on this platform.',
        );
      native = requireOptionalNativeModule<Listener>('DronePhonePairing');
      if (!native || typeof native.refresh !== 'function')
        throw new Error(
          'Nearby discovery needs a new native Android build. A JavaScript reload is not enough.',
        );
      const presence: PhonePairingPresence = {
        type: 'dronehub.phone.presence',
        version: 1,
        session: nonce,
        device: {
          id: identity.id,
          name: identity.name,
          platform: identity.platform,
          publicKey: identity.publicKey,
        },
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      };
      let claimed = false;
      let offers = 0;
      let offerWindow = Date.now();
      subscriptions.push(
        native.addListener('stopped', (event) => {
          if (event.session === nonce) stop();
        }),
      );
      subscriptions.push(
        native.addListener('nearbyError', (event) => {
          if (session.current === nonce && event.session === nonce)
            setError(event.body ?? 'Wi-Fi discovery unavailable.');
        }),
      );
      subscriptions.push(
        native.addListener('nearbyHub', (event) => {
          if (session.current !== nonce || event.session !== nonce) return;
          try {
            const hub = parseNearbyHub(event.body ?? '');
            setHubs((previous) =>
              [...previous.filter((item) => item.key !== hub.key), hub].slice(0, 100),
            );
          } catch {
            /* Malformed advertisements never reach the pairing UI. */
          }
        }),
      );
      subscriptions.push(
        native.addListener('nearbyLost', (event) => {
          if (session.current === nonce && event.session === nonce)
            setHubs((previous) => previous.filter((hub) => hub.key !== event.body));
        }),
      );
      subscriptions.push(
        native.addListener('offer', (event) => {
          if (Date.now() - offerWindow >= 120000) {
            offerWindow = Date.now();
            offers = 0;
          }
          if (session.current !== nonce || claimed || ++offers > 16) return;
          void (async () => {
            try {
              const incoming = await verifyPhoneOffer(
                JSON.parse(event.body ?? ''),
                nonce,
                identity.id,
                mobileDeviceIdForPublicKey,
              );
              const digest = await Crypto.digestStringAsync(
                Crypto.CryptoDigestAlgorithm.SHA256,
                phonePairingCodeText(incoming),
              );
              if (session.current !== nonce || claimed) return;
              claimed = true;
              setOffer({
                hub: { id: incoming.hub.id, name: incoming.hub.name, endpoint: incoming.endpoint },
                code: phonePairingCode(digest),
              });
              clearTimeout(offerTimer);
              offerTimer = setTimeout(
                () => {
                  if (session.current !== nonce) return;
                  claimed = false;
                  setOffer(null);
                },
                Math.max(0, Date.parse(incoming.expiresAt) - Date.now()),
              );
            } catch {
              /* Invalid offers never become user-visible pairing requests. */
            }
          })();
        }),
      );
      const descriptor = JSON.stringify({
        ...presence,
        signature: await identity.sign(phonePairingSigningText(presence)),
      });
      if (session.current !== nonce) return;
      if (!(await startNativePairing(native, descriptor, () => session.current === nonce))) return;
      if (session.current !== nonce) return;
      setActive(true);
      searchTimer = setTimeout(() => setSearched(true), 8000);
      const renew = async () => {
        if (session.current !== nonce) return;
        try {
          const refreshed = { ...presence, expiresAt: new Date(Date.now() + 120000).toISOString() };
          const descriptor = JSON.stringify({
            ...refreshed,
            signature: await identity.sign(phonePairingSigningText(refreshed)),
          });
          if (await refreshNativePairing(native!, descriptor, () => session.current === nonce))
            timer = setTimeout(() => void renew(), 60000);
        } catch (error: any) {
          if (session.current !== nonce) return;
          setError(error?.message ?? 'Discovery could not refresh. Tap Start discovery to retry.');
          stop();
        }
      };
      timer = setTimeout(() => void renew(), 60000);
    } catch (error: any) {
      if (session.current === nonce) {
        setError(error?.message ?? String(error));
        stop();
      }
    } finally {
      if (session.current === nonce) setStarting(false);
    }
  };
  startRef.current = start;
  const selectHub = async (candidate: NearbyHub) => {
    if (verification.current || disabled) return;
    const controller = new AbortController();
    verification.current = controller;
    setChecking(true);
    setError(null);
    try {
      const hub = await verifyNearbyHub(candidate, {
        nonce: Crypto.randomUUID(),
        signal: controller.signal,
        keyId: mobileDeviceIdForPublicKey,
        fetchImpl: expoFetch as unknown as typeof fetch,
      });
      throwIfAborted(controller.signal);
      stopRef.current();
      onConfirm(hub);
    } catch (error: any) {
      if (!controller.signal.aborted) setError(error?.message ?? String(error));
    } finally {
      if (verification.current === controller) {
        verification.current = null;
        setChecking(false);
      }
    }
  };
  return (
    <Card>
      <Text style={textStyles.body}>
        Open Devices → Add device on your desktop. Keep Wi-Fi and Tailscale connected.
      </Text>
      <Button
        tone="quiet"
        disabled={disabled || !identity}
        onPress={() => {
          paused.current = active || starting;
          if (paused.current) stopRef.current();
          else void start();
        }}
      >
        {active || starting ? 'Stop discovery' : 'Start discovery'}
      </Button>
      {active && (
        <Text accessibilityLiveRegion="polite" style={textStyles.body}>
          {hubs.length
            ? 'Choose a device to connect.'
            : searched
              ? 'No devices found yet. Try Scan QR or Address.'
              : 'Looking for devices…'}
        </Text>
      )}
      {!active && !starting && <Text style={textStyles.body}>Discovery paused.</Text>}
      {hubs.map((hub) => (
        <View key={hub.key} style={{ gap: 6 }}>
          <Text style={textStyles.heading}>{hub.name}</Text>
          <Text numberOfLines={1} style={textStyles.body}>
            {hub.endpoint}
          </Text>
          <Button disabled={disabled || checking} onPress={() => void selectHub(hub)}>
            {checking ? 'Verifying…' : 'Connect'}
          </Button>
        </View>
      ))}
      {offer && (
        <View style={{ gap: 10 }}>
          <Text style={textStyles.heading}>{offer.hub.name} wants to pair</Text>
          <Text style={textStyles.mono}>{offer.code}</Text>
          <Text style={textStyles.body}>Continue only if this code matches the desktop.</Text>
          <Button
            disabled={disabled || checking}
            onPress={() => {
              const hub = offer.hub;
              stopRef.current();
              onConfirm(hub);
            }}
          >
            Codes match — connect
          </Button>
          <Button tone="quiet" onPress={() => stopRef.current()}>
            Reject
          </Button>
        </View>
      )}
      <ErrorBanner message={error} />
      {active && <Text style={textStyles.body}>Visible while this screen is open.</Text>}
    </Card>
  );
}
