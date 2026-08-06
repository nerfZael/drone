import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clearProfileScopedStorage, persistProfileStorageIdOverride } from '../../profile-storage';
import type { ProfileSettingsResponse } from './settings-types';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;
type ProfileMutation =
  | { action: 'create'; name: string }
  | { action: 'activate'; name: string }
  | { action: 'rename'; name: string; nextName: string }
  | { action: 'delete'; name: string };

export type UseProfileSettingsResult = ReturnType<typeof useProfileSettings>;

export function useProfileSettings(requestJson: RequestJsonFn) {
  const queryClient = useQueryClient();
  const queryKey = settingsQueryKey('profiles');
  const query = useSettingsQuery<ProfileSettingsResponse>(requestJson, queryKey, '/api/settings/profiles');
  const [profileSettingsError, setProfileSettingsError] = React.useState<string | null>(null);
  const [profileSettingsNotice, setProfileSettingsNotice] = React.useState<string | null>(null);
  const [createProfileDraft, setCreateProfileDraft] = React.useState('');

  const applyResponse = React.useCallback((data: ProfileSettingsResponse) => {
    queryClient.setQueryData(queryKey, data);
    persistProfileStorageIdOverride(data.activeProfile ?? null);
  }, [queryClient, queryKey]);

  React.useEffect(() => {
    if (query.data) persistProfileStorageIdOverride(query.data.activeProfile ?? null);
  }, [query.data]);

  const loadProfileSettings = React.useCallback(async () => {
    setProfileSettingsError(null);
    await query.refetch();
  }, [query.refetch]);

  const mutation = useMutation({
    mutationFn: (input: ProfileMutation) => {
      if (input.action === 'create') {
        return requestJson<ProfileSettingsResponse>('/api/settings/profiles', jsonRequest('POST', { name: input.name }));
      }
      if (input.action === 'activate') {
        return requestJson<ProfileSettingsResponse>('/api/settings/profiles/activate', jsonRequest('POST', { name: input.name }));
      }
      if (input.action === 'rename') {
        return requestJson<ProfileSettingsResponse>(
          '/api/settings/profiles/rename',
          jsonRequest('POST', { name: input.name, nextName: input.nextName }),
        );
      }
      return requestJson<ProfileSettingsResponse>(`/api/settings/profiles/${encodeURIComponent(input.name)}`, {
        method: 'DELETE',
      });
    },
  });

  const createProfile = React.useCallback(async () => {
    const name = String(createProfileDraft ?? '').trim();
    if (!name) {
      setProfileSettingsError('Profile name is required.');
      return;
    }
    setProfileSettingsError(null);
    setProfileSettingsNotice(null);
    try {
      const data = await mutation.mutateAsync({ action: 'create', name });
      applyResponse(data);
      setCreateProfileDraft('');
      setProfileSettingsNotice(`Created profile ${data.createdProfile ?? name}.`);
    } catch (error) {
      setProfileSettingsError(settingsErrorMessage(error));
    }
  }, [applyResponse, createProfileDraft, mutation]);

  const activateProfile = React.useCallback(
    async (nameRaw: string) => {
      const name = String(nameRaw ?? '').trim();
      if (!name) return;
      setProfileSettingsError(null);
      setProfileSettingsNotice(null);
      try {
        const data = await mutation.mutateAsync({ action: 'activate', name });
        applyResponse(data);
        if (data.reloadRequired && typeof window !== 'undefined') {
          window.location.reload();
          return;
        }
        setProfileSettingsNotice(`Switched to profile ${data.activatedProfile ?? name}.`);
      } catch (error) {
        setProfileSettingsError(settingsErrorMessage(error));
      }
    },
    [applyResponse, mutation],
  );

  const deleteProfile = React.useCallback(
    async (nameRaw: string) => {
      const name = String(nameRaw ?? '').trim();
      if (!name) return;
      setProfileSettingsError(null);
      setProfileSettingsNotice(null);
      try {
        const data = await mutation.mutateAsync({ action: 'delete', name });
        clearProfileScopedStorage(name);
        applyResponse(data);
        const removedContainers = Array.isArray(data.removedContainers) ? data.removedContainers.length : 0;
        const removedHostRoots = Array.isArray(data.removedHostRoots) ? data.removedHostRoots.length : 0;
        setProfileSettingsNotice(
          `Deleted profile ${data.deletedProfile ?? name}${removedContainers || removedHostRoots ? ` (${removedContainers} containers, ${removedHostRoots} host runtimes removed)` : ''}.`,
        );
      } catch (error) {
        setProfileSettingsError(settingsErrorMessage(error));
      }
    },
    [applyResponse, mutation],
  );

  const renameProfile = React.useCallback(
    async (nameRaw: string, nextNameRaw: string) => {
      const name = String(nameRaw ?? '').trim();
      const nextName = String(nextNameRaw ?? '').trim();
      if (!name || !nextName) {
        setProfileSettingsError('Both current and new profile names are required.');
        return;
      }
      setProfileSettingsError(null);
      setProfileSettingsNotice(null);
      try {
        const data = await mutation.mutateAsync({ action: 'rename', name, nextName });
        applyResponse(data);
        if (data.reloadRequired && typeof window !== 'undefined') {
          window.location.reload();
          return;
        }
        setProfileSettingsNotice(`Renamed profile ${data.renamedFrom ?? name} to ${data.renamedTo ?? nextName}.`);
      } catch (error) {
        setProfileSettingsError(settingsErrorMessage(error));
      }
    },
    [applyResponse, mutation],
  );

  const pending = mutation.isPending ? mutation.variables : null;

  return {
    profileSettings: query.data ?? null,
    profileSettingsLoading: query.isFetching,
    profileSettingsError: settingsQueryError(profileSettingsError, false, query),
    profileSettingsNotice,
    createProfileDraft,
    creatingProfile: pending?.action === 'create',
    activatingProfileName: pending?.action === 'activate' ? pending.name : null,
    renamingProfileName: pending?.action === 'rename' ? pending.name : null,
    deletingProfileName: pending?.action === 'delete' ? pending.name : null,
    setCreateProfileDraft,
    loadProfileSettings,
    createProfile,
    activateProfile,
    renameProfile,
    deleteProfile,
  };
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
