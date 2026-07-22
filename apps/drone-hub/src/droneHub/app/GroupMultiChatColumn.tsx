import React from 'react';
import {
  ChatInput,
  ChatLoadingState,
  type ChatSendPayload,
  type DroneHubTask,
  type DroneHubTaskSpawnMode,
  EmptyState,
  PendingTranscriptTurn,
  TranscriptTurn,
} from '../chat';
import { requestJson } from '../http';
import { StatusBadge } from '../overview';
import { IconSpinner, IconTrash, TypingDots } from '../overview/icons';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../types';
import { IconChat } from './icons';
import { fetchJson, isNotFoundError, resolvePollIntervalMs, usePoll } from './hooks';
import {
  chatInputDraftKeyForDroneChat,
  droneHomePath,
  isDroneStartingOrSeeding,
  isHostRuntimeDrone,
  resolveChatNameForDrone,
} from './helpers';
import {
  appendOptimisticPendingPrompt,
  createOptimisticPendingPrompt,
  normalizePendingPromptState,
  optimisticPendingPromptState,
  reconcileOptimisticPendingPrompt,
} from './optimistic-pending-prompts';
import {
  dirtyDroneApplyRequestBody,
  reconcileDirtyDroneApplyModal,
  type DirtyDroneApplyModalState,
} from './dirty-drone-apply';
import { parseIsoDateMs, type GroupMultiChatColumnRuntimeState } from './group-multi-chat-sort';
import { createCanvasChatNodeId } from './app-config';
import { openDroneTabFromLastPreview, resolveDroneOpenTabUrl } from './quick-actions';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { useLocalChatBusy } from './use-drone-hub-runtime-store';
import { droneChatEventMatches, fetchDroneChatState, fetchDroneChatTranscriptCached, sameTranscriptItems, sendDroneChatPrompt } from './chat-api';
import { subscribeDroneChatEvents } from './chat-events';

const DirtyDroneApplyModal = React.lazy(async () => {
  const { DirtyDroneApplyModal } = await import('./DirtyDroneApplyModal');
  return { default: DirtyDroneApplyModal };
});

const INITIAL_TRANSCRIPT_TAIL_TURNS = 50;

export type GroupMultiChatColumnProps = {
  drone: DroneSummary;
  droneLabel?: string;
  preferredChat: string;
  onOpenDrone: () => void;
  onDeleteDrone: () => void;
  deleteBusy?: boolean;
  onCreateJobs: (opts: { turn: number; message: string }) => void;
  onSpawnDroneHubTask: (opts: {
    sourceDroneId: string;
    sourceChatName: string;
    task: DroneHubTask;
    mode: DroneHubTaskSpawnMode;
  }) => Promise<{ ok: boolean; error?: string | null }>;
  onAutoRenameChatFromFirstPrompt?: (droneId: string, chatName: string, prompt: string) => void;
  columnWidthPx: number;
  onRuntimeStateChange?: (next: GroupMultiChatColumnRuntimeState) => void;
};

export function GroupMultiChatColumn({
  drone,
  droneLabel,
  preferredChat,
  onOpenDrone,
  onDeleteDrone,
  deleteBusy = false,
  onCreateJobs,
  onSpawnDroneHubTask,
  onAutoRenameChatFromFirstPrompt,
  columnWidthPx,
  onRuntimeStateChange,
}: GroupMultiChatColumnProps) {
  const shownName = String(droneLabel ?? drone.name).trim() || drone.name;
  const chatName = React.useMemo(() => resolveChatNameForDrone(drone, preferredChat), [drone, preferredChat]);
  const chatCacheKey = React.useMemo(() => `${drone.id}\u0000${chatName}`, [chatName, drone.id]);
  const droneHome = React.useMemo(() => droneHomePath(drone), [drone]);
  const [transcripts, setTranscripts] = React.useState<TranscriptItem[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [promptError, setPromptError] = React.useState<string | null>(null);
  const [sendingPromptCount, setSendingPromptCount] = React.useState(0);
  const sendingPrompt = sendingPromptCount > 0;
  const [stoppingResponse, setStoppingResponse] = React.useState(false);
  const [localWaitingStartedAtMs, setLocalWaitingStartedAtMs] = React.useState<number | null>(null);
  const [optimisticPendingPrompts, setOptimisticPendingPrompts] = React.useState<PendingPrompt[]>([]);
  const [initialPendingResp, setInitialPendingResp] = React.useState<{ key: string; pending: PendingPrompt[] } | null>(null);
  const [chatEventsConnected, setChatEventsConnected] = React.useState(false);
  const [chatEventsNonce, setChatEventsNonce] = React.useState(0);
  const [quickActionBusy, setQuickActionBusy] = React.useState<null | 'ssh' | 'pull' | 'push'>(null);
  const [quickActionError, setQuickActionError] = React.useState<string | null>(null);
  const [dirtyDroneApplyModal, setDirtyDroneApplyModal] = React.useState<DirtyDroneApplyModalState | null>(null);
  const columnScrollRef = React.useRef<HTMLDivElement | null>(null);
  const transcriptEtagRef = React.useRef<string | null>(null);
  const draftKey = React.useMemo(() => chatInputDraftKeyForDroneChat(drone.id, chatName), [drone.id, chatName]);
  const draftValue = useDroneHubUiStore((s) => s.chatInputDrafts[draftKey] ?? '');
  const setChatInputDraft = useDroneHubUiStore((s) => s.setChatInputDraft);
  const terminalEmulator = useDroneHubUiStore((s) => s.terminalEmulator);
  const hostRuntime = isHostRuntimeDrone(drone);
  const repoAttached = Boolean(drone.repoAttached ?? Boolean(String(drone.repoPath ?? '').trim()));
  const quickOpenTabUrl = resolveDroneOpenTabUrl(drone);
  const disabledByProvisioning = isDroneStartingOrSeeding(drone.hubPhase);
  const fullTranscriptLoadedRef = React.useRef(false);

  const scrollColumnToBottom = React.useCallback(() => {
    const el = columnScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  React.useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let loadedInitialTail = false;
    let eventsConnected = false;
    let reloadAfterCurrentLoad = false;
    let reloadAfterBackgroundFull = false;
    const clearTimer = () => {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
    };

    setTranscripts(null);
    setInitialPendingResp(null);
    transcriptEtagRef.current = null;
    fullTranscriptLoadedRef.current = false;
    setError(null);
    setLoading(true);
    let backgroundFullBusy = false;

    const loadFullTranscript = async (): Promise<void> => {
      const data = await fetchDroneChatTranscriptCached({
        droneId: drone.id,
        chatName,
        turn: 'all',
        etag: transcriptEtagRef.current,
      });
      if (!mounted) return;
      if (data.notModified) {
        setError(null);
        return;
      }
      transcriptEtagRef.current = data.etag;
      fullTranscriptLoadedRef.current = true;
      setTranscripts((prev) => (sameTranscriptItems(prev, data.transcripts) ? prev : data.transcripts));
      setError(null);
    };

    const startBackgroundFullLoad = () => {
      if (backgroundFullBusy) return;
      backgroundFullBusy = true;
      void loadFullTranscript()
        .catch((err: any) => {
          if (!mounted) return;
          if (isNotFoundError(err)) {
            transcriptEtagRef.current = null;
            setTranscripts((prev) => (Array.isArray(prev) && prev.length === 0 ? prev : []));
            setError(null);
            return;
          }
          setError(err?.message ?? String(err));
        })
        .finally(() => {
          backgroundFullBusy = false;
          if (reloadAfterBackgroundFull && mounted) {
            reloadAfterBackgroundFull = false;
            clearTimer();
            void loop();
          }
        });
    };

    const load = async (): Promise<boolean> => {
      if (busy) {
        reloadAfterCurrentLoad = true;
        return false;
      }
      const isStarting = isDroneStartingOrSeeding(drone.hubPhase);
      if (isStarting) {
        if (mounted) {
          setTranscripts((prev) => (Array.isArray(prev) && prev.length === 0 ? prev : []));
          setError(null);
          setLoading(false);
        }
        return true;
      }
      busy = true;
      let scheduleNext = true;
      try {
        const shouldLoadTailFirst = !loadedInitialTail && !fullTranscriptLoadedRef.current;
        if (shouldLoadTailFirst) {
          const data = await fetchDroneChatState(requestJson, {
            droneId: drone.id,
            chatName,
            turn: 'all',
            tail: INITIAL_TRANSCRIPT_TAIL_TURNS,
          });
          if (!mounted) return false;
          loadedInitialTail = true;
          setInitialPendingResp({ key: chatCacheKey, pending: data.pending });
          setTranscripts((prev) => (sameTranscriptItems(prev, data.transcripts) ? prev : data.transcripts));
          setError(null);
          setLoading(false);
          startBackgroundFullLoad();
        } else if (backgroundFullBusy) {
          reloadAfterBackgroundFull = true;
          scheduleNext = false;
        } else {
          await loadFullTranscript();
        }
      } catch (err: any) {
        if (!mounted) return false;
        if (isNotFoundError(err)) {
          transcriptEtagRef.current = null;
          setTranscripts((prev) => (Array.isArray(prev) && prev.length === 0 ? prev : []));
          setError(null);
        } else {
          setError(err?.message ?? String(err));
        }
      } finally {
        busy = false;
        if (mounted) setLoading(false);
        if (reloadAfterCurrentLoad && mounted) {
          reloadAfterCurrentLoad = false;
          scheduleNext = false;
          clearTimer();
          void loop();
        }
      }
      return scheduleNext;
    };

    const loop = async () => {
      const scheduleNext = await load();
      if (!mounted || !scheduleNext) return;
      clearTimer();
      timer = setTimeout(() => {
        void loop();
      }, eventsConnected ? resolvePollIntervalMs(60_000, 60_000) : resolvePollIntervalMs(4000, 15_000));
    };

    const onVisibilityChange = () => {
      if (!mounted || typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      clearTimer();
      void loop();
    };
    const unsubscribeChatEvents = subscribeDroneChatEvents({
      onConnectedChange: (connected) => {
        eventsConnected = connected;
        if (mounted) setChatEventsConnected(connected);
      },
      onDelta: (data) => {
        if (!mounted) return;
        if (!droneChatEventMatches(data, drone.id, chatName)) return;
        setChatEventsNonce((value) => value + 1);
        clearTimer();
        void loop();
      },
    });

    void loop();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted = false;
      setChatEventsConnected(false);
      unsubscribeChatEvents();
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [chatCacheKey, chatName, drone.hubPhase, drone.id]);

  const pendingPollEnabled = initialPendingResp?.key === chatCacheKey || transcripts !== null || Boolean(error);

  const { value: pendingResp } = usePoll<{ key: string; pending: PendingPrompt[] }>(
    async () => {
      if (isDroneStartingOrSeeding(drone.hubPhase)) return { key: chatCacheKey, pending: [] };
      const data = await fetchJson<{ ok: true; pending: PendingPrompt[] }>(
        `/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(chatName)}/pending`,
      );
      return { key: chatCacheKey, pending: Array.isArray(data?.pending) ? data.pending : [] };
    },
    chatEventsConnected ? 60_000 : 1000,
    [chatCacheKey, chatName, drone.hubPhase, drone.id, chatEventsConnected, chatEventsNonce],
    { enabled: pendingPollEnabled },
  );

  const pendingPrompts = React.useMemo(() => {
    const initial = initialPendingResp?.key === chatCacheKey ? initialPendingResp.pending : [];
    const server = pendingResp?.key === chatCacheKey && Array.isArray(pendingResp.pending) ? pendingResp.pending : initial;
    const byId = new Map<string, PendingPrompt>();
    for (const p of server) {
      if (p?.id) byId.set(p.id, p);
    }
    for (const p of optimisticPendingPrompts) {
      if (p?.id && !byId.has(p.id)) byId.set(p.id, p);
    }
    return Array.from(byId.values()).slice(-60);
  }, [chatCacheKey, initialPendingResp, optimisticPendingPrompts, pendingResp]);

  const visiblePendingPrompts = React.useMemo(() => {
    const ts = Array.isArray(transcripts) ? transcripts : [];
    const ids = new Set(ts.map((t) => String((t as any)?.id ?? '')).filter(Boolean));
    return pendingPrompts.filter((p) => p.state === 'failed' || !ids.has(p.id));
  }, [pendingPrompts, transcripts]);

  const waitingForAgent = React.useMemo(() => {
    if (sendingPrompt) return true;
    return visiblePendingPrompts.some((p) => p.state !== 'failed');
  }, [sendingPrompt, visiblePendingPrompts]);
  useLocalChatBusy(createCanvasChatNodeId(drone.id, chatName), waitingForAgent);

  const canStopResponse = React.useMemo(
    () => visiblePendingPrompts.some((item) => item.state === 'queued' || item.state === 'sending' || item.state === 'sent'),
    [visiblePendingPrompts],
  );

  const waitingSinceMs = React.useMemo(() => {
    let earliestPendingMs: number | null = null;
    for (const pending of visiblePendingPrompts) {
      if (pending.state === 'failed') continue;
      const pendingMs = parseIsoDateMs(pending.at);
      if (pendingMs == null) continue;
      if (earliestPendingMs == null || pendingMs < earliestPendingMs) {
        earliestPendingMs = pendingMs;
      }
    }
    return earliestPendingMs ?? localWaitingStartedAtMs;
  }, [localWaitingStartedAtMs, visiblePendingPrompts]);

  const lastResponseAtMs = React.useMemo(() => {
    if (!Array.isArray(transcripts) || transcripts.length === 0) return null;
    let latestMs: number | null = null;
    for (const item of transcripts) {
      const itemMs = parseIsoDateMs(item.completedAt ?? item.at);
      if (itemMs == null) continue;
      if (latestMs == null || itemMs > latestMs) {
        latestMs = itemMs;
      }
    }
    return latestMs;
  }, [transcripts]);

  React.useEffect(() => {
    setOptimisticPendingPrompts([]);
  }, [chatName, drone.id]);

  React.useEffect(() => {
    if (waitingForAgent) {
      setLocalWaitingStartedAtMs((prev) => prev ?? Date.now());
      return;
    }
    setLocalWaitingStartedAtMs(null);
  }, [waitingForAgent]);

  React.useEffect(() => {
    onRuntimeStateChange?.({
      waitingForAgent,
      waitingSinceMs,
      lastResponseAtMs,
    });
  }, [lastResponseAtMs, onRuntimeStateChange, waitingForAgent, waitingSinceMs]);

  React.useEffect(() => {
    if (loading) return;
    const id = requestAnimationFrame(() => scrollColumnToBottom());
    return () => cancelAnimationFrame(id);
  }, [chatName, columnWidthPx, loading, scrollColumnToBottom, transcripts?.length, visiblePendingPrompts.length]);

  const sendPrompt = React.useCallback(
    async (payload: ChatSendPayload): Promise<boolean> => {
      const prompt = String(payload?.prompt ?? '').trim();
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
      if (!prompt && attachments.length === 0) return false;
      if (isDroneStartingOrSeeding(drone.hubPhase)) {
        if (attachments.length > 0) {
          setPromptError(`\"${shownName}\" is still starting. Attachments can be sent once it is ready.`);
          return false;
        }
        setPromptError(`\"${shownName}\" is still starting.`);
        return false;
      }
      setSendingPromptCount((c) => c + 1);
      setPromptError(null);
      const optimisticItem = createOptimisticPendingPrompt({
        prompt,
        attachments,
        state: optimisticPendingPromptState(waitingForAgent),
      });
      const optimisticId = String(optimisticItem?.id ?? '').trim();
      if (optimisticItem) {
        setOptimisticPendingPrompts((prev) => appendOptimisticPendingPrompt(prev, optimisticItem));
      }
      try {
        const data = await sendDroneChatPrompt(requestJson, {
          droneId: drone.id,
          chatName,
          prompt,
          attachments,
          autoRenameHandledByClient: Boolean(prompt),
        });
        if (data.autoRenameChat && prompt) {
          onAutoRenameChatFromFirstPrompt?.(drone.id, chatName, prompt);
        }
        const id = String((data as any)?.promptId ?? '').trim();
        const pendingState = normalizePendingPromptState(data?.pendingState);
        setOptimisticPendingPrompts((prev) =>
          optimisticId
            ? reconcileOptimisticPendingPrompt(prev, {
                optimisticId,
                confirmedId: id,
                state: pendingState,
              })
            : prev,
        );
        requestAnimationFrame(() => scrollColumnToBottom());
        return true;
      } catch (err: any) {
        const message = err?.message ?? String(err);
        if (optimisticId) {
          setOptimisticPendingPrompts((prev) =>
            reconcileOptimisticPendingPrompt(prev, {
              optimisticId,
              state: 'failed',
              error: message,
            }),
          );
        }
        setPromptError(message);
        return false;
      } finally {
        setSendingPromptCount((c) => Math.max(0, c - 1));
      }
    },
    [
      chatName,
      drone.hubPhase,
      drone.id,
      onAutoRenameChatFromFirstPrompt,
      scrollColumnToBottom,
      shownName,
      waitingForAgent,
    ],
  );
  const spawnDroneHubTaskForColumn = React.useCallback(
    (mode: DroneHubTaskSpawnMode, task: DroneHubTask) =>
      onSpawnDroneHubTask({
        sourceDroneId: drone.id,
        sourceChatName: chatName,
        task,
        mode,
      }),
    [chatName, drone.id, onSpawnDroneHubTask],
  );

  const stopResponse = React.useCallback(async (): Promise<void> => {
    if (!canStopResponse || stoppingResponse) return;
    setStoppingResponse(true);
    setPromptError(null);
    try {
      const data = await requestJson<{ ok: true; stoppedPromptIds?: string[]; clearedPromptIds?: string[] }>(
        `/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(chatName)}/stop`,
        { method: 'POST' },
      );
      const stoppedSet = new Set((Array.isArray(data.stoppedPromptIds) ? data.stoppedPromptIds : []).map((id) => String(id).trim()).filter(Boolean));
      const clearedSet = new Set((Array.isArray(data.clearedPromptIds) ? data.clearedPromptIds : []).map((id) => String(id).trim()).filter(Boolean));
      if (stoppedSet.size > 0 || clearedSet.size > 0) {
        setOptimisticPendingPrompts((prev) =>
          prev.flatMap((item) => {
            if (!item?.id) return [];
            if (clearedSet.has(item.id)) return [];
            if (!stoppedSet.has(item.id)) return [item];
            return [
              {
                ...item,
                state: 'failed',
                error: item.state === 'queued' ? 'Stopped before submission.' : 'Stopped by user.',
                updatedAt: new Date().toISOString(),
              },
            ];
          }),
        );
      }
    } catch (err: any) {
      setPromptError(err?.message ?? String(err));
    } finally {
      setStoppingResponse(false);
    }
  }, [canStopResponse, chatName, drone.id, stoppingResponse]);

  const openSshTerminal = React.useCallback(async () => {
    if (disabledByProvisioning || quickActionBusy) return;
    setQuickActionBusy('ssh');
    setQuickActionError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('mode', 'ssh');
      qs.set('chat', chatName || 'default');
      const cwd = droneHomePath(drone);
      if (cwd && !(hostRuntime && cwd === '/')) qs.set('cwd', cwd);
      if (terminalEmulator && terminalEmulator !== 'auto') qs.set('terminal', terminalEmulator);
      const r = await fetch(`/api/drones/${encodeURIComponent(drone.id)}/open-terminal?${qs.toString()}`, { method: 'POST' });
      if (!r.ok) {
        const text = await r.text();
        let parsed: any = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        setQuickActionError(String(parsed?.error ?? `${r.status} ${r.statusText}`));
      }
    } catch (err: any) {
      setQuickActionError(err?.message ?? String(err));
    } finally {
      setQuickActionBusy(null);
    }
  }, [chatName, disabledByProvisioning, drone, quickActionBusy, terminalEmulator]);

  const executePullRepoChanges = React.useCallback(async (body: Record<string, unknown> = {}) => {
    if (disabledByProvisioning || quickActionBusy || !repoAttached) return;
    setQuickActionBusy('pull');
    setQuickActionError(null);
    try {
      const postPull = async (
        body: any,
      ): Promise<{ ok: boolean; status: number; statusText: string; data: any }> => {
        const response = await fetch(`/api/drones/${encodeURIComponent(drone.id)}/repo/pull`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });
        const text = await response.text();
        let parsed: any = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        return { ok: response.ok, status: response.status, statusText: response.statusText, data: parsed };
      };

      let result = await postPull(body);
      const initialCode = String(result.data?.code ?? '').trim().toLowerCase();
      if (!result.ok && initialCode === 'drone_dirty') {
        setDirtyDroneApplyModal({
          droneId: String(drone.id ?? '').trim(),
          droneLabel: shownName,
          dirtyFileCount: Number(result.data?.dirtyFileCount) || 0,
          autoCommitMessage:
            String(result.data?.autoCommitMessage ?? '').trim() || 'chore(drone): snapshot working tree before apply changes',
        });
        return;
      }
      const canOfferConflictApply =
        !result.ok &&
        initialCode === 'patch_apply_conflict' &&
        result.data?.hostConflictState !== true &&
        result.data?.canApplyConflictsToHost === true &&
        (body as any)?.applyConflictsToHost !== true;
      if (canOfferConflictApply) {
        const conflictFiles = Array.isArray(result.data?.conflictFiles)
          ? result.data.conflictFiles.map((f: any) => String(f ?? '').trim()).filter(Boolean)
          : [];
        const preview: string[] = conflictFiles.slice(0, 8);
        const suffix = conflictFiles.length > preview.length ? `\n- and ${conflictFiles.length - preview.length} more` : '';
        const confirmed = window.confirm(
          [
            'Applying these drone changes would conflict with your host repo.',
            '',
            preview.length > 0 ? preview.map((file) => `- ${file}`).join('\n') + suffix : 'No individual files were reported.',
            '',
            'Apply the conflict set onto the host repo so you can resolve it there?',
          ].join('\n'),
        );
        if (confirmed) {
          result = await postPull({ ...body, applyConflictsToHost: true });
        }
      }

      if (!result.ok) {
        setQuickActionError(String(result.data?.error ?? `${result.status} ${result.statusText}`));
      }
    } catch (err: any) {
      setQuickActionError(err?.message ?? String(err));
    } finally {
      setQuickActionBusy(null);
    }
  }, [disabledByProvisioning, drone.id, quickActionBusy, repoAttached, shownName]);

  const pullRepoChanges = React.useCallback(async () => {
    await executePullRepoChanges();
  }, [executePullRepoChanges]);

  const continueDirtyDroneApply = React.useCallback(
    async (choice: 'commit' | 'keep') => {
      if (!dirtyDroneApplyModal) return;
      const requestBody = dirtyDroneApplyRequestBody(choice, dirtyDroneApplyModal.autoCommitMessage);
      setDirtyDroneApplyModal(null);
      await executePullRepoChanges(requestBody);
    },
    [dirtyDroneApplyModal, executePullRepoChanges],
  );

  React.useEffect(() => {
    setDirtyDroneApplyModal((current) => reconcileDirtyDroneApplyModal(current, drone.id));
  }, [drone.id]);

  const pushRepoChanges = React.useCallback(async () => {
    if (disabledByProvisioning || quickActionBusy || !repoAttached) return;
    if (!hostRuntime) {
      const confirmed = window.confirm(
        'Pull current host branch changes into this drone branch? A clean merge creates a merge commit in the drone repo.',
      );
      if (!confirmed) return;
    }
    setQuickActionBusy('push');
    setQuickActionError(null);
    try {
      const r = await fetch(`/api/drones/${encodeURIComponent(drone.id)}/repo/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const text = await r.text();
        let parsed: any = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        setQuickActionError(String(parsed?.error ?? `${r.status} ${r.statusText}`));
      }
    } catch (err: any) {
      setQuickActionError(err?.message ?? String(err));
    } finally {
      setQuickActionBusy(null);
    }
  }, [disabledByProvisioning, drone.id, hostRuntime, quickActionBusy, repoAttached]);

  const openBrowserTab = React.useCallback(async () => {
    if (disabledByProvisioning) return;
    setQuickActionError(null);
    const ok = await openDroneTabFromLastPreview(drone);
    if (!ok) setQuickActionError('No preview URL available yet.');
  }, [disabledByProvisioning, drone]);


  return (
    <section
      className="flex-none h-full rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden flex flex-col"
      style={{ width: columnWidthPx, minWidth: columnWidthPx }}
    >
      <div className="group/column-header flex-shrink-0 px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenDrone}
                className="min-w-0 flex-1 block text-left text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] hover:text-[var(--accent)] transition-colors truncate"
                style={{ fontFamily: 'var(--display)' }}
                title={`Open ${shownName}`}
              >
                {shownName}
              </button>
              {waitingForAgent ? (
                <span className="inline-flex items-center flex-shrink-0" title="Agent responding">
                  <TypingDots color="var(--yellow)" />
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {waitingForAgent ? null : (
                <StatusBadge
                  ok={drone.statusOk}
                  error={drone.statusError}
                  checking={drone.statusChecking}
                  hubPhase={drone.hubPhase}
                  hubMessage={drone.hubMessage}
                />
              )}
              <button
                type="button"
                onClick={onDeleteDrone}
                disabled={deleteBusy}
                aria-busy={deleteBusy}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  deleteBusy
                    ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                    : 'opacity-0 pointer-events-none group-hover/column-header:opacity-100 group-hover/column-header:pointer-events-auto bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
                }`}
                title={deleteBusy ? `Deleting "${shownName}"…` : `Delete "${shownName}"`}
                aria-label={deleteBusy ? `Deleting "${shownName}"` : `Delete "${shownName}"`}
              >
                {deleteBusy ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
              </button>
            </div>
          </div>
          <div className="text-[var(--text-10)] text-[var(--muted-dim)] font-mono mt-0.5">chat: {chatName}</div>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                void openSshTerminal();
              }}
              disabled={disabledByProvisioning || Boolean(quickActionBusy)}
              className={`inline-flex items-center h-5 px-1.5 rounded border text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                disabledByProvisioning || Boolean(quickActionBusy)
                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title={`SSH into "${shownName}"`}
            >
              {quickActionBusy === 'ssh' ? 'Opening...' : 'SSH'}
            </button>
            <button
              type="button"
              onClick={() => {
                void openBrowserTab();
              }}
              disabled={disabledByProvisioning || !quickOpenTabUrl}
              className={`inline-flex items-center h-5 px-1.5 rounded border text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                disabledByProvisioning || !quickOpenTabUrl
                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title={quickOpenTabUrl ? `Open ${quickOpenTabUrl} in a new browser tab` : 'No preview URL available yet'}
            >
              Open tab
            </button>
            {repoAttached ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void pullRepoChanges();
                  }}
                  disabled={disabledByProvisioning || Boolean(quickActionBusy)}
                  className={`inline-flex items-center h-5 px-1.5 rounded border text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                    disabledByProvisioning || Boolean(quickActionBusy)
                      ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title={
                    hostRuntime
                      ? 'Host runtime uses the host repository directly; this action is a no-op.'
                      : 'Apply repo changes from this drone into the local repo'
                  }
                >
                  {quickActionBusy === 'pull' ? 'Applying...' : hostRuntime ? 'Apply (noop)' : 'Apply'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void pushRepoChanges();
                  }}
                  disabled={disabledByProvisioning || Boolean(quickActionBusy)}
                  className={`inline-flex items-center h-5 px-1.5 rounded border text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                    disabledByProvisioning || Boolean(quickActionBusy)
                      ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title={
                    hostRuntime
                      ? 'Host runtime uses the host repository directly; this action is a no-op.'
                      : 'Merge current host branch commits into this drone branch'
                  }
                >
                  {quickActionBusy === 'push' ? 'Pulling...' : hostRuntime ? 'Pull host (noop)' : 'Pull host'}
                </button>
              </>
            ) : null}
          </div>
          {quickActionError ? <div className="mt-1 text-[var(--text-10)] text-[var(--red)] truncate" title={quickActionError}>{quickActionError}</div> : null}
        </div>
      </div>
      <div ref={columnScrollRef} className="flex-1 min-h-0 overflow-auto px-3 py-3">
        {loading && !transcripts ? (
          <ChatLoadingState />
        ) : error ? (
          <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">{error}</div>
        ) : (transcripts && transcripts.length > 0) || visiblePendingPrompts.length > 0 ? (
          <div className="space-y-5">
            {(transcripts ?? []).map((item, index, items) => {
              const messageId = `${drone.id}:${item.turn}:${item.at}`;
              return (
                <TranscriptTurn
                  key={messageId}
                  item={item}
                  autoExpandAgentMessage={
                    index === items.length - 1 && visiblePendingPrompts.length === 0
                  }
                  parsingJobs={false}
                  onCreateJobs={onCreateJobs}
                  onSpawnDroneHubTask={spawnDroneHubTaskForColumn}
                  messageId={messageId}
                  droneId={drone.id}
                  droneHomePath={droneHome}
                  showRoleIcons={false}
                />
              );
            })}
            {visiblePendingPrompts.map((item, index) => (
              <PendingTranscriptTurn
                key={`${drone.id}:pending:${item.id}`}
                item={item}
                autoExpandPrompt={index === visiblePendingPrompts.length - 1}
                droneId={drone.id}
                droneHomePath={droneHome}
                showRoleIcons={false}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<IconChat className="w-7 h-7 text-[var(--muted)]" />}
            title={isDroneStartingOrSeeding(drone.hubPhase) ? 'Drone is starting' : 'No messages yet'}
            description={
              isDroneStartingOrSeeding(drone.hubPhase)
                ? `Waiting for ${shownName} to become ready.`
                : `Open ${shownName} and send a prompt to populate this chat.`
            }
          />
        )}
      </div>
      <ChatInput
        resetKey={`group:${drone.id}:${chatName}`}
        droneName={drone.name}
        draftValue={draftValue}
        onDraftValueChange={(next) => setChatInputDraft(draftKey, next)}
        promptError={promptError}
        sending={sendingPrompt}
        waiting={waitingForAgent}
        disabled={sendingPrompt || isDroneStartingOrSeeding(drone.hubPhase)}
        autoFocus={false}
        modeHint=""
        onStop={canStopResponse ? stopResponse : undefined}
        stopping={stoppingResponse}
        onSend={sendPrompt}
      />
      {dirtyDroneApplyModal ? (
        <React.Suspense fallback={null}>
          <DirtyDroneApplyModal
            dirtyDroneApplyModal={dirtyDroneApplyModal}
            busy={quickActionBusy === 'pull'}
            onCancel={() => setDirtyDroneApplyModal(null)}
            onKeepDirtyAndApply={() => {
              void continueDirtyDroneApply('keep');
            }}
            onCommitAndApply={() => {
              void continueDirtyDroneApply('commit');
            }}
          />
        </React.Suspense>
      ) : null}
    </section>
  );
}
