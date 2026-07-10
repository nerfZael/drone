import React from 'react';
import { normalizeChatInfoPayload, type ChatInfo } from '../domain';
import { droneChatEventMatches } from '../droneHub/app/chat-api';
import { subscribeDroneChatEvents } from '../droneHub/app/chat-events';
import type { ChatModelOption } from '../droneHub/app/app-types';
import type { ChatSendPayload } from '../droneHub/chat';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../droneHub/types';
import {
  remoteRequestJson,
  setRemoteCsrf,
  type ChatListResponse,
  type ChatRuntimeResponse,
  type ChatStateResponse,
  type DroneListResponse,
  type RemoteSession,
  type TranscriptResponse,
} from './remote-api';

type RemoteChatState = {
  transcripts: TranscriptItem[];
  pending: PendingPrompt[];
};

type RemoteChatRuntimeState = {
  key: string | null;
  info: ChatInfo | null;
  models: ChatModelOption[];
  loading: boolean;
  error: string | null;
};

type UseRemoteHubModelOptions = {
  pauseChatPolling?: boolean;
};

function remoteChatStateKey(droneId: string, chatName: string): string {
  return `${droneId}\u0000${chatName}`;
}

export function useRemoteHubModel(options: UseRemoteHubModelOptions = {}) {
  const pauseChatPolling = options.pauseChatPolling === true;
  const [session, setSession] = React.useState<RemoteSession | null>(null);
  const [drones, setDrones] = React.useState<DroneSummary[]>([]);
  const [selectedDroneId, setSelectedDroneId] = React.useState<string | null>(null);
  const [selectedChat, setSelectedChat] = React.useState('default');
  const [chats, setChats] = React.useState<string[]>([]);
  const [draftChats, setDraftChats] = React.useState<Record<string, boolean>>({});
  const [transcripts, setTranscripts] = React.useState<TranscriptItem[]>([]);
  const [pending, setPending] = React.useState<PendingPrompt[]>([]);
  const [draft, setDraft] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [chatStateLoading, setChatStateLoading] = React.useState(false);
  const [chatRuntime, setChatRuntime] = React.useState<RemoteChatRuntimeState>({
    key: null,
    info: null,
    models: [],
    loading: false,
    error: null,
  });
  const [sending, setSending] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [chatEventsConnected, setChatEventsConnected] = React.useState(false);
  const [chatEventsNonce, setChatEventsNonce] = React.useState(0);
  const activeChatStateKeyRef = React.useRef<string | null>(null);
  const loadedChatStateKeyRef = React.useRef<string | null>(null);
  const loadedFullTranscriptKeyRef = React.useRef<string | null>(null);

  const authenticated = session?.authenticated === true;
  const selectedDrone = drones.find((drone) => drone.id === selectedDroneId) ?? drones[0] ?? null;
  const effectiveDroneId = selectedDrone?.id ?? null;

  React.useEffect(() => {
    activeChatStateKeyRef.current = effectiveDroneId && selectedChat ? remoteChatStateKey(effectiveDroneId, selectedChat) : null;
  }, [effectiveDroneId, selectedChat]);

  const markUnauthenticated = React.useCallback(() => {
    setRemoteCsrf(null);
    setSession({ ok: true, authenticated: false, csrf: null });
    setDrones([]);
    setSelectedDroneId(null);
    setChats([]);
    setDraftChats({});
    setTranscripts([]);
    setPending([]);
    setChatStateLoading(false);
    setChatRuntime({ key: null, info: null, models: [], loading: false, error: null });
    setChatEventsConnected(false);
    activeChatStateKeyRef.current = null;
    loadedChatStateKeyRef.current = null;
    loadedFullTranscriptKeyRef.current = null;
  }, []);

  const errorMessage = React.useCallback((err: any) => {
    if (err?.status === 401) {
      markUnauthenticated();
      return 'Pairing required';
    }
    return err?.message ?? String(err);
  }, [markUnauthenticated]);

  const loadSession = React.useCallback(async () => {
    const next = await remoteRequestJson<RemoteSession>('/api/remote/session');
    setRemoteCsrf(next.csrf);
    setSession(next);
    return next;
  }, []);

  const loadDrones = React.useCallback(async () => {
    const data = await remoteRequestJson<DroneListResponse>('/api/drones');
    const nextDrones = Array.isArray(data.drones) ? data.drones : [];
    setDrones(nextDrones);
    setSelectedDroneId((current) => (current && nextDrones.some((drone) => drone.id === current) ? current : nextDrones[0]?.id ?? null));
  }, []);
  const reloadDrones = React.useCallback(async (preferredDroneId?: string | null) => {
    const data = await remoteRequestJson<DroneListResponse>('/api/drones');
    const nextDrones = Array.isArray(data.drones) ? data.drones : [];
    const preferred = String(preferredDroneId ?? '').trim();
    setDrones(nextDrones);
    setSelectedDroneId((current) => {
      if (preferred && nextDrones.some((drone) => drone.id === preferred)) return preferred;
      return current && nextDrones.some((drone) => drone.id === current) ? current : nextDrones[0]?.id ?? null;
    });
  }, []);

  const fetchChats = React.useCallback(async (droneId: string) => {
    const data = await remoteRequestJson<ChatListResponse>(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    const draftByChat: Record<string, boolean> =
      data.draftChats && typeof data.draftChats === 'object' && !Array.isArray(data.draftChats)
        ? Object.fromEntries(
            Object.entries(data.draftChats)
              .map(([chatName, draft]) => [String(chatName).trim(), draft === true] as const)
              .filter(([chatName, draft]) => Boolean(chatName) && draft),
          )
        : {};
    for (const item of Array.isArray(data.chatDetails) ? data.chatDetails : []) {
      const chatName = String(item.chat ?? item.name ?? '').trim();
      if (chatName && item.draft === true) draftByChat[chatName] = true;
    }
    const chatNames = (Array.isArray(data.chats) ? data.chats : [])
      .map((item) => {
        if (typeof item === 'string') return item;
        const chatName = String(item.chat ?? item.name ?? '').trim();
        if (chatName && item.draft === true) draftByChat[chatName] = true;
        return chatName;
      })
      .map((item) => String(item).trim())
      .filter(Boolean);
    setDraftChats(draftByChat);
    return chatNames;
  }, []);

  const fetchChatState = React.useCallback(async (droneId: string, chatName: string, signal?: AbortSignal): Promise<RemoteChatState> => {
    const data = await remoteRequestJson<ChatStateResponse>(
      `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/state?turn=all&transcript=tail&tail=50`,
      signal ? { signal } : undefined,
    );
    return {
      transcripts: Array.isArray(data.transcripts) ? data.transcripts : [],
      pending: Array.isArray(data.pending) ? data.pending : [],
    };
  }, []);

  const fetchFullTranscript = React.useCallback(async (droneId: string, chatName: string, signal?: AbortSignal): Promise<TranscriptItem[]> => {
    const data = await remoteRequestJson<TranscriptResponse>(
      `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/state?turn=all&transcript=full&pending=none`,
      signal ? { signal } : undefined,
    );
    return Array.isArray(data.transcripts) ? data.transcripts : [];
  }, []);

  const applyChatState = React.useCallback((droneId: string, chatName: string, next: RemoteChatState, opts?: { preserveTranscripts?: boolean }) => {
    const key = remoteChatStateKey(droneId, chatName);
    if (activeChatStateKeyRef.current !== key) return false;
    if (opts?.preserveTranscripts !== true) setTranscripts(next.transcripts);
    setPending(next.pending);
    loadedChatStateKeyRef.current = key;
    setChatStateLoading(false);
    return true;
  }, []);

  const applyFullTranscript = React.useCallback((droneId: string, chatName: string, next: TranscriptItem[]) => {
    const key = remoteChatStateKey(droneId, chatName);
    if (activeChatStateKeyRef.current !== key) return false;
    setTranscripts(next);
    loadedFullTranscriptKeyRef.current = key;
    setChatStateLoading(false);
    return true;
  }, []);

  const loadChatState = React.useCallback(async (droneId: string, chatName: string) => {
    const key = remoteChatStateKey(droneId, chatName);
    const next = await fetchChatState(droneId, chatName);
    const hasFullTranscript = loadedFullTranscriptKeyRef.current === key;
    applyChatState(droneId, chatName, next, { preserveTranscripts: hasFullTranscript });
    if (hasFullTranscript) {
      const fullTranscript = await fetchFullTranscript(droneId, chatName);
      applyFullTranscript(droneId, chatName, fullTranscript);
    }
  }, [applyChatState, applyFullTranscript, fetchChatState, fetchFullTranscript]);

  React.useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      setLoading(true);
      try {
        const next = await loadSession();
        if (cancelled) return;
        if (next.authenticated) await loadDrones();
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [errorMessage, loadDrones, loadSession]);

  React.useEffect(() => {
    if (!authenticated || !effectiveDroneId) return;
    let cancelled = false;
    const droneId = effectiveDroneId;
    const run = async () => {
      try {
        const nextChats = await fetchChats(droneId);
        if (cancelled) return;
        setChats(nextChats.length > 0 ? nextChats : ['default']);
        setSelectedChat((current) => (nextChats.includes(current) ? current : nextChats[0] ?? 'default'));
      } catch (err: any) {
        if (!cancelled) setError(errorMessage(err));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [authenticated, effectiveDroneId, errorMessage, fetchChats]);

  React.useEffect(() => {
    if (authenticated && effectiveDroneId) return;
    setChats([]);
    setTranscripts([]);
    setPending([]);
    setChatStateLoading(false);
    setChatEventsConnected(false);
    loadedChatStateKeyRef.current = null;
    loadedFullTranscriptKeyRef.current = null;
  }, [authenticated, effectiveDroneId]);

  React.useEffect(() => {
    const key = effectiveDroneId && selectedChat ? remoteChatStateKey(effectiveDroneId, selectedChat) : null;
    if (!authenticated || !effectiveDroneId || !selectedChat || !key) {
      setChatRuntime({ key: null, info: null, models: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setChatRuntime({ key, info: null, models: [], loading: true, error: null });
    void remoteRequestJson<ChatRuntimeResponse>(
      `/api/drones/${encodeURIComponent(effectiveDroneId)}/chats/${encodeURIComponent(selectedChat)}/models`,
    )
      .then((data) => {
        if (cancelled) return;
        const models = (Array.isArray(data.models) ? data.models : [])
          .map((model) => ({
            id: String(model?.id ?? '').trim(),
            label: String(model?.label ?? model?.id ?? '').trim(),
            ...(model?.isCurrent ? { isCurrent: true } : {}),
            ...(model?.isDefault ? { isDefault: true } : {}),
          }))
          .filter((model) => model.id);
        setChatRuntime({
          key,
          info: normalizeChatInfoPayload(data),
          models,
          loading: false,
          error: null,
        });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setChatRuntime({
          key,
          info: null,
          models: [],
          loading: false,
          error: err?.message ?? String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, effectiveDroneId, selectedChat]);

  React.useEffect(() => {
    if (!authenticated || !effectiveDroneId || !selectedChat) return;
    if (pauseChatPolling) return;
    let mounted = true;
    const unsubscribe = subscribeDroneChatEvents({
      onConnectedChange: (connected) => {
        if (mounted) setChatEventsConnected(connected);
      },
      onDelta: (data) => {
        if (!droneChatEventMatches(data, effectiveDroneId, selectedChat)) return;
        setChatEventsNonce((value) => value + 1);
      },
    });
    return () => {
      mounted = false;
      setChatEventsConnected(false);
      unsubscribe();
    };
  }, [authenticated, effectiveDroneId, pauseChatPolling, selectedChat]);

  React.useEffect(() => {
    if (!authenticated || !effectiveDroneId || !selectedChat) return;
    if (pauseChatPolling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const droneId = effectiveDroneId;
    const chatName = selectedChat;
    const key = remoteChatStateKey(droneId, chatName);
    if (loadedChatStateKeyRef.current !== key) {
      setChatStateLoading(true);
    }
    const tick = async () => {
      try {
        const next = await fetchChatState(droneId, chatName, controller.signal);
        const hasFullTranscript = loadedFullTranscriptKeyRef.current === key;
        if (!cancelled && applyChatState(droneId, chatName, next, { preserveTranscripts: hasFullTranscript })) setError(null);
        if (!cancelled) {
          const fullTranscript = await fetchFullTranscript(droneId, chatName, controller.signal);
          if (!cancelled && applyFullTranscript(droneId, chatName, fullTranscript)) setError(null);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) {
          const intervalMs = document.visibilityState === 'hidden' ? 60_000 : chatEventsConnected ? 60_000 : 30_000;
          timer = setTimeout(tick, intervalMs);
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [
    applyChatState,
    applyFullTranscript,
    authenticated,
    chatEventsConnected,
    chatEventsNonce,
    effectiveDroneId,
    errorMessage,
    fetchChatState,
    fetchFullTranscript,
    pauseChatPolling,
    selectedChat,
  ]);

  const sendPrompt = React.useCallback(async (payload?: ChatSendPayload) => {
    const prompt = String(payload?.prompt ?? draft).trim();
    if (!effectiveDroneId || !selectedChat || !prompt) return;
    setSending(true);
    try {
      await remoteRequestJson(`/api/drones/${encodeURIComponent(effectiveDroneId)}/chats/${encodeURIComponent(selectedChat)}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, submittedAt: new Date().toISOString() }),
      });
      setDraft('');
      await loadChatState(effectiveDroneId, selectedChat);
      return true;
    } catch (err: any) {
      setError(errorMessage(err));
      return false;
    } finally {
      setSending(false);
    }
  }, [draft, effectiveDroneId, errorMessage, loadChatState, selectedChat]);

  const publishDraft = React.useCallback(async () => {
    if (!effectiveDroneId || !selectedChat || publishing) return false;
    setPublishing(true);
    try {
      const isDraftDrone = selectedDrone?.draft === true || selectedDrone?.hubPhase === 'draft';
      const url = isDraftDrone
        ? `/api/drones/${encodeURIComponent(effectiveDroneId)}/publish`
        : `/api/drones/${encodeURIComponent(effectiveDroneId)}/chats/${encodeURIComponent(selectedChat)}/publish`;
      await remoteRequestJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      await reloadDrones(effectiveDroneId);
      const nextChats = await fetchChats(effectiveDroneId).catch(() => null);
      if (nextChats) setChats(nextChats.length > 0 ? nextChats : ['default']);
      await loadChatState(effectiveDroneId, selectedChat).catch(() => {});
      setError(null);
      return true;
    } catch (err: any) {
      setError(errorMessage(err));
      return false;
    } finally {
      setPublishing(false);
    }
  }, [effectiveDroneId, errorMessage, fetchChats, loadChatState, publishing, reloadDrones, selectedChat, selectedDrone]);

  const stopChat = React.useCallback(async () => {
    if (!effectiveDroneId || !selectedChat) return;
    try {
      await remoteRequestJson(`/api/drones/${encodeURIComponent(effectiveDroneId)}/chats/${encodeURIComponent(selectedChat)}/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      await loadChatState(effectiveDroneId, selectedChat);
    } catch (err: any) {
      setError(errorMessage(err));
    }
  }, [effectiveDroneId, errorMessage, loadChatState, selectedChat]);

  const createChat = React.useCallback(async (chatNameRaw: string, opts?: { draft?: boolean }) => {
    const chatName = String(chatNameRaw ?? '').trim();
    if (!effectiveDroneId || !chatName) return false;
    try {
      await remoteRequestJson(`/api/drones/${encodeURIComponent(effectiveDroneId)}/chats`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: chatName, ...(opts?.draft === true ? { draft: true } : {}) }),
      });
      const nextChats = await fetchChats(effectiveDroneId);
      setChats(nextChats.length > 0 ? nextChats : ['default']);
      setSelectedChat(chatName);
      setError(null);
      return true;
    } catch (err: any) {
      setError(errorMessage(err));
      return false;
    }
  }, [effectiveDroneId, errorMessage, fetchChats]);

  const renameDrone = React.useCallback(async (newNameRaw: string) => {
    const newName = String(newNameRaw ?? '').trim();
    if (!effectiveDroneId || !newName) return false;
    try {
      await remoteRequestJson(`/api/drones/${encodeURIComponent(effectiveDroneId)}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newName }),
      });
      await reloadDrones(effectiveDroneId);
      setError(null);
      return true;
    } catch (err: any) {
      setError(errorMessage(err));
      return false;
    }
  }, [effectiveDroneId, errorMessage, reloadDrones]);

  const cloneDrone = React.useCallback(async (cloneNameRaw: string) => {
    const cloneName = String(cloneNameRaw ?? '').trim();
    if (!effectiveDroneId || !selectedDrone || !cloneName) return false;
    try {
      const response = await remoteRequestJson<{ ok: true; id: string }>('/api/drones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: cloneName,
          runtime: 'container',
          cloneFrom: effectiveDroneId,
          cloneChats: true,
          persistVolume: selectedDrone.persistVolume !== false,
          group: String(selectedDrone.group ?? '').trim(),
        }),
      });
      await reloadDrones(String(response.id ?? '').trim());
      setError(null);
      return true;
    } catch (err: any) {
      setError(errorMessage(err));
      return false;
    }
  }, [effectiveDroneId, errorMessage, reloadDrones, selectedDrone]);

  const logout = React.useCallback(async () => {
    await remoteRequestJson('/api/remote/logout', { method: 'POST' }).catch(() => {});
    markUnauthenticated();
  }, [markUnauthenticated]);

  const selectedChatRuntimeKey = effectiveDroneId && selectedChat
    ? remoteChatStateKey(effectiveDroneId, selectedChat)
    : null;
  const selectedChatRuntime: RemoteChatRuntimeState = chatRuntime.key === selectedChatRuntimeKey
    ? chatRuntime
    : {
        key: selectedChatRuntimeKey,
        info: null,
        models: [],
        loading: Boolean(selectedChatRuntimeKey),
        error: null,
      };

  return {
    authenticated,
    session,
    drones,
    selectedDrone,
    selectedDroneId,
    setSelectedDroneId,
    selectedChat,
    setSelectedChat,
    chats,
    draftChats,
    transcripts,
    pending,
    draft,
    setDraft,
    loading,
    chatStateLoading,
    chatRuntime: selectedChatRuntime,
    sending,
    publishing,
    error,
    sendPrompt,
    publishDraft,
    stopChat,
    createChat,
    renameDrone,
    cloneDrone,
    logout,
    reloadDrones,
  };
}
