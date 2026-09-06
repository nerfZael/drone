import React from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  DroneBrowserSession,
  DroneBrowserTargets,
  DroneControlOperation,
} from '@drone/device-protocol';
import { colors } from '../theme';
import {
  startNativeBrowser,
  stopNativeBrowser,
  type BrowserNative,
  type NativeBrowserGateway,
} from './native-browser-lifecycle';
import {
  allowBrowserNavigation,
  browserPath,
  browserPort,
  browserPreferenceKey,
  defaultBrowserPort,
} from './mobile-browser-model';

type Request = (
  deviceId: string,
  operation: DroneControlOperation,
  payload?: any,
  signal?: AbortSignal,
) => Promise<any>;

export function RemoteDroneBrowser({
  deviceId,
  droneId,
  droneName,
  request,
  onClose,
}: {
  deviceId: string;
  droneId: string;
  droneName: string;
  request: Request;
  onClose(): void;
}) {
  const native = React.useMemo(
    () => requireOptionalNativeModule<BrowserNative>('DroneBrowser'),
    [],
  );
  const webView = React.useRef<WebView>(null);
  const [targets, setTargets] = React.useState<DroneBrowserTargets | null>(null);
  const [port, setPort] = React.useState('');
  const [path, setPath] = React.useState('/');
  const [gateway, setGateway] = React.useState<NativeBrowserGateway | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [back, setBack] = React.useState(false);
  const [forward, setForward] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const generation = React.useRef(0);
  const session = React.useRef<DroneBrowserSession | null>(null);
  const opening = React.useRef<AbortController | null>(null);
  const requestRef = React.useRef(request);
  requestRef.current = request;
  const key = browserPreferenceKey(deviceId, droneId);

  const release = React.useCallback(
    async (value: DroneBrowserSession | null) => {
      if (!value) return;
      await Promise.allSettled([
        native ? stopNativeBrowser(native, value.sessionId) : Promise.resolve(),
        requestRef.current(
          deviceId,
          'browser.close',
          { droneId, sessionId: value.sessionId },
          AbortSignal.timeout(5000),
        ),
      ]);
    },
    [deviceId, droneId, native],
  );

  const stop = React.useCallback(() => {
    generation.current++;
    opening.current?.abort();
    const old = session.current;
    session.current = null;
    setGateway(null);
    setBusy(false);
    setLoading(false);
    setBack(false);
    setForward(false);
    void release(old);
  }, [release]);

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBusy(true);
    void Promise.all([
      requestRef.current(deviceId, 'browser.targets', { droneId }, controller.signal),
      AsyncStorage.getItem(key).catch(() => null),
    ])
      .then(([value, saved]) => {
        if (!active) return;
        setTargets(value);
        let preference: { port?: number; path?: string } = {};
        try {
          preference = JSON.parse(saved ?? '{}');
        } catch {}
        const savedPort = preference?.port;
        setPort(
          String(
            savedPort &&
              (value.manualPort || value.ports.some((p: { port: number }) => p.port === savedPort))
              ? savedPort
              : (defaultBrowserPort(value.ports) ?? ''),
          ),
        );
        try {
          setPath(browserPath(preference?.path ?? '/'));
        } catch {
          setPath('/');
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
      generation.current++;
      opening.current?.abort();
      const old = session.current;
      session.current = null;
      void release(old);
    };
  }, [deviceId, droneId, key, release]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        stop();
        setError('Browser paused. Tap Open when you return.');
      }
    });
    return () => subscription.remove();
  }, [stop]);

  const open = async () => {
    // Invalid input must not discard the reference to the still-running session.
    if (!native) {
      setError('Install the updated Android app to use Browser.');
      return;
    }
    let selectedPort: number;
    let selectedPath: string;
    try {
      selectedPort = browserPort(port);
      selectedPath = browserPath(path);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    const version = ++generation.current;
    opening.current?.abort();
    const controller = new AbortController();
    opening.current = controller;
    const old = session.current;
    session.current = null;
    setGateway(null);
    setError(null);
    setBusy(true);
    setBack(false);
    setForward(false);
    let created: DroneBrowserSession | null = null;
    try {
      await release(old);
      if (generation.current !== version) return;
      created = await requestRef.current(
        deviceId,
        'browser.open',
        { droneId, port: selectedPort },
        controller.signal,
      );
      if (generation.current !== version) {
        await release(created);
        return;
      }
      session.current = created;
      const local = await startNativeBrowser(
        native,
        created!,
        selectedPath,
        selectedPort,
        () => generation.current === version,
      );
      if (!local || generation.current !== version) {
        await release(created);
        return;
      }
      setGateway(local);
      void AsyncStorage.setItem(
        key,
        JSON.stringify({ port: selectedPort, path: selectedPath }),
      ).catch(() => undefined);
    } catch (error) {
      await release(created);
      if (generation.current === version) {
        session.current = null;
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (opening.current === controller) opening.current = null;
      if (generation.current === version) setBusy(false);
    }
  };

  React.useEffect(() => {
    if (!gateway || !session.current) return;
    const timer = setTimeout(
      () => {
        stop();
        setError('Browser session expired. Tap Open to reconnect.');
      },
      Math.max(1, Date.parse(session.current.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [gateway, stop]);

  const fail = (message: string) => {
    setLoading(false);
    setError(message);
  };
  const refreshPorts = async () => {
    const version = generation.current;
    setBusy(true);
    setError(null);
    try {
      const value = await requestRef.current(deviceId, 'browser.targets', { droneId });
      if (version === generation.current) setTargets(value);
    } catch (error) {
      if (version === generation.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  };
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => (back ? webView.current?.goBack() : onClose())}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.toolbar}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
            <Text style={styles.buttonText}>Close</Text>
          </Pressable>
          <Text numberOfLines={1} style={styles.title}>
            {droneName} · Browser
          </Text>
          {loading || busy ? <ActivityIndicator color={colors.accent} /> : null}
        </View>
        <View style={styles.toolbar}>
          <TextInput
            accessibilityLabel="Browser port"
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
            placeholder="Port"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.port]}
          />
          <TextInput
            accessibilityLabel="Browser path"
            value={path}
            onChangeText={setPath}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="/"
            style={[styles.input, styles.path]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void open()}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Open</Text>
          </Pressable>
          {!gateway ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void refreshPorts()}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Ports</Text>
            </Pressable>
          ) : null}
        </View>
        {!gateway && targets ? (
          <View>
            <ScrollView horizontal contentContainerStyle={styles.ports}>
              {targets.ports.map((target) => (
                <Pressable
                  key={target.port}
                  onPress={() => setPort(String(target.port))}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>:{target.port}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.notice}>
              {targets.manualPort
                ? 'Choose a port on the hosting device.'
                : 'Choose a Docker-mapped container port.'}
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {gateway ? (
          <>
            <View style={styles.toolbar}>
              <Pressable
                disabled={!back}
                onPress={() => webView.current?.goBack()}
                style={styles.button}
              >
                <Text style={[styles.buttonText, !back && styles.disabled]}>Back</Text>
              </Pressable>
              <Pressable
                disabled={!forward}
                onPress={() => webView.current?.goForward()}
                style={styles.button}
              >
                <Text style={[styles.buttonText, !forward && styles.disabled]}>Forward</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setError(null);
                  webView.current?.reload();
                }}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Refresh</Text>
              </Pressable>
            </View>
            <WebView
              ref={webView}
              key={gateway.sessionId}
              source={{ uri: gateway.url }}
              style={styles.web}
              javaScriptEnabled
              domStorageEnabled
              incognito
              cacheEnabled={false}
              originWhitelist={['*']}
              mixedContentMode="never"
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              javaScriptCanOpenWindowsAutomatically={false}
              setSupportMultipleWindows
              geolocationEnabled={false}
              thirdPartyCookiesEnabled={false}
              webviewDebuggingEnabled={false}
              onOpenWindow={() => fail('Open links within this browser’s selected service.')}
              onShouldStartLoadWithRequest={(event) => {
                const allowed = allowBrowserNavigation(event.url, gateway.origin);
                if (!allowed)
                  fail(
                    'This link leaves the selected service. Choose its port and path to open it.',
                  );
                return allowed;
              }}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={(state) => {
                setBack(state.canGoBack);
                setForward(state.canGoForward);
              }}
              onError={() =>
                fail(
                  'Could not reach the service. Check that it is running, then tap Open to reconnect.',
                )
              }
              onHttpError={(event) => {
                if (event.nativeEvent.url === gateway.origin + path)
                  fail(`Service returned HTTP ${event.nativeEvent.statusCode}.`);
              }}
              onRenderProcessGone={() => {
                stop();
                fail('Browser stopped. Tap Open to reconnect.');
              }}
            />
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.notice}>
              {busy ? 'Connecting…' : 'Select a port and tap Open to view this drone’s web app.'}
            </Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.mantle },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  title: { flex: 1, color: colors.textStrong, fontWeight: '700' },
  button: { paddingHorizontal: 10, paddingVertical: 10 },
  buttonText: { color: colors.accent, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 8,
    color: colors.textStrong,
  },
  port: { width: 76 },
  path: { flex: 1 },
  ports: { paddingHorizontal: 12 },
  notice: { color: colors.muted, paddingHorizontal: 16, paddingVertical: 8 },
  error: { color: colors.warning, paddingHorizontal: 16, paddingVertical: 8 },
  disabled: { opacity: 0.35 },
  web: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
