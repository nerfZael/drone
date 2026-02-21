import React from 'react';
import type { ChatAgentConfig, ChatInfo } from '../../domain';
import { stripAnsi } from '../../domain';
import type { ChatSendPayload } from '../chat';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../types';
import type { StartupSeedState } from './app-types';
import { droneChatQueueKey, isDroneStartingOrSeeding, parseDroneChatQueueKey } from './helpers';
import { fetchJson, isNotFoundError, useNowMs, usePoll } from './hooks';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseChatRuntimeOrchestrationArgs = {
  chatInfo: ChatInfo | null;
  currentDrone: DroneSummary | null;
  currentDroneLabel: string;
  drones: DroneSummary[];
  outputView: 'screen' | 'log';
  optimisticPendingPrompts: PendingPrompt[];
  queuedPromptsByDroneChat: Record<string, PendingPrompt[]>;
  getQueuedPromptsForKey: (key: string) => PendingPrompt[];
  flushingQueuedKeysRef: React.MutableRefObject<Set<string>>;
  selectedChat: string;
  selectedDrone: string | null;
  selectedDroneIdentity: string;
  startupSeedByDrone: Record<string, StartupSeedState>;
  transcriptError: string | null;
  transcripts: TranscriptItem[] | null;
  setLoadingSession: React.Dispatch<React.SetStateAction<boolean>>;
  setLoadingTranscript: React.Dispatch<React.SetStateAction<boolean>>;
  setOptimisticPendingPrompts: React.Dispatch<React.SetStateAction<PendingPrompt[]>>;
  setSessionError: React.Dispatch<React.SetStateAction<string | null>>;
  setSessionText: React.Dispatch<React.SetStateAction<string>>;
  setTranscriptError: React.Dispatch<React.SetStateAction<string | null>>;
  setTranscripts: React.Dispatch<React.SetStateAction<TranscriptItem[] | null>>;
  enqueueQueuedPrompt: (droneIdRaw: string, chatNameRaw: string, promptRaw: string) => PendingPrompt | null;
  patchQueuedPrompt: (key: string, id: string, patch: Partial<PendingPrompt>) => void;
  removeQueuedPrompt: (key: string, id: string) => void;
  requestJson: RequestJson;
};

function chatUiModeForAgent(agent: ChatAgentConfig | null | undefined): 'transcript' | 'cli' {
  if (!agent) return 'transcript';
  return agent.kind === 'builtin' ? 'transcript' : 'cli';
}

export function useChatRuntimeOrchestration({
  chatInfo,
  currentDrone,
  currentDroneLabel,
  drones,
  outputView,
  optimisticPendingPrompts,
  queuedPromptsByDroneChat,
  getQueuedPromptsForKey,
  flushingQueuedKeysRef,
  selectedChat,
  selectedDrone,
  selectedDroneIdentity,
  startupSeedByDrone,
  transcriptError,
  transcripts,
  setLoadingSession,
  setLoadingTranscript,
  setOptimisticPendingPrompts,
  setSessionError,
  setSessionText,
  setTranscriptError,
  setTranscripts,
  enqueueQueuedPrompt,
  patchQueuedPrompt,
  removeQueuedPrompt,
  requestJson,
}: UseChatRuntimeOrchestrationArgs) {
  const [sendingPromptCount, setSendingPromptCount] = React.useState(0);
  const [promptError, setPromptError] = React.useState<string | null>(null);
  const [unstickingPendingPromptById, setUnstickingPendingPromptById] = React.useState<Record<string, true>>({});
  const [unstickPendingPromptErrorById, setUnstickPendingPromptErrorById] = React.useState<Record<string, string>>({});
  const [cliTyping, setCliTyping] = React.useState(false);
  const cliTypingTimerRef = React.useRef<any>(null);
  const sessionOffsetRef = React.useRef<number | null>(null);
  const screenLoadedRef = React.useRef(false);
  const transcriptsRef = React.useRef<TranscriptItem[] | null>(transcripts);
  const transcriptErrorRef = React.useRef<string | null>(transcriptError);
  const sessionTextRef = React.useRef<string>('');

  React.useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  React.useEffect(() => {
    transcriptErrorRef.current = transcriptError;
  }, [transcriptError]);

  React.useEffect(() => {
    return () => {
      if (cliTypingTimerRef.current) clearTimeout(cliTypingTimerRef.current);
    };
  }, []);

  const bumpCliTyping = React.useCallback(() => {
    setCliTyping(true);
    if (cliTypingTimerRef.current) clearTimeout(cliTypingTimerRef.current);
    cliTypingTimerRef.current = setTimeout(() => setCliTyping(false), 1400);
  }, []);

  const addOptimisticPendingPrompt = React.useCallback(
    (id: string, prompt: string) => {
      if (!id) return;
      setOptimisticPendingPrompts((prev) => {
        if (prev.some((p) => p.id === id)) return prev;
        return [...prev, { id, at: new Date().toISOString(), prompt, state: 'sending' }];
      });
    },
    [setOptimisticPendingPrompts],
  );

  React.useEffect(() => {
    // Clear any local optimistic entries when switching chats/drones.
    setOptimisticPendingPrompts([]);
    setUnstickingPendingPromptById({});
    setUnstickPendingPromptErrorById({});
  }, [selectedDrone, selectedChat, setOptimisticPendingPrompts]);

  const selectedDroneSummary = React.useMemo(
    () => (selectedDrone ? drones.find((x) => x.id === selectedDrone) ?? null : null),
    [drones, selectedDrone],
  );
  const hasSelectedDroneSummary = selectedDroneSummary !== null;
  const selectedDroneHubPhase = selectedDroneSummary?.hubPhase ?? null;
  const startupSeedForSelectedDrone = React.useMemo(
    () => (selectedDrone ? startupSeedByDrone[selectedDrone] ?? null : null),
    [selectedDrone, startupSeedByDrone],
  );
  const startupAgentForSelectedDrone =
    selectedDroneSummary &&
    isDroneStartingOrSeeding(selectedDroneSummary.hubPhase) &&
    startupSeedForSelectedDrone?.agent
      ? startupSeedForSelectedDrone.agent
      : null;
  const chatUiMode = chatUiModeForAgent(chatInfo?.agent ?? startupAgentForSelectedDrone ?? null);
  const nowMs = useNowMs(1000, chatUiMode === 'transcript');
  const sendingPrompt = sendingPromptCount > 0;

  const resetSessionOutputState = React.useCallback(() => {
    sessionOffsetRef.current = null;
    screenLoadedRef.current = false;
    sessionTextRef.current = '';
    setSessionText('');
    setSessionError(null);
    setLoadingSession(false);
  }, [setLoadingSession, setSessionError, setSessionText]);

  React.useEffect(() => {
    // Reset output buffer on effective selection/chat change.
    // Use stable drone identity so in-place renames don't wipe the current chat/output pane.
    const shouldPrimeTranscriptLoading = chatUiMode === 'transcript' && Boolean(selectedDrone && selectedChat);
    const shouldPrimeSessionLoading = chatUiMode === 'cli' && Boolean(selectedDrone && selectedChat);
    resetSessionOutputState();
    setLoadingTranscript(shouldPrimeTranscriptLoading);
    setTranscripts(null);
    setTranscriptError(null);
    setLoadingSession(shouldPrimeSessionLoading);
    // pending prompts are chat-scoped and loaded in the chat selection effect
  }, [
    chatUiMode,
    outputView,
    resetSessionOutputState,
    selectedDrone,
    selectedChat,
    selectedDroneIdentity,
    setLoadingSession,
    setLoadingTranscript,
    setTranscriptError,
    setTranscripts,
  ]);

  const sendPromptText = React.useCallback(
    async (payload: ChatSendPayload): Promise<boolean> => {
      if (!currentDrone) return false;
      const prompt = String(payload?.prompt ?? '').trim();
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
      if (!prompt && attachments.length === 0) return false;

      const optimisticPrompt =
        prompt || (attachments.length === 1 ? '[image attachment]' : `[${attachments.length} image attachments]`);
      if (isDroneStartingOrSeeding(currentDrone.hubPhase)) {
        if (attachments.length > 0) {
          setPromptError(`"${currentDroneLabel}" is still provisioning. Image attachments can be sent once it is ready.`);
          return false;
        }
        enqueueQueuedPrompt(currentDrone.id, selectedChat || 'default', prompt);
        setPromptError(null);
        return true;
      }

      setSendingPromptCount((c) => c + 1);
      setPromptError(null);
      try {
        const data = await requestJson<{ ok: true; accepted: true; promptId: string }>(
          `/api/drones/${encodeURIComponent(currentDrone.id)}/chats/${encodeURIComponent(selectedChat || 'default')}/prompt`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt, attachments }),
          },
        );
        if (chatUiMode === 'cli') bumpCliTyping();
        const id = String((data as any)?.promptId ?? '').trim();
        if (chatUiMode === 'transcript') addOptimisticPendingPrompt(id, optimisticPrompt);
        return true;
      } catch (e: any) {
        setPromptError(e?.message ?? String(e));
        return false;
      } finally {
        setSendingPromptCount((c) => Math.max(0, c - 1));
      }
    },
    [
      addOptimisticPendingPrompt,
      bumpCliTyping,
      chatUiMode,
      currentDrone,
      currentDroneLabel,
      enqueueQueuedPrompt,
      requestJson,
      selectedChat,
    ],
  );

  const requestUnstickPendingPrompt = React.useCallback(
    async (promptIdRaw: string): Promise<void> => {
      const id = String(promptIdRaw ?? '').trim();
      if (!id || !selectedDrone || !selectedChat) return;

      let shouldStart = false;
      setUnstickingPendingPromptById((prev) => {
        if (prev[id]) return prev;
        shouldStart = true;
        return { ...prev, [id]: true };
      });
      if (!shouldStart) return;
      setUnstickPendingPromptErrorById((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });

      try {
        await requestJson<{ ok: true }>(
          `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat || 'default')}/pending/${encodeURIComponent(id)}/unstick`,
          { method: 'POST' },
        );
        setOptimisticPendingPrompts((prev) =>
          prev.map((p) => (p.id === id ? { ...p, state: 'sent', error: undefined, updatedAt: new Date().toISOString() } : p)),
        );
      } catch (e: any) {
        setUnstickPendingPromptErrorById((prev) => ({ ...prev, [id]: e?.message ?? String(e) }));
      } finally {
        setUnstickingPendingPromptById((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [requestJson, selectedChat, selectedDrone, setOptimisticPendingPrompts],
  );

  React.useEffect(() => {
    const keys = Object.keys(queuedPromptsByDroneChat);
    if (keys.length === 0) return;

    for (const key of keys) {
      const parsed = parseDroneChatQueueKey(key);
      if (!parsed) continue;
      const drone = drones.find((d) => d.id === parsed.droneId) ?? null;
      if (!drone) continue;
      if (isDroneStartingOrSeeding(drone.hubPhase) || drone.hubPhase === 'error') continue;
      if (flushingQueuedKeysRef.current.has(key)) continue;
      flushingQueuedKeysRef.current.add(key);

      void (async () => {
        while (true) {
          const latest = getQueuedPromptsForKey(key);
          const head = latest[0] ?? null;
          if (!head) return;
          // Preserve strict FIFO ordering: if the head failed (or is mid-send), don't send later items.
          if (head.state !== 'queued') return;

          patchQueuedPrompt(key, head.id, { state: 'sending', error: undefined });
          try {
            const data = await requestJson<{ ok: true; accepted: true; promptId: string }>(
              `/api/drones/${encodeURIComponent(parsed.droneId)}/chats/${encodeURIComponent(parsed.chatName)}/prompt`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ prompt: head.prompt }),
              },
            );

            const id = String((data as any)?.promptId ?? '').trim();
            removeQueuedPrompt(key, head.id);

            // If the flushed prompt is for the currently visible chat, mirror the optimistic UX.
            const selectedKeyMatches =
              parsed.droneId === String(selectedDrone ?? '').trim() &&
              parsed.chatName === (String(selectedChat ?? '').trim() || 'default');
            if (selectedKeyMatches) {
              if (chatUiMode === 'cli') bumpCliTyping();
              if (chatUiMode === 'transcript') addOptimisticPendingPrompt(id, head.prompt);
            }
          } catch (e: any) {
            const errText = e?.message ?? String(e);
            patchQueuedPrompt(key, head.id, { state: 'failed', error: errText });
            return;
          }
        }
      })().finally(() => {
        flushingQueuedKeysRef.current.delete(key);
      });
    }
  }, [
    addOptimisticPendingPrompt,
    bumpCliTyping,
    chatUiMode,
    drones,
    flushingQueuedKeysRef,
    patchQueuedPrompt,
    queuedPromptsByDroneChat,
    getQueuedPromptsForKey,
    removeQueuedPrompt,
    requestJson,
    selectedChat,
    selectedDrone,
  ]);

  const { value: pendingResp } = usePoll<{ ok: true; pending: PendingPrompt[] }>(
    async () => {
      if (chatUiMode !== 'transcript') return { ok: true, pending: [] };
      if (!selectedDrone || !selectedChat) return { ok: true, pending: [] };
      if (!hasSelectedDroneSummary) return { ok: true, pending: [] };
      if (isDroneStartingOrSeeding(selectedDroneHubPhase)) return { ok: true, pending: [] };
      return await fetchJson<{ ok: true; pending: PendingPrompt[] }>(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat || 'default')}/pending`,
      );
    },
    1000,
    [chatUiMode, selectedDrone, selectedChat, hasSelectedDroneSummary, selectedDroneHubPhase],
  );

  const pendingPrompts: PendingPrompt[] = React.useMemo(() => {
    const server = Array.isArray(pendingResp?.pending) ? pendingResp.pending : [];
    const byId = new Map<string, PendingPrompt>();
    for (const p of server) {
      if (p?.id) byId.set(p.id, p);
    }
    for (const p of optimisticPendingPrompts) {
      if (p?.id && !byId.has(p.id)) byId.set(p.id, p);
    }
    return Array.from(byId.values()).slice(-60);
  }, [optimisticPendingPrompts, pendingResp]);

  const visiblePendingPrompts = React.useMemo(() => {
    if (chatUiMode !== 'transcript') return [];
    const ts = Array.isArray(transcripts) ? transcripts : [];
    const ids = new Set(ts.map((t) => String((t as any)?.id ?? '')).filter(Boolean));
    return pendingPrompts.filter((p) => p.state === 'failed' || !ids.has(p.id));
  }, [chatUiMode, pendingPrompts, transcripts]);

  const startupPendingPrompt = React.useMemo((): PendingPrompt | null => {
    if (chatUiMode !== 'transcript') return null;
    if (!selectedDroneSummary) return null;
    if (!isDroneStartingOrSeeding(selectedDroneSummary.hubPhase)) return null;
    const seed = selectedDroneSummary.id ? startupSeedByDrone[selectedDroneSummary.id] : null;
    if (!seed) return null;
    const prompt = String(seed.prompt ?? '').trim();
    if (!prompt) return null;
    return {
      id: `seed-${selectedDroneSummary.id}-${seed.chatName}`,
      at: seed.at || new Date().toISOString(),
      prompt,
      state: 'sending',
      updatedAt: seed.at || undefined,
    };
  }, [chatUiMode, selectedDroneSummary, startupSeedByDrone]);

  const localQueuedPromptsForSelected = React.useMemo((): PendingPrompt[] => {
    if (!selectedDrone) return [];
    const key = droneChatQueueKey(selectedDrone, selectedChat || 'default');
    return queuedPromptsByDroneChat[key] ?? [];
  }, [queuedPromptsByDroneChat, selectedChat, selectedDrone]);

  const visiblePendingPromptsWithStartup = React.useMemo(() => {
    const base = (() => {
      if (!startupPendingPrompt) return visiblePendingPrompts;
      const startupPrompt = String(startupPendingPrompt.prompt ?? '').trim();
      if (
        visiblePendingPrompts.some((p) => {
          if (p.id === startupPendingPrompt.id) return true;
          const prompt = String(p?.prompt ?? '').trim();
          return Boolean(startupPrompt) && Boolean(prompt) && prompt === startupPrompt;
        })
      ) {
        return visiblePendingPrompts;
      }
      return [startupPendingPrompt, ...visiblePendingPrompts];
    })();

    if (chatUiMode !== 'transcript' || localQueuedPromptsForSelected.length === 0) return base;
    const ids = new Set(base.map((p) => p.id));
    const extra = localQueuedPromptsForSelected.filter((p) => !ids.has(p.id));
    return extra.length > 0 ? [...base, ...extra] : base;
  }, [chatUiMode, localQueuedPromptsForSelected, startupPendingPrompt, visiblePendingPrompts]);

  const selectedIsResponding = React.useMemo(() => {
    if (selectedDrone) {
      if (sendingPrompt) return true; // request in flight
      if (chatUiMode === 'cli' && cliTyping) return true; // best-effort signal for custom agents
    }
    return visiblePendingPromptsWithStartup.some((p) => p.state !== 'failed');
  }, [chatUiMode, cliTyping, sendingPrompt, selectedDrone, visiblePendingPromptsWithStartup]);

  React.useEffect(() => {
    if (chatUiMode !== 'transcript') return;
    if (!hasSelectedDroneSummary) return;
    let mounted = true;
    let timer: any = null;
    let busy = false;
    const load = async () => {
      if (!selectedDrone || !selectedChat || busy) return;
      if (isDroneStartingOrSeeding(selectedDroneHubPhase)) return;
      busy = true;
      const initial = transcriptsRef.current === null && !transcriptErrorRef.current;
      if (initial && mounted) setLoadingTranscript(true);
      try {
        const data = await fetchJson<{ ok: true; transcripts: TranscriptItem[] }>(
          `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}/transcript?turn=all`,
        );
        if (!mounted) return;
        setTranscripts(data.transcripts ?? []);
        setTranscriptError(null);
      } catch (e: any) {
        if (!mounted) return;
        if (isNotFoundError(e)) {
          // Treat 404 as "no transcript yet" to avoid a scary error state for brand new chats.
          setTranscripts([]);
          setTranscriptError(null);
        } else {
          setTranscriptError(e?.message ?? String(e));
        }
      } finally {
        if (mounted) setLoadingTranscript(false);
        busy = false;
      }
    };
    load();
    timer = setInterval(load, 2000);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [
    chatUiMode,
    selectedDrone,
    selectedChat,
    hasSelectedDroneSummary,
    selectedDroneHubPhase,
    setLoadingTranscript,
    setTranscriptError,
    setTranscripts,
  ]);

  React.useEffect(() => {
    if (chatUiMode !== 'cli') return;
    let mounted = true;
    let timer: any = null;
    let busy = false;
    const load = async () => {
      if (!selectedDrone || !selectedChat || busy) return;
      busy = true;
      const d = drones.find((x) => x.id === selectedDrone) ?? null;
      if (isDroneStartingOrSeeding(d?.hubPhase)) {
        if (mounted) resetSessionOutputState();
        busy = false;
        return;
      }
      const chatExists = Boolean(d && Array.isArray(d.chats) && d.chats.includes(selectedChat));
      if (!chatExists) {
        if (mounted) resetSessionOutputState();
        busy = false;
        return;
      }
      const initial = outputView === 'log' ? sessionOffsetRef.current == null : !screenLoadedRef.current;
      if (initial && mounted) setLoadingSession(true);
      try {
        const qs = new URLSearchParams();
        if (outputView === 'screen') {
          qs.set('view', 'screen');
          qs.set('tail', '2000');
          const data = await fetchJson<{ ok: true; text: string }>(
            `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}/output?${qs.toString()}`,
          );
          if (!mounted) return;
          const nextText = typeof data?.text === 'string' ? data.text : '';
          const nextPlain = stripAnsi(nextText);
          if (sessionTextRef.current && nextPlain !== sessionTextRef.current) bumpCliTyping();
          sessionTextRef.current = nextPlain;
          screenLoadedRef.current = true;
          sessionOffsetRef.current = null;
          setSessionError(null);
          setSessionText((prev) => (prev === nextPlain ? prev : nextPlain));
        } else {
          if (initial) {
            qs.set('tail', '200');
          } else {
            qs.set('since', String(sessionOffsetRef.current));
            qs.set('maxBytes', '200000');
          }
          const data = await fetchJson<{ ok: true; offsetBytes: number; text: string }>(
            `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}/output?${qs.toString()}`,
          );
          if (!mounted) return;
          const nextOffset =
            typeof data?.offsetBytes === 'number' && Number.isFinite(data.offsetBytes)
              ? data.offsetBytes
              : sessionOffsetRef.current ?? 0;
          const chunk = typeof data?.text === 'string' ? data.text : '';
          const chunkPlain = chunk ? stripAnsi(chunk) : '';
          sessionOffsetRef.current = nextOffset;
          setSessionError(null);
          if (initial) {
            sessionTextRef.current = chunkPlain;
            setSessionText(chunkPlain);
          } else if (chunkPlain) {
            bumpCliTyping();
            setSessionText((prev) => {
              const next = prev + chunkPlain;
              const capped = next.length > 800_000 ? next.slice(-800_000) : next;
              sessionTextRef.current = capped;
              return capped;
            });
          }
        }
      } catch (e: any) {
        if (!mounted) return;
        setSessionError(e?.message ?? String(e));
      } finally {
        if (mounted) setLoadingSession(false);
        busy = false;
      }
    };
    load();
    timer = setInterval(load, 1000);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [chatUiMode, drones, outputView, resetSessionOutputState, selectedChat, selectedDrone, setLoadingSession, setSessionError, setSessionText, bumpCliTyping]);

  return {
    chatUiMode,
    nowMs,
    promptError,
    requestUnstickPendingPrompt,
    selectedIsResponding,
    sendPromptText,
    sendingPrompt,
    unstickingPendingPromptById,
    unstickPendingPromptErrorById,
    visiblePendingPromptsWithStartup,
  };
}
