import React from 'react';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';
import { useMesh } from '../mesh/MeshContext';

/** A boolean Companion preference stored on the selected Hub and shared with desktop Companion. */
export function useMobileCompanionHubToggle(deviceId: string, setting: {
  /** Lowercase setting name for error messages. */
  label: string;
  get: string;
  update: string;
  changed: string;
}) {
  const { request, subscribe } = useMesh();
  const { label, get, update, changed } = setting;
  const [stored, setStored] = React.useState({ deviceId: '', enabled: false });
  const enabled = stored.deviceId === deviceId && stored.enabled;
  const setEnabled = (enabled: boolean) => setStored({ deviceId, enabled });
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const generation = React.useRef(0);
  const writing = React.useRef(false);
  const load = React.useCallback(async (): Promise<boolean> => {
    if (!deviceId) throw new Error(`Choose a connected Hub to use ${label}.`);
    const current = ++generation.current;
    setLoading(true);
    try {
      const value = await request(deviceId, COMPANION_CAPABILITY.id, get) as { enabled?: unknown };
      if (typeof value?.enabled !== 'boolean') throw new Error(`Invalid ${label} setting from the Hub.`);
      if (current === generation.current) { setEnabled(value.enabled); setError(''); }
      return value.enabled;
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : `Could not load ${label} setting.`);
      throw error;
    } finally { if (current === generation.current) setLoading(false); }
  }, [deviceId, request, get, label]);
  React.useEffect(() => {
    setEnabled(false); setError(''); setLoading(false);
    if (deviceId) void load().catch(() => undefined);
    return () => { generation.current++; };
  }, [deviceId, load]);
  React.useEffect(() => {
    if (!deviceId) return;
    return subscribe('companion', changed, (event) => {
      if (event.sourceDeviceId !== deviceId || typeof event.payload?.enabled !== 'boolean') return;
      generation.current++;
      setEnabled(event.payload.enabled); setLoading(false); setError('');
    });
  }, [deviceId, subscribe, changed]);
  const save = React.useCallback(async (enabled: boolean) => {
    if (!deviceId || loading || writing.current) return;
    writing.current = true;
    const current = ++generation.current;
    setSaving(true);
    try {
      const value = await request(deviceId, COMPANION_CAPABILITY.id, update, { enabled }) as { enabled?: unknown };
      if (typeof value?.enabled !== 'boolean') throw new Error(`Invalid ${label} setting from the Hub.`);
      if (current === generation.current) { setEnabled(value.enabled); setError(''); return value.enabled; }
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : `Could not save ${label} setting.`);
    } finally { writing.current = false; setSaving(false); }
  }, [deviceId, request, loading, update, label]);
  return { enabled, loading, saving, error, load, save, supported: Boolean(deviceId) };
}
