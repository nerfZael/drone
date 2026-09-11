import React from 'react';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';
import { useMesh } from '../mesh/MeshContext';

/** The preference belongs to the selected Hub, shared with desktop Companion. */
export function useMobileCompanionLiveSettings(deviceId: string) {
  const { request } = useMesh();
  const [enabled, setEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const generation = React.useRef(0);
  const writing = React.useRef(false);
  const load = React.useCallback(async (): Promise<boolean> => {
    if (!deviceId) throw new Error('Choose a connected Hub to use Live voice.');
    const current = ++generation.current;
    setLoading(true);
    try {
      const value = await request(deviceId, COMPANION_CAPABILITY.id, 'live.settings.get') as { enabled?: unknown };
      if (typeof value?.enabled !== 'boolean') throw new Error('Invalid Live voice setting from the Hub.');
      if (current === generation.current) { setEnabled(value.enabled); setError(''); }
      return value.enabled;
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not load Live voice setting.');
      throw error;
    } finally { if (current === generation.current) setLoading(false); }
  }, [deviceId, request]);
  React.useEffect(() => {
    setEnabled(false); setError(''); setLoading(false);
    if (deviceId) void load().catch(() => undefined);
    return () => { generation.current++; };
  }, [deviceId, load]);
  const save = React.useCallback(async (enabled: boolean) => {
    if (!deviceId || writing.current) return;
    writing.current = true;
    const current = ++generation.current;
    setSaving(true);
    try {
      const value = await request(deviceId, COMPANION_CAPABILITY.id, 'live.settings.update', { enabled }) as { enabled?: unknown };
      if (typeof value?.enabled !== 'boolean') throw new Error('Invalid Live voice setting from the Hub.');
      if (current === generation.current) { setEnabled(value.enabled); setError(''); return value.enabled; }
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not save Live voice setting.');
    } finally { writing.current = false; setSaving(false); }
  }, [deviceId, request]);
  return { enabled, loading, saving, error, load, save };
}
