import React from 'react';
import type { ChatSendPayload } from '../droneHub/chat';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../droneHub/types';
import {
  remoteRequestJson,
  setRemoteCsrf,
  type ChatListResponse,
  type DroneListResponse,
  type PendingResponse,
  type RemoteSession,
  type TranscriptResponse,
} from './remote-api';

type RemoteChatState = {
  transcripts: TranscriptItem[];
  pending: PendingPrompt[];
};

function remoteChatStateKey(droneId: string, chatName: string): string {
  return `${droneId}\u0000${chatName}`;
}

export function useRemoteHubModel() {
  const [session, setSession] = React.useState<RemoteSession | null>(null);
  const [drones, setDrones] = React.useState<DroneSummary[]>([]);
  const [selectedDroneId, setSelectedDroneId] = React.useState<string | null>(null);
  const [selectedChat, setSelectedChat] = React.useState('default');
  const [chats, setChats] = React.useState<string[]>([]);
  const [transcripts, setTranscripts] = React.useState<TranscriptItem[]>([]);
  const [pending, setPending] = React.useState<PendingPrompt[]>([]);
  const [draft, setDraft] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [chatStateLoading, setChatStateLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const activeChatStateKeyRef = React.useRef<string | null>(null);
  const loadedChatStateKeyRef = React.useRef<string | null>(null);

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
    setTranscripts([]);
    setPending([]);
    setChatStateLoading(false);
    activeChatStateKeyRef.current = null;
    loadedChatStateKeyRef.current = null;
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

  const fetchChats = React.useCallback(async (droneId: string) => {
    const data = await remoteRequestJson<ChatListResponse>(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    return (Array.isArray(data.chats) ? data.chats : []).map((item) => String(item.chat ?? item.name ?? '')).filter(Boolean);
  }, []);

  const fetchChatState = React.useCallback(async (droneId: string, chatName: string): Promise<RemoteChatState> => {
    const [transcriptData, pendingData] = await Promise.all([
      remoteRequestJson<TranscriptResponse>(`/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/transcript?turn=all&tail=50`),
      remoteRequestJson<PendingResponse>(`/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/pending`),
    ]);
    return {
      transcripts: Array.isArray(transcriptData.transcripts) ? transcriptData.transcripts : [],
      pending: Array.isArray(pendingData.pending) ? pendingData.pending : [],
    };
  }, []);

  const applyChatState = React.useCallback((droneId: string, chatName: string, next: RemoteChatState) => {
    const key = remoteChatStateKey(droneId, chatName);
    if (activeChatStateKeyRef.current !== key) return false;
    setTranscripts(next.transcripts);
    setPending(next.pending);
    loadedChatStateKeyRef.current = key;
    setChatStateLoading(false);
    return true;
  }, []);

  const loadChatState = React.useCallback(async (droneId: string, chatName: string) => {
    const next = await fetchChatState(droneId, chatName);
    applyChatState(droneId, chatName, next);
  }, [applyChatState, fetchChatState]);

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
    loadedChatStateKeyRef.current = null;
  }, [authenticated, effectiveDroneId]);

  React.useEffect(() => {
    if (!authenticated || !effectiveDroneId || !selectedChat) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const droneId = effectiveDroneId;
    const chatName = selectedChat;
    const key = remoteChatStateKey(droneId, chatName);
    if (loadedChatStateKeyRef.current !== key) {
      setChatStateLoading(true);
    }
    const tick = async () => {
      try {
        const next = await fetchChatState(droneId, chatName);
        if (!cancelled && applyChatState(droneId, chatName, next)) setError(null);
      } catch (err: any) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) timer = setTimeout(tick, document.visibilityState === 'hidden' ? 8000 : 2500);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [applyChatState, authenticated, effectiveDroneId, errorMessage, fetchChatState, selectedChat]);

  const sendPrompt = React.useCallback(async (payload?: ChatSendPayload) => {
    const prompt = String(payload?.prompt ?? draft).trim();
    if (!effectiveDroneId || !selectedChat || !prompt) return;
    setSending(true);
    try {
      await remoteRequestJson(`/api/drones/${encodeURIComponent(effectiveDroneId)}/chats/${encodeURIComponent(selectedChat)}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
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

  const logout = React.useCallback(async () => {
    await remoteRequestJson('/api/remote/logout', { method: 'POST' }).catch(() => {});
    markUnauthenticated();
  }, [markUnauthenticated]);

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
    transcripts,
    pending,
    draft,
    setDraft,
    loading,
    chatStateLoading,
    sending,
    error,
    sendPrompt,
    stopChat,
    logout,
  };
}
