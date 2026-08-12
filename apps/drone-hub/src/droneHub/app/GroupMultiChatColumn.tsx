import React from 'react';
import { filterCompletedPendingPrompts } from '@drone/assistant-chat';
import { useDndMonitor, useDroppable } from '@dnd-kit/core';
import {
  ChatInput,
  ChatLoadingState,
  type ChatComposerControlsConfig,
  type ChatSendContext,
  type ChatSendPayload,
  EmptyState,
  PendingTranscriptTurn,
  TranscriptTurn,
} from '../chat';
import { requestJson } from '../http';
import { StatusBadge } from '../overview';
import { IconSpinner, IconTrash, TypingDots } from '../overview/icons';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../types';
import { IconChat, IconNetwork } from './icons';
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
  mergeDesktopOptimisticPendingPrompts,
  normalizePendingPromptState,
  optimisticPendingPromptState,
  pendingPromptCanStopResponse,
  pendingPromptShowsWorkingState,
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
import { beginRepoApplyProgress, useLocalChatBusy } from './use-drone-hub-runtime-store';
import { usePendingPromptInterruption } from './use-pending-prompt-interruption';
import {
  droneChatEventMatches,
  fetchDroneChatState,
  fetchDroneChatTranscriptCached,
  sameTranscriptItems,
  sendDroneChatPrompt,
} from './chat-api';
import { subscribeDroneChatEvents } from './chat-events';
import { useChatMcpAccess } from './use-chat-mcp-access';
import { parseDroneHubDragData, useDroneHubActiveDrag } from './drone-hub-dnd';
import { assignedDroneIdsFromData } from './drone-hub-dnd-utils';
import { DroneHubPermissionsView } from './DroneHubPermissionsView';
import { DroneChatComposerMetadata } from './ChatComposerMetadata';
import type { ChatResourceSubscriptionInfo } from '../../domain';

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
  onSendPromptInNewChat: (payload: ChatSendPayload, context: ChatSendContext) => Promise<boolean>;
  onCreateQueuedNewChatNow: (actionId: string, sourceChatName: string) => Promise<void>;
  focusedNewChatActionId: string;
  onCreateNewChatAutoFocusHandled: (promptId: string) => void;
  promotingNewChatActionById: Record<string, true>;
  promoteNewChatActionErrorById: Record<string, string>;
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
  onSendPromptInNewChat,
  onCreateQueuedNewChatNow,
  focusedNewChatActionId,
  onCreateNewChatAutoFocusHandled,
  promotingNewChatActionById,
  promoteNewChatActionErrorById,
  onAutoRenameChatFromFirstPrompt,
  columnWidthPx,
  onRuntimeStateChange,
}: GroupMultiChatColumnProps) {
  const shownName = String(droneLabel ?? drone.name).trim() || drone.name;
  const chatName = React.useMemo(
    () => resolveChatNameForDrone(drone, preferredChat),
    [drone, preferredChat],
  );
  const chatCacheKey = React.useMemo(() => `${drone.id}\u0000${chatName}`, [chatName, drone.id]);
  const droneHome = React.useMemo(() => droneHomePath(drone), [drone]);
  const [transcripts, setTranscripts] = React.useState<TranscriptItem[] | null>(null);
  const [chatId, setChatId] = React.useState<string | null>(null);
  const [chatSubscriptions, setChatSubscriptions] = React.useState<ChatResourceSubscriptionInfo[]>(
    [],
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [promptError, setPromptError] = React.useState<string | null>(null);
  const [sendingPromptCount, setSendingPromptCount] = React.useState(0);
  const sendingPrompt = sendingPromptCount > 0;
  const [stoppingResponse, setStoppingResponse] = React.useState(false);
  const [cancellingPendingPromptById, setCancellingPendingPromptById] = React.useState<
    Record<string, true>
  >({});
  const [cancelPendingPromptErrorById, setCancelPendingPromptErrorById] = React.useState<
    Record<string, string>
  >({});
  const [chatEventsConnected, setChatEventsConnected] = React.useState(false);
  const [chatEventsNonce, setChatEventsNonce] = React.useState(0);
  const {
    busyById: resolvingInterruptionById,
    errorById: interruptionResolutionErrorById,
    resolve: resolvePendingPromptInterruption,
  } = usePendingPromptInterruption({
    droneId: drone.id,
    chatName,
    requestJson,
    onResolved: () => setChatEventsNonce((value) => value + 1),
  });
  const [localWaitingStartedAtMs, setLocalWaitingStartedAtMs] = React.useState<number | null>(null);
  const [optimisticPendingPrompts, setOptimisticPendingPrompts] = React.useState<PendingPrompt[]>(
    [],
  );
  const [initialPendingResp, setInitialPendingResp] = React.useState<{
    key: string;
    pending: PendingPrompt[];
  } | null>(null);
  const [quickActionBusy, setQuickActionBusy] = React.useState<null | 'ssh' | 'pull' | 'push'>(
    null,
  );
  const [quickActionError, setQuickActionError] = React.useState<string | null>(null);
  const [dirtyDroneApplyModal, setDirtyDroneApplyModal] =
    React.useState<DirtyDroneApplyModalState | null>(null);
  const [droneHubPermissionsOpen, setDroneHubPermissionsOpen] = React.useState(false);
  const columnScrollRef = React.useRef<HTMLDivElement | null>(null);
  const transcriptEtagRef = React.useRef<string | null>(null);
  const draftKey = React.useMemo(
    () => chatInputDraftKeyForDroneChat(drone.id, chatName),
    [drone.id, chatName],
  );
  const terminalEmulator = useDroneHubUiStore((s) => s.terminalEmulator);
  const hostRuntime = isHostRuntimeDrone(drone);
  const repoAttached = Boolean(drone.repoAttached ?? Boolean(String(drone.repoPath ?? '').trim()));
  const quickOpenTabUrl = resolveDroneOpenTabUrl(drone);
  const disabledByProvisioning = isDroneStartingOrSeeding(drone.hubPhase);
  const fullTranscriptLoadedRef = React.useRef(false);
  const activeDroneHubDrag = useDroneHubActiveDrag();
  const chatMcpAccess = useChatMcpAccess(drone.id, chatName, true);
  const chatMcpAccessDropId = `group-chat-mcp-access:${drone.id}:${chatName}`;
  const { isOver: chatMcpAccessDropIsOver, setNodeRef: setChatMcpAccessDropNodeRef } = useDroppable(
    { id: chatMcpAccessDropId },
  );
  const chatMcpAccessDropActive =
    chatMcpAccessDropIsOver && assignedDroneIdsFromData(activeDroneHubDrag).length > 0;

  useDndMonitor({
    onDragEnd(event) {
      if (
        chatMcpAccess.loading ||
        !chatMcpAccess.available ||
        String(event.over?.id ?? '') !== chatMcpAccessDropId
      ) {
        return;
      }
      const droneIds = assignedDroneIdsFromData(parseDroneHubDragData(event.active.data.current));
      if (droneIds.length === 0) return;
      void chatMcpAccess.addSelectedDrones(droneIds);
    },
  });

  React.useEffect(() => {
    setDroneHubPermissionsOpen(false);
  }, [chatName, drone.id]);

  const composerControls: ChatComposerControlsConfig = {
    controls: [],
    menuActions: [
      {
        id: 'drone-hub-permissions',
        label: 'DroneHub permissions',
        title: 'Configure what this chat can access through the DroneHub MCP server.',
        icon: <IconNetwork className="h-3.5 w-3.5" />,
        active: droneHubPermissionsOpen,
        onSelect: () => setDroneHubPermissionsOpen(true),
      },
    ],
  };

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
    setChatId(null);
    setChatSubscriptions([]);
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
      setTranscripts((prev) =>
        sameTranscriptItems(prev, data.transcripts) ? prev : data.transcripts,
      );
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
          setChatId(data.chatId);
          setChatSubscriptions(data.subscriptions);
          setInitialPendingResp({ key: chatCacheKey, pending: data.pending });
          setTranscripts((prev) =>
            sameTranscriptItems(prev, data.transcripts) ? prev : data.transcripts,
          );
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
      timer = setTimeout(
        () => {
          void loop();
        },
        eventsConnected
          ? resolvePollIntervalMs(60_000, 60_000)
          : resolvePollIntervalMs(4000, 15_000),
      );
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

  const pendingPollEnabled =
    initialPendingResp?.key === chatCacheKey || transcripts !== null || Boolean(error);

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
    const server =
      pendingResp?.key === chatCacheKey && Array.isArray(pendingResp.pending)
        ? pendingResp.pending
        : initial;
    return mergeDesktopOptimisticPendingPrompts({
      serverPrompts: server,
      optimisticPrompts: optimisticPendingPrompts,
      nowMs: Date.now(),
    }).slice(-60);
  }, [chatCacheKey, initialPendingResp, optimisticPendingPrompts, pendingResp]);

  const visiblePendingPrompts = React.useMemo(() => {
    return filterCompletedPendingPrompts(pendingPrompts, transcripts);
  }, [pendingPrompts, transcripts]);

  const cancelPendingPrompt = React.useCallback(
    async (promptIdRaw: string): Promise<void> => {
      const promptId = String(promptIdRaw ?? '').trim();
      if (!promptId || cancellingPendingPromptById[promptId]) return;
      setCancellingPendingPromptById((current) => ({ ...current, [promptId]: true }));
      setCancelPendingPromptErrorById((current) => {
        const next = { ...current };
        delete next[promptId];
        return next;
      });
      try {
        const result = await requestJson<{
          ok: true;
          cancelled: boolean;
          alreadySubmitted: boolean;
        }>(
          `/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(chatName)}/pending/${encodeURIComponent(promptId)}`,
          { method: 'DELETE' },
        );
        if (!result.cancelled) {
          throw new Error(
            result.alreadySubmitted
              ? 'Already submitted to agent.'
              : 'Unable to cancel pending prompt.',
          );
        }
        setChatEventsNonce((value) => value + 1);
      } catch (cancelError: any) {
        if (Number(cancelError?.status ?? 0) === 404) {
          setChatEventsNonce((value) => value + 1);
        } else {
          setCancelPendingPromptErrorById((current) => ({
            ...current,
            [promptId]: cancelError?.message ?? String(cancelError),
          }));
        }
      } finally {
        setCancellingPendingPromptById((current) => {
          const next = { ...current };
          delete next[promptId];
          return next;
        });
      }
    },
    [cancellingPendingPromptById, chatName, drone.id],
  );

  const waitingForAgent = React.useMemo(() => {
    if (sendingPrompt) return true;
    return visiblePendingPrompts.some(pendingPromptShowsWorkingState);
  }, [sendingPrompt, visiblePendingPrompts]);
  useLocalChatBusy(createCanvasChatNodeId(drone.id, chatName), waitingForAgent);

  const canStopResponse = React.useMemo(
    () => visiblePendingPrompts.some(pendingPromptCanStopResponse),
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
  }, [
    chatName,
    columnWidthPx,
    loading,
    scrollColumnToBottom,
    transcripts?.length,
    visiblePendingPrompts.length,
  ]);

  const sendPrompt = React.useCallback(
    async (payload: ChatSendPayload, context: ChatSendContext): Promise<boolean> => {
      const prompt = String(payload?.prompt ?? '').trim();
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
      if (!prompt && attachments.length === 0) return false;
      if (isDroneStartingOrSeeding(drone.hubPhase)) {
        if (attachments.length > 0) {
          setPromptError(
            `\"${shownName}\" is still starting. Attachments can be sent once it is ready.`,
          );
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
        ...(payload.promptId ? { id: payload.promptId } : {}),
        state: optimisticPendingPromptState(waitingForAgent),
      });
      const optimisticId = String(optimisticItem?.id ?? '').trim();
      if (optimisticItem) {
        setOptimisticPendingPrompts((prev) => appendOptimisticPendingPrompt(prev, optimisticItem));
      }
      try {
        const data = await sendDroneChatPrompt(requestJson, {
          promptId: optimisticId,
          droneId: drone.id,
          chatName,
          prompt,
          attachments,
          submittedAt: optimisticItem?.at,
          deliveryMode: context.deliveryMode,
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
  const stopResponse = React.useCallback(async (): Promise<void> => {
    if (!canStopResponse || stoppingResponse) return;
    setStoppingResponse(true);
    setPromptError(null);
    try {
      const data = await requestJson<{
        ok: true;
        stoppedPromptIds?: string[];
        clearedPromptIds?: string[];
      }>(`/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(chatName)}/stop`, {
        method: 'POST',
      });
      const stoppedSet = new Set(
        (Array.isArray(data.stoppedPromptIds) ? data.stoppedPromptIds : [])
          .map((id) => String(id).trim())
          .filter(Boolean),
      );
      const clearedSet = new Set(
        (Array.isArray(data.clearedPromptIds) ? data.clearedPromptIds : [])
          .map((id) => String(id).trim())
          .filter(Boolean),
      );
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
      const r = await fetch(
        `/api/drones/${encodeURIComponent(drone.id)}/open-terminal?${qs.toString()}`,
        { method: 'POST' },
      );
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

  const executePullRepoChanges = React.useCallback(
    async (body: Record<string, unknown> = {}) => {
      if (disabledByProvisioning || quickActionBusy || !repoAttached) return;
      setQuickActionBusy('pull');
      setQuickActionError(null);
      const endApplyProgress = beginRepoApplyProgress({
        droneId: drone.id,
        droneLabel: shownName,
      });
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
          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            data: parsed,
          };
        };

        let result = await postPull(body);
        const initialCode = String(result.data?.code ?? '')
          .trim()
          .toLowerCase();
        if (!result.ok && initialCode === 'drone_dirty') {
          setDirtyDroneApplyModal({
            droneId: String(drone.id ?? '').trim(),
            droneLabel: shownName,
            dirtyFileCount: Number(result.data?.dirtyFileCount) || 0,
            autoCommitMessage:
              String(result.data?.autoCommitMessage ?? '').trim() ||
              'chore(drone): snapshot working tree before apply changes',
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
          const suffix =
            conflictFiles.length > preview.length
              ? `\n- and ${conflictFiles.length - preview.length} more`
              : '';
          const confirmed = window.confirm(
            [
              'Applying these drone changes would conflict with your host repo.',
              '',
              preview.length > 0
                ? preview.map((file) => `- ${file}`).join('\n') + suffix
                : 'No individual files were reported.',
              '',
              'Apply the conflict set onto the host repo so you can resolve it there?',
            ].join('\n'),
          );
          if (confirmed) {
            result = await postPull({ ...body, applyConflictsToHost: true });
          }
        }

        if (!result.ok) {
          setQuickActionError(
            String(result.data?.error ?? `${result.status} ${result.statusText}`),
          );
        }
      } catch (err: any) {
        setQuickActionError(err?.message ?? String(err));
      } finally {
        endApplyProgress();
        setQuickActionBusy(null);
      }
    },
    [disabledByProvisioning, drone.id, quickActionBusy, repoAttached, shownName],
  );

  const pullRepoChanges = React.useCallback(async () => {
    await executePullRepoChanges();
  }, [executePullRepoChanges]);

  const continueDirtyDroneApply = React.useCallback(
    async (choice: 'commit' | 'keep') => {
      if (!dirtyDroneApplyModal) return;
      const requestBody = dirtyDroneApplyRequestBody(
        choice,
        dirtyDroneApplyModal.autoCommitMessage,
      );
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

  let latestTranscriptFileChangesIndex = -1;
  let latestPendingFileChangesIndex = -1;
  for (let index = visiblePendingPrompts.length - 1; index >= 0; index -= 1) {
    if (!visiblePendingPrompts[index]?.fileChanges) continue;
    latestPendingFileChangesIndex = index;
    break;
  }
  if (latestPendingFileChangesIndex < 0) {
    for (let index = (transcripts?.length ?? 0) - 1; index >= 0; index -= 1) {
      if (!transcripts?.[index]?.fileChanges) continue;
      latestTranscriptFileChangesIndex = index;
      break;
    }
  }

  return (
    <section
      className="relative flex-none h-full rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden flex flex-col"
      style={{ width: columnWidthPx, minWidth: columnWidthPx }}
    >
      {droneHubPermissionsOpen ? (
        <div className="absolute inset-0 z-30 overflow-y-auto">
          <DroneHubPermissionsView
            chatLabel={`${shownName} · ${chatName}`}
            available={chatMcpAccess.available}
            loading={chatMcpAccess.loading}
            saving={chatMcpAccess.saving}
            error={chatMcpAccess.error}
            readMode={chatMcpAccess.accessScope.readMode}
            writeMode={chatMcpAccess.accessScope.writeMode}
            executeMode={chatMcpAccess.accessScope.executeMode}
            changeRequestCreate={chatMcpAccess.accessScope.changeRequestCreate !== false}
            changeRequestMerge={chatMcpAccess.accessScope.changeRequestMerge === true}
            selectedDrones={chatMcpAccess.accessScope.droneIds.map((droneId) => ({
              id: droneId,
              label: droneId === drone.id ? shownName : droneId,
              removable: droneId !== drone.id,
            }))}
            dropActive={chatMcpAccessDropActive}
            dropTargetRef={setChatMcpAccessDropNodeRef}
            onModeChange={(kind, mode) => void chatMcpAccess.setMode(kind, mode)}
            onChangeRequestPermissionChange={(kind, allowed) =>
              void chatMcpAccess.setChangeRequestPermission(kind, allowed)
            }
            onRemoveDrone={(droneId) => void chatMcpAccess.removeSelectedDrone(droneId)}
            onBack={() => setDroneHubPermissionsOpen(false)}
          />
        </div>
      ) : null}
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
                {deleteBusy ? (
                  <IconSpinner className="opacity-90" />
                ) : (
                  <IconTrash className="opacity-90" />
                )}
              </button>
            </div>
          </div>
          <div className="text-[var(--text-10)] text-[var(--muted-dim)] font-mono mt-0.5">
            chat: {chatName}
          </div>
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
              title={
                quickOpenTabUrl
                  ? `Open ${quickOpenTabUrl} in a new browser tab`
                  : 'No preview URL available yet'
              }
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
                  {quickActionBusy === 'pull'
                    ? 'Applying...'
                    : hostRuntime
                      ? 'Apply (noop)'
                      : 'Apply'}
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
                  {quickActionBusy === 'push'
                    ? 'Pulling...'
                    : hostRuntime
                      ? 'Pull host (noop)'
                      : 'Pull host'}
                </button>
              </>
            ) : null}
          </div>
          {quickActionError ? (
            <div
              className="mt-1 text-[var(--text-10)] text-[var(--red)] truncate"
              title={quickActionError}
            >
              {quickActionError}
            </div>
          ) : null}
        </div>
      </div>
      <div ref={columnScrollRef} className="flex-1 min-h-0 overflow-auto px-3 py-3">
        {loading && !transcripts ? (
          <ChatLoadingState />
        ) : error ? (
          <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
            {error}
          </div>
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
                  initiallyExpandFileChanges={
                    index === latestTranscriptFileChangesIndex &&
                    index === items.length - 1 &&
                    visiblePendingPrompts.length === 0
                  }
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
                initiallyExpandFileChanges={
                  index === latestPendingFileChangesIndex &&
                  index === visiblePendingPrompts.length - 1
                }
                droneId={drone.id}
                droneHomePath={droneHome}
                showRoleIcons={false}
                onCancelQueued={cancelPendingPrompt}
                cancelBusy={Boolean(cancellingPendingPromptById[item.id])}
                cancelError={cancelPendingPromptErrorById[item.id] ?? null}
                onResolveInterruption={resolvePendingPromptInterruption}
                resolvingInterruption={Boolean(resolvingInterruptionById[item.id])}
                interruptionError={interruptionResolutionErrorById[item.id] ?? null}
                onCreateNewChatNow={(actionId) => onCreateQueuedNewChatNow(actionId, chatName)}
                createNewChatBusy={Boolean(promotingNewChatActionById[item.id])}
                createNewChatError={promoteNewChatActionErrorById[item.id] ?? null}
                autoFocusCreateNewChat={focusedNewChatActionId === item.id}
                onCreateNewChatAutoFocusHandled={onCreateNewChatAutoFocusHandled}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<IconChat className="w-7 h-7 text-[var(--muted)]" />}
            title={
              isDroneStartingOrSeeding(drone.hubPhase) ? 'Drone is starting' : 'No messages yet'
            }
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
        draftPersistenceKey={draftKey}
        droneName={drone.name}
        promptError={promptError}
        waiting={waitingForAgent}
        disabled={isDroneStartingOrSeeding(drone.hubPhase)}
        autoFocus={false}
        modeHint=""
        composerTopAction={
          <DroneChatComposerMetadata
            runtime={hostRuntime ? 'host' : 'container'}
            chatId={chatId}
            initialSubscriptions={chatSubscriptions}
            branch={drone.repoBranch}
          />
        }
        composerControls={composerControls}
        onStop={canStopResponse ? stopResponse : undefined}
        stopping={stoppingResponse}
        onSend={sendPrompt}
        onSendInNewChat={onSendPromptInNewChat}
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
