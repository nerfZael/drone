import React from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import CircleX from 'lucide-react-native/icons/circle-x';
import Globe from 'lucide-react-native/icons/globe';
import Lock from 'lucide-react-native/icons/lock';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import Unplug from 'lucide-react-native/icons/unplug';
import X from 'lucide-react-native/icons/x';
import type {
  DroneBrowserSession,
  DroneBrowserTargets,
  DroneControlOperation,
} from '@drone/device-protocol';
import { APP_HEADER_HEIGHT } from '../layout';
import { colors, radii } from '../theme';
import { ConfirmDialog } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import {
  startNativeBrowser,
  stopNativeBrowser,
  type BrowserNative,
  type NativeBrowserGateway,
} from './native-browser-lifecycle';
import {
  allowBrowserNavigation,
  browserAccessDialog,
  browserAddress,
  browserPath,
  browserPreferenceKey,
  defaultBrowserPort,
  parseBrowserAddress,
} from './mobile-browser-model';

type Request = (
  deviceId: string,
  operation: DroneControlOperation,
  payload?: any,
  signal?: AbortSignal,
) => Promise<any>;

type IconComponent = React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled,
  size = 20,
  style,
}: {
  icon: IconComponent;
  label: string;
  onPress(): void;
  disabled?: boolean;
  size?: number;
  style?: object;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, style]}
    >
      <Icon color={disabled ? colors.overlay0 : colors.text} size={size} strokeWidth={2.1} />
    </Pressable>
  );
}

export function RemoteDroneBrowser({
  deviceId,
  droneId,
  droneName,
  targetName,
  phoneName,
  request,
  onClose,
}: {
  deviceId: string;
  droneId: string;
  droneName: string;
  targetName: string;
  phoneName: string;
  request: Request;
  onClose(): void;
}) {
  const native = React.useMemo(
    () => requireOptionalNativeModule<BrowserNative>('DroneBrowser'),
    [],
  );
  const webView = React.useRef<WebView>(null);
  const addressInput = React.useRef<TextInput>(null);
  const addressFocused = React.useRef(false);
  const currentPath = React.useRef('/');
  const [targets, setTargets] = React.useState<DroneBrowserTargets | null>(null);
  const [port, setPort] = React.useState<number | null>(null);
  const [address, setAddress] = React.useState('');
  const [gateway, setGateway] = React.useState<NativeBrowserGateway | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [accessDialog, setAccessDialog] =
    React.useState<ReturnType<typeof browserAccessDialog>>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [retry, setRetry] = React.useState(0);
  const retryAction = React.useRef<'targets' | 'open'>('targets');
  const reportRequestError = React.useCallback(
    (error: unknown, action: 'targets' | 'open' = 'targets') => {
      retryAction.current = action;
      const dialog = browserAccessDialog(error, targetName, phoneName);
      setAccessDialog(dialog);
      setError(dialog ? null : error instanceof Error ? error.message : String(error));
    },
    [targetName, phoneName],
  );
  const [back, setBack] = React.useState(false);
  const [forward, setForward] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const generation = React.useRef(0);
  const session = React.useRef<DroneBrowserSession | null>(null);
  const opening = React.useRef<AbortController | null>(null);
  const requestRef = React.useRef(request);
  requestRef.current = request;
  const key = browserPreferenceKey(deviceId, droneId);

  const showAddress = React.useCallback((nextPort: number | null, nextPath: string) => {
    currentPath.current = nextPath;
    if (!addressFocused.current)
      setAddress(nextPort === null ? '' : browserAddress(nextPort, nextPath));
  }, []);

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
    setPickerOpen(false);
    setBusy(false);
    setLoading(false);
    setBack(false);
    setForward(false);
    void release(old);
  }, [release]);

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setGateway(null);
    setBusy(true);
    setError(null);
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
        const nextPort =
          savedPort &&
          (value.manualPort || value.ports.some((p: { port: number }) => p.port === savedPort))
            ? savedPort
            : defaultBrowserPort(value.ports);
        let nextPath = '/';
        try {
          nextPath = browserPath(preference?.path ?? '/');
        } catch {}
        setPort(nextPort);
        showAddress(nextPort, nextPath);
      })
      .catch((error) => {
        if (active) reportRequestError(error);
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
  }, [deviceId, droneId, key, release, retry, reportRequestError, showAddress]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        stop();
        setError('Browser paused. Tap reload to reconnect.');
      }
    });
    return () => subscription.remove();
  }, [stop]);

  const open = async (selectedPort: number, nextPath = currentPath.current) => {
    // Invalid input must not discard the reference to the still-running session.
    if (!native) {
      setError('Install the updated Android app to use Browser.');
      return;
    }
    let selectedPath: string;
    try {
      selectedPath = browserPath(nextPath);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    Keyboard.dismiss();
    addressInput.current?.blur();
    addressFocused.current = false;
    setPort(selectedPort);
    showAddress(selectedPort, selectedPath);
    const version = ++generation.current;
    opening.current?.abort();
    const controller = new AbortController();
    opening.current = controller;
    const old = session.current;
    session.current = null;
    setGateway(null);
    setPickerOpen(false);
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
        reportRequestError(error, 'open');
      }
    } finally {
      if (opening.current === controller) opening.current = null;
      if (generation.current === version) setBusy(false);
    }
  };

  const submitAddress = () => {
    let parsed: { port: number; path: string };
    try {
      parsed = parseBrowserAddress(address, port);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    void open(parsed.port, parsed.path);
  };

  const reload = () => {
    if (gateway && !error) webView.current?.reload();
    else if (port !== null) void open(port, currentPath.current);
    else submitAddress();
  };

  React.useEffect(() => {
    if (!gateway || !session.current) return;
    const timer = setTimeout(
      () => {
        stop();
        setError('Browser session expired. Tap reload to reconnect.');
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
    setRefreshing(true);
    setError(null);
    try {
      const value = await requestRef.current(deviceId, 'browser.targets', { droneId });
      if (version === generation.current) setTargets(value);
    } catch (error) {
      if (version === generation.current) reportRequestError(error);
    } finally {
      if (version === generation.current) setRefreshing(false);
    }
  };

  const loadingTargets = busy && !targets;
  const connecting = busy && targets !== null && !gateway;
  const pickerVisible = !gateway || pickerOpen;
  const ports = targets?.ports ?? [];

  const picker = (
    <ScrollView
      style={styles.picker}
      contentContainerStyle={styles.pickerContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.pickerHeading}>
        <View style={styles.pickerCopy}>
          <Text numberOfLines={1} style={styles.pickerTitle}>
            {droneName}
          </Text>
          <Text numberOfLines={1} style={styles.pickerSubtitle}>
            {targets?.runtime === 'container'
              ? 'Ports mapped from the container'
              : `Ports listening on ${targetName}`}
          </Text>
        </View>
        <IconButton
          icon={RotateCw}
          label="Refresh ports"
          size={17}
          disabled={busy || refreshing}
          onPress={() => void refreshPorts()}
        />
      </View>
      {loadingTargets || (refreshing && !ports.length) ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : ports.length ? (
        <View style={styles.portList}>
          {ports.map((target, index) => {
            const active = gateway !== null && target.port === port;
            return (
              <Pressable
                key={target.port}
                accessibilityRole="button"
                accessibilityLabel={`Open port ${target.port}`}
                onPress={() =>
                  void open(target.port, target.port === port ? currentPath.current : '/')
                }
                style={({ pressed }) => [
                  styles.portRow,
                  index > 0 && styles.portRowDivider,
                  pressed && styles.portRowPressed,
                ]}
              >
                <View style={[styles.portDot, active && styles.portDotActive]} />
                <Text style={styles.portNumber}>:{target.port}</Text>
                {active ? <Text style={styles.portMeta}>Open now</Text> : null}
                <ChevronRight color={colors.overlay0} size={18} strokeWidth={2} />
              </Pressable>
            );
          })}
        </View>
      ) : targets ? (
        <View style={styles.emptyState}>
          <Unplug color={colors.overlay0} size={28} strokeWidth={1.8} />
          <Text style={styles.emptyTitle}>No web ports found</Text>
          <Text style={styles.emptyText}>
            {targets.manualPort
              ? `Start a server on ${targetName}, or type its port in the address bar.`
              : 'Start a dev server in this drone or map a container port, then refresh.'}
          </Text>
        </View>
      ) : null}
      {targets?.manualPort && ports.length ? (
        <Text style={styles.hint}>Any other port can be typed in the address bar.</Text>
      ) : null}
    </ScrollView>
  );

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (gateway && pickerOpen) setPickerOpen(false);
        else if (back) webView.current?.goBack();
        else onClose();
      }}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <IconButton
            icon={ChevronLeft}
            label="Close browser"
            size={22}
            onPress={onClose}
            style={styles.backButton}
          />
          <View style={[styles.omnibox, connecting && styles.omniboxBusy]}>
            {gateway ? (
              <Lock color={colors.online} size={13} strokeWidth={2.4} />
            ) : (
              <Globe color={colors.overlay0} size={14} strokeWidth={2.2} />
            )}
            <ThemedTextInput
              ref={addressInput}
              accessibilityLabel="Address"
              value={address}
              onChangeText={setAddress}
              onFocus={() => {
                addressFocused.current = true;
              }}
              onBlur={() => {
                addressFocused.current = false;
                showAddress(port, currentPath.current);
              }}
              onSubmitEditing={submitAddress}
              returnKeyType="go"
              selectTextOnFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="Port or path, e.g. 3000/app"
              placeholderTextColor={colors.overlay0}
              style={styles.addressInput}
            />
            {loading || connecting ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop loading"
                hitSlop={8}
                onPress={() => (connecting ? stop() : webView.current?.stopLoading())}
                style={styles.omniAction}
              >
                <ActivityIndicator color={colors.accent} size="small" />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reload"
                hitSlop={8}
                onPress={reload}
                style={({ pressed }) => [styles.omniAction, pressed && styles.pressed]}
              >
                <RotateCw color={colors.text} size={17} strokeWidth={2.1} />
              </Pressable>
            )}
          </View>
        </View>
        {loading ? <View style={styles.progress} /> : null}
        {error ? (
          <View style={styles.errorBanner}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              hitSlop={8}
              onPress={() => setError(null)}
            >
              <X color={colors.warning} size={15} strokeWidth={2.4} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.body}>
          {gateway ? (
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
                  fail('This link leaves the selected service. Enter its port to open it.');
                return allowed;
              }}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={(state) => {
                setBack(state.canGoBack);
                setForward(state.canGoForward);
                if (allowBrowserNavigation(state.url, gateway.origin)) {
                  const url = new URL(state.url);
                  if (!url.pathname.startsWith('/__drone_browser_bootstrap/'))
                    showAddress(port, url.pathname + url.search + url.hash);
                }
              }}
              onError={() => fail('Could not load the page. Tap reload to reconnect.')}
              renderError={() => (
                <View style={styles.centered}>
                  <CircleX color={colors.overlay0} size={28} strokeWidth={1.8} />
                  <Text style={styles.emptyTitle}>Connection interrupted</Text>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                    onPress={() => port !== null && void open(port, currentPath.current)}
                  >
                    <Text style={styles.primaryButtonText}>Reconnect</Text>
                  </Pressable>
                </View>
              )}
              onHttpError={(event) => {
                if (event.nativeEvent.url === gateway.origin + currentPath.current)
                  fail(`Service returned HTTP ${event.nativeEvent.statusCode}.`);
              }}
              onRenderProcessGone={() => {
                stop();
                fail('Browser stopped. Tap reload to reconnect.');
              }}
            />
          ) : null}
          {pickerVisible ? (
            <View style={[styles.pickerLayer, gateway && styles.pickerOverlay]}>
              {connecting ? (
                <View style={styles.centered}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.emptyText}>
                    {port === null ? 'Connecting…' : `Connecting to :${port}…`}
                  </Text>
                </View>
              ) : (
                picker
              )}
            </View>
          ) : null}
        </View>
        {gateway ? (
          <View style={styles.navbar}>
            <IconButton
              icon={ArrowLeft}
              label="Back"
              size={22}
              disabled={!back}
              onPress={() => webView.current?.goBack()}
            />
            <IconButton
              icon={ArrowRight}
              label="Forward"
              size={22}
              disabled={!forward}
              onPress={() => webView.current?.goForward()}
            />
            <View style={styles.navSpacer} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch port"
              hitSlop={6}
              onPress={() => setPickerOpen((value) => !value)}
              style={({ pressed }) => [
                styles.portChip,
                pickerOpen && styles.portChipActive,
                pressed && styles.pressed,
              ]}
            >
              <Globe color={pickerOpen ? colors.accent : colors.text} size={15} strokeWidth={2.2} />
              <Text style={[styles.portChipText, pickerOpen && styles.portChipTextActive]}>
                :{port}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <ConfirmDialog
          visible={accessDialog !== null}
          title={accessDialog?.title ?? ''}
          message={accessDialog?.message ?? ''}
          confirmLabel="Try again"
          onCancel={() => setAccessDialog(null)}
          onConfirm={() => {
            setAccessDialog(null);
            if (retryAction.current === 'open') {
              if (port !== null) void open(port, currentPath.current);
            } else setRetry((current) => current + 1);
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    height: APP_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 2,
    paddingRight: 10,
    backgroundColor: colors.mantle,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.large,
  },
  backButton: { width: 28, borderRadius: radii.medium },
  pressed: { opacity: 0.6 },
  omnibox: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  omniboxBusy: { borderColor: colors.accentBorder },
  addressInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: colors.textStrong,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  omniAction: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  progress: { height: 2, backgroundColor: colors.accent, opacity: 0.8 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.warningDark,
    borderBottomWidth: 1,
    borderBottomColor: colors.warningBorder,
  },
  errorText: { flex: 1, color: colors.warning, fontSize: 12, lineHeight: 16 },
  body: { flex: 1, minHeight: 0 },
  web: { flex: 1, backgroundColor: colors.background },
  pickerLayer: { flex: 1 },
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  picker: { flex: 1 },
  pickerContent: { padding: 16, gap: 12 },
  pickerHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerCopy: { flex: 1, minWidth: 0 },
  pickerTitle: { color: colors.textStrong, fontSize: 17, fontWeight: '800' },
  pickerSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  portList: {
    borderRadius: radii.xlarge,
    backgroundColor: colors.mantle,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  portRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    minHeight: 54,
  },
  portRowDivider: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  portRowPressed: { backgroundColor: colors.surface0 },
  portDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.overlay0 },
  portDotActive: { backgroundColor: colors.online },
  portNumber: {
    flex: 1,
    color: colors.textStrong,
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: '700',
  },
  portMeta: { color: colors.online, fontSize: 11, fontWeight: '700' },
  hint: { color: colors.secondary, fontSize: 12, textAlign: 'center' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyTitle: { color: colors.textStrong, fontSize: 15, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  primaryButton: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  primaryButtonText: { color: colors.onAccent, fontWeight: '700' },
  navbar: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    backgroundColor: colors.mantle,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  navSpacer: { flex: 1 },
  portChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  portChipActive: { backgroundColor: colors.accentWash, borderColor: colors.accentBorder },
  portChipText: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
  },
  portChipTextActive: { color: colors.accent },
});
