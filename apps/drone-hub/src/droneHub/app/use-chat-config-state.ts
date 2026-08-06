import React from 'react';
import type {
  AgentApprovalPolicy,
  AgentPermissionMode,
  ChatAgentConfig,
  ChatInfo,
} from '../../domain';
import { normalizeChatInfoPayload } from '../../domain';
import type { DroneSummary } from '../types';
import {
  chatInfoForSelection,
  chatNamesForConfigSelection,
  chatSelectionKey,
} from './chat-selection-model';
import { isDroneStartingOrSeeding } from './helpers';
import { fetchJson, isNotFoundError } from './hooks';
import { useAgentModelCatalog } from './use-agent-model-catalog';

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
        return {
          key: selectedChatInfoKey,
          loading: previous.key === selectedChatInfoKey && previous.loading,
          error,
        };
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
  const chatModelDiscoveryAgentId:
    | 'cursor'
    | 'codex'
    | 'claude'
    | 'opencode'
    | 'pi'
    | 'blip'
    | null = chatInfo?.agent?.kind === 'builtin' ? chatInfo.agent.id : null;

  const selectedDroneSummary = selectedDrone ? (droneById[selectedDrone] ?? null) : null;
  const hasSelectedDroneSummary = selectedDroneSummary !== null;
  const selectedDroneHubPhase = selectedDroneSummary?.hubPhase ?? null;
  const selectedDroneProvisioning = isDroneStartingOrSeeding(selectedDroneHubPhase);
  const selectedDroneStartupFailed = selectedDroneHubPhase === 'error';
  const selectedDroneHasChatList = Array.isArray(selectedDroneSummary?.chats);
  const selectedDroneRuntime =
    String(selectedDroneSummary?.runtime ?? '')
      .trim()
      .toLowerCase() === 'host'
      ? 'host'
      : 'container';
  const modelCatalog = useAgentModelCatalog({
    agentId: chatModelDiscoveryAgentId ?? '',
    runtime: selectedDroneRuntime,
    enabled:
      Boolean(selectedDrone && selectedChat && chatModelDiscoveryAgentId) &&
      hasSelectedDroneSummary &&
      !selectedDroneProvisioning,
  });
  const selectedDroneChatsKey = React.useMemo(() => {
    return chatNamesForConfigSelection({
      chats: selectedDroneSummary?.chats,
      workflowChats: selectedDroneSummary?.workflowChats,
    }).join('\u0000');
  }, [selectedDroneSummary?.chats, selectedDroneSummary?.workflowChats]);

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
    if (selectedDroneStartupFailed) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    // Avoid 404 spam: don't fetch chat info until the chat exists on this drone.
    if (selectedDroneHasChatList && !selectedDroneChatsKey.split('\u0000').includes(selectedChat)) {
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
    selectedDroneStartupFailed,
    selectedDroneHasChatList,
    selectedDroneChatsKey,
  ]);

  const setChatAgent = React.useCallback(
    async (agent: ChatAgentConfig) => {
      if (!selectedDrone) return;
      const chat = selectedChat || 'default';
      const readOnlySupported =
        agent.kind === 'native' ||
        (agent.kind === 'builtin' && (agent.id === 'codex' || agent.id === 'blip'));
      const approvalSupported =
        agent.kind === 'native' || (agent.kind === 'builtin' && agent.id === 'codex');
      await requestJson(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chat)}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agent }),
        },
      );
      setChatInfo((prev) => ({
        name: selectedDrone,
        chat,
        chatId: prev?.chatId ?? null,
        subscriptions: prev?.subscriptions ?? [],
        agent,
        agentLocked: prev?.agentLocked ?? false,
        model: prev?.model ?? null,
        reasoning: prev?.reasoning ?? null,
        agentPermissionMode: readOnlySupported
          ? (prev?.agentPermissionMode ?? 'full-access')
          : 'full-access',
        approvalPolicy:
          approvalSupported &&
          !(
            prev?.approvalPolicy === 'agent-decides' &&
            !(agent.kind === 'builtin' && agent.id === 'codex')
          )
            ? (prev?.approvalPolicy ?? 'ask')
            : 'ask',
        dockerSnapshotAfterAgentMessageEnabled:
          prev?.dockerSnapshotAfterAgentMessageEnabled === true,
        sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
      }));
      setChatInfoError(null);
    },
    [requestJson, selectedChat, selectedDrone],
  );

  const setChatModelSettings = React.useCallback(
    async (settings: { model?: string | null; reasoning?: string | null }) => {
      if (!selectedDrone) return;
      const chat = selectedChat || 'default';
      const hasModel = Object.prototype.hasOwnProperty.call(settings, 'model');
      const hasReasoning = Object.prototype.hasOwnProperty.call(settings, 'reasoning');
      const model = String(settings.model ?? '').trim() || null;
      const reasoning =
        String(settings.reasoning ?? '')
          .trim()
          .toLowerCase() || null;
      const body = {
        ...(hasModel ? { model } : {}),
        ...(hasReasoning ? { reasoning } : {}),
      };
      await requestJson(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chat)}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      setChatInfo((prev) => ({
        name: selectedDrone,
        chat,
        chatId: prev?.chatId ?? null,
        subscriptions: prev?.subscriptions ?? [],
        agent: prev?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig),
        agentLocked: prev?.agentLocked ?? false,
        model: hasModel ? model : (prev?.model ?? null),
        reasoning: hasReasoning ? reasoning : (prev?.reasoning ?? null),
        agentPermissionMode: prev?.agentPermissionMode ?? 'full-access',
        approvalPolicy: prev?.approvalPolicy ?? 'ask',
        dockerSnapshotAfterAgentMessageEnabled:
          prev?.dockerSnapshotAfterAgentMessageEnabled === true,
        sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
      }));
      setChatInfoError(null);
    },
    [requestJson, selectedChat, selectedDrone],
  );

  const setChatAgentPermissionMode = React.useCallback(
    async (agentPermissionMode: AgentPermissionMode) => {
      if (!selectedDrone) return;
      const chat = selectedChat || 'default';
      await requestJson(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chat)}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agentPermissionMode }),
        },
      );
      setChatInfo((prev) => ({
        name: selectedDrone,
        chat,
        chatId: prev?.chatId ?? null,
        subscriptions: prev?.subscriptions ?? [],
        agent: prev?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig),
        agentLocked: prev?.agentLocked ?? false,
        model: prev?.model ?? null,
        reasoning: prev?.reasoning ?? null,
        agentPermissionMode,
        approvalPolicy: prev?.approvalPolicy ?? 'ask',
        dockerSnapshotAfterAgentMessageEnabled:
          prev?.dockerSnapshotAfterAgentMessageEnabled === true,
        sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
      }));
      setChatInfoError(null);
    },
    [requestJson, selectedChat, selectedDrone],
  );

  const setChatApprovalPolicy = React.useCallback(
    async (approvalPolicy: AgentApprovalPolicy) => {
      if (!selectedDrone) return;
      const chat = selectedChat || 'default';
      await requestJson(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chat)}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ approvalPolicy }),
        },
      );
      setChatInfo((prev) => ({
        name: selectedDrone,
        chat,
        chatId: prev?.chatId ?? null,
        subscriptions: prev?.subscriptions ?? [],
        agent: prev?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig),
        agentLocked: prev?.agentLocked ?? false,
        model: prev?.model ?? null,
        reasoning: prev?.reasoning ?? null,
        agentPermissionMode: prev?.agentPermissionMode ?? 'full-access',
        approvalPolicy,
        dockerSnapshotAfterAgentMessageEnabled:
          prev?.dockerSnapshotAfterAgentMessageEnabled === true,
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
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chat)}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dockerSnapshotAfterAgentMessageEnabled: enabled }),
        },
      );
      setChatInfo((prev) => ({
        name: selectedDrone,
        chat,
        chatId: prev?.chatId ?? null,
        subscriptions: prev?.subscriptions ?? [],
        agent: prev?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig),
        agentLocked: prev?.agentLocked ?? false,
        model: prev?.model ?? null,
        reasoning: prev?.reasoning ?? null,
        agentPermissionMode: prev?.agentPermissionMode ?? 'full-access',
        approvalPolicy: prev?.approvalPolicy ?? 'ask',
        dockerSnapshotAfterAgentMessageEnabled: enabled,
        sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
      }));
      setChatInfoError(null);
    },
    [requestJson, selectedChat, selectedDrone],
  );

  const handleSetAgentFailure = React.useCallback((prefix: string, err: any) => {
    const msg = err?.message ?? String(err);
    console.error(prefix, err);
    setChatInfoError(msg);
  }, []);

  return {
    chatInfo,
    chatInfoError,
    setChatInfoError,
    loadingChatInfo,
    chatModels: modelCatalog.models,
    chatModelsError: modelCatalog.error,
    loadingChatModels: modelCatalog.loading,
    chatModelsStale: modelCatalog.stale,
    setChatAgent,
    setChatModelSettings,
    setChatAgentPermissionMode,
    setChatApprovalPolicy,
    setDockerSnapshotAfterAgentMessageEnabled,
    handleSetAgentFailure,
  };
}
