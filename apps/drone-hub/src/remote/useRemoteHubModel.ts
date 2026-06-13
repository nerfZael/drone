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
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const authenticated = session?.authenticated === true;
  const selectedDrone = drones.find((drone) => drone.id === selectedDroneId) ?? drones[0] ?? null;
  const effectiveDroneId = selectedDrone?.id ?? null;

  const markUnauthenticated = React.useCallback(() => {
    setRemoteCsrf(null);
    setSession({ ok: true, authenticated: false, csrf: null });
    setDrones([]);
    setSelectedDroneId(null);
    setChats([]);
    setTranscripts([]);
    setPending([]);
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

  const loadChats = React.useCallback(async (droneId: string) => {
    const data = await remoteRequestJson<ChatListResponse>(`/api/drones/${encodeURIComponent(droneId)}/chats`);
    const nextChats = (Array.isArray(data.chats) ? data.chats : []).map((item) => String(item.chat ?? item.name ?? '')).filter(Boolean);
    setChats(nextChats.length > 0 ? nextChats : ['default']);
    setSelectedChat((current) => (nextChats.includes(current) ? current : nextChats[0] ?? 'default'));
  }, []);

  const loadChatState = React.useCallback(async (droneId: string, chatName: string) => {
    const [transcriptData, pendingData] = await Promise.all([
      remoteRequestJson<TranscriptResponse>(`/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/transcript?turn=all`),
      remoteRequestJson<PendingResponse>(`/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/pending`),
    ]);
    setTranscripts(Array.isArray(transcriptData.transcripts) ? transcriptData.transcripts : []);
    setPending(Array.isArray(pendingData.pending) ? pendingData.pending : []);
  }, []);

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
    void loadChats(effectiveDroneId).catch((err: any) => setError(errorMessage(err)));
  }, [authenticated, effectiveDroneId, errorMessage, loadChats]);

  React.useEffect(() => {
    if (authenticated && effectiveDroneId) return;
    setChats([]);
    setTranscripts([]);
    setPending([]);
  }, [authenticated, effectiveDroneId]);

  React.useEffect(() => {
    if (!authenticated || !effectiveDroneId || !selectedChat) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        await loadChatState(effectiveDroneId, selectedChat);
        if (!cancelled) setError(null);
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
  }, [authenticated, effectiveDroneId, errorMessage, loadChatState, selectedChat]);

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
    sending,
    error,
    sendPrompt,
    stopChat,
    logout,
  };
}
