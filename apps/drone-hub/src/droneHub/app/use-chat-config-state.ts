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
import { markChatLoadConfigResolved, type ChatLoadSurface } from './chat-load-telemetry';
import {
  deleteChatRuntimeCache,
  readFreshChatRuntimeCache,
  writeChatRuntimeCache,
} from './chat-runtime-cache';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseChatConfigStateArgs = {
  selectedDrone: string | null;
  selectedChat: string;
  droneById: Record<string, DroneSummary>;
  requestJson: RequestJsonFn;
};

function chatLoadSurfaceForAgent(agent: ChatAgentConfig | null | undefined): ChatLoadSurface {
  if (agent?.kind === 'native') return 'native';
  if (agent?.kind === 'custom') return 'cli';
  return 'transcript';
}

export function useChatConfigState({
  selectedDrone,
  selectedChat,
  droneById,
  requestJson,
}: UseChatConfigStateArgs) {
  const selectedChatInfoKey = chatSelectionKey(selectedDrone, selectedChat);
  const selectedDroneSummary = selectedDrone ? (droneById[selectedDrone] ?? null) : null;
  const hasSelectedDroneSummary = selectedDroneSummary !== null;
  const selectedDroneHubPhase = selectedDroneSummary?.hubPhase ?? null;
  const selectedDroneProvisioning = isDroneStartingOrSeeding(selectedDroneHubPhase);
  const selectedDroneStartupFailed = selectedDroneHubPhase === 'error';
  const selectedDroneHasChatList = Array.isArray(selectedDroneSummary?.chats);
  const selectedDroneChatsKey = React.useMemo(() => {
    return chatNamesForConfigSelection({
      chats: selectedDroneSummary?.chats,
      workflowChats: selectedDroneSummary?.workflowChats,
    }).join('\u0000');
  }, [selectedDroneSummary?.chats, selectedDroneSummary?.workflowChats]);
  const selectedChatListed =
    !selectedDroneHasChatList || selectedDroneChatsKey.split('\u0000').includes(selectedChat);
  const selectedChatIsDraft =
    selectedDroneSummary?.draft === true ||
    selectedDroneSummary?.hubPhase === 'draft' ||
    selectedDroneSummary?.draftChats?.[selectedChat || 'default'] === true;
  const chatConfigEligible =
    hasSelectedDroneSummary &&
    !selectedDroneProvisioning &&
    !selectedDroneStartupFailed &&
    !selectedChatIsDraft &&
    selectedChatListed;
  const cachedChatInfo =
    chatConfigEligible
      ? (readFreshChatRuntimeCache(selectedChatInfoKey)?.chatInfo ?? null)
      : null;
  const [chatInfoState, setChatInfoState] = React.useState<{
    key: string;
    value: ChatInfo | null;
  }>({ key: '', value: null });
  const chatInfo = chatConfigEligible
    ? chatInfoForSelection(
        chatInfoState.value,
        chatInfoState.key,
        selectedDrone,
        selectedChat,
      ) ??
      chatInfoForSelection(
        cachedChatInfo,
        selectedChatInfoKey,
        selectedDrone,
        selectedChat,
      )
    : null;
  const setChatInfo = React.useCallback<React.Dispatch<React.SetStateAction<ChatInfo | null>>>(
    (next) => {
      setChatInfoState((previous) => {
        const value =
          typeof next === 'function'
            ? next(
                previous.key === selectedChatInfoKey
                  ? previous.value
                  : (readFreshChatRuntimeCache(selectedChatInfoKey)?.chatInfo ?? null),
              )
            : next;
        if (value) writeChatRuntimeCache(selectedChatInfoKey, { chatInfo: value });
        return { key: selectedChatInfoKey, value };
      });
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
    if (!selectedChatListed) {
      deleteChatRuntimeCache(selectedChatInfoKey);
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    let mounted = true;
    if (cachedChatInfo) {
      markChatLoadConfigResolved(
        { droneId: selectedDrone, chatName: selectedChat },
        {
          surface: chatLoadSurfaceForAgent(cachedChatInfo.agent),
          agentKind:
            cachedChatInfo.agent.kind === 'builtin'
              ? `builtin:${cachedChatInfo.agent.id}`
              : cachedChatInfo.agent.kind,
          runtime: selectedDroneRuntime,
          source: 'cache',
        },
      );
    }
    setLoadingChatInfo(true);
    setChatInfoError(null);
    fetchJson<any>(
      `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}?turns=0`,
    )
      .then((data) => {
        if (!mounted) return;
        const nextChatInfo = normalizeChatInfoPayload(data);
        if (
          !chatInfoForSelection(
            nextChatInfo,
            selectedChatInfoKey,
            selectedDrone,
            selectedChat,
          )
        ) {
          throw new Error('Chat metadata response did not match the selected chat.');
        }
        setChatInfo(nextChatInfo);
        setChatInfoError(null);
        markChatLoadConfigResolved(
          { droneId: selectedDrone, chatName: selectedChat },
          {
            surface: chatLoadSurfaceForAgent(nextChatInfo.agent),
            agentKind:
              nextChatInfo.agent.kind === 'builtin'
                ? `builtin:${nextChatInfo.agent.id}`
                : nextChatInfo.agent.kind,
            runtime: selectedDroneRuntime,
          },
        );
      })
      .catch((e: any) => {
        if (!mounted) return;
        const msg = e?.message ?? String(e);
        if (isNotFoundError(e)) deleteChatRuntimeCache(selectedChatInfoKey);
        setChatInfo(isNotFoundError(e) ? null : cachedChatInfo);
        setChatInfoError(isNotFoundError(e) ? null : msg);
        markChatLoadConfigResolved(
          { droneId: selectedDrone, chatName: selectedChat },
          cachedChatInfo && !isNotFoundError(e)
            ? {
                surface: chatLoadSurfaceForAgent(cachedChatInfo.agent),
                agentKind:
                  cachedChatInfo.agent.kind === 'builtin'
                    ? `builtin:${cachedChatInfo.agent.id}`
                    : cachedChatInfo.agent.kind,
                runtime: selectedDroneRuntime,
                status: 'error',
              }
            : { surface: 'unavailable', runtime: selectedDroneRuntime, status: 'error' },
        );
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
    selectedChatInfoKey,
    selectedChatListed,
    selectedDroneRuntime,
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
          ? (prev?.agentPermissionMode ?? 'execute')
          : 'execute',
        approvalPolicy:
          approvalSupported &&
          !(
            prev?.approvalPolicy === 'auto' &&
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
        agentPermissionMode: prev?.agentPermissionMode ?? 'execute',
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
        agentPermissionMode: prev?.agentPermissionMode ?? 'execute',
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
        agentPermissionMode: prev?.agentPermissionMode ?? 'execute',
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
