import React from 'react';
import type { AgentPermissionMode, ChatAgentConfig, ChatInfo } from '../../domain';
import { normalizeChatInfoPayload } from '../../domain';
import type { DroneSummary } from '../types';
import type { ChatModelOption } from './app-types';
import { chatInfoForSelection, chatSelectionKey } from './chat-selection-model';
import { isDroneStartingOrSeeding } from './helpers';
import { fetchJson, isNotFoundError } from './hooks';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseChatConfigStateArgs = {
  selectedDrone: string | null;
  selectedChat: string;
  droneById: Record<string, DroneSummary>;
  requestJson: RequestJsonFn;
};

export function useChatConfigState({
  selectedDrone,
  selectedChat,
  droneById,
  requestJson,
}: UseChatConfigStateArgs) {
  const [chatInfoState, setChatInfoState] = React.useState<{
    key: string;
    value: ChatInfo | null;
  }>({ key: '', value: null });
  const selectedChatInfoKey = chatSelectionKey(selectedDrone, selectedChat);
  const chatInfo = chatInfoForSelection(
    chatInfoState.value,
    chatInfoState.key,
    selectedDrone,
    selectedChat,
  );
  const setChatInfo = React.useCallback<React.Dispatch<React.SetStateAction<ChatInfo | null>>>(
    (next) => {
      setChatInfoState((previous) => ({
        key: selectedChatInfoKey,
        value:
          typeof next === 'function'
            ? next(previous.key === selectedChatInfoKey ? previous.value : null)
            : next,
      }));
    },
    [selectedChatInfoKey],
  );
  const [chatInfoStatus, setChatInfoStatus] = React.useState<{
    key: string;
    loading: boolean;
    error: string | null;
  }>({ key: '', loading: false, error: null });
  const chatInfoStatusCurrent = chatInfoStatus.key === selectedChatInfoKey;
  const chatInfoError = chatInfoStatusCurrent ? chatInfoStatus.error : null;
  const loadingChatInfo = chatInfoStatusCurrent
    ? chatInfoStatus.loading
    : Boolean(selectedChatInfoKey);
  const setChatInfoError = React.useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (next) => {
      setChatInfoStatus((previous) => {
        const previousError = previous.key === selectedChatInfoKey ? previous.error : null;
        const error = typeof next === 'function' ? next(previousError) : next;
        return { key: selectedChatInfoKey, loading: previous.key === selectedChatInfoKey && previous.loading, error };
      });
    },
    [selectedChatInfoKey],
  );
  const setLoadingChatInfo = React.useCallback(
    (loading: boolean) => {
      setChatInfoStatus((previous) => ({
        key: selectedChatInfoKey,
        loading,
        error: previous.key === selectedChatInfoKey ? previous.error : null,
      }));
    },
    [selectedChatInfoKey],
  );
  const [chatModels, setChatModels] = React.useState<ChatModelOption[]>([]);
  const [chatModelsSource, setChatModelsSource] = React.useState<
    'live' | 'cache' | 'none'
  >('none');
  const [chatModelsDiscoveredAt, setChatModelsDiscoveredAt] = React.useState<
    string | null
  >(null);
  const [chatModelsError, setChatModelsError] = React.useState<string | null>(null);
  const [loadingChatModels, setLoadingChatModels] = React.useState(false);
  const [chatModelsRefreshNonce, setChatModelsRefreshNonce] = React.useState(0);
  const chatModelsRefreshHandledRef = React.useRef(0);
  const [manualChatModelInput, setManualChatModelInput] = React.useState('');

  const chatModelDiscoveryAgentId:
    | 'cursor'
    | 'codex'
    | 'claude'
    | 'opencode'
    | 'pi'
    | 'blip'
    | null = chatInfo?.agent?.kind === 'builtin' ? chatInfo.agent.id : null;

  const selectedDroneSummary = selectedDrone ? droneById[selectedDrone] ?? null : null;
  const hasSelectedDroneSummary = selectedDroneSummary !== null;
  const selectedDroneHubPhase = selectedDroneSummary?.hubPhase ?? null;
  const selectedDroneProvisioning = isDroneStartingOrSeeding(selectedDroneHubPhase);
  const selectedDroneHasChatList = Array.isArray(selectedDroneSummary?.chats);
  const selectedDroneChatsKey = React.useMemo(() => {
    if (!Array.isArray(selectedDroneSummary?.chats)) return '';
    const normalized = selectedDroneSummary.chats
      .map((chat) => String(chat ?? '').trim())
      .filter(Boolean);
    if (normalized.length === 0) return '';
    return Array.from(new Set(normalized)).sort().join('\u0000');
  }, [selectedDroneSummary?.chats]);

  React.useEffect(() => {
    if (!selectedDrone || !selectedChat) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    if (!hasSelectedDroneSummary) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    if (selectedDroneProvisioning) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    // Avoid 404 spam: don't fetch chat info until the chat exists on this drone.
    if (
      selectedDroneHasChatList &&
      !selectedDroneChatsKey.split('\u0000').includes(selectedChat)
    ) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    let mounted = true;
    setLoadingChatInfo(true);
    setChatInfoError(null);
    fetchJson<any>(
      `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}`,
    )
      .then((data) => {
        if (!mounted) return;
        setChatInfo(normalizeChatInfoPayload(data));
        setChatInfoError(null);
      })
      .catch((e: any) => {
        if (!mounted) return;
        const msg = e?.message ?? String(e);
        setChatInfo(null);
        setChatInfoError(isNotFoundError(e) ? null : msg);
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingChatInfo(false);
      });
    return () => {
      mounted = false;
    };
  }, [
    selectedDrone,
    selectedChat,
    hasSelectedDroneSummary,
    selectedDroneHubPhase,
    selectedDroneProvisioning,
    selectedDroneHasChatList,
    selectedDroneChatsKey,
  ]);

  React.useEffect(() => {
    setManualChatModelInput(chatInfo?.model ?? '');
  }, [chatInfo?.model, selectedDrone, selectedChat]);

  React.useEffect(() => {
    if (
      !selectedDrone ||
      !selectedChat ||
      !chatModelDiscoveryAgentId ||
      !hasSelectedDroneSummary ||
      selectedDroneProvisioning
    ) {
      setChatModels([]);
      setChatModelsSource('none');
      setChatModelsDiscoveredAt(null);
      setChatModelsError(null);
      setLoadingChatModels(false);
      return;
    }

    const requested = chatModelsRefreshNonce > chatModelsRefreshHandledRef.current;
    if (!requested) {
      setChatModels([]);
      setChatModelsSource('none');
      setChatModelsDiscoveredAt(null);
      setChatModelsError(null);
      setLoadingChatModels(false);
      return;
    }

    let mounted = true;
    chatModelsRefreshHandledRef.current = chatModelsRefreshNonce;
    setLoadingChatModels(true);
    setChatModelsError(null);
    fetchJson<any>(
      `/api/drones/${encodeURIComponent(
        selectedDrone,
      )}/chats/${encodeURIComponent(selectedChat)}/models?refresh=1`,
    )
      .then((data) => {
        if (!mounted) return;
        const listRaw = Array.isArray(data?.models) ? data.models : [];
        const list: ChatModelOption[] = listRaw
          .map(
            (x: any): ChatModelOption => ({
              id: String(x?.id ?? '').trim(),
              label: String(x?.label ?? '').trim() || String(x?.id ?? '').trim(),
              ...(x?.isDefault ? { isDefault: true } : {}),
              ...(x?.isCurrent ? { isCurrent: true } : {}),
            }),
          )
          .filter((x: ChatModelOption) => x.id);
        setChatModels(list);
        const source = String(data?.source ?? 'none').toLowerCase();
        setChatModelsSource(source === 'live' || source === 'cache' ? source : 'none');
        const discoveredAt = String(data?.discoveredAt ?? '').trim();
        setChatModelsDiscoveredAt(discoveredAt || null);
        const discoveredError = String(data?.error ?? '').trim();
        setChatModelsError(discoveredError || null);
      })
      .catch((e: any) => {
        if (!mounted) return;
        setChatModels([]);
        setChatModelsSource('none');
        setChatModelsDiscoveredAt(null);
        setChatModelsError(e?.message ?? String(e));
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingChatModels(false);
      });
    return () => {
      mounted = false;
    };
  }, [
    chatModelDiscoveryAgentId,
    chatModelsRefreshNonce,
    selectedChat,
    selectedDrone,
    hasSelectedDroneSummary,
    selectedDroneHubPhase,
    selectedDroneProvisioning,
  ]);

  const setChatAgent = React.useCallback(
    async (agent: ChatAgentConfig) => {
      if (!selectedDrone) return;
      const chat = selectedChat || 'default';
      const readOnlySupported = agent.kind === 'builtin' && (agent.id === 'codex' || agent.id === 'blip');
      await requestJson(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(
          chat,
        )}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agent }),
        },
      );
      setChatInfo((prev) => ({
        name: selectedDrone,
        chat,
        agent,
        agentLocked: prev?.agentLocked ?? false,
        model: prev?.model ?? null,
        agentPermissionMode: readOnlySupported ? prev?.agentPermissionMode ?? 'full-access' : 'full-access',
        dockerSnapshotAfterAgentMessageEnabled: prev?.dockerSnapshotAfterAgentMessageEnabled === true,
        sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
      }));
      setChatInfoError(null);
    },
    [requestJson, selectedChat, selectedDrone],
  );

  const setChatModel = React.useCallback(
    async (model: string | null) => {
      if (!selectedDrone) return;
      const chat = selectedChat || 'default';
      const normalized = String(model ?? '').trim() || null;
      await requestJson(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(
          chat,
        )}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: normalized }),
        },
      );
      setChatInfo((prev) => ({
        name: selectedDrone,
        chat,
        agent: prev?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig),
        agentLocked: prev?.agentLocked ?? false,
        model: normalized,
        agentPermissionMode: prev?.agentPermissionMode ?? 'full-access',
        dockerSnapshotAfterAgentMessageEnabled: prev?.dockerSnapshotAfterAgentMessageEnabled === true,
        sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
      }));
      setManualChatModelInput(normalized ?? '');
      setChatInfoError(null);
    },
    [requestJson, selectedChat, selectedDrone],
  );

  const setChatAgentPermissionMode = React.useCallback(
    async (agentPermissionMode: AgentPermissionMode) => {
      if (!selectedDrone) return;
      const chat = selectedChat || 'default';
      await requestJson(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(
          chat,
        )}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agentPermissionMode }),
        },
      );
      setChatInfo((prev) => ({
        name: selectedDrone,
        chat,
        agent: prev?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig),
        agentLocked: prev?.agentLocked ?? false,
        model: prev?.model ?? null,
        agentPermissionMode,
        dockerSnapshotAfterAgentMessageEnabled: prev?.dockerSnapshotAfterAgentMessageEnabled === true,
        sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
      }));
      setChatInfoError(null);
    },
    [requestJson, selectedChat, selectedDrone],
  );

  const setDockerSnapshotAfterAgentMessageEnabled = React.useCallback(
    async (enabled: boolean) => {
      if (!selectedDrone) return;
      const chat = selectedChat || 'default';
      await requestJson(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(
          chat,
        )}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dockerSnapshotAfterAgentMessageEnabled: enabled }),
        },
      );
      setChatInfo((prev) => ({
        name: selectedDrone,
        chat,
        agent: prev?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig),
        agentLocked: prev?.agentLocked ?? false,
        model: prev?.model ?? null,
        agentPermissionMode: prev?.agentPermissionMode ?? 'full-access',
        dockerSnapshotAfterAgentMessageEnabled: enabled,
        sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
      }));
      setChatInfoError(null);
    },
    [requestJson, selectedChat, selectedDrone],
  );

  const handleSetAgentFailure = React.useCallback(
    (prefix: string, err: any) => {
      const msg = err?.message ?? String(err);
      console.error(prefix, err);
      setChatInfoError(msg);
    },
    [],
  );

  return {
    chatInfo,
    chatInfoError,
    setChatInfoError,
    loadingChatInfo,
    chatModels,
    chatModelsSource,
    chatModelsDiscoveredAt,
    chatModelsError,
    loadingChatModels,
    chatModelsRefreshNonce,
    setChatModelsRefreshNonce,
    manualChatModelInput,
    setManualChatModelInput,
    setChatAgent,
    setChatModel,
    setChatAgentPermissionMode,
    setDockerSnapshotAfterAgentMessageEnabled,
    handleSetAgentFailure,
  };
}
