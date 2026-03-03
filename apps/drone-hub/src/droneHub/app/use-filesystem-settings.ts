import React from 'react';
import {
  bytesToMaxMiB,
  bytesToMinMiB,
  bytesToNearestMiB,
  miBToBytes,
  parseUploadMaxMiBDraft,
} from './filesystem-size-utils';
import type { FilesystemSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseFilesystemSettingsResult = {
  filesystemSettings: FilesystemSettingsResponse | null;
  filesystemSettingsLoading: boolean;
  filesystemSettingsError: string | null;
  filesystemSettingsNotice: string | null;
  uploadMaxMiBDraft: string;
  savingFilesystemSettings: boolean;
  setUploadMaxMiBDraft: React.Dispatch<React.SetStateAction<string>>;
  loadFilesystemSettings: () => Promise<void>;
  saveFilesystemSettings: () => Promise<void>;
};

export function useFilesystemSettings(requestJson: RequestJsonFn): UseFilesystemSettingsResult {
  const [filesystemSettings, setFilesystemSettings] = React.useState<FilesystemSettingsResponse | null>(null);
  const [filesystemSettingsLoading, setFilesystemSettingsLoading] = React.useState(false);
  const [filesystemSettingsError, setFilesystemSettingsError] = React.useState<string | null>(null);
  const [filesystemSettingsNotice, setFilesystemSettingsNotice] = React.useState<string | null>(null);
  const [uploadMaxMiBDraft, setUploadMaxMiBDraft] = React.useState('2048');
  const [savingFilesystemSettings, setSavingFilesystemSettings] = React.useState(false);

  const loadFilesystemSettings = React.useCallback(async () => {
    setFilesystemSettingsLoading(true);
    setFilesystemSettingsError(null);
    setFilesystemSettingsNotice(null);
    try {
      const data = await requestJson<FilesystemSettingsResponse>('/api/settings/filesystem');
      setFilesystemSettings(data);
      setUploadMaxMiBDraft(String(bytesToNearestMiB(data.filesystem.uploadMaxBytes)));
    } catch (e: any) {
      setFilesystemSettingsError(e?.message ?? String(e));
    } finally {
      setFilesystemSettingsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadFilesystemSettings();
  }, [loadFilesystemSettings]);

  const saveFilesystemSettings = React.useCallback(async () => {
    setFilesystemSettingsError(null);
    setFilesystemSettingsNotice(null);
    const uploadMaxMiB = parseUploadMaxMiBDraft(uploadMaxMiBDraft);
    if (!uploadMaxMiB) {
      setFilesystemSettingsError('Upload max file size must be a whole number of MiB.');
      return;
    }
    const uploadMaxBytes = miBToBytes(uploadMaxMiB);
    const minBytes = filesystemSettings?.filesystem.minUploadMaxBytes ?? null;
    const maxBytes = filesystemSettings?.filesystem.maxUploadMaxBytes ?? null;
    if ((minBytes != null && uploadMaxBytes < minBytes) || (maxBytes != null && uploadMaxBytes > maxBytes)) {
      const minMiB = minBytes != null ? bytesToMinMiB(minBytes) : 1;
      const maxMiB = maxBytes != null ? bytesToMaxMiB(maxBytes, minMiB) : 8192;
      setFilesystemSettingsError(`Upload max file size must be between ${minMiB} and ${maxMiB} MiB.`);
      return;
    }

    setSavingFilesystemSettings(true);
    try {
      const data = await requestJson<FilesystemSettingsResponse>('/api/settings/filesystem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploadMaxBytes }),
      });
      setFilesystemSettings(data);
      const savedMiB = bytesToNearestMiB(data.filesystem.uploadMaxBytes);
      setUploadMaxMiBDraft(String(savedMiB));
      setFilesystemSettingsNotice(`Saved upload max file size to ${savedMiB} MiB.`);
    } catch (e: any) {
      setFilesystemSettingsError(e?.message ?? String(e));
    } finally {
      setSavingFilesystemSettings(false);
    }
  }, [filesystemSettings?.filesystem.maxUploadMaxBytes, filesystemSettings?.filesystem.minUploadMaxBytes, requestJson, uploadMaxMiBDraft]);

  return {
    filesystemSettings,
    filesystemSettingsLoading,
    filesystemSettingsError,
    filesystemSettingsNotice,
    uploadMaxMiBDraft,
    savingFilesystemSettings,
    setUploadMaxMiBDraft,
    loadFilesystemSettings,
    saveFilesystemSettings,
  };
}
