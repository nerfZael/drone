import React from 'react';
import type {
  AgentsFileResponse,
  AgentsMdFile,
  AgentsSettingsResponse,
} from './settings-types';
import { prepareAgentsMdUpload } from './agents-md-file-import';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

function normalizeAgentsSettingsResponse(data: AgentsSettingsResponse): AgentsSettingsResponse {
  return { ...data, files: Array.isArray(data.files) ? data.files : [] };
}

export type UseAgentsSettingsResult = {
  agentsSettings: AgentsSettingsResponse | null;
  agentsSettingsLoading: boolean;
  agentsSettingsError: string | null;
  agentsSettingsNotice: string | null;
  agentsContentDraft: string;
  savingAgentsSettings: boolean;
  selectedAgentsFile: AgentsMdFile | null;
  creatingAgentsFile: boolean;
  agentsFileDraftName: string;
  agentsFileDraftContent: string;
  agentsFileLoading: boolean;
  savingAgentsFile: boolean;
  deletingAgentsFile: boolean;
  importingAgentsFiles: boolean;
  agentsFileDraftDirty: boolean;
  setAgentsContentDraft: React.Dispatch<React.SetStateAction<string>>;
  setAgentsFileDraftName: React.Dispatch<React.SetStateAction<string>>;
  setAgentsFileDraftContent: React.Dispatch<React.SetStateAction<string>>;
  loadAgentsSettings: () => Promise<void>;
  saveAgentsSettings: () => Promise<void>;
  selectAgentsFile: (fileId: string) => Promise<void>;
  beginAgentsFile: () => void;
  closeAgentsFile: () => void;
  saveAgentsFile: () => Promise<void>;
  deleteAgentsFile: () => Promise<void>;
  importAgentsFiles: (files: File[]) => Promise<void>;
};

export function useAgentsSettings(requestJson: RequestJsonFn): UseAgentsSettingsResult {
  const [agentsSettings, setAgentsSettings] = React.useState<AgentsSettingsResponse | null>(null);
  const [agentsSettingsLoading, setAgentsSettingsLoading] = React.useState(false);
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

  React.useEffect(() => {
    selectedAgentsFileRef.current = selectedAgentsFile;
  }, [selectedAgentsFile]);

  const setFileDraft = React.useCallback((file: AgentsMdFile | null) => {
    setSelectedAgentsFile(file);
    setAgentsFileDraftName(file?.name ?? '');
    setAgentsFileDraftContent(file?.content ?? '');
  }, []);

  const loadAgentsSettings = React.useCallback(async () => {
    setAgentsSettingsLoading(true);
    setAgentsSettingsError(null);
    setAgentsSettingsNotice(null);
    try {
      const response = await requestJson<AgentsSettingsResponse>('/api/settings/agents');
      const data = normalizeAgentsSettingsResponse(response);
      setAgentsSettings(data);
      setAgentsContentDraft(data.agents.content);
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
    } catch (e: any) {
      setAgentsSettingsError(e?.message ?? String(e));
    } finally {
      setAgentsSettingsLoading(false);
    }
  }, [requestJson, setFileDraft]);

  React.useEffect(() => {
    void loadAgentsSettings();
  }, [loadAgentsSettings]);

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
      setAgentsSettings(data);
      setAgentsContentDraft(data.agents.content);
      setAgentsSettingsNotice(
        data.agents.enabled ? 'Saved default AGENTS.md for repo-attached container drones.' : 'Cleared the default AGENTS.md.',
      );
    } catch (e: any) {
      setAgentsSettingsError(e?.message ?? String(e));
    } finally {
      setSavingAgentsSettings(false);
    }
  }, [agentsContentDraft, requestJson]);

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
      setAgentsSettings(normalizeAgentsSettingsResponse(data));
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
      setAgentsSettings(normalizeAgentsSettingsResponse(data));
      setCreatingAgentsFile(false);
      setFileDraft(null);
      setAgentsSettingsNotice(`Deleted ${file.name}.`);
    } catch (e: any) {
      setAgentsSettingsError(e?.message ?? String(e));
    } finally {
      setDeletingAgentsFile(false);
    }
  }, [requestJson, selectedAgentsFile, setFileDraft]);

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
        if (latestSettings) setAgentsSettings(latestSettings);
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
    [requestJson, setFileDraft],
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
    agentsSettingsLoading,
    agentsSettingsError,
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
