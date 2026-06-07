import React from 'react';
import type { ChatAgentConfig, ChatInfo } from '../../domain';
import { stripAnsi } from '../../domain';
import type { ChatSendPayload } from '../chat';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../types';
import type { StartupSeedState } from './app-types';
import { formatDroneRuntimeError, isTransientDroneStartupError } from './chat-startup-errors';
import {
  appendOptimisticPendingPrompt,
  createOptimisticPendingPrompt,
  normalizePendingPromptState,
  reconcileOptimisticPendingPrompt,
} from './optimistic-pending-prompts';
import { droneChatEventMatches, fetchDroneChatTranscriptCached, sameTranscriptItems, sendDroneChatPrompt } from './chat-api';
import { subscribeDroneChatEvents } from './chat-events';
import { droneChatQueueKey, isDroneStartingOrSeeding, parseDroneChatQueueKey } from './helpers';
import { fetchJson, isNotFoundError, resolvePollIntervalMs, usePoll } from './hooks';
import { beginRecordBusyKey, removeRecordKey } from './keyed-record-state';
import type { QueuedPrompt } from './use-queued-prompts-state';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

const STOPPED_BY_USER_ERROR = 'Stopped by user.';
const STOPPED_BEFORE_SUBMISSION_ERROR = 'Stopped before submission.';
const INITIAL_TRANSCRIPT_TAIL_TURNS = 50;

type UseChatRuntimeOrchestrationArgs = {
  chatInfo: ChatInfo | null;
  currentDrone: DroneSummary | null;
  currentDroneLabel: string;
  droneById: Record<string, DroneSummary>;
  outputView: 'screen' | 'log';
  optimisticPendingPrompts: PendingPrompt[];
  queuedPromptsByDroneChat: Record<string, QueuedPrompt[]>;
  getQueuedPromptsForKey: (key: string) => QueuedPrompt[];
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
  enqueueQueuedPrompt: (
    droneIdRaw: string,
    chatNameRaw: string,
    promptRaw: string,
    attachmentsRaw?: ChatSendPayload['attachments'],
  ) => QueuedPrompt | null;
  patchQueuedPrompt: (key: string, id: string, patch: Partial<QueuedPrompt>) => void;
  removeQueuedPrompt: (key: string, id: string) => void;
  requestJson: RequestJson;
};

function chatUiModeForAgent(agent: ChatAgentConfig | null | undefined): 'transcript' | 'cli' {
  if (!agent) return 'transcript';
  return agent.kind === 'builtin' ? 'transcript' : 'cli';
}

function isStoppableTranscriptPendingPrompt(item: PendingPrompt | null | undefined): boolean {
  if (!item || item.automation) return false;
  return item.state === 'queued' || item.state === 'sending' || item.state === 'sent';
}

export function useChatRuntimeOrchestration({
  chatInfo,
  currentDrone,
  currentDroneLabel,
  droneById,
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
  const [cancellingPendingPromptById, setCancellingPendingPromptById] = React.useState<Record<string, true>>({});
  const [cancelPendingPromptErrorById, setCancelPendingPromptErrorById] = React.useState<Record<string, string>>({});
  const [stoppingResponse, setStoppingResponse] = React.useState(false);
  const [stopResponseError, setStopResponseError] = React.useState<string | null>(null);
  const [cliTyping, setCliTyping] = React.useState(false);
  const [chatEventsConnected, setChatEventsConnected] = React.useState(false);
  const [chatEventsNonce, setChatEventsNonce] = React.useState(0);
  const cliTypingTimerRef = React.useRef<any>(null);
  const sessionOffsetRef = React.useRef<number | null>(null);
  const transcriptEtagRef = React.useRef<string | null>(null);
  const fullTranscriptLoadedRef = React.useRef(false);
  const screenLoadedRef = React.useRef(false);
  const transcriptsRef = React.useRef<TranscriptItem[] | null>(transcripts);
  const transcriptErrorRef = React.useRef<string | null>(transcriptError);
  const sessionTextRef = React.useRef<string>('');
  const selectedDroneRef = React.useRef(selectedDrone);
  const selectedChatRef = React.useRef(selectedChat);

  React.useEffect(() => {
    selectedDroneRef.current = selectedDrone;
  }, [selectedDrone]);

  React.useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

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
    (
      prompt: string,
      attachmentsRaw?: ChatSendPayload['attachments'],
      opts?: { id?: string | null; state?: PendingPrompt['state']; blockedByAutomation?: boolean },
    ): PendingPrompt | null => {
      const item = createOptimisticPendingPrompt({
        id: opts?.id,
        prompt,
        attachments: attachmentsRaw,
        state: opts?.state,
        blockedByAutomation: opts?.blockedByAutomation,
      });
      if (!item) return null;
      const nextState = normalizePendingPromptState(opts?.state);
      setOptimisticPendingPrompts((prev) => {
        return appendOptimisticPendingPrompt(prev, { ...item, state: nextState });
      });
      return { ...item, state: nextState };
    },
    [setOptimisticPendingPrompts],
  );

  const reconcileLocalPendingPrompt = React.useCallback(
    (
      optimisticId: string,
      opts: { confirmedId?: string | null; state?: unknown; blockedByAutomation?: boolean; error?: string | null },
    ) => {
      setOptimisticPendingPrompts((prev) =>
        reconcileOptimisticPendingPrompt(prev, {
          optimisticId,
          confirmedId: opts.confirmedId,
          state: opts.state,
          blockedByAutomation: opts.blockedByAutomation,
          error: opts.error,
        }),
      );
    },
    [setOptimisticPendingPrompts],
  );

  React.useEffect(() => {
    // Clear any local optimistic entries when switching chats/drones.
    setOptimisticPendingPrompts([]);
    setUnstickingPendingPromptById({});
    setUnstickPendingPromptErrorById({});
    setCancellingPendingPromptById({});
    setCancelPendingPromptErrorById({});
    setStoppingResponse(false);
    setStopResponseError(null);
  }, [selectedDrone, selectedChat, setOptimisticPendingPrompts]);

  const selectedDroneSummary = selectedDrone ? droneById[selectedDrone] ?? null : null;
  const hasSelectedDroneSummary = selectedDroneSummary !== null;
  const selectedDroneHubPhase = selectedDroneSummary?.hubPhase ?? null;
  const selectedDroneChatsKey = React.useMemo(() => {
    if (!Array.isArray(selectedDroneSummary?.chats)) return '';
    return selectedDroneSummary.chats
      .map((chat) => String(chat ?? '').trim())
      .filter(Boolean)
      .join('\u0000');
  }, [selectedDroneSummary?.chats]);
  const selectedDroneHasSelectedChat = React.useMemo(() => {
    const chat = String(selectedChat ?? '').trim();
    if (!chat || !selectedDroneChatsKey) return false;
    return selectedDroneChatsKey.split('\u0000').includes(chat);
  }, [selectedChat, selectedDroneChatsKey]);
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
    transcriptEtagRef.current = null;
    fullTranscriptLoadedRef.current = false;
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

      if (isDroneStartingOrSeeding(currentDrone.hubPhase)) {
        enqueueQueuedPrompt(currentDrone.id, selectedChat || 'default', prompt, attachments);
        setPromptError(null);
        return true;
      }

      const originDroneId = currentDrone.id;
      const originChat = selectedChat || 'default';
      const optimisticItem = addOptimisticPendingPrompt(prompt, attachments, { state: 'sending' });
      const optimisticId = String(optimisticItem?.id ?? '').trim();

      setSendingPromptCount((c) => c + 1);
      setPromptError(null);
      setStopResponseError(null);
      try {
        const data = await sendDroneChatPrompt(requestJson, {
          droneId: currentDrone.id,
          chatName: selectedChat || 'default',
          prompt,
          attachments,
        });
        const stillOnSameChat =
          selectedDroneRef.current === originDroneId &&
          (selectedChatRef.current || 'default') === originChat;
        if (stillOnSameChat) {
          if (chatUiMode === 'cli') bumpCliTyping();
          if (optimisticId) {
            reconcileLocalPendingPrompt(optimisticId, {
              confirmedId: String((data as any)?.promptId ?? '').trim(),
              state: data?.pendingState,
              blockedByAutomation: data?.blockedByAutomation === true,
            });
          } else {
            addOptimisticPendingPrompt(prompt, attachments, {
              id: String((data as any)?.promptId ?? '').trim(),
              state: data?.pendingState,
              blockedByAutomation: data?.blockedByAutomation === true,
            });
          }
        }
        return true;
      } catch (e: any) {
        const message = formatDroneRuntimeError(e);
        if (
          selectedDroneRef.current === originDroneId &&
          (selectedChatRef.current || 'default') === originChat
        ) {
          if (optimisticId) {
            reconcileLocalPendingPrompt(optimisticId, { state: 'failed', error: message });
          }
          setPromptError(message);
        }
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

      if (!beginRecordBusyKey(setUnstickingPendingPromptById, id)) return;
      setUnstickPendingPromptErrorById((prev) => {
        return removeRecordKey(prev, id);
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
          return removeRecordKey(prev, id);
        });
      }
    },
    [requestJson, selectedChat, selectedDrone, setOptimisticPendingPrompts],
  );

  const requestCancelPendingPrompt = React.useCallback(
    async (promptIdRaw: string): Promise<void> => {
      const id = String(promptIdRaw ?? '').trim();
      if (!id || !selectedDrone) return;
      const chatName = String(selectedChat ?? '').trim() || 'default';

      if (!beginRecordBusyKey(setCancellingPendingPromptById, id)) return;
      setCancelPendingPromptErrorById((prev) => {
        return removeRecordKey(prev, id);
      });

      const key = droneChatQueueKey(selectedDrone, chatName);
      const localQueued = (queuedPromptsByDroneChat[key] ?? []).some((item) => item.id === id && item.state === 'queued');
      if (localQueued) {
        removeQueuedPrompt(key, id);
        setOptimisticPendingPrompts((prev) => prev.filter((p) => p.id !== id));
        setCancellingPendingPromptById((prev) => {
          return removeRecordKey(prev, id);
        });
        return;
      }

      try {
        const data = await requestJson<{ ok: true; cancelled: boolean; alreadySubmitted: boolean }>(
          `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chatName)}/pending/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        );
        if (data.cancelled) {
          setOptimisticPendingPrompts((prev) => prev.filter((p) => p.id !== id));
        } else if (data.alreadySubmitted) {
          setCancelPendingPromptErrorById((prev) => ({ ...prev, [id]: 'Already submitted to agent.' }));
        } else {
          setCancelPendingPromptErrorById((prev) => ({ ...prev, [id]: 'Unable to cancel pending prompt.' }));
        }
      } catch (e: any) {
        const status = Number((e as any)?.status ?? 0);
        if (status === 404) {
          setOptimisticPendingPrompts((prev) => prev.filter((p) => p.id !== id));
        } else {
          setCancelPendingPromptErrorById((prev) => ({ ...prev, [id]: e?.message ?? String(e) }));
        }
      } finally {
        setCancellingPendingPromptById((prev) => {
          return removeRecordKey(prev, id);
        });
      }
    },
    [queuedPromptsByDroneChat, removeQueuedPrompt, requestJson, selectedChat, selectedDrone, setOptimisticPendingPrompts],
  );

  React.useEffect(() => {
    const keys = Object.keys(queuedPromptsByDroneChat);
    if (keys.length === 0) return;

    for (const key of keys) {
      const parsed = parseDroneChatQueueKey(key);
      if (!parsed) continue;
      const drone = droneById[parsed.droneId] ?? null;
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
            const data = await sendDroneChatPrompt(requestJson, {
              droneId: parsed.droneId,
              chatName: parsed.chatName,
              prompt: head.prompt,
              attachments: head.attachmentPayloads ?? [],
            });

            const id = String((data as any)?.promptId ?? '').trim();
            removeQueuedPrompt(key, head.id);

            // If the flushed prompt is for the currently visible chat, mirror the optimistic UX.
            const selectedKeyMatches =
              parsed.droneId === String(selectedDrone ?? '').trim() &&
              parsed.chatName === (String(selectedChat ?? '').trim() || 'default');
            if (selectedKeyMatches) {
              if (chatUiMode === 'cli') bumpCliTyping();
              addOptimisticPendingPrompt(head.prompt, head.attachmentPayloads, {
                id,
                state: data?.pendingState,
                blockedByAutomation: data?.blockedByAutomation === true,
              });
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
    droneById,
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
      if (!selectedDrone || !selectedChat) return { ok: true, pending: [] };
      if (!hasSelectedDroneSummary) return { ok: true, pending: [] };
      if (isDroneStartingOrSeeding(selectedDroneHubPhase)) return { ok: true, pending: [] };
      return await fetchJson<{ ok: true; pending: PendingPrompt[] }>(
        `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat || 'default')}/pending`,
      );
    },
    chatEventsConnected ? 60_000 : 1000,
    [selectedDrone, selectedChat, hasSelectedDroneSummary, selectedDroneHubPhase, chatEventsConnected, chatEventsNonce],
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
    if (chatUiMode !== 'transcript') return pendingPrompts;
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
      if (chatUiMode !== 'transcript') return visiblePendingPrompts;
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

  const canStopTranscriptResponse = React.useMemo(() => {
    if (chatUiMode !== 'transcript') return false;
    return visiblePendingPrompts.some((item) => isStoppableTranscriptPendingPrompt(item));
  }, [chatUiMode, visiblePendingPrompts]);

  const selectedIsResponding = React.useMemo(() => {
    if (selectedDrone) {
      if (sendingPrompt) return true; // request in flight
      if (chatUiMode === 'cli' && cliTyping) return true; // best-effort signal for custom agents
    }
    return visiblePendingPromptsWithStartup.some((p) => p.state !== 'failed');
  }, [chatUiMode, cliTyping, sendingPrompt, selectedDrone, visiblePendingPromptsWithStartup]);

  const canStopResponse = React.useMemo(() => {
    if (!selectedDrone || !selectedChat) return false;
    if (chatUiMode === 'cli') return selectedIsResponding && !sendingPrompt;
    return canStopTranscriptResponse;
  }, [canStopTranscriptResponse, chatUiMode, selectedChat, selectedDrone, selectedIsResponding, sendingPrompt]);

  const requestStopResponse = React.useCallback(async (): Promise<void> => {
    if (!selectedDrone || !selectedChat || !canStopResponse) return;
    if (stoppingResponse) return;
    setStoppingResponse(true);
    setStopResponseError(null);
    try {
      const data = await requestJson<{
        ok: true;
        mode: 'transcript' | 'cli';
        stopped: boolean;
        stoppedPromptIds?: string[];
        clearedPromptIds?: string[];
      }>(`/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat || 'default')}/stop`, {
        method: 'POST',
      });
      if (data.mode === 'cli') {
        setCliTyping(false);
      }
      const stoppedSet = new Set((Array.isArray(data.stoppedPromptIds) ? data.stoppedPromptIds : []).map((id) => String(id).trim()).filter(Boolean));
      const clearedSet = new Set((Array.isArray(data.clearedPromptIds) ? data.clearedPromptIds : []).map((id) => String(id).trim()).filter(Boolean));
      if (stoppedSet.size > 0 || clearedSet.size > 0) {
        setOptimisticPendingPrompts((prev) =>
          prev.flatMap((item) => {
            if (!item?.id) return [];
            if (clearedSet.has(item.id)) return [];
            if (!stoppedSet.has(item.id)) return [item];
            const nextState = item.state === 'queued' ? 'failed' : 'failed';
            return [
              {
                ...item,
                state: nextState,
                error: item.state === 'queued' ? STOPPED_BEFORE_SUBMISSION_ERROR : STOPPED_BY_USER_ERROR,
                updatedAt: new Date().toISOString(),
              },
            ];
          }),
        );
      }
    } catch (e: any) {
      setStopResponseError(e?.message ?? String(e));
    } finally {
      setStoppingResponse(false);
    }
  }, [canStopResponse, requestJson, selectedChat, selectedDrone, setOptimisticPendingPrompts, stoppingResponse]);

  React.useEffect(() => {
    if (chatUiMode !== 'transcript') return;
    if (!hasSelectedDroneSummary) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let backgroundFullBusy = false;
    let loadedInitialTail = false;
    let eventsConnected = false;
    let reloadAfterCurrentLoad = false;
    let reloadAfterBackgroundFull = false;
    const clearTimer = () => {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
    };
    const loadFullTranscript = async (): Promise<void> => {
      const data = await fetchDroneChatTranscriptCached({
        droneId: selectedDrone || '',
        chatName: selectedChat || 'default',
        turn: 'all',
        etag: transcriptEtagRef.current,
      });
      if (!mounted) return;
      if (data.notModified) {
        setTranscriptError(null);
        return;
      }
      transcriptEtagRef.current = data.etag;
      fullTranscriptLoadedRef.current = true;
      setTranscripts((prev) => (sameTranscriptItems(prev, data.transcripts) ? prev : data.transcripts));
      setTranscriptError(null);
    };
    const startBackgroundFullLoad = () => {
      if (backgroundFullBusy) return;
      backgroundFullBusy = true;
      void loadFullTranscript()
        .catch((e: any) => {
          if (!mounted) return;
          if (isNotFoundError(e)) {
            transcriptEtagRef.current = null;
            setTranscripts((prev) => (Array.isArray(prev) && prev.length === 0 ? prev : []));
            setTranscriptError(null);
            return;
          }
          if (isTransientDroneStartupError(e)) return;
          setTranscriptError(e?.message ?? String(e));
        })
        .finally(() => {
          backgroundFullBusy = false;
          if (reloadAfterBackgroundFull && mounted) {
            reloadAfterBackgroundFull = false;
            clearTimer();
            void load();
          }
        });
    };
    const load = async () => {
      if (!selectedDrone || !selectedChat) return;
      if (busy) {
        reloadAfterCurrentLoad = true;
        return;
      }
      if (isDroneStartingOrSeeding(selectedDroneHubPhase)) return;
      busy = true;
      let keepLoading = false;
      const shouldLoadTailFirst = !loadedInitialTail && !fullTranscriptLoadedRef.current;
      const initial = transcriptsRef.current === null && !transcriptErrorRef.current;
      if ((initial || shouldLoadTailFirst) && mounted) setLoadingTranscript(true);
      try {
        if (shouldLoadTailFirst) {
          const data = await fetchDroneChatTranscriptCached({
            droneId: selectedDrone,
            chatName: selectedChat,
            turn: 'all',
            tail: INITIAL_TRANSCRIPT_TAIL_TURNS,
          });
          if (!mounted) return;
          loadedInitialTail = true;
          setTranscripts((prev) => (sameTranscriptItems(prev, data.transcripts) ? prev : data.transcripts));
          setTranscriptError(null);
          setLoadingTranscript(false);
          startBackgroundFullLoad();
          return;
        }
        if (backgroundFullBusy) {
          reloadAfterBackgroundFull = true;
          return;
        }
        await loadFullTranscript();
      } catch (e: any) {
        if (!mounted) return;
        if (isNotFoundError(e)) {
          // Treat 404 as "no transcript yet" to avoid a scary error state for brand new chats.
          transcriptEtagRef.current = null;
          setTranscripts((prev) => (Array.isArray(prev) && prev.length === 0 ? prev : []));
          setTranscriptError(null);
        } else if (isTransientDroneStartupError(e)) {
          keepLoading = true;
          transcriptEtagRef.current = null;
          setTranscripts(null);
          setTranscriptError(null);
        } else {
          setTranscriptError(e?.message ?? String(e));
        }
      } finally {
        if (mounted && !keepLoading) setLoadingTranscript(false);
        busy = false;
        if (mounted) {
          if (reloadAfterCurrentLoad) {
            reloadAfterCurrentLoad = false;
            clearTimer();
            void load();
            return;
          }
          clearTimer();
          timer = setTimeout(() => {
            void load();
          }, eventsConnected ? resolvePollIntervalMs(60_000, 60_000) : resolvePollIntervalMs(2000, 10_000));
        }
      }
    };
    const onVisibilityChange = () => {
      if (!mounted || typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      clearTimer();
      void load();
    };
    const unsubscribeChatEvents = subscribeDroneChatEvents({
      onConnectedChange: (connected) => {
        eventsConnected = connected;
        if (mounted) setChatEventsConnected(connected);
      },
      onDelta: (data) => {
        if (!mounted) return;
        if (!droneChatEventMatches(data, selectedDrone, selectedChat || 'default')) return;
        setChatEventsNonce((value) => value + 1);
        clearTimer();
        void load();
      },
    });
    load();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted = false;
      setChatEventsConnected(false);
      unsubscribeChatEvents();
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    chatUiMode,
    selectedDrone,
    selectedChat,
    hasSelectedDroneSummary,
    selectedDroneHubPhase,
    requestJson,
    setLoadingTranscript,
    setTranscriptError,
    setTranscripts,
  ]);

  React.useEffect(() => {
    if (chatUiMode !== 'cli') return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    const clearTimer = () => {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
    };
    const load = async () => {
      if (!selectedDrone || !selectedChat || busy) return;
      busy = true;
      let keepLoading = false;
      if (isDroneStartingOrSeeding(selectedDroneHubPhase)) {
        if (mounted) resetSessionOutputState();
        busy = false;
        return;
      }
      if (!hasSelectedDroneSummary || !selectedDroneHasSelectedChat) {
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
        if (isTransientDroneStartupError(e)) {
          keepLoading = true;
          setSessionError(null);
        } else {
          setSessionError(formatDroneRuntimeError(e));
        }
      } finally {
        if (mounted && !keepLoading) setLoadingSession(false);
        busy = false;
        if (mounted) {
          clearTimer();
          timer = setTimeout(() => {
            void load();
          }, resolvePollIntervalMs(1000, 5_000));
        }
      }
    };
    const onVisibilityChange = () => {
      if (!mounted || typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      clearTimer();
      void load();
    };
    load();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted = false;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    chatUiMode,
    hasSelectedDroneSummary,
    outputView,
    resetSessionOutputState,
    selectedChat,
    selectedDrone,
    selectedDroneHasSelectedChat,
    selectedDroneHubPhase,
    setLoadingSession,
    setSessionError,
    setSessionText,
    bumpCliTyping,
  ]);

  return {
    cancelPendingPromptErrorById,
    cancellingPendingPromptById,
    canStopResponse,
    chatUiMode,
    promptError,
    requestCancelPendingPrompt,
    requestStopResponse,
    requestUnstickPendingPrompt,
    selectedIsResponding,
    sendPromptText,
    sendingPrompt,
    stopResponseError,
    stoppingResponse,
    unstickingPendingPromptById,
    unstickPendingPromptErrorById,
    visiblePendingPromptsWithStartup,
  };
}
