import React from 'react';
import type {
  AssistantMessage,
  ChatQuestionRequest,
  ChatQuestionResponse,
  NativeChatApproval,
} from '@drone/assistant-chat';
import { requestJson, requestJsonWithTimeout } from '../http';
import type { ChatAttachmentPayload } from '../chat/ChatInput';
import { sendRemoteChatPrompt } from './remote-chat-attachments';

export type RemoteDroneSummary = {
  id: string;
  name: string;
  runtime: string;
  group: string | null;
  repoPath: string;
  chats: string[];
  busyChats: string[];
  unreadChats: string[];
  statusOk: boolean;
  statusError: string | null;
};

type RemoteControlOperation =
  | 'drones.list'
  | 'chats.list'
  | 'chat.create'
  | 'chat.read'
  | 'chat.prompt'
  | 'chat.stop'
  | 'chat.approval.resolve'
  | 'chat.questions.resolve';

type RemoteControlResponse<T> = { ok: true; result: T };

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(text).filter(Boolean))]
    : [];
}

function remoteAttachments(value: unknown): Array<{ name: string; mime: string; size: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Array<{ name: string; mime: string; size: number }> => {
    const name = text(item?.name);
    const mime = text(item?.mime).toLowerCase();
    const size = Number(item?.size);
    if (
      !name ||
      mime.length > 120 ||
      !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mime) ||
      !Number.isSafeInteger(size) ||
      size <= 0
    )
      return [];
    return [{ name, mime, size }];
  }).slice(0, 8);
}

export function normalizeRemoteDrones(value: unknown): RemoteDroneSummary[] {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (!Array.isArray(source.drones)) return [];
  return source.drones.flatMap((item): RemoteDroneSummary[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const drone = item as Record<string, unknown>;
    const id = text(drone.id || drone.name);
    if (!id) return [];
    return [
      {
        id,
        name: text(drone.name) || id,
        runtime: text(drone.runtime) || 'container',
        group: text(drone.group) || null,
        repoPath: text(drone.repoPath),
        chats: textList(drone.chats),
        busyChats: textList(drone.busyChats),
        unreadChats: textList(drone.unreadChats),
        statusOk: drone.statusOk !== false,
        statusError: text(drone.statusError) || null,
      },
    ];
  });
}

function normalizeNativeMessages(value: unknown): AssistantMessage[] {
  const history = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const entries = Array.isArray(value) ? value : Array.isArray(history.entries) ? history.entries : [];
  return entries.flatMap((entry): AssistantMessage[] => {
    const message = entry?.message && typeof entry.message === 'object' ? entry.message : entry;
    const role = String(message?.role ?? '');
    if (!['user', 'assistant', 'toolResult', 'runSummary', 'compaction'].includes(role)) return [];
    return [
      {
        ...message,
        role,
        id: text(entry?.id || message.id) || undefined,
        createdAt: text(message.createdAt ?? entry?.timestamp) || undefined,
        ...(entry?.meshTruncated === true || message.meshTruncated === true
          ? { meshTruncated: true }
          : {}),
      } as AssistantMessage,
    ];
  });
}

export function normalizeRemoteChatMessages(value: unknown): AssistantMessage[] {
  const result = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  if (result.historyKind === 'messages') {
    return [
      ...normalizeNativeMessages(result.history),
      ...normalizeNativeMessages(result.streamingMessages),
    ];
  }
  if (!Array.isArray(result.turns)) return [];
  return result.turns.flatMap((item: any, index: number): AssistantMessage[] => {
    const turn = item && typeof item === 'object' ? item : {};
    const id = text(turn.id) || `turn-${Number.isFinite(Number(turn.turn)) ? turn.turn : index}`;
    const messages: AssistantMessage[] = [];
    const prompt = String(turn.prompt ?? '');
    const output = String(turn.output ?? '');
    const error = String(turn.error ?? '');
    const attachments = remoteAttachments(turn.attachments);
    const attachmentCount = Array.isArray(turn.attachments) ? turn.attachments.length : 0;
    if (prompt || attachmentCount > 0) {
      messages.push({
        id: `${id}:user`,
        role: 'user',
        content:
          prompt ||
          `Attached ${attachmentCount} file${attachmentCount === 1 ? '' : 's'} to this prompt.`,
        createdAt: text(turn.promptAt || turn.at) || undefined,
        ...(attachments.length > 0 ? { details: { attachments } } : {}),
        ...(turn.meshTruncated === true ? { meshTruncated: true } : {}),
      });
    }
    if (output || error) {
      messages.push({
        id: `${id}:assistant`,
        role: 'assistant',
        content: output,
        createdAt: text(turn.completedAt || turn.at) || undefined,
        ...(error ? { isError: true, errorMessage: error } : {}),
        ...(turn.meshTruncated === true ? { meshTruncated: true } : {}),
      });
    }
    return messages;
  });
}

async function remoteControl<T>(
  targetDeviceId: string,
  operation: RemoteControlOperation,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<T> {
  const init = {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetDeviceId, operation, payload }),
  } satisfies RequestInit;
  const response = timeoutMs
    ? await requestJsonWithTimeout<RemoteControlResponse<T>>(
        '/api/device-mesh/drone-control',
        init,
        timeoutMs,
      )
    : await requestJson<RemoteControlResponse<T>>('/api/device-mesh/drone-control', init);
  return response.result;
}

function suggestedChatName(chats: readonly string[]): string {
  const used = new Set(chats);
  for (let index = 2; index < 10_000; index += 1) {
    const name = `chat-${index}`;
    if (!used.has(name)) return name;
  }
  return `chat-${Date.now()}`;
}

export function useRemoteDroneHub(targetDeviceId: string, routeAvailable: boolean) {
  const [drones, setDrones] = React.useState<RemoteDroneSummary[]>([]);
  const [selectedDroneId, setSelectedDroneId] = React.useState('');
  const [selectedChat, setSelectedChat] = React.useState('');
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [pendingApprovals, setPendingApprovals] = React.useState<NativeChatApproval[]>([]);
  const [pendingQuestionRequests, setPendingQuestionRequests] = React.useState<
    ChatQuestionRequest[]
  >([]);
  const [nativeChatId, setNativeChatId] = React.useState('');
  const [attachmentMode, setAttachmentMode] = React.useState<'images' | 'files'>('images');
  const [pendingCount, setPendingCount] = React.useState(0);
  const [loadingDrones, setLoadingDrones] = React.useState(true);
  const [loadingChat, setLoadingChat] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [creatingChat, setCreatingChat] = React.useState(false);
  const [approvalBusyId, setApprovalBusyId] = React.useState('');
  const [questionBusyId, setQuestionBusyId] = React.useState('');
  const [listError, setListError] = React.useState<string | null>(null);
  const [chatError, setChatError] = React.useState<string | null>(null);
  const targetRef = React.useRef(targetDeviceId);
  const routeAvailableRef = React.useRef(routeAvailable);
  const listVersion = React.useRef(0);
  const listRequests = React.useRef(new Map<string, symbol>());
  const chatVersion = React.useRef(0);
  targetRef.current = targetDeviceId;

  const selectedDrone = drones.find((drone) => drone.id === selectedDroneId) ?? null;
  const waiting = Boolean(
    selectedDrone?.busyChats.includes(selectedChat) ||
      pendingCount > 0 ||
      pendingApprovals.length > 0 ||
      pendingQuestionRequests.length > 0,
  );

  const loadDrones = React.useCallback(
    async (quiet = false) => {
      if (!targetDeviceId || !routeAvailable) {
        if (!quiet) setLoadingDrones(false);
        return;
      }
      if (listRequests.current.has(targetDeviceId)) return;
      const requestToken = Symbol(targetDeviceId);
      listRequests.current.set(targetDeviceId, requestToken);
      const version = ++listVersion.current;
      if (!quiet) setLoadingDrones(true);
      try {
        const result = await remoteControl<unknown>(
          targetDeviceId,
          'drones.list',
          {},
          undefined,
          12_000,
        );
        if (targetRef.current !== targetDeviceId || listVersion.current !== version) return;
        const next = normalizeRemoteDrones(result);
        setDrones(next);
        setSelectedDroneId((current) =>
          current && next.some((drone) => drone.id === current) ? current : '',
        );
        setListError(null);
      } catch (error: any) {
        if (targetRef.current === targetDeviceId && !quiet)
          setListError(error?.message ?? String(error));
      } finally {
        if (listRequests.current.get(targetDeviceId) === requestToken) {
          listRequests.current.delete(targetDeviceId);
        }
        if (targetRef.current === targetDeviceId && !quiet) setLoadingDrones(false);
      }
    },
    [routeAvailable, targetDeviceId],
  );

  const loadChat = React.useCallback(
    async (droneId: string, chatName: string, quiet = false) => {
      if (!routeAvailable || !droneId || !chatName) return;
      const version = ++chatVersion.current;
      if (!quiet) setLoadingChat(true);
      try {
        const result = await remoteControl<any>(targetDeviceId, 'chat.read', {
          droneId,
          chatName,
        });
        if (
          targetRef.current !== targetDeviceId ||
          chatVersion.current !== version ||
          selectedDroneId !== droneId ||
          selectedChat !== chatName
        )
          return;
        setMessages(normalizeRemoteChatMessages(result));
        setPendingCount(Array.isArray(result?.pending) ? result.pending.length : 0);
        setPendingApprovals(
          Array.isArray(result?.pendingApprovals)
            ? result.pendingApprovals.filter(
                (approval: NativeChatApproval) => approval?.status === 'pending',
              )
            : [],
        );
        setPendingQuestionRequests(
          Array.isArray(result?.pendingQuestionRequests)
            ? result.pendingQuestionRequests.filter(
                (request: ChatQuestionRequest) => request?.status === 'pending',
              )
            : [],
        );
        setNativeChatId(text(result?.nativeChatId));
        setAttachmentMode(result?.agent?.kind === 'native' ? 'files' : 'images');
        setChatError(null);
      } catch (error: any) {
        if (targetRef.current === targetDeviceId && !quiet)
          setChatError(error?.message ?? String(error));
      } finally {
        if (targetRef.current === targetDeviceId && !quiet) setLoadingChat(false);
      }
    },
    [routeAvailable, selectedChat, selectedDroneId, targetDeviceId],
  );

  React.useEffect(() => {
    listVersion.current += 1;
    chatVersion.current += 1;
    setDrones([]);
    setSelectedDroneId('');
    setSelectedChat('');
    setMessages([]);
    setPendingApprovals([]);
    setPendingQuestionRequests([]);
    setNativeChatId('');
    setAttachmentMode('images');
    setListError(null);
    setChatError(null);
    setLoadingDrones(true);
    void loadDrones();
  }, [targetDeviceId]); // loadDrones intentionally changes when reachability changes.

  React.useEffect(() => {
    const reconnected = routeAvailable && !routeAvailableRef.current;
    routeAvailableRef.current = routeAvailable;
    if (reconnected) void loadDrones();
  }, [loadDrones, routeAvailable]); // Refresh immediately after a route reconnects.

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadDrones(true);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [loadDrones]);

  React.useEffect(() => {
    if (!selectedDroneId || !selectedChat) return;
    void loadChat(selectedDroneId, selectedChat);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadChat(selectedDroneId, selectedChat, true);
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [loadChat, selectedChat, selectedDroneId]);

  const selectChat = React.useCallback((droneId: string, chatName: string) => {
    chatVersion.current += 1;
    setSelectedDroneId(droneId);
    setSelectedChat(chatName);
    setMessages([]);
    setPendingApprovals([]);
    setPendingQuestionRequests([]);
    setNativeChatId('');
    setAttachmentMode('images');
    setPendingCount(0);
    setChatError(null);
  }, []);

  const selectDrone = React.useCallback((drone: RemoteDroneSummary) => {
    const chat = drone.chats.includes('default') ? 'default' : (drone.chats[0] ?? '');
    selectChat(drone.id, chat);
  }, [selectChat]);

  const createChat = React.useCallback(async () => {
    if (!selectedDrone || !routeAvailable) return;
    setCreatingChat(true);
    setChatError(null);
    try {
      const name = suggestedChatName(selectedDrone.chats);
      const result = await remoteControl<any>(targetDeviceId, 'chat.create', {
        droneId: selectedDrone.id,
        name,
        ...(selectedChat ? { copyFrom: selectedChat } : {}),
      });
      if (targetRef.current !== targetDeviceId) return;
      const created = text(result?.chatName) || name;
      await loadDrones(true);
      selectChat(selectedDrone.id, created);
    } catch (error: any) {
      if (targetRef.current === targetDeviceId) setChatError(error?.message ?? String(error));
    } finally {
      if (targetRef.current === targetDeviceId) setCreatingChat(false);
    }
  }, [loadDrones, routeAvailable, selectChat, selectedChat, selectedDrone, targetDeviceId]);

  const sendPrompt = React.useCallback(
    async (
      prompt: string,
      attachments: readonly ChatAttachmentPayload[] = [],
      deliveryMode: 'queue' | 'asap' = 'queue',
      promptId?: string,
    ) => {
      if (
        !selectedDrone ||
        !selectedChat ||
        !routeAvailable ||
        (!prompt.trim() && attachments.length === 0)
      )
        return false;
      const target = targetDeviceId;
      const droneId = selectedDrone.id;
      const chatName = selectedChat;
      const optimisticId = promptId || `desktop-optimistic-${Date.now()}`;
      setChatError(null);
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimisticId),
        {
          id: optimisticId,
          role: 'user',
          content:
            prompt ||
            `Attached ${attachments.length} file${attachments.length === 1 ? '' : 's'} to this prompt.`,
          createdAt: new Date().toISOString(),
          ...(attachments.length > 0
            ? {
                details: {
                  attachments: attachments.map(({ name, mime, size }) => ({ name, mime, size })),
                },
              }
            : {}),
        },
      ]);
      try {
        await sendRemoteChatPrompt({
          droneId,
          chatName,
          prompt,
          ...(promptId ? { promptId } : {}),
          attachments,
          deliveryMode,
          request: (payload) => remoteControl(target, 'chat.prompt', payload),
        });
        if (targetRef.current === target) {
          setPendingCount((count) => count + 1);
          window.setTimeout(() => void loadChat(droneId, chatName, true), 250);
        }
        return true;
      } catch (error: any) {
        if (targetRef.current === target) {
          setMessages((current) => current.filter((message) => message.id !== optimisticId));
          setChatError(error?.message ?? String(error));
        }
        return false;
      }
    },
    [loadChat, routeAvailable, selectedChat, selectedDrone, targetDeviceId],
  );

  const stop = React.useCallback(async () => {
    if (!selectedDrone || !selectedChat || !routeAvailable) return;
    const target = targetDeviceId;
    setStopping(true);
    setChatError(null);
    try {
      await remoteControl(target, 'chat.stop', {
        droneId: selectedDrone.id,
        chatName: selectedChat,
      });
      if (targetRef.current === target) {
        setPendingCount(0);
        await loadChat(selectedDrone.id, selectedChat, true);
      }
    } catch (error: any) {
      if (targetRef.current === target) setChatError(error?.message ?? String(error));
    } finally {
      if (targetRef.current === target) setStopping(false);
    }
  }, [loadChat, routeAvailable, selectedChat, selectedDrone, targetDeviceId]);

  const resolveApproval = React.useCallback(
    async (approval: NativeChatApproval, approved: boolean) => {
      if (
        !selectedDrone ||
        !selectedChat ||
        !nativeChatId ||
        !routeAvailable ||
        approvalBusyId
      )
        return;
      const target = targetDeviceId;
      setApprovalBusyId(approval.id);
      setChatError(null);
      try {
        await remoteControl(target, 'chat.approval.resolve', {
          droneId: selectedDrone.id,
          chatName: selectedChat,
          nativeChatId,
          approvalId: approval.id,
          approved,
        });
        if (targetRef.current !== target) return;
        setPendingApprovals((current) => current.filter((item) => item.id !== approval.id));
        await loadChat(selectedDrone.id, selectedChat, true);
      } catch (error: any) {
        if (targetRef.current === target) setChatError(error?.message ?? String(error));
      } finally {
        if (targetRef.current === target) setApprovalBusyId('');
      }
    },
    [
      approvalBusyId,
      loadChat,
      nativeChatId,
      routeAvailable,
      selectedChat,
      selectedDrone,
      targetDeviceId,
    ],
  );

  const resolveQuestionRequest = React.useCallback(
    async (
      request: ChatQuestionRequest,
      resolution:
        | { action: 'submit'; responses: ChatQuestionResponse[]; notes?: string }
        | { action: 'skip'; notes?: string },
    ) => {
      if (!selectedDrone || !selectedChat || !routeAvailable || questionBusyId) return;
      const target = targetDeviceId;
      setQuestionBusyId(request.id);
      setChatError(null);
      try {
        await remoteControl(target, 'chat.questions.resolve', {
          droneId: selectedDrone.id,
          chatName: selectedChat,
          requestId: request.id,
          ...resolution,
        });
        if (targetRef.current !== target) return;
        setPendingQuestionRequests((current) =>
          current.filter((item) => item.id !== request.id),
        );
        await loadChat(selectedDrone.id, selectedChat, true);
      } catch (error: any) {
        if (targetRef.current === target) setChatError(error?.message ?? String(error));
      } finally {
        if (targetRef.current === target) setQuestionBusyId('');
      }
    },
    [
      loadChat,
      questionBusyId,
      routeAvailable,
      selectedChat,
      selectedDrone,
      targetDeviceId,
    ],
  );

  return {
    drones,
    selectedDrone,
    selectedChat,
    messages,
    pendingApprovals,
    approvalBusyId,
    pendingQuestionRequests,
    questionBusyId,
    attachmentMode,
    pendingCount,
    waiting,
    loadingDrones,
    loadingChat,
    stopping,
    creatingChat,
    listError,
    chatError,
    loadDrones,
    selectDrone,
    selectChat,
    createChat,
    sendPrompt,
    stop,
    resolveApproval,
    resolveQuestionRequest,
  };
}
