import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  bytesToMaxMiB,
  bytesToMinMiB,
  bytesToNearestMiB,
  miBToBytes,
  parseUploadMaxMiBDraft,
} from './filesystem-size-utils';
import type { FilesystemSettingsResponse } from './settings-types';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsPostMutation, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseFilesystemSettingsResult = ReturnType<typeof useFilesystemSettings>;

export function useFilesystemSettings(requestJson: RequestJsonFn, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = settingsQueryKey('filesystem');
  const query = useSettingsQuery<FilesystemSettingsResponse>(requestJson, queryKey, '/api/settings/filesystem', enabled);
  const [filesystemSettingsError, setFilesystemSettingsError] = React.useState<string | null>(null);
  const [filesystemSettingsNotice, setFilesystemSettingsNotice] = React.useState<string | null>(null);
  const [uploadMaxMiBDraft, setUploadMaxMiBDraft] = React.useState('2048');

  const applySettings = React.useCallback((data: FilesystemSettingsResponse) => {
    setUploadMaxMiBDraft(String(bytesToNearestMiB(data.filesystem.uploadMaxBytes)));
  }, []);

  React.useEffect(() => {
    if (query.data) applySettings(query.data);
  }, [applySettings, query.data]);

  const saveMutation = useSettingsPostMutation<FilesystemSettingsResponse, { uploadMaxBytes: number }>(
    requestJson,
    '/api/settings/filesystem',
  );

  const loadFilesystemSettings = React.useCallback(async () => {
    setFilesystemSettingsError(null);
    setFilesystemSettingsNotice(null);
    const { data } = await query.refetch();
    if (data) applySettings(data);
  }, [applySettings, query.refetch]);

  const saveFilesystemSettings = React.useCallback(async () => {
    setFilesystemSettingsError(null);
    setFilesystemSettingsNotice(null);
    const uploadMaxMiB = parseUploadMaxMiBDraft(uploadMaxMiBDraft);
    if (!uploadMaxMiB) {
      setFilesystemSettingsError('Upload max file size must be a whole number of MiB.');
      return;
    }
    const uploadMaxBytes = miBToBytes(uploadMaxMiB);
    const minBytes = query.data?.filesystem.minUploadMaxBytes ?? null;
    const maxBytes = query.data?.filesystem.maxUploadMaxBytes ?? null;
    if ((minBytes != null && uploadMaxBytes < minBytes) || (maxBytes != null && uploadMaxBytes > maxBytes)) {
      const minMiB = minBytes != null ? bytesToMinMiB(minBytes) : 1;
      const maxMiB = maxBytes != null ? bytesToMaxMiB(maxBytes, minMiB) : 8192;
      setFilesystemSettingsError(`Upload max file size must be between ${minMiB} and ${maxMiB} MiB.`);
      return;
    }

    try {
      const data = await saveMutation.mutateAsync({ uploadMaxBytes });
      queryClient.setQueryData(queryKey, data);
      applySettings(data);
      const savedMiB = bytesToNearestMiB(data.filesystem.uploadMaxBytes);
      setFilesystemSettingsNotice(`Saved upload max file size to ${savedMiB} MiB.`);
    } catch (error) {
      setFilesystemSettingsError(settingsErrorMessage(error));
    }
  }, [applySettings, query.data?.filesystem.maxUploadMaxBytes, query.data?.filesystem.minUploadMaxBytes, queryClient, queryKey, saveMutation, uploadMaxMiBDraft]);

  return {
    filesystemSettings: query.data ?? null,
    filesystemSettingsLoading: query.isFetching,
    filesystemSettingsError: settingsQueryError(filesystemSettingsError, false, query),
    filesystemSettingsNotice,
    uploadMaxMiBDraft,
    savingFilesystemSettings: saveMutation.isPending,
    setUploadMaxMiBDraft,
    loadFilesystemSettings,
    saveFilesystemSettings,
  };
}
