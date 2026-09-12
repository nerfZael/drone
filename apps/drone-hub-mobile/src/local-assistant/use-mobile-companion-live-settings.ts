import React from 'react';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';
import { useMesh } from '../mesh/MeshContext';

type LiveSettings = {
  enabled: boolean;
  systemPrompt: string;
  defaultSystemPrompt: string;
  maxSystemPromptChars: number;
};

/** The preference belongs to the selected Hub, shared with desktop Companion. */
export function useMobileCompanionLiveSettings(deviceId: string, promptSupported = true) {
  const { request } = useMesh();
  const [enabled, setEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [defaultSystemPrompt, setDefaultSystemPrompt] = React.useState('');
  const [maxSystemPromptChars, setMaxSystemPromptChars] = React.useState(0);
  const generation = React.useRef(0);
  const writing = React.useRef(false);
  const load = React.useCallback(async (): Promise<boolean> => {
    if (!deviceId) throw new Error('Choose a connected Hub to use Live voice.');
    const current = ++generation.current;
    setLoading(true);
    try {
      const preference = await request(deviceId, COMPANION_CAPABILITY.id, 'live.settings.get') as { enabled?: unknown };
      if (typeof preference?.enabled !== 'boolean') throw new Error('Invalid Live voice setting from the Hub.');
      const value = promptSupported
        ? parseLiveSettings(await request(deviceId, COMPANION_CAPABILITY.id, 'live.prompt.get'))
        : { enabled: preference.enabled, systemPrompt: '', defaultSystemPrompt: '', maxSystemPromptChars: 0 };
      if (current === generation.current) {
        setEnabled(preference.enabled);
        setSystemPrompt(value.systemPrompt);
        setDefaultSystemPrompt(value.defaultSystemPrompt);
        setMaxSystemPromptChars(value.maxSystemPromptChars);
        setError('');
      }
      return preference.enabled;
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not load Live voice setting.');
      throw error;
    } finally { if (current === generation.current) setLoading(false); }
  }, [deviceId, promptSupported, request]);
  React.useEffect(() => {
    setEnabled(false); setSystemPrompt(''); setDefaultSystemPrompt(''); setMaxSystemPromptChars(0); setError(''); setLoading(false);
    if (deviceId) void load().catch(() => undefined);
    return () => { generation.current++; };
  }, [deviceId, load]);
  const save = React.useCallback(async (nextEnabled: boolean) => {
    if (!deviceId || writing.current) return;
    writing.current = true;
    const current = ++generation.current;
    setSaving(true);
    try {
      const value = await request(deviceId, COMPANION_CAPABILITY.id, 'live.settings.update', { enabled: nextEnabled }) as { enabled?: unknown };
      if (typeof value?.enabled !== 'boolean') throw new Error('Invalid Live voice setting from the Hub.');
      if (current === generation.current) {
        setEnabled(value.enabled);
        setError('');
        return value.enabled;
      }
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not save Live voice setting.');
    } finally { writing.current = false; setSaving(false); }
  }, [deviceId, request]);
  const saveSystemPrompt = React.useCallback(async (nextSystemPrompt: string) => {
    if (!deviceId || !promptSupported || writing.current) return false;
    writing.current = true;
    const current = ++generation.current;
    setSaving(true);
    try {
      const value = parseLiveSettings(await request(deviceId, COMPANION_CAPABILITY.id, 'live.prompt.update', { systemPrompt: nextSystemPrompt }));
      if (current !== generation.current) return false;
      setSystemPrompt(value.systemPrompt);
      setDefaultSystemPrompt(value.defaultSystemPrompt);
      setMaxSystemPromptChars(value.maxSystemPromptChars);
      setError('');
      return true;
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not save Live voice system prompt.');
      return false;
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }, [deviceId, promptSupported, request]);
  return {
    enabled,
    systemPrompt,
    defaultSystemPrompt,
    maxSystemPromptChars,
    loading,
    saving,
    error,
    load,
    save,
    saveSystemPrompt,
  };
}

function parseLiveSettings(value: unknown): LiveSettings {
  const settings = value as Partial<LiveSettings> | undefined;
  if (!settings || typeof settings.enabled !== 'boolean' || typeof settings.systemPrompt !== 'string' ||
    typeof settings.defaultSystemPrompt !== 'string' || typeof settings.maxSystemPromptChars !== 'number') {
    throw new Error('Invalid Live voice setting from the Hub.');
  }
  return settings as LiveSettings;
}
