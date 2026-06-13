import React from 'react';
import type { DesktopVoiceModelSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseDesktopVoiceModelSettingsResult = {
  desktopVoiceModelSettings: DesktopVoiceModelSettingsResponse | null;
  desktopVoiceModelSettingsLoading: boolean;
  desktopVoiceModelSettingsError: string | null;
  desktopVoiceModelSettingsNotice: string | null;
  installingDesktopVoiceModel: boolean;
  removingDesktopVoiceModel: boolean;
  loadDesktopVoiceModelSettings: () => Promise<void>;
  installDesktopVoiceModel: (modelId?: string) => Promise<void>;
  removeDesktopVoiceModel: (modelId?: string) => Promise<void>;
};

export function useDesktopVoiceModelSettings(requestJson: RequestJsonFn): UseDesktopVoiceModelSettingsResult {
  const [desktopVoiceModelSettings, setDesktopVoiceModelSettings] = React.useState<DesktopVoiceModelSettingsResponse | null>(null);
  const [desktopVoiceModelSettingsLoading, setDesktopVoiceModelSettingsLoading] = React.useState(false);
  const [desktopVoiceModelSettingsError, setDesktopVoiceModelSettingsError] = React.useState<string | null>(null);
  const [desktopVoiceModelSettingsNotice, setDesktopVoiceModelSettingsNotice] = React.useState<string | null>(null);
  const [installingDesktopVoiceModel, setInstallingDesktopVoiceModel] = React.useState(false);
  const [removingDesktopVoiceModel, setRemovingDesktopVoiceModel] = React.useState(false);

  const loadDesktopVoiceModelSettings = React.useCallback(async () => {
    setDesktopVoiceModelSettingsLoading(true);
    setDesktopVoiceModelSettingsError(null);
    try {
      const data = await requestJson<DesktopVoiceModelSettingsResponse>('/api/settings/desktop-voice/model');
      setDesktopVoiceModelSettings(data);
    } catch (e: any) {
      setDesktopVoiceModelSettingsError(e?.message ?? String(e));
    } finally {
      setDesktopVoiceModelSettingsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadDesktopVoiceModelSettings();
  }, [loadDesktopVoiceModelSettings]);

  React.useEffect(() => {
    if (!desktopVoiceModelSettings?.installing) return;
    const interval = window.setInterval(() => {
      void loadDesktopVoiceModelSettings();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [desktopVoiceModelSettings?.installing, loadDesktopVoiceModelSettings]);

  const installDesktopVoiceModel = React.useCallback(async (requestedModelId?: string) => {
    setDesktopVoiceModelSettingsError(null);
    setDesktopVoiceModelSettingsNotice(null);
    setInstallingDesktopVoiceModel(true);
    try {
      const modelId = requestedModelId || desktopVoiceModelSettings?.catalog[0]?.id;
      const data = await requestJson<DesktopVoiceModelSettingsResponse>('/api/settings/desktop-voice/model', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(modelId ? { modelId } : {}),
      });
      setDesktopVoiceModelSettings(data);
      setDesktopVoiceModelSettingsNotice(data.installing ? 'Desktop voice trigger model install started.' : 'Desktop voice trigger model selected.');
    } catch (e: any) {
      setDesktopVoiceModelSettingsError(e?.message ?? String(e));
    } finally {
      setInstallingDesktopVoiceModel(false);
    }
  }, [desktopVoiceModelSettings?.catalog, requestJson]);

  const removeDesktopVoiceModel = React.useCallback(async (modelId?: string) => {
    setDesktopVoiceModelSettingsError(null);
    setDesktopVoiceModelSettingsNotice(null);
    setRemovingDesktopVoiceModel(true);
    try {
      const data = await requestJson<DesktopVoiceModelSettingsResponse>('/api/settings/desktop-voice/model', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(modelId ? { modelId } : {}),
      });
      setDesktopVoiceModelSettings(data);
      setDesktopVoiceModelSettingsNotice('Desktop voice trigger model removed.');
    } catch (e: any) {
      setDesktopVoiceModelSettingsError(e?.message ?? String(e));
    } finally {
      setRemovingDesktopVoiceModel(false);
    }
  }, [requestJson]);

  return {
    desktopVoiceModelSettings,
    desktopVoiceModelSettingsLoading,
    desktopVoiceModelSettingsError,
    desktopVoiceModelSettingsNotice,
    installingDesktopVoiceModel,
    removingDesktopVoiceModel,
    loadDesktopVoiceModelSettings,
    installDesktopVoiceModel,
    removeDesktopVoiceModel,
  };
}
