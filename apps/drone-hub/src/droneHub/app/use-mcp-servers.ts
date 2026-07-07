import React from 'react';
import {
  createEmptyMcpServerDraft,
  draftFromMcpServer,
  payloadFromMcpDraft,
  sanitizeMcpDraftForComparison,
  sortMcpServers,
  type McpAgentId,
  type McpServerDraft,
  type McpServerDraftScalarKey,
  type McpServerRecord,
} from './mcp-server-library-model';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type McpServersListResponse = {
  ok: true;
  servers: McpServerRecord[];
};

export type McpAccessTokenSummary = {
  id: string;
  name: string;
  kind: 'host' | 'drone';
  droneId?: string;
  tokenPreview: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

type McpServerMutationResponse = {
  ok: true;
  server: McpServerRecord;
};

type McpTokensListResponse = {
  ok: true;
  tokens: McpAccessTokenSummary[];
};

type McpTokenMutationResponse = {
  ok: true;
  token: McpAccessTokenSummary;
  tokenValue?: string;
};

function replaceServer(servers: McpServerRecord[], server: McpServerRecord): McpServerRecord[] {
  const next = servers.filter((entry) => entry.id !== server.id);
  next.push(server);
  return sortMcpServers(next);
}

export type UseMcpServersResult = {
  mcpServers: McpServerRecord[];
  mcpAccessTokens: McpAccessTokenSummary[];
  mcpServersLoading: boolean;
  mcpServersSaving: boolean;
  mcpServersDeleting: boolean;
  mcpAccessTokensLoading: boolean;
  mcpAccessTokensSaving: boolean;
  mcpServersError: string | null;
  mcpServersNotice: string | null;
  mcpHostTokenName: string;
  mcpTokenRevealValue: string | null;
  selectedMcpServerId: string | null;
  selectedMcpServer: McpServerRecord | null;
  mcpDraft: McpServerDraft;
  mcpDraftDirty: boolean;
  loadMcpServers: () => Promise<void>;
  loadMcpAccessTokens: () => Promise<void>;
  setMcpHostTokenName: (value: string) => void;
  createHostMcpToken: () => Promise<void>;
  regenerateMcpToken: (tokenId: string) => Promise<void>;
  revokeMcpToken: (tokenId: string) => Promise<void>;
  clearMcpTokenRevealValue: () => void;
  selectMcpServer: (serverId: string | null) => void;
  startNewMcpServer: () => void;
  updateMcpDraftField: <K extends McpServerDraftScalarKey>(key: K, value: McpServerDraft[K]) => void;
  toggleMcpDraftAgent: (agent: McpAgentId) => void;
  resetMcpDraft: () => void;
  saveMcpDraft: () => Promise<void>;
  deleteSelectedMcpServer: () => Promise<void>;
  upsertDroneHubMcpServer: () => Promise<void>;
  clearMcpServersError: () => void;
  clearMcpServersNotice: () => void;
};

export function useMcpServers(requestJson: RequestJsonFn): UseMcpServersResult {
  const [mcpServers, setMcpServers] = React.useState<McpServerRecord[]>([]);
  const [mcpAccessTokens, setMcpAccessTokens] = React.useState<McpAccessTokenSummary[]>([]);
  const [mcpServersLoading, setMcpServersLoading] = React.useState(false);
  const [mcpServersSaving, setMcpServersSaving] = React.useState(false);
  const [mcpServersDeleting, setMcpServersDeleting] = React.useState(false);
  const [mcpAccessTokensLoading, setMcpAccessTokensLoading] = React.useState(false);
  const [mcpAccessTokensSaving, setMcpAccessTokensSaving] = React.useState(false);
  const [mcpServersError, setMcpServersError] = React.useState<string | null>(null);
  const [mcpServersNotice, setMcpServersNotice] = React.useState<string | null>(null);
  const [mcpHostTokenName, setMcpHostTokenName] = React.useState('host agent');
  const [mcpTokenRevealValue, setMcpTokenRevealValue] = React.useState<string | null>(null);
  const [selectedMcpServerId, setSelectedMcpServerId] = React.useState<string | null>(null);
  const [mcpDraft, setMcpDraft] = React.useState<McpServerDraft>(() => createEmptyMcpServerDraft());
  const [baselineDraft, setBaselineDraft] = React.useState<McpServerDraft>(() => createEmptyMcpServerDraft());
  const selectedMcpServerIdRef = React.useRef<string | null>(selectedMcpServerId);

  React.useEffect(() => {
    selectedMcpServerIdRef.current = selectedMcpServerId;
  }, [selectedMcpServerId]);

  const selectedMcpServer = React.useMemo(
    () => mcpServers.find((server) => server.id === selectedMcpServerId) ?? null,
    [mcpServers, selectedMcpServerId],
  );

  const mcpDraftDirty = React.useMemo(
    () => sanitizeMcpDraftForComparison(mcpDraft) !== sanitizeMcpDraftForComparison(baselineDraft),
    [baselineDraft, mcpDraft],
  );

  const applySelectedServer = React.useCallback((server: McpServerRecord | null) => {
    setSelectedMcpServerId(server?.id ?? null);
    const nextDraft = server ? draftFromMcpServer(server) : createEmptyMcpServerDraft();
    setMcpDraft(nextDraft);
    setBaselineDraft(nextDraft);
  }, []);

  const loadMcpServers = React.useCallback(async () => {
    setMcpServersLoading(true);
    setMcpServersError(null);
    try {
      const data = await requestJson<McpServersListResponse>('/api/mcp-servers');
      const nextServers = sortMcpServers(data.servers ?? []);
      setMcpServers(nextServers);
      const nextSelected =
        nextServers.find((server) => server.id === selectedMcpServerIdRef.current) ??
        nextServers[0] ??
        null;
      applySelectedServer(nextSelected);
    } catch (e: any) {
      setMcpServersError(e?.message ?? String(e));
    } finally {
      setMcpServersLoading(false);
    }
  }, [applySelectedServer, requestJson]);

  const loadMcpAccessTokens = React.useCallback(async () => {
    setMcpAccessTokensLoading(true);
    setMcpServersError(null);
    try {
      const data = await requestJson<McpTokensListResponse>('/api/mcp-tokens');
      setMcpAccessTokens([...(data.tokens ?? [])].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)));
    } catch (e: any) {
      setMcpServersError(e?.message ?? String(e));
    } finally {
      setMcpAccessTokensLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadMcpServers();
    void loadMcpAccessTokens();
  }, [loadMcpAccessTokens, loadMcpServers]);

  const replaceToken = React.useCallback((token: McpAccessTokenSummary) => {
    setMcpAccessTokens((prev) => {
      const next = prev.filter((entry) => entry.id !== token.id);
      next.push(token);
      return next.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    });
  }, []);

  const createHostMcpToken = React.useCallback(async () => {
    setMcpAccessTokensSaving(true);
    setMcpServersError(null);
    setMcpServersNotice(null);
    setMcpTokenRevealValue(null);
    try {
      const data = await requestJson<McpTokenMutationResponse>('/api/mcp-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: mcpHostTokenName.trim(), kind: 'host' }),
      });
      replaceToken(data.token);
      setMcpTokenRevealValue(data.tokenValue ?? null);
      setMcpServersNotice(`Created MCP token ${data.token.name}.`);
    } catch (e: any) {
      setMcpServersError(e?.message ?? String(e));
    } finally {
      setMcpAccessTokensSaving(false);
    }
  }, [mcpHostTokenName, replaceToken, requestJson]);

  const regenerateMcpToken = React.useCallback(async (tokenId: string) => {
    setMcpAccessTokensSaving(true);
    setMcpServersError(null);
    setMcpServersNotice(null);
    setMcpTokenRevealValue(null);
    try {
      const data = await requestJson<McpTokenMutationResponse>(`/api/mcp-tokens/${encodeURIComponent(tokenId)}/regenerate`, {
        method: 'POST',
      });
      replaceToken(data.token);
      setMcpTokenRevealValue(data.tokenValue ?? null);
      setMcpServersNotice(`Regenerated MCP token ${data.token.name}.`);
    } catch (e: any) {
      setMcpServersError(e?.message ?? String(e));
    } finally {
      setMcpAccessTokensSaving(false);
    }
  }, [replaceToken, requestJson]);

  const revokeMcpToken = React.useCallback(async (tokenId: string) => {
    setMcpAccessTokensSaving(true);
    setMcpServersError(null);
    setMcpServersNotice(null);
    setMcpTokenRevealValue(null);
    try {
      const data = await requestJson<McpTokenMutationResponse>(`/api/mcp-tokens/${encodeURIComponent(tokenId)}`, {
        method: 'DELETE',
      });
      replaceToken(data.token);
      setMcpServersNotice(`Revoked MCP token ${data.token.name}.`);
    } catch (e: any) {
      setMcpServersError(e?.message ?? String(e));
    } finally {
      setMcpAccessTokensSaving(false);
    }
  }, [replaceToken, requestJson]);

  const selectMcpServer = React.useCallback(
    (serverId: string | null) => {
      const next = serverId ? mcpServers.find((server) => server.id === serverId) ?? null : null;
      applySelectedServer(next);
    },
    [applySelectedServer, mcpServers],
  );

  const startNewMcpServer = React.useCallback(() => {
    applySelectedServer(null);
    setMcpServersError(null);
    setMcpServersNotice('Creating a new MCP server draft.');
  }, [applySelectedServer]);

  const updateMcpDraftField = React.useCallback(<K extends McpServerDraftScalarKey>(key: K, value: McpServerDraft[K]) => {
    setMcpDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleMcpDraftAgent = React.useCallback((agent: McpAgentId) => {
    setMcpDraft((prev) => {
      const hasAgent = prev.agents.includes(agent);
      const agents = hasAgent ? prev.agents.filter((entry) => entry !== agent) : [...prev.agents, agent];
      return { ...prev, agents };
    });
  }, []);

  const resetMcpDraft = React.useCallback(() => {
    const nextDraft = selectedMcpServer ? draftFromMcpServer(selectedMcpServer) : createEmptyMcpServerDraft();
    setMcpDraft(nextDraft);
    setBaselineDraft(nextDraft);
    setMcpServersError(null);
    setMcpServersNotice(selectedMcpServer ? `Reverted changes for ${selectedMcpServer.name}.` : 'Cleared draft.');
  }, [selectedMcpServer]);

  const saveMcpDraft = React.useCallback(async () => {
    setMcpServersSaving(true);
    setMcpServersError(null);
    setMcpServersNotice(null);
    try {
      const payload = payloadFromMcpDraft(mcpDraft);
      const data = mcpDraft.id
        ? await requestJson<McpServerMutationResponse>(`/api/mcp-servers/${encodeURIComponent(mcpDraft.id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await requestJson<McpServerMutationResponse>('/api/mcp-servers', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const saved = data.server;
      setMcpServers((prev) => replaceServer(prev, saved));
      applySelectedServer(saved);
      setMcpServersNotice(mcpDraft.id ? `Saved ${saved.name}.` : `Created ${saved.name}.`);
    } catch (e: any) {
      setMcpServersError(e?.message ?? String(e));
    } finally {
      setMcpServersSaving(false);
    }
  }, [applySelectedServer, mcpDraft, requestJson]);

  const deleteSelectedMcpServer = React.useCallback(async () => {
    if (!selectedMcpServerId) return;
    setMcpServersDeleting(true);
    setMcpServersError(null);
    setMcpServersNotice(null);
    try {
      await requestJson<{ ok: true; deleted: true; id: string }>(`/api/mcp-servers/${encodeURIComponent(selectedMcpServerId)}`, {
        method: 'DELETE',
      });
      const nextServers = mcpServers.filter((server) => server.id !== selectedMcpServerId);
      setMcpServers(nextServers);
      applySelectedServer(nextServers[0] ?? null);
      setMcpServersNotice('Deleted MCP server.');
    } catch (e: any) {
      setMcpServersError(e?.message ?? String(e));
    } finally {
      setMcpServersDeleting(false);
    }
  }, [applySelectedServer, mcpServers, requestJson, selectedMcpServerId]);

  const upsertDroneHubMcpServer = React.useCallback(async () => {
    setMcpServersSaving(true);
    setMcpServersError(null);
    setMcpServersNotice(null);
    try {
      const data = await requestJson<McpServerMutationResponse>('/api/mcp-servers/drone-hub-preset', {
        method: 'POST',
      });
      const saved = data.server;
      setMcpServers((prev) => replaceServer(prev, saved));
      applySelectedServer(saved);
      void loadMcpAccessTokens();
      setMcpServersNotice('Saved Drone Hub MCP server.');
    } catch (e: any) {
      setMcpServersError(e?.message ?? String(e));
    } finally {
      setMcpServersSaving(false);
    }
  }, [applySelectedServer, loadMcpAccessTokens, requestJson]);

  return {
    mcpServers,
    mcpAccessTokens,
    mcpServersLoading,
    mcpServersSaving,
    mcpServersDeleting,
    mcpAccessTokensLoading,
    mcpAccessTokensSaving,
    mcpServersError,
    mcpServersNotice,
    mcpHostTokenName,
    mcpTokenRevealValue,
    selectedMcpServerId,
    selectedMcpServer,
    mcpDraft,
    mcpDraftDirty,
    loadMcpServers,
    loadMcpAccessTokens,
    setMcpHostTokenName,
    createHostMcpToken,
    regenerateMcpToken,
    revokeMcpToken,
    clearMcpTokenRevealValue: () => setMcpTokenRevealValue(null),
    selectMcpServer,
    startNewMcpServer,
    updateMcpDraftField,
    toggleMcpDraftAgent,
    resetMcpDraft,
    saveMcpDraft,
    deleteSelectedMcpServer,
    upsertDroneHubMcpServer,
    clearMcpServersError: () => setMcpServersError(null),
    clearMcpServersNotice: () => setMcpServersNotice(null),
  };
}
