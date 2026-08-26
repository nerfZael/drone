import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RegistryBackupSettingsResponse } from './settings-types';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;
type BackupSettingsInput = {
  enabled: boolean;
  hourlyEnabled: boolean;
  dailyEnabled: boolean;
  hourlyRetentionHours: number;
  dailyRetentionDays: number;
};
type BackupMutation = { action: 'save'; settings: BackupSettingsInput } | { action: 'run' };

export type UseRegistryBackupSettingsResult = ReturnType<typeof useRegistryBackupSettings>;

function parsePositiveIntDraft(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function useRegistryBackupSettings(requestJson: RequestJsonFn, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = settingsQueryKey('backups');
  const query = useSettingsQuery<RegistryBackupSettingsResponse>(requestJson, queryKey, '/api/settings/backups', enabled);
  const [backupSettingsError, setBackupSettingsError] = React.useState<string | null>(null);
  const [backupSettingsNotice, setBackupSettingsNotice] = React.useState<string | null>(null);
  const [backupsEnabledDraft, setBackupsEnabledDraft] = React.useState(true);
  const [hourlyEnabledDraft, setHourlyEnabledDraft] = React.useState(true);
  const [dailyEnabledDraft, setDailyEnabledDraft] = React.useState(true);
  const [hourlyRetentionHoursDraft, setHourlyRetentionHoursDraft] = React.useState('72');
  const [dailyRetentionDaysDraft, setDailyRetentionDaysDraft] = React.useState('60');

  const applyDrafts = React.useCallback((data: RegistryBackupSettingsResponse) => {
    setBackupsEnabledDraft(data.backupSettings.enabled);
    setHourlyEnabledDraft(data.backupSettings.hourlyEnabled);
    setDailyEnabledDraft(data.backupSettings.dailyEnabled);
    setHourlyRetentionHoursDraft(String(data.backupSettings.hourlyRetentionHours));
    setDailyRetentionDaysDraft(String(data.backupSettings.dailyRetentionDays));
  }, []);

  React.useEffect(() => {
    if (query.data) applyDrafts(query.data);
  }, [applyDrafts, query.data]);

  const loadBackupSettings = React.useCallback(async () => {
    setBackupSettingsError(null);
    const { data } = await query.refetch();
    if (data) applyDrafts(data);
  }, [applyDrafts, query.refetch]);

  const mutation = useMutation({
    mutationFn: (input: BackupMutation) =>
      requestJson<RegistryBackupSettingsResponse>(
        input.action === 'save' ? '/api/settings/backups' : '/api/settings/backups/run',
        input.action === 'save'
          ? {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(input.settings),
            }
          : { method: 'POST' },
      ),
  });

  const applyResponse = React.useCallback((data: RegistryBackupSettingsResponse) => {
    queryClient.setQueryData(queryKey, data);
    applyDrafts(data);
  }, [applyDrafts, queryClient, queryKey]);

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
    try {
      const data = await mutation.mutateAsync({
        action: 'save',
        settings: {
          enabled: backupsEnabledDraft,
          hourlyEnabled: hourlyEnabledDraft,
          dailyEnabled: dailyEnabledDraft,
          hourlyRetentionHours,
          dailyRetentionDays,
        },
      });
      applyResponse(data);
      setBackupSettingsNotice('Saved backup settings.');
    } catch (error) {
      setBackupSettingsError(settingsErrorMessage(error));
    }
  }, [applyResponse, backupsEnabledDraft, dailyEnabledDraft, dailyRetentionDaysDraft, hourlyEnabledDraft, hourlyRetentionHoursDraft, mutation]);

  const runBackupNow = React.useCallback(async () => {
    setBackupSettingsError(null);
    setBackupSettingsNotice(null);
    try {
      const data = await mutation.mutateAsync({ action: 'run' });
      applyResponse(data);
      setBackupSettingsNotice(data.createdBackup?.suspect ? 'Backup quarantined because the registry looked suspicious.' : 'Manual backup created.');
    } catch (error) {
      setBackupSettingsError(settingsErrorMessage(error));
    }
  }, [applyResponse, mutation]);

  const pendingAction = mutation.isPending ? mutation.variables.action : null;

  return React.useMemo(
    () => ({
      backupSettings: query.data ?? null,
      backupSettingsLoading: query.isFetching,
      backupSettingsError: settingsQueryError(backupSettingsError, false, query),
      backupSettingsNotice,
      backupsEnabledDraft,
      hourlyEnabledDraft,
      dailyEnabledDraft,
      hourlyRetentionHoursDraft,
      dailyRetentionDaysDraft,
      savingBackupSettings: pendingAction === 'save',
      runningBackup: pendingAction === 'run',
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
      query.data,
      query.error,
      query.isFetching,
      backupSettingsError,
      backupSettingsNotice,
      backupsEnabledDraft,
      dailyEnabledDraft,
      dailyRetentionDaysDraft,
      hourlyEnabledDraft,
      hourlyRetentionHoursDraft,
      loadBackupSettings,
      runBackupNow,
      pendingAction,
      saveBackupSettings,
    ],
  );
}
