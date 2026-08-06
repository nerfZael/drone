import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsQuery } from './settings-query';

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
type McpTokenMutation =
  | { action: 'create'; name: string }
  | { action: 'regenerate'; tokenId: string }
  | { action: 'revoke'; tokenId: string };
type McpServerMutation =
  | { action: 'save'; draft: McpServerDraft }
  | { action: 'delete'; serverId: string }
  | { action: 'preset' };

function replaceServer(servers: McpServerRecord[], server: McpServerRecord): McpServerRecord[] {
  const next = servers.filter((entry) => entry.id !== server.id);
  next.push(server);
  return sortMcpServers(next);
}

export type UseMcpServersResult = ReturnType<typeof useMcpServers>;

export function useMcpServers(requestJson: RequestJsonFn) {
  const queryClient = useQueryClient();
  const serversQueryKey = settingsQueryKey('mcp-servers');
  const tokensQueryKey = settingsQueryKey('mcp-access-tokens');
  const serversQuery = useSettingsQuery<McpServersListResponse>(requestJson, serversQueryKey, '/api/mcp-servers');
  const tokensQuery = useSettingsQuery<McpTokensListResponse>(requestJson, tokensQueryKey, '/api/mcp-tokens');
  const [mcpServersError, setMcpServersError] = React.useState<string | null>(null);
  const [queryErrorDismissed, setQueryErrorDismissed] = React.useState(false);
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

  const mcpServers = React.useMemo(
    () => sortMcpServers(serversQuery.data?.servers ?? []),
    [serversQuery.data],
  );
  const mcpAccessTokens = React.useMemo(
    () => sortTokens(tokensQuery.data?.tokens ?? []),
    [tokensQuery.data],
  );

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

  React.useEffect(() => {
    if (!serversQuery.data) return;
    const nextSelected =
      mcpServers.find((server) => server.id === selectedMcpServerIdRef.current) ??
      mcpServers[0] ??
      null;
    applySelectedServer(nextSelected);
  }, [applySelectedServer, mcpServers, serversQuery.data]);

  const loadMcpServers = React.useCallback(async () => {
    setQueryErrorDismissed(false);
    setMcpServersError(null);
    const { data } = await serversQuery.refetch();
    if (!data) return;
    const servers = sortMcpServers(data.servers ?? []);
    const selected =
      servers.find((server) => server.id === selectedMcpServerIdRef.current) ??
      servers[0] ??
      null;
    applySelectedServer(selected);
  }, [applySelectedServer, serversQuery.refetch]);

  const loadMcpAccessTokens = React.useCallback(async () => {
    setQueryErrorDismissed(false);
    setMcpServersError(null);
    await tokensQuery.refetch();
  }, [tokensQuery.refetch]);

  const replaceToken = React.useCallback((token: McpAccessTokenSummary) => {
    queryClient.setQueryData<McpTokensListResponse>(tokensQueryKey, (current) => ({
      ok: true,
      tokens: sortTokens([...(current?.tokens ?? []).filter((entry) => entry.id !== token.id), token]),
    }));
  }, [queryClient, tokensQueryKey]);

  const tokenMutation = useMutation({
    mutationFn: (input: McpTokenMutation) => {
      if (input.action === 'create') {
        return requestJson<McpTokenMutationResponse>('/api/mcp-tokens', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: input.name, kind: 'host' }),
        });
      }
      const suffix = input.action === 'regenerate' ? '/regenerate' : '';
      return requestJson<McpTokenMutationResponse>(
        `/api/mcp-tokens/${encodeURIComponent(input.tokenId)}${suffix}`,
        { method: input.action === 'regenerate' ? 'POST' : 'DELETE' },
      );
    },
  });
  const serverMutation = useMutation({
    mutationFn: async (input: McpServerMutation) => {
      if (input.action === 'delete') {
        await requestJson<{ ok: true; deleted: true; id: string }>(
          `/api/mcp-servers/${encodeURIComponent(input.serverId)}`,
          { method: 'DELETE' },
        );
        return { action: input.action } as const;
      }
      if (input.action === 'preset') {
        const data = await requestJson<McpServerMutationResponse>('/api/mcp-servers/drone-hub-preset', {
          method: 'POST',
        });
        return { action: input.action, server: data.server } as const;
      }
      const payload = payloadFromMcpDraft(input.draft);
      const data = await requestJson<McpServerMutationResponse>(
        input.draft.id ? `/api/mcp-servers/${encodeURIComponent(input.draft.id)}` : '/api/mcp-servers',
        {
          method: input.draft.id ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      return { action: input.action, server: data.server } as const;
    },
  });

  const mutateToken = React.useCallback(async (input: McpTokenMutation) => {
    setMcpServersError(null);
    setMcpServersNotice(null);
    setMcpTokenRevealValue(null);
    try {
      const data = await tokenMutation.mutateAsync(input);
      replaceToken(data.token);
      setMcpTokenRevealValue(data.tokenValue ?? null);
      const action = input.action === 'create' ? 'Created' : input.action === 'regenerate' ? 'Regenerated' : 'Revoked';
      setMcpServersNotice(`${action} MCP token ${data.token.name}.`);
    } catch (error) {
      setMcpServersError(settingsErrorMessage(error));
    }
  }, [replaceToken, tokenMutation]);

  const createHostMcpToken = React.useCallback(async () => {
    await mutateToken({ action: 'create', name: mcpHostTokenName.trim() });
  }, [mcpHostTokenName, mutateToken]);

  const regenerateMcpToken = React.useCallback(async (tokenId: string) => {
    await mutateToken({ action: 'regenerate', tokenId });
  }, [mutateToken]);

  const revokeMcpToken = React.useCallback(async (tokenId: string) => {
    await mutateToken({ action: 'revoke', tokenId });
  }, [mutateToken]);

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
    setMcpServersError(null);
    setMcpServersNotice(null);
    try {
      const result = await serverMutation.mutateAsync({ action: 'save', draft: mcpDraft });
      const saved = result.server;
      if (!saved) throw new Error('The MCP server response did not include a server.');
      queryClient.setQueryData<McpServersListResponse>(serversQueryKey, (current) => ({
        ok: true,
        servers: replaceServer(current?.servers ?? [], saved),
      }));
      applySelectedServer(saved);
      setMcpServersNotice(mcpDraft.id ? `Saved ${saved.name}.` : `Created ${saved.name}.`);
    } catch (error) {
      setMcpServersError(settingsErrorMessage(error));
    }
  }, [applySelectedServer, mcpDraft, queryClient, serverMutation, serversQueryKey]);

  const deleteSelectedMcpServer = React.useCallback(async () => {
    if (!selectedMcpServerId) return;
    setMcpServersError(null);
    setMcpServersNotice(null);
    try {
      await serverMutation.mutateAsync({ action: 'delete', serverId: selectedMcpServerId });
      const nextServers = mcpServers.filter((server) => server.id !== selectedMcpServerId);
      queryClient.setQueryData<McpServersListResponse>(serversQueryKey, { ok: true, servers: nextServers });
      applySelectedServer(nextServers[0] ?? null);
      setMcpServersNotice('Deleted MCP server.');
    } catch (error) {
      setMcpServersError(settingsErrorMessage(error));
    }
  }, [applySelectedServer, mcpServers, queryClient, selectedMcpServerId, serverMutation, serversQueryKey]);

  const upsertDroneHubMcpServer = React.useCallback(async () => {
    setMcpServersError(null);
    setMcpServersNotice(null);
    try {
      const result = await serverMutation.mutateAsync({ action: 'preset' });
      const saved = result.server;
      if (!saved) throw new Error('The MCP preset response did not include a server.');
      queryClient.setQueryData<McpServersListResponse>(serversQueryKey, (current) => ({
        ok: true,
        servers: replaceServer(current?.servers ?? [], saved),
      }));
      applySelectedServer(saved);
      void loadMcpAccessTokens();
      setMcpServersNotice('Saved Drone Hub MCP server.');
    } catch (error) {
      setMcpServersError(settingsErrorMessage(error));
    }
  }, [applySelectedServer, loadMcpAccessTokens, queryClient, serverMutation, serversQueryKey]);

  const pendingServerAction = serverMutation.isPending ? serverMutation.variables.action : null;

  return {
    mcpServers,
    mcpAccessTokens,
    mcpServersLoading: serversQuery.isFetching,
    mcpServersSaving: pendingServerAction === 'save' || pendingServerAction === 'preset',
    mcpServersDeleting: pendingServerAction === 'delete',
    mcpAccessTokensLoading: tokensQuery.isFetching,
    mcpAccessTokensSaving: tokenMutation.isPending,
    mcpServersError: settingsQueryError(mcpServersError, queryErrorDismissed, serversQuery, tokensQuery),
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
    clearMcpServersError: () => {
      setMcpServersError(null);
      setQueryErrorDismissed(true);
    },
    clearMcpServersNotice: () => setMcpServersNotice(null),
  };
}

function sortTokens(tokens: McpAccessTokenSummary[]): McpAccessTokenSummary[] {
  return [...tokens].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
