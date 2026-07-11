import React from 'react';
import { timeAgo } from '../../domain';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { requestJson } from '../http';
import { StatusBadge } from '../overview/StatusBadge';
import type { DroneSummary } from '../types';
import { createCanvasChatNodeId } from './app-config';
import { normalizedDroneChats } from './chat-node-helpers';
import { fetchJson, usePoll } from './hooks';
import { isDroneStartingOrSeeding, parseDroneChatQueueKey } from './helpers';
import type { QueuedPrompt } from './use-queued-prompts-state';
import { IconBoard, IconChevron, IconDrone, IconList, IconPlus, IconPlusDouble } from './icons';

type FleetWorkItem = {
  key: string;
  source: 'drone' | 'startup';
  droneId: string;
  droneName: string;
  chatName: string;
  promptId: string;
  prompt: string;
  cwd?: string | null;
  at: string;
  updatedAt: string | null;
  state: 'queued' | 'sending' | 'sent' | 'failed';
  derivedState: 'queued' | 'running' | 'failed' | 'stuck';
  error: string | null;
  runtime: 'container' | 'host';
  blockedByAutomation: boolean;
  attachmentsCount: number;
  canCancel: boolean;
  canRetry: boolean;
};

type FleetWorkPayload = {
  ok: true;
  counts: {
    total: number;
    queued: number;
    running: number;
    failed: number;
    stuck: number;
  };
  items: FleetWorkItem[];
};

type DashboardQueueItem = {
  key: string;
  source: 'server' | 'local';
  droneId: string;
  droneName: string;
  chatName: string;
  promptId: string;
  prompt: string;
  cwd?: string | null;
  at: string;
  updatedAt: string | null;
  state: 'queued' | 'sending' | 'sent' | 'failed';
  derivedState: 'queued' | 'running' | 'failed' | 'stuck';
  error: string | null;
  runtime: 'container' | 'host' | null;
  canCancel: boolean;
  canRetry: boolean;
  blockedByAutomation: boolean;
  attachmentsCount: number;
  localQueueKey?: string;
};

type DashboardUnreadItem = {
  key: string;
  droneId: string;
  droneName: string;
  chatName: string;
};

type DashboardUnreadItemDetail = {
  prompt: string;
  output: string;
  at: string | null;
  completedAt: string | null;
};

export type NoDroneSelectedStateProps = {
  dronesLoading: boolean;
  sidebarDroneCount: number;
  sidebarDrones: DroneSummary[];
  dronesError: string | null | undefined;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  queuedPromptsByDroneChat: Record<string, QueuedPrompt[]>;
  removeQueuedPrompt: (key: string, id: string) => void;
  onOpenDraftChatComposer: () => void;
  onOpenCreateModal: () => void;
  onOpenKanbanBoard: () => void;
  onOpenPlaybookRuns: () => void;
  onSelectDrone: (droneId: string) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
};

function useFleetDashboardState({
  sidebarDrones,
  unreadAgentMessageByChatNodeId,
  queuedPromptsByDroneChat,
  removeQueuedPrompt,
}: Pick<NoDroneSelectedStateProps, 'sidebarDrones' | 'unreadAgentMessageByChatNodeId' | 'queuedPromptsByDroneChat' | 'removeQueuedPrompt'>) {
  const [activityFilter, setActivityFilter] = React.useState<'unread' | 'all' | 'queued' | 'running' | 'failed' | 'stuck'>('unread');
  const [queueActionBusyByKey, setQueueActionBusyByKey] = React.useState<Record<string, true>>({});
  const [lifecycleBusyByDroneId, setLifecycleBusyByDroneId] = React.useState<Record<string, 'start' | 'stop' | 'restart'>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const fleetWorkRef = React.useRef<FleetWorkPayload | null>(null);

  const { value: fleetWorkPolled, error: fleetWorkError, loading: fleetWorkLoading } = usePoll<FleetWorkPayload>(
    () => fetchJson(`/api/fleet/work?refresh=${refreshNonce}`),
    2000,
    [refreshNonce],
  );

  React.useEffect(() => {
    if (fleetWorkPolled?.ok) fleetWorkRef.current = fleetWorkPolled;
  }, [fleetWorkPolled]);

  const fleetWork = fleetWorkPolled ?? fleetWorkRef.current;
  const sidebarDroneById = React.useMemo(() => new Map(sidebarDrones.map((drone) => [drone.id, drone])), [sidebarDrones]);
  const unreadByChatNodeId = unreadAgentMessageByChatNodeId ?? {};

  const localQueueItems = React.useMemo<DashboardQueueItem[]>(() => {
    return Object.entries(queuedPromptsByDroneChat)
      .flatMap(([key, prompts]) => {
        const parsed = parseDroneChatQueueKey(key);
        if (!parsed) return [];
        const drone = sidebarDroneById.get(parsed.droneId) ?? null;
        const droneName = String(drone?.name ?? parsed.droneId).trim() || parsed.droneId;
        return prompts.map<DashboardQueueItem>((prompt) => ({
          key: `local:${key}:${prompt.id}`,
          source: 'local' as const,
          droneId: parsed.droneId,
          droneName,
          chatName: parsed.chatName,
          promptId: prompt.id,
          prompt: prompt.prompt,
          at: prompt.at,
          updatedAt: prompt.updatedAt ?? null,
          state: prompt.state,
          derivedState:
            prompt.state === 'failed'
              ? 'failed'
              : prompt.state === 'sending' || prompt.state === 'sent'
                ? 'running'
                : 'queued',
          error: typeof prompt.error === 'string' ? prompt.error : null,
          runtime: drone?.runtime ?? null,
          canCancel: true,
          canRetry: false,
          blockedByAutomation: Boolean(prompt.blockedByAutomation),
          attachmentsCount: Array.isArray(prompt.attachments) ? prompt.attachments.length : 0,
          localQueueKey: key,
        }));
      })
      .sort(compareDashboardQueueItems);
  }, [queuedPromptsByDroneChat, sidebarDroneById]);

  const mergedQueueItems = React.useMemo<DashboardQueueItem[]>(() => {
    const serverItems = (fleetWork?.items ?? []).map<DashboardQueueItem>((item) => ({
      key: `server:${item.key}`,
      source: 'server',
      droneId: item.droneId,
      droneName: item.droneName,
      chatName: item.chatName,
      promptId: item.promptId,
      prompt: item.prompt,
      ...(typeof item.cwd === 'string' || item.cwd === null ? { cwd: item.cwd } : {}),
      at: item.at,
      updatedAt: item.updatedAt,
      state: item.state,
      derivedState: item.derivedState,
      error: item.error,
      runtime: item.runtime,
      canCancel: item.canCancel,
      canRetry: item.canRetry,
      blockedByAutomation: item.blockedByAutomation,
      attachmentsCount: item.attachmentsCount,
    }));
    const seen = new Set(serverItems.map((item) => `${item.droneId}:${item.chatName}:${item.promptId}`));
    const localOnly = localQueueItems.filter((item) => !seen.has(`${item.droneId}:${item.chatName}:${item.promptId}`));
    return [...serverItems, ...localOnly].sort(compareDashboardQueueItems);
  }, [fleetWork?.items, localQueueItems]);

  const unreadItems = React.useMemo<DashboardUnreadItem[]>(
    () =>
      sidebarDrones
        .flatMap((drone) => {
          const droneId = String(drone?.id ?? '').trim();
          if (!droneId) return [];
          const droneName = String(drone?.name ?? droneId).trim() || droneId;
          return normalizedDroneChats(drone, { includeDefaultWhenEmpty: true })
            .filter((chatName) => unreadByChatNodeId[createCanvasChatNodeId(droneId, chatName)] === true)
            .map((chatName) => ({
              key: `${droneId}:${chatName}`,
              droneId,
              droneName,
              chatName,
            }));
        })
        .sort((a, b) => a.droneName.localeCompare(b.droneName) || a.chatName.localeCompare(b.chatName)),
    [sidebarDrones, unreadByChatNodeId],
  );

  const unreadItemsKey = React.useMemo(() => unreadItems.map((item) => item.key).join('|'), [unreadItems]);
  const unreadDetailsRef = React.useRef<Record<string, DashboardUnreadItemDetail>>({});
  const { value: unreadDetailsPolled } = usePoll<Record<string, DashboardUnreadItemDetail>>(
    async () => {
      if (unreadItems.length === 0) return {};
      const entries = await Promise.all(
        unreadItems.map(async (item) => {
          try {
            const data = await fetchJson<{ ok: true; transcripts: Array<{ prompt?: string; output?: string; at?: string; completedAt?: string }> }>(
              `/api/drones/${encodeURIComponent(item.droneId)}/chats/${encodeURIComponent(item.chatName)}/state?turn=last&transcript=selected&pending=none`,
            );
            const transcript = Array.isArray(data.transcripts) ? data.transcripts[0] ?? null : null;
            if (!transcript) return [item.key, { prompt: '', output: '', at: null, completedAt: null }] as const;
            return [
              item.key,
              {
                prompt: String(transcript.prompt ?? ''),
                output: String(transcript.output ?? ''),
                at: typeof transcript.at === 'string' ? transcript.at : null,
                completedAt: typeof transcript.completedAt === 'string' ? transcript.completedAt : null,
              },
            ] as const;
          } catch {
            return [item.key, { prompt: '', output: '', at: null, completedAt: null }] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    5000,
    [unreadItemsKey],
  );

  React.useEffect(() => {
    if (unreadDetailsPolled) unreadDetailsRef.current = unreadDetailsPolled;
  }, [unreadDetailsPolled]);

  const unreadDetails = unreadDetailsPolled ?? unreadDetailsRef.current;

  const dashboard = React.useMemo(() => {
    const busyDrones = sidebarDrones.filter((drone) => {
      if (isDroneStartingOrSeeding(drone.hubPhase)) return false;
      const busyChats = Array.isArray(drone.busyChats) ? drone.busyChats.length : 0;
      return Boolean(drone.busy) || busyChats > 0;
    });
    const startingDrones = sidebarDrones.filter((drone) => isDroneStartingOrSeeding(drone.hubPhase));
    const checkingDrones = sidebarDrones.filter((drone) => !isDroneStartingOrSeeding(drone.hubPhase) && drone.statusChecking === true);
    const attentionDrones = sidebarDrones.filter(
      (drone) =>
        !isDroneStartingOrSeeding(drone.hubPhase) &&
        !drone.statusChecking &&
        (drone.hubPhase === 'error' || !drone.statusOk || Boolean(String(drone.statusError ?? '').trim())),
    );
    const healthyDrones = Math.max(sidebarDrones.length - startingDrones.length - checkingDrones.length - attentionDrones.length, 0);
    const counts = {
      total: mergedQueueItems.length,
      queued: mergedQueueItems.filter((item) => item.derivedState === 'queued').length,
      running: mergedQueueItems.filter((item) => item.derivedState === 'running').length,
      failed: mergedQueueItems.filter((item) => item.derivedState === 'failed').length,
      stuck: mergedQueueItems.filter((item) => item.derivedState === 'stuck').length,
    };
    return { busyDrones, startingDrones, checkingDrones, attentionDrones, healthyDrones, counts, unreadItems };
  }, [mergedQueueItems, sidebarDrones, unreadItems]);

  const visibleQueueItems = React.useMemo(() => {
    if (activityFilter === 'unread') return [];
    if (activityFilter === 'all') return mergedQueueItems;
    return mergedQueueItems.filter((item) => item.derivedState === activityFilter);
  }, [activityFilter, mergedQueueItems]);

  const filterOptions: Array<{ key: 'unread' | 'all' | 'queued' | 'running' | 'failed' | 'stuck'; label: string; count: number }> = [
    { key: 'unread', label: 'Unread', count: dashboard.unreadItems.length },
    { key: 'all', label: 'All work', count: dashboard.counts.total },
    { key: 'queued', label: 'Queued', count: dashboard.counts.queued },
    { key: 'running', label: 'Running', count: dashboard.counts.running },
    { key: 'stuck', label: 'Stuck', count: dashboard.counts.stuck },
    { key: 'failed', label: 'Failed', count: dashboard.counts.failed },
  ];

  const triggerRefresh = React.useCallback(() => {
    setRefreshNonce((prev) => prev + 1);
  }, []);

  const runQueueAction = React.useCallback(
    async (item: DashboardQueueItem, action: 'cancel' | 'retry' | 'remove') => {
      const key = `${action}:${item.key}`;
      setQueueActionBusyByKey((prev) => ({ ...prev, [key]: true }));
      setActionError(null);
      try {
        if (action === 'remove') {
          if (item.source === 'local' && item.localQueueKey) {
            removeQueuedPrompt(item.localQueueKey, item.promptId);
          }
          return;
        }
        if (action === 'cancel') {
          await requestJson(
            `/api/drones/${encodeURIComponent(item.droneId)}/chats/${encodeURIComponent(item.chatName)}/pending/${encodeURIComponent(item.promptId)}`,
            { method: 'DELETE' },
          );
          return;
        }
        if (action === 'retry') {
          await requestJson(`/api/drones/${encodeURIComponent(item.droneId)}/chats/${encodeURIComponent(item.chatName)}/prompt`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt: item.prompt,
              submittedAt: new Date().toISOString(),
              ...(typeof item.cwd === 'string' ? { cwd: item.cwd } : {}),
            }),
          });
          return;
        }
      } catch (error: any) {
        setActionError(error?.message ?? String(error));
      } finally {
        setQueueActionBusyByKey((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
        triggerRefresh();
      }
    },
    [removeQueuedPrompt, triggerRefresh],
  );

  const runLifecycleAction = React.useCallback(
    async (droneIdRaw: string, action: 'start' | 'stop' | 'restart') => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      setLifecycleBusyByDroneId((prev) => ({ ...prev, [droneId]: action }));
      setActionError(null);
      try {
        await requestJson(`/api/drones/${encodeURIComponent(droneId)}/lifecycle/${action}`, { method: 'POST' });
      } catch (error: any) {
        setActionError(error?.message ?? String(error));
      } finally {
        setLifecycleBusyByDroneId((prev) => {
          if (!(droneId in prev)) return prev;
          const next = { ...prev };
          delete next[droneId];
          return next;
        });
        triggerRefresh();
      }
    },
    [triggerRefresh],
  );

  return {
    actionError,
    dashboard,
    filterOptions,
    fleetWork,
    fleetWorkError,
    fleetWorkLoading,
    lifecycleBusyByDroneId,
    queueActionBusyByKey,
    activityFilter,
    runLifecycleAction,
    runQueueAction,
    setActivityFilter,
    sidebarDroneById,
    unreadDetails,
    unreadItems,
    visibleQueueItems,
  };
}

export function FleetDashboard({
  sidebarDrones,
  dronesError,
  unreadAgentMessageByChatNodeId,
  queuedPromptsByDroneChat,
  removeQueuedPrompt,
  onOpenDraftChatComposer,
  onOpenCreateModal,
  onOpenKanbanBoard,
  onSelectDrone,
  onSelectDroneChat,
}: NoDroneSelectedStateProps) {
  const {
    actionError,
    dashboard,
    filterOptions,
    fleetWork,
    fleetWorkError,
    fleetWorkLoading,
    lifecycleBusyByDroneId,
    queueActionBusyByKey,
    activityFilter,
    runLifecycleAction,
    runQueueAction,
    setActivityFilter,
    sidebarDroneById,
    unreadDetails,
    unreadItems,
    visibleQueueItems,
  } = useFleetDashboardState({
    sidebarDrones,
    unreadAgentMessageByChatNodeId,
    queuedPromptsByDroneChat,
    removeQueuedPrompt,
  });

  return (
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top,rgba(92,152,255,.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,.015),rgba(255,255,255,0))]">
      <div className="flex w-full flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] p-4 md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[720px]">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(92,152,255,.18)] bg-[rgba(92,152,255,.12)] text-[var(--accent)]">
                <IconDrone className="h-5 w-5" />
              </div>
              <h2 className="text-[22px] font-semibold tracking-tight text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
                Fleet dashboard
              </h2>
              <p className="mt-2 max-w-[62ch] text-[13px] leading-6 text-[var(--muted)]">
                This is the fleet home for the Hub. It now reflects real hub-side queued work and lets you control container drones without
                leaving the overview.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenDraftChatComposer}
                className="inline-flex items-center gap-2 h-[34px] px-3 rounded-lg border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[11px] text-[var(--accent)] hover:shadow-[var(--glow-accent)] transition-all"
              >
                <IconPlus className="opacity-90" />
                <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                  New drone
                </span>
              </button>
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="inline-flex items-center gap-2 h-[34px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
              >
                <IconPlusDouble className="opacity-80" />
                <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                  Batch create
                </span>
              </button>
              <button
                type="button"
                onClick={onOpenKanbanBoard}
                className="inline-flex items-center gap-2 h-[34px] px-3 rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
              >
                <IconBoard className="opacity-80" />
                <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                  Task board
                </span>
              </button>
            </div>
          </div>
          {actionError || dronesError || fleetWorkError ? (
            <div className="mt-4 rounded-xl border border-[rgba(255,90,90,.18)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[12px] text-[var(--red)]">
              {actionError || dronesError || fleetWorkError}
            </div>
          ) : null}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            label="Fleet size"
            value={String(sidebarDrones.length)}
            detail={
              dashboard.checkingDrones.length > 0
                ? `${dashboard.healthyDrones} healthy, ${dashboard.checkingDrones.length} checking`
                : `${dashboard.healthyDrones} healthy now`
            }
            tone="neutral"
          />
          <SummaryCard label="Busy now" value={String(dashboard.busyDrones.length)} detail={`${dashboard.counts.running} running items`} tone="accent" />
          <SummaryCard label="Unread replies" value={String(dashboard.unreadItems.length)} detail="Chats waiting on you" tone="accent" />
          <SummaryCard label="Queued work" value={String(dashboard.counts.queued)} detail={`${dashboard.counts.failed} failed items`} tone="warning" />
          <SummaryCard label="Needs attention" value={String(dashboard.attentionDrones.length)} detail={`${dashboard.counts.stuck} stuck work items`} tone="danger" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.85fr)]">
          <div className="min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-4">
            <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-dim)]">
                  <IconList className="h-3.5 w-3.5" />
                  Activity center
                </div>
                <p className="mt-1 text-[13px] text-[var(--muted)]">
                  Unread replies and hub-backed pending work, with local unsent items still visible while they wait to flush.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {activityFilter !== 'unread' && fleetWorkLoading && !fleetWork ? <span className="text-[11px] text-[var(--muted-dim)]">Loading queue…</span> : null}
                <div className="flex flex-wrap gap-2">
                  {filterOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setActivityFilter(option.key)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-wide transition-all ${
                        activityFilter === option.key
                          ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                          : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      <span>{option.label}</span>
                      <span className="rounded-full bg-[rgba(255,255,255,.06)] px-1.5 py-[1px] text-[10px]">{option.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {activityFilter === 'unread' ? (
                unreadItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
                    No unread replies right now.
                  </div>
                ) : (
                  unreadItems.map((item) => {
                    return (
                      <UnreadReplyCard
                        key={item.key}
                        item={item}
                        detail={unreadDetails[item.key] ?? null}
                        onOpenChat={onSelectDroneChat}
                      />
                    );
                  })
                )
              ) : visibleQueueItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
                  No items in this activity view right now.
                </div>
              ) : (
                visibleQueueItems.map((item) => {
                  const canOpen = sidebarDroneById.has(item.droneId);
                  const busyRemove = queueActionBusyByKey[`remove:${item.key}`];
                  const busyCancel = queueActionBusyByKey[`cancel:${item.key}`];
                  const busyRetry = queueActionBusyByKey[`retry:${item.key}`];
                  return (
                    <div
                      key={item.key}
                      className={`rounded-xl border px-3 py-3 transition-all ${
                        canOpen
                          ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] hover:border-[var(--accent-muted)]'
                          : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.01)]'
                      }`}
                    >
                      <div className="flex flex-col gap-3">
                        <button
                          type="button"
                          disabled={!canOpen}
                          onClick={() => canOpen && onSelectDroneChat(item.droneId, item.chatName)}
                          className={`w-full text-left ${canOpen ? '' : 'cursor-default opacity-80'}`}
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <QueueStateBadge state={item.derivedState} />
                                {item.source === 'local' ? <SourceBadge label="Local" /> : null}
                                {item.source === 'server' && item.blockedByAutomation ? <SourceBadge label="Automation" /> : null}
                                <span className="text-[12px] font-semibold text-[var(--fg)]">{item.droneName}</span>
                                <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-dim)]">
                                  {item.chatName}
                                </span>
                              </div>
                              <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-[var(--muted)]">{item.prompt || 'Attachment-only prompt'}</p>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted-dim)]">
                                <span>{timeAgo(item.updatedAt ?? item.at)}</span>
                                {item.attachmentsCount > 0 ? <span>{item.attachmentsCount} attachments</span> : null}
                                {item.error ? <span className="text-[var(--red)]">{item.error}</span> : null}
                              </div>
                            </div>
                          </div>
                        </button>
                        <div className="flex flex-wrap gap-2">
                          {item.source === 'local' ? (
                            <ActionButton
                              label={busyRemove ? 'Removing…' : 'Remove'}
                              disabled={Boolean(busyRemove)}
                              onClick={() => void runQueueAction(item, 'remove')}
                            />
                          ) : null}
                          {item.source === 'server' && item.canCancel ? (
                            <ActionButton
                              label={busyCancel ? 'Cancelling…' : 'Cancel'}
                              disabled={Boolean(busyCancel)}
                              onClick={() => void runQueueAction(item, 'cancel')}
                            />
                          ) : null}
                          {item.source === 'server' && item.canRetry ? (
                            <ActionButton
                              label={busyRetry ? 'Retrying…' : 'Retry'}
                              disabled={Boolean(busyRetry)}
                              onClick={() => void runQueueAction(item, 'retry')}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <FleetDroneListCard
              title="Needs attention"
              subtitle="Offline, error, or blocked drones."
              emptyLabel="No drones need attention."
              drones={dashboard.attentionDrones}
              onSelectDrone={onSelectDrone}
              onRunLifecycleAction={runLifecycleAction}
              lifecycleBusyByDroneId={lifecycleBusyByDroneId}
            />
            <FleetDroneListCard
              title="Busy now"
              subtitle="Drones actively responding or working."
              emptyLabel="No drones are actively working."
              drones={dashboard.busyDrones}
              onSelectDrone={onSelectDrone}
              onRunLifecycleAction={runLifecycleAction}
              lifecycleBusyByDroneId={lifecycleBusyByDroneId}
            />
            <FleetDroneListCard
              title="Starting up"
              subtitle="Provisioning, booting, or seeding."
              emptyLabel="No drones are starting."
              drones={dashboard.startingDrones}
              onSelectDrone={onSelectDrone}
              onRunLifecycleAction={runLifecycleAction}
              lifecycleBusyByDroneId={lifecycleBusyByDroneId}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function compareDashboardQueueItems(a: DashboardQueueItem, b: DashboardQueueItem): number {
  const rank = { stuck: 0, running: 1, queued: 2, failed: 3 } as const;
  const byState = rank[a.derivedState] - rank[b.derivedState];
  if (byState !== 0) return byState;
  const aMs = Date.parse(a.updatedAt ?? a.at ?? '');
  const bMs = Date.parse(b.updatedAt ?? b.at ?? '');
  return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
}

function summarizeFleetUnreadText(raw: string): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}...` : text;
}

function SummaryCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'accent' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'accent'
      ? 'border-[rgba(92,152,255,.18)] bg-[rgba(92,152,255,.08)]'
      : tone === 'warning'
        ? 'border-[rgba(255,178,36,.18)] bg-[rgba(255,178,36,.08)]'
        : tone === 'danger'
          ? 'border-[rgba(255,90,90,.18)] bg-[rgba(255,90,90,.08)]'
          : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]';

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
        {label}
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
        {value}
      </div>
      <div className="mt-2 text-[12px] text-[var(--muted)]">{detail}</div>
    </div>
  );
}

function UnreadReplyCard({
  item,
  detail,
  onOpenChat,
}: {
  item: DashboardUnreadItem;
  detail: DashboardUnreadItemDetail | null;
  onOpenChat: (droneId: string, chatName: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const when = detail?.completedAt ?? detail?.at ?? null;
  const rawPrompt = String(detail?.prompt ?? '').trim();
  const rawOutput = String(detail?.output ?? '').trim();
  const promptPreview = summarizeFleetUnreadText(rawPrompt);
  const featuredText = rawOutput || rawPrompt || 'Unread reply in this chat.';
  const featuredLabel = rawOutput ? 'Agent reply' : 'Latest message';
  const showPromptPreview = Boolean(rawPrompt) && rawPrompt !== featuredText;
  const collapseStyle = {
    ['--collapse-max-height' as any]: '220px',
    ['--collapse-fade' as any]: 'rgba(18,24,36,.98)',
  } as React.CSSProperties;

  const toggleExpanded = React.useCallback(() => {
    setExpanded((value) => !value);
  }, []);

  const handleResponseClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('a,button')) return;
    toggleExpanded();
  }, [toggleExpanded]);

  const handleResponseKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('a,button')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleExpanded();
  }, [toggleExpanded]);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] px-3 py-3 transition-all hover:border-[var(--accent-muted)] hover:bg-[rgba(255,255,255,.03)]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-[rgba(255,178,36,.18)] bg-[rgba(255,178,36,.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--yellow)]">
                unread
              </span>
              <span className="text-[13px] font-semibold text-[var(--fg)]">{item.droneName}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted-dim)]">
              <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 uppercase tracking-wide">{item.chatName}</span>
              {when ? <span>{timeAgo(when)}</span> : null}
            </div>
          </div>

          <div className="flex flex-col gap-2 xl:max-w-[320px] xl:items-end">
            {showPromptPreview ? (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2 xl:text-right">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  You sent
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--muted)]">{promptPreview}</p>
              </div>
            ) : null}
            <div className="flex xl:justify-end">
              <ActionButton label="Open chat" disabled={false} onClick={() => onOpenChat(item.droneId, item.chatName)} />
            </div>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={handleResponseClick}
          onKeyDown={handleResponseKeyDown}
          className="group cursor-pointer rounded-lg px-1 py-1 text-left transition-colors hover:bg-[rgba(255,255,255,.02)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-muted)]"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {featuredLabel}
            </div>
            <div className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)] transition-colors group-hover:text-[var(--fg)]">
              <IconChevron down={expanded} className="opacity-80" />
              <span>{expanded ? 'Collapse' : 'Expand'}</span>
            </div>
          </div>
          <div className={`output-collapse ${expanded ? '' : 'collapsed'}`} style={collapseStyle}>
            <MarkdownMessage text={featuredText} className="dh-markdown--transcript dh-markdown--agent" />
          </div>
        </div>
      </div>
    </div>
  );
}

function QueueStateBadge({ state }: { state: DashboardQueueItem['derivedState'] }) {
  const styles =
    state === 'running'
      ? 'border-[rgba(92,152,255,.2)] bg-[rgba(92,152,255,.12)] text-[rgb(124,170,255)]'
      : state === 'failed'
        ? 'border-[rgba(255,90,90,.2)] bg-[rgba(255,90,90,.1)] text-[var(--red)]'
        : state === 'stuck'
          ? 'border-[rgba(255,116,36,.2)] bg-[rgba(255,116,36,.1)] text-[rgb(255,150,94)]'
          : 'border-[rgba(255,178,36,.18)] bg-[rgba(255,178,36,.1)] text-[var(--yellow)]';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles}`}
      style={{ fontFamily: 'var(--display)' }}
    >
      {state}
    </span>
  );
}

function SourceBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]">
      {label}
    </span>
  );
}

function ActionButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-2 h-[30px] px-3 rounded-lg border text-[11px] font-semibold transition-all ${
        disabled
          ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
          : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
      }`}
      style={{ fontFamily: 'var(--display)' }}
    >
      {label}
    </button>
  );
}

function FleetDroneListCard({
  title,
  subtitle,
  emptyLabel,
  drones,
  onSelectDrone,
  onRunLifecycleAction,
  lifecycleBusyByDroneId,
}: {
  title: string;
  subtitle: string;
  emptyLabel: string;
  drones: DroneSummary[];
  onSelectDrone: (droneId: string) => void;
  onRunLifecycleAction: (droneId: string, action: 'start' | 'stop' | 'restart') => void;
  lifecycleBusyByDroneId: Record<string, 'start' | 'stop' | 'restart'>;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
          {title}
        </div>
        <p className="mt-1 text-[13px] text-[var(--muted)]">{subtitle}</p>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {drones.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-5 text-[13px] text-[var(--muted)]">{emptyLabel}</div>
        ) : (
          drones.slice(0, 6).map((drone) => {
            const busyChats = Array.isArray(drone.busyChats) ? drone.busyChats.length : 0;
            const lifecycleBusy = lifecycleBusyByDroneId[drone.id] ?? null;
            const runtimeSupportsLifecycle = drone.runtime !== 'host';
            const isStarting = isDroneStartingOrSeeding(drone.hubPhase);
            const statusChecking = drone.statusChecking === true;
            const canStart = runtimeSupportsLifecycle && !isStarting && !statusChecking && (!drone.statusOk || drone.hubPhase === 'error');
            const canStop = runtimeSupportsLifecycle && !isStarting && !statusChecking && (drone.statusOk || drone.busy || busyChats > 0);
            const canRestart = runtimeSupportsLifecycle && !isStarting && !statusChecking;
            const detail =
              drone.hubPhase === 'error'
                ? String(drone.hubMessage ?? drone.statusError ?? 'Error')
                : isStarting
                  ? String(drone.hubMessage ?? (drone.hubPhase === 'seeding' ? 'Seeding workspace' : 'Starting drone'))
                  : statusChecking
                    ? 'Checking status'
                  : busyChats > 0
                    ? `${busyChats} active chat${busyChats === 1 ? '' : 's'}`
                    : drone.busy
                      ? 'Responding now'
                      : drone.statusOk
                        ? 'Ready'
                        : String(drone.statusError ?? 'Offline');

            return (
              <div
                key={drone.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] px-3 py-3 transition-all hover:border-[var(--accent-muted)] hover:bg-[rgba(255,255,255,.03)]"
              >
                <button type="button" onClick={() => onSelectDrone(drone.id)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-[var(--fg)]">{drone.name}</div>
                      <div className="mt-1 text-[12px] leading-5 text-[var(--muted)]">{detail}</div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge
                        ok={drone.statusOk}
                        error={drone.statusError}
                        checking={drone.statusChecking}
                        hubPhase={drone.hubPhase}
                        hubMessage={drone.hubMessage}
                      />
                      <span className="text-[10px] uppercase tracking-wide text-[var(--muted-dim)]">{timeAgo(drone.createdAt)}</span>
                    </div>
                  </div>
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canStart ? (
                    <ActionButton
                      label={lifecycleBusy === 'start' ? 'Starting…' : 'Start'}
                      disabled={Boolean(lifecycleBusy)}
                      onClick={() => onRunLifecycleAction(drone.id, 'start')}
                    />
                  ) : null}
                  {canStop ? (
                    <ActionButton
                      label={lifecycleBusy === 'stop' ? 'Stopping…' : 'Stop'}
                      disabled={Boolean(lifecycleBusy)}
                      onClick={() => onRunLifecycleAction(drone.id, 'stop')}
                    />
                  ) : null}
                  {canRestart ? (
                    <ActionButton
                      label={lifecycleBusy === 'restart' ? 'Restarting…' : 'Restart'}
                      disabled={Boolean(lifecycleBusy)}
                      onClick={() => onRunLifecycleAction(drone.id, 'restart')}
                    />
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
