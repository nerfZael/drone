import React from 'react';
import type { RegistryBackupSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseRegistryBackupSettingsResult = {
  backupSettings: RegistryBackupSettingsResponse | null;
  backupSettingsLoading: boolean;
  backupSettingsError: string | null;
  backupSettingsNotice: string | null;
  backupsEnabledDraft: boolean;
  hourlyEnabledDraft: boolean;
  dailyEnabledDraft: boolean;
  hourlyRetentionHoursDraft: string;
  dailyRetentionDaysDraft: string;
  savingBackupSettings: boolean;
  runningBackup: boolean;
  setBackupsEnabledDraft: React.Dispatch<React.SetStateAction<boolean>>;
  setHourlyEnabledDraft: React.Dispatch<React.SetStateAction<boolean>>;
  setDailyEnabledDraft: React.Dispatch<React.SetStateAction<boolean>>;
  setHourlyRetentionHoursDraft: React.Dispatch<React.SetStateAction<string>>;
  setDailyRetentionDaysDraft: React.Dispatch<React.SetStateAction<string>>;
  loadBackupSettings: () => Promise<void>;
  saveBackupSettings: () => Promise<void>;
  runBackupNow: () => Promise<void>;
};

function applyBackupSettings(
  data: RegistryBackupSettingsResponse,
  setBackupSettings: React.Dispatch<React.SetStateAction<RegistryBackupSettingsResponse | null>>,
  setBackupsEnabledDraft: React.Dispatch<React.SetStateAction<boolean>>,
  setHourlyEnabledDraft: React.Dispatch<React.SetStateAction<boolean>>,
  setDailyEnabledDraft: React.Dispatch<React.SetStateAction<boolean>>,
  setHourlyRetentionHoursDraft: React.Dispatch<React.SetStateAction<string>>,
  setDailyRetentionDaysDraft: React.Dispatch<React.SetStateAction<string>>,
) {
  setBackupSettings(data);
  setBackupsEnabledDraft(data.backupSettings.enabled);
  setHourlyEnabledDraft(data.backupSettings.hourlyEnabled);
  setDailyEnabledDraft(data.backupSettings.dailyEnabled);
  setHourlyRetentionHoursDraft(String(data.backupSettings.hourlyRetentionHours));
  setDailyRetentionDaysDraft(String(data.backupSettings.dailyRetentionDays));
}

function parsePositiveIntDraft(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function useRegistryBackupSettings(requestJson: RequestJsonFn): UseRegistryBackupSettingsResult {
  const [backupSettings, setBackupSettings] = React.useState<RegistryBackupSettingsResponse | null>(null);
  const [backupSettingsLoading, setBackupSettingsLoading] = React.useState(false);
  const [backupSettingsError, setBackupSettingsError] = React.useState<string | null>(null);
  const [backupSettingsNotice, setBackupSettingsNotice] = React.useState<string | null>(null);
  const [backupsEnabledDraft, setBackupsEnabledDraft] = React.useState(true);
  const [hourlyEnabledDraft, setHourlyEnabledDraft] = React.useState(true);
  const [dailyEnabledDraft, setDailyEnabledDraft] = React.useState(true);
  const [hourlyRetentionHoursDraft, setHourlyRetentionHoursDraft] = React.useState('72');
  const [dailyRetentionDaysDraft, setDailyRetentionDaysDraft] = React.useState('60');
  const [savingBackupSettings, setSavingBackupSettings] = React.useState(false);
  const [runningBackup, setRunningBackup] = React.useState(false);

  const loadBackupSettings = React.useCallback(async () => {
    setBackupSettingsLoading(true);
    setBackupSettingsError(null);
    try {
      const data = await requestJson<RegistryBackupSettingsResponse>('/api/settings/backups');
      applyBackupSettings(
        data,
        setBackupSettings,
        setBackupsEnabledDraft,
        setHourlyEnabledDraft,
        setDailyEnabledDraft,
        setHourlyRetentionHoursDraft,
        setDailyRetentionDaysDraft,
      );
    } catch (e: any) {
      setBackupSettingsError(e?.message ?? String(e));
    } finally {
      setBackupSettingsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadBackupSettings();
  }, [loadBackupSettings]);

  const saveBackupSettings = React.useCallback(async () => {
    setBackupSettingsError(null);
    setBackupSettingsNotice(null);
    const hourlyRetentionHours = parsePositiveIntDraft(hourlyRetentionHoursDraft);
    const dailyRetentionDays = parsePositiveIntDraft(dailyRetentionDaysDraft);
    if (!hourlyRetentionHours) {
      setBackupSettingsError('Hourly retention must be a positive whole number of hours.');
      return;
    }
    if (!dailyRetentionDays) {
      setBackupSettingsError('Daily retention must be a positive whole number of days.');
      return;
    }
    setSavingBackupSettings(true);
    try {
      const data = await requestJson<RegistryBackupSettingsResponse>('/api/settings/backups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: backupsEnabledDraft,
          hourlyEnabled: hourlyEnabledDraft,
          dailyEnabled: dailyEnabledDraft,
          hourlyRetentionHours,
          dailyRetentionDays,
        }),
      });
      applyBackupSettings(
        data,
        setBackupSettings,
        setBackupsEnabledDraft,
        setHourlyEnabledDraft,
        setDailyEnabledDraft,
        setHourlyRetentionHoursDraft,
        setDailyRetentionDaysDraft,
      );
      setBackupSettingsNotice('Saved backup settings.');
    } catch (e: any) {
      setBackupSettingsError(e?.message ?? String(e));
    } finally {
      setSavingBackupSettings(false);
    }
  }, [backupsEnabledDraft, dailyEnabledDraft, dailyRetentionDaysDraft, hourlyEnabledDraft, hourlyRetentionHoursDraft, requestJson]);

  const runBackupNow = React.useCallback(async () => {
    setBackupSettingsError(null);
    setBackupSettingsNotice(null);
    setRunningBackup(true);
    try {
      const data = await requestJson<RegistryBackupSettingsResponse>('/api/settings/backups/run', {
        method: 'POST',
      });
      applyBackupSettings(
        data,
        setBackupSettings,
        setBackupsEnabledDraft,
        setHourlyEnabledDraft,
        setDailyEnabledDraft,
        setHourlyRetentionHoursDraft,
        setDailyRetentionDaysDraft,
      );
      setBackupSettingsNotice(data.createdBackup?.suspect ? 'Backup quarantined because the registry looked suspicious.' : 'Manual backup created.');
    } catch (e: any) {
      setBackupSettingsError(e?.message ?? String(e));
    } finally {
      setRunningBackup(false);
    }
  }, [requestJson]);

  return React.useMemo(
    () => ({
      backupSettings,
      backupSettingsLoading,
      backupSettingsError,
      backupSettingsNotice,
      backupsEnabledDraft,
      hourlyEnabledDraft,
      dailyEnabledDraft,
      hourlyRetentionHoursDraft,
      dailyRetentionDaysDraft,
      savingBackupSettings,
      runningBackup,
      setBackupsEnabledDraft,
      setHourlyEnabledDraft,
      setDailyEnabledDraft,
      setHourlyRetentionHoursDraft,
      setDailyRetentionDaysDraft,
      loadBackupSettings,
      saveBackupSettings,
      runBackupNow,
    }),
    [
      backupSettings,
      backupSettingsError,
      backupSettingsLoading,
      backupSettingsNotice,
      backupsEnabledDraft,
      dailyEnabledDraft,
      dailyRetentionDaysDraft,
      hourlyEnabledDraft,
      hourlyRetentionHoursDraft,
      loadBackupSettings,
      runBackupNow,
      runningBackup,
      saveBackupSettings,
      savingBackupSettings,
    ],
  );
}
