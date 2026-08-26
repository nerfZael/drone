import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AgentsFileResponse,
  AgentsMdFile,
  AgentsSettingsResponse,
} from './settings-types';
import { prepareAgentsMdUpload } from './agents-md-file-import';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

function normalizeAgentsSettingsResponse(data: AgentsSettingsResponse): AgentsSettingsResponse {
  return { ...data, files: Array.isArray(data.files) ? data.files : [] };
}

export type UseAgentsSettingsResult = ReturnType<typeof useAgentsSettings>;

export function useAgentsSettings(requestJson: RequestJsonFn, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = settingsQueryKey('agents');
  const query = useSettingsQuery<AgentsSettingsResponse>(requestJson, queryKey, '/api/settings/agents', enabled);
  const [agentsSettingsError, setAgentsSettingsError] = React.useState<string | null>(null);
  const [agentsSettingsNotice, setAgentsSettingsNotice] = React.useState<string | null>(null);
  const [agentsContentDraft, setAgentsContentDraft] = React.useState('');
  const [savingAgentsSettings, setSavingAgentsSettings] = React.useState(false);
  const [selectedAgentsFile, setSelectedAgentsFile] = React.useState<AgentsMdFile | null>(null);
  const selectedAgentsFileRef = React.useRef<AgentsMdFile | null>(null);
  const [creatingAgentsFile, setCreatingAgentsFile] = React.useState(false);
  const [agentsFileDraftName, setAgentsFileDraftName] = React.useState('');
  const [agentsFileDraftContent, setAgentsFileDraftContent] = React.useState('');
  const [agentsFileLoading, setAgentsFileLoading] = React.useState(false);
  const [savingAgentsFile, setSavingAgentsFile] = React.useState(false);
  const [deletingAgentsFile, setDeletingAgentsFile] = React.useState(false);
  const [importingAgentsFiles, setImportingAgentsFiles] = React.useState(false);
  const appliedAgentsContentRef = React.useRef<string | null>(null);
  const agentsSettings = React.useMemo(
    () => (query.data ? normalizeAgentsSettingsResponse(query.data) : null),
    [query.data],
  );

  React.useEffect(() => {
    selectedAgentsFileRef.current = selectedAgentsFile;
  }, [selectedAgentsFile]);

  const setFileDraft = React.useCallback((file: AgentsMdFile | null) => {
    setSelectedAgentsFile(file);
    setAgentsFileDraftName(file?.name ?? '');
    setAgentsFileDraftContent(file?.content ?? '');
  }, []);

  const applyAgentsContent = React.useCallback((data: AgentsSettingsResponse) => {
    appliedAgentsContentRef.current = data.agents.content;
    setAgentsContentDraft(data.agents.content);
  }, []);

  React.useEffect(() => {
    if (!query.data) return;
    const data = normalizeAgentsSettingsResponse(query.data);
    if (appliedAgentsContentRef.current !== data.agents.content) applyAgentsContent(data);
    const selectedFileId = selectedAgentsFileRef.current?.id;
    if (!selectedFileId || !data.files.some((file) => file.id === selectedFileId)) {
      setFileDraft(null);
      setCreatingAgentsFile(false);
    }
  }, [applyAgentsContent, query.data, setFileDraft]);

  const loadAgentsSettings = React.useCallback(async () => {
    setAgentsSettingsError(null);
    setAgentsSettingsNotice(null);
    try {
      const result = await query.refetch();
      if (result.error) throw result.error;
      if (!result.data) return;
      const response = result.data;
      const data = normalizeAgentsSettingsResponse(response);
      applyAgentsContent(data);
      const selectedFileId = selectedAgentsFileRef.current?.id;
      if (selectedFileId && data.files.some((file) => file.id === selectedFileId)) {
        const detail = await requestJson<{ ok: true; file: AgentsMdFile }>(
          `/api/settings/agents/files/${encodeURIComponent(selectedFileId)}`,
        );
        setFileDraft(detail.file);
      } else {
        setFileDraft(null);
        setCreatingAgentsFile(false);
      }
    } catch (error) {
      setAgentsSettingsError(settingsErrorMessage(error));
    }
  }, [applyAgentsContent, query.refetch, requestJson, setFileDraft]);

  const saveAgentsSettings = React.useCallback(async () => {
    setAgentsSettingsError(null);
    setAgentsSettingsNotice(null);
    setSavingAgentsSettings(true);
    try {
      const response = await requestJson<AgentsSettingsResponse>('/api/settings/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: agentsContentDraft }),
      });
      const data = normalizeAgentsSettingsResponse(response);
      queryClient.setQueryData(queryKey, data);
      applyAgentsContent(data);
      setAgentsSettingsNotice(
        data.agents.enabled ? 'Saved default AGENTS.md for repo-attached container drones.' : 'Cleared the default AGENTS.md.',
      );
    } catch (e: any) {
      setAgentsSettingsError(e?.message ?? String(e));
    } finally {
      setSavingAgentsSettings(false);
    }
  }, [agentsContentDraft, applyAgentsContent, queryClient, queryKey, requestJson]);

  const selectAgentsFile = React.useCallback(
    async (fileId: string) => {
      const cleanId = String(fileId ?? '').trim();
      if (!cleanId) return;
      setAgentsSettingsError(null);
      setAgentsSettingsNotice(null);
      setAgentsFileLoading(true);
      try {
        const data = await requestJson<{ ok: true; file: AgentsMdFile }>(
          `/api/settings/agents/files/${encodeURIComponent(cleanId)}`,
        );
        setCreatingAgentsFile(false);
        setFileDraft(data.file);
      } catch (e: any) {
        setAgentsSettingsError(e?.message ?? String(e));
      } finally {
        setAgentsFileLoading(false);
      }
    },
    [requestJson, setFileDraft],
  );

  const beginAgentsFile = React.useCallback(() => {
    setAgentsSettingsError(null);
    setAgentsSettingsNotice(null);
    setCreatingAgentsFile(true);
    setFileDraft(null);
  }, [setFileDraft]);

  const closeAgentsFile = React.useCallback(() => {
    setCreatingAgentsFile(false);
    setFileDraft(null);
  }, [setFileDraft]);

  const saveAgentsFile = React.useCallback(async () => {
    setAgentsSettingsError(null);
    setAgentsSettingsNotice(null);
    setSavingAgentsFile(true);
    try {
      const fileId = selectedAgentsFile?.id;
      const data = await requestJson<AgentsFileResponse>(
        fileId
          ? `/api/settings/agents/files/${encodeURIComponent(fileId)}`
          : '/api/settings/agents/files',
        {
          method: fileId ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: agentsFileDraftName,
            content: agentsFileDraftContent,
          }),
        },
      );
      queryClient.setQueryData(queryKey, normalizeAgentsSettingsResponse(data));
      setCreatingAgentsFile(false);
      setFileDraft(data.file);
      setAgentsSettingsNotice(
        fileId ? `Saved ${data.file.name}.` : `Added ${data.file.name} to the AGENTS.md library.`,
      );
    } catch (e: any) {
      setAgentsSettingsError(e?.message ?? String(e));
    } finally {
      setSavingAgentsFile(false);
    }
  }, [
    agentsFileDraftContent,
    agentsFileDraftName,
    queryClient,
    queryKey,
    requestJson,
    selectedAgentsFile?.id,
    setFileDraft,
  ]);

  const deleteAgentsFile = React.useCallback(async () => {
    const file = selectedAgentsFile;
    if (!file) return;
    setAgentsSettingsError(null);
    setAgentsSettingsNotice(null);
    setDeletingAgentsFile(true);
    try {
      const data = await requestJson<AgentsSettingsResponse>(
        `/api/settings/agents/files/${encodeURIComponent(file.id)}`,
        { method: 'DELETE' },
      );
      queryClient.setQueryData(queryKey, normalizeAgentsSettingsResponse(data));
      setCreatingAgentsFile(false);
      setFileDraft(null);
      setAgentsSettingsNotice(`Deleted ${file.name}.`);
    } catch (e: any) {
      setAgentsSettingsError(e?.message ?? String(e));
    } finally {
      setDeletingAgentsFile(false);
    }
  }, [queryClient, queryKey, requestJson, selectedAgentsFile, setFileDraft]);

  const importAgentsFiles = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setAgentsSettingsError(null);
      setAgentsSettingsNotice(null);
      setImportingAgentsFiles(true);
      let imported = 0;
      let latestFile: AgentsMdFile | null = null;
      let latestSettings: AgentsSettingsResponse | null = null;
      const failures: string[] = [];
      try {
        for (const file of files) {
          try {
            const prepared = await prepareAgentsMdUpload(file);
            const data = await requestJson<AgentsFileResponse>('/api/settings/agents/files', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(prepared),
            });
            latestSettings = normalizeAgentsSettingsResponse(data);
            latestFile = data.file;
            imported += 1;
          } catch (error: any) {
            failures.push(`${file.name || 'File'}: ${error?.message ?? String(error)}`);
          }
        }
        if (latestSettings) queryClient.setQueryData(queryKey, latestSettings);
        if (latestFile) {
          setCreatingAgentsFile(false);
          setFileDraft(latestFile);
        }
        if (imported > 0) {
          setAgentsSettingsNotice(
            `Imported ${imported} AGENTS.md ${imported === 1 ? 'file' : 'files'}.`,
          );
        }
        if (failures.length > 0) {
          setAgentsSettingsError(
            `${failures.length} ${failures.length === 1 ? 'file was' : 'files were'} not imported:\n${failures.join('\n')}`,
          );
        }
      } finally {
        setImportingAgentsFiles(false);
      }
    },
    [queryClient, queryKey, requestJson, setFileDraft],
  );

  const agentsFileDraftDirty = creatingAgentsFile
    ? Boolean(agentsFileDraftName || agentsFileDraftContent)
    : Boolean(
        selectedAgentsFile &&
          (agentsFileDraftName !== selectedAgentsFile.name ||
            agentsFileDraftContent !== selectedAgentsFile.content),
      );

  return {
    agentsSettings,
    agentsSettingsLoading: query.isFetching,
    agentsSettingsError: settingsQueryError(agentsSettingsError, false, query),
    agentsSettingsNotice,
    agentsContentDraft,
    savingAgentsSettings,
    selectedAgentsFile,
    creatingAgentsFile,
    agentsFileDraftName,
    agentsFileDraftContent,
    agentsFileLoading,
    savingAgentsFile,
    deletingAgentsFile,
    importingAgentsFiles,
    agentsFileDraftDirty,
    setAgentsContentDraft,
    setAgentsFileDraftName,
    setAgentsFileDraftContent,
    loadAgentsSettings,
    saveAgentsSettings,
    selectAgentsFile,
    beginAgentsFile,
    closeAgentsFile,
    saveAgentsFile,
    deleteAgentsFile,
    importAgentsFiles,
  };
}
