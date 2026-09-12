import React from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'drone.companion.headset-shortcut';

/** A phone preference; arming must happen while an Android activity is visible. */
export function useMobileCompanionHeadsetShortcut(setArmed: (enabled: boolean) => Promise<void>) {
  const supported = Platform.OS === 'android';
  const [enabled, setEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const desired = React.useRef(false);
  const busy = React.useRef(false);
  const writes = React.useRef(Promise.resolve());
  const persist = React.useCallback((value: boolean) => {
    const next = writes.current.catch(() => undefined).then(() => AsyncStorage.setItem(STORAGE_KEY, value ? 'on' : 'off'));
    writes.current = next;
    return next;
  }, []);

  React.useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (!mounted) return;
      desired.current = supported && saved === 'on';
      setEnabled(desired.current);
    }).catch(() => { if (mounted) setError('Could not load the headset shortcut setting.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [supported]);

  const arm = React.useCallback(async () => {
    if (!desired.current || busy.current || AppState.currentState !== 'active') return;
    busy.current = true; setSaving(true); setError('');
    try { await setArmed(true); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not enable the headset shortcut.'); }
    finally { busy.current = false; setSaving(false); }
  }, [setArmed]);

  React.useEffect(() => {
    if (loading || !enabled) return;
    void arm();
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void arm(); });
    return () => listener.remove();
  }, [arm, enabled, loading]);

  const save = React.useCallback(async (value: boolean) => {
    if (loading || busy.current || !supported) return;
    busy.current = true; setSaving(true); setError('');
    const previous = desired.current;
    desired.current = value;
    try {
      await setArmed(value);
      // A notification End may have cancelled arming while permissions were open.
      if (desired.current !== value) return;
      await persist(value);
      setEnabled(desired.current);
    } catch (error) {
      desired.current = previous;
      await setArmed(previous).catch(() => undefined);
      setError(error instanceof Error ? error.message : 'Could not save the headset shortcut setting.');
    } finally { busy.current = false; setSaving(false); }
  }, [loading, persist, setArmed, supported]);

  // Explicitly ending the notification also opts out; it must not silently rearm.
  const ended = React.useCallback(() => {
    desired.current = false; setEnabled(false);
    void persist(false).catch(() => setError('Could not save that the headset shortcut is off.'));
  }, [persist]);

  return { supported, enabled, loading, saving, error, save, ended, retry: arm };
}
