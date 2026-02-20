import React from 'react';
import {
  ChatInput,
  type ChatSendPayload,
  EmptyState,
  PendingTranscriptTurn,
  TranscriptSkeleton,
  TranscriptTurn,
} from '../chat';
import { requestJson } from '../http';
import { StatusBadge } from '../overview';
import { IconSpinner, IconTrash, TypingDots } from '../overview/icons';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../types';
import { IconChat } from './icons';
import { fetchJson, isNotFoundError, usePoll } from './hooks';
import { chatInputDraftKeyForDroneChat, droneHomePath, isDroneStartingOrSeeding, resolveChatNameForDrone } from './helpers';
import { openDroneTabFromLastPreview, resolveDroneOpenTabUrl } from './quick-actions';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

export type GroupMultiChatColumnProps = {
  drone: DroneSummary;
  droneLabel?: string;
  preferredChat: string;
  nowMs: number;
  onOpenDrone: () => void;
  onDeleteDrone: () => void;
  deleteBusy?: boolean;
  onCreateJobs: (opts: { turn: number; message: string }) => void;
  columnWidthPx: number;
};

export function GroupMultiChatColumn({
  drone,
  droneLabel,
  preferredChat,
  nowMs,
  onOpenDrone,
  onDeleteDrone,
  deleteBusy = false,
  onCreateJobs,
  columnWidthPx,
}: GroupMultiChatColumnProps) {
  const shownName = String(droneLabel ?? drone.name).trim() || drone.name;
  const chatName = React.useMemo(() => resolveChatNameForDrone(drone, preferredChat), [drone, preferredChat]);
  const [transcripts, setTranscripts] = React.useState<TranscriptItem[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [promptError, setPromptError] = React.useState<string | null>(null);
  const [sendingPromptCount, setSendingPromptCount] = React.useState(0);
  const sendingPrompt = sendingPromptCount > 0;
  const [optimisticPendingPrompts, setOptimisticPendingPrompts] = React.useState<PendingPrompt[]>([]);
  const [quickActionBusy, setQuickActionBusy] = React.useState<null | 'ssh' | 'pull' | 'push'>(null);
  const [quickActionError, setQuickActionError] = React.useState<string | null>(null);
  const columnScrollRef = React.useRef<HTMLDivElement | null>(null);
  const draftKey = React.useMemo(() => chatInputDraftKeyForDroneChat(drone.id, chatName), [drone.id, chatName]);
  const draftValue = useDroneHubUiStore((s) => s.chatInputDrafts[draftKey] ?? '');
  const setChatInputDraft = useDroneHubUiStore((s) => s.setChatInputDraft);
  const terminalEmulator = useDroneHubUiStore((s) => s.terminalEmulator);
  const repoAttached = Boolean(drone.repoAttached ?? Boolean(String(drone.repoPath ?? '').trim()));
  const quickOpenTabUrl = resolveDroneOpenTabUrl(drone);
  const disabledByProvisioning = isDroneStartingOrSeeding(drone.hubPhase);

  const scrollColumnToBottom = React.useCallback(() => {
    const el = columnScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  React.useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;

    setTranscripts(null);
    setError(null);
    setLoading(true);

    const load = async () => {
      if (busy) return;
      const isStarting = isDroneStartingOrSeeding(drone.hubPhase);
      if (isStarting) {
        if (mounted) {
          setTranscripts([]);
          setError(null);
          setLoading(false);
        }
        return;
      }
      busy = true;
      try {
        const data = await fetchJson<{ ok: true; transcripts: TranscriptItem[] }>(
          `/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(chatName)}/transcript?turn=all`,
        );
        if (!mounted) return;
        setTranscripts(data.transcripts ?? []);
        setError(null);
      } catch (err: any) {
        if (!mounted) return;
        if (isNotFoundError(err)) {
          setTranscripts([]);
          setError(null);
        } else {
          setError(err?.message ?? String(err));
        }
      } finally {
        busy = false;
        if (mounted) setLoading(false);
      }
    };

    const loop = async () => {
      await load();
      if (!mounted) return;
      timer = setTimeout(() => {
        void loop();
      }, 4000);
    };

    void loop();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [chatName, drone.hubPhase, drone.id]);

  const { value: pendingResp } = usePoll<{ ok: true; pending: PendingPrompt[] }>(
    async () => {
      if (isDroneStartingOrSeeding(drone.hubPhase)) return { ok: true, pending: [] };
      return await fetchJson<{ ok: true; pending: PendingPrompt[] }>(
        `/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(chatName)}/pending`,
      );
    },
    1000,
    [chatName, drone.hubPhase, drone.id],
  );

  const pendingPrompts = React.useMemo(() => {
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
    const ts = Array.isArray(transcripts) ? transcripts : [];
    const ids = new Set(ts.map((t) => String((t as any)?.id ?? '')).filter(Boolean));
    return pendingPrompts.filter((p) => p.state === 'failed' || !ids.has(p.id));
  }, [pendingPrompts, transcripts]);

  const waitingForAgent = React.useMemo(() => {
    if (sendingPrompt) return true;
    return visiblePendingPrompts.some((p) => p.state !== 'failed');
  }, [sendingPrompt, visiblePendingPrompts]);

  React.useEffect(() => {
    setOptimisticPendingPrompts([]);
  }, [chatName, drone.id]);

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
      const optimisticPrompt = prompt || (attachments.length === 1 ? '[image attachment]' : `[${attachments.length} image attachments]`);
      if (isDroneStartingOrSeeding(drone.hubPhase)) {
        if (attachments.length > 0) {
          setPromptError(`\"${shownName}\" is still starting. Image attachments can be sent once it is ready.`);
          return false;
        }
        setPromptError(`\"${shownName}\" is still starting.`);
        return false;
      }
      setSendingPromptCount((c) => c + 1);
      setPromptError(null);
      try {
        const data = await requestJson<{ ok: true; accepted: true; promptId: string }>(
          `/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(chatName)}/prompt`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt, attachments }),
          },
        );
        const id = String((data as any)?.promptId ?? '').trim();
        if (id) {
          setOptimisticPendingPrompts((prev) => {
            if (prev.some((p) => p.id === id)) return prev;
            return [...prev, { id, at: new Date().toISOString(), prompt: optimisticPrompt, state: 'sending' }];
          });
        }
        requestAnimationFrame(() => scrollColumnToBottom());
        return true;
      } catch (err: any) {
        setPromptError(err?.message ?? String(err));
        return false;
      } finally {
        setSendingPromptCount((c) => Math.max(0, c - 1));
      }
    },
    [chatName, drone.hubPhase, drone.id, scrollColumnToBottom, shownName],
  );

  const openSshTerminal = React.useCallback(async () => {
    if (disabledByProvisioning || quickActionBusy) return;
    setQuickActionBusy('ssh');
    setQuickActionError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('mode', 'ssh');
      qs.set('chat', chatName || 'default');
      qs.set('cwd', droneHomePath(drone));
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

  const pullRepoChanges = React.useCallback(async () => {
    if (disabledByProvisioning || quickActionBusy || !repoAttached) return;
    setQuickActionBusy('pull');
    setQuickActionError(null);
    try {
      const r = await fetch(`/api/drones/${encodeURIComponent(drone.id)}/repo/pull`, {
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
  }, [disabledByProvisioning, drone.id, quickActionBusy, repoAttached]);

  const pushRepoChanges = React.useCallback(async () => {
    if (disabledByProvisioning || quickActionBusy || !repoAttached) return;
    const confirmed = window.confirm(
      'Pull current host branch changes into this drone branch? A clean merge creates a merge commit in the drone repo.',
    );
    if (!confirmed) return;
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
  }, [disabledByProvisioning, drone.id, quickActionBusy, repoAttached]);

  const openBrowserTab = React.useCallback(async () => {
    if (disabledByProvisioning) return;
    setQuickActionError(null);
    const ok = await openDroneTabFromLastPreview(drone);
    if (!ok) setQuickActionError('No preview URL available yet.');
  }, [disabledByProvisioning, drone]);

  const noopToggleTldr = React.useCallback((_item: TranscriptItem) => {}, []);
  const noopHoverAgentMessage = React.useCallback((_item: TranscriptItem | null) => {}, []);

  return (
    <section
      className="flex-none h-full rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden flex flex-col"
      style={{ width: columnWidthPx, minWidth: columnWidthPx }}
    >
      <div className="group/column-header flex-shrink-0 px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenDrone}
                className="min-w-0 flex-1 block text-left text-[12px] font-semibold text-[var(--fg-secondary)] hover:text-[var(--accent)] transition-colors truncate"
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
                    : 'opacity-0 pointer-events-none group-hover/column-header:opacity-100 group-hover/column-header:pointer-events-auto bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)] hover:bg-[rgba(255,90,90,.15)]'
                }`}
                title={deleteBusy ? `Deleting "${shownName}"…` : `Delete "${shownName}"`}
                aria-label={deleteBusy ? `Deleting "${shownName}"` : `Delete "${shownName}"`}
              >
                {deleteBusy ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
              </button>
            </div>
          </div>
          <div className="text-[10px] text-[var(--muted-dim)] font-mono mt-0.5">chat: {chatName}</div>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                void openSshTerminal();
              }}
              disabled={disabledByProvisioning || Boolean(quickActionBusy)}
              className={`inline-flex items-center h-5 px-1.5 rounded border text-[9px] font-semibold tracking-wide uppercase transition-all ${
                disabledByProvisioning || Boolean(quickActionBusy)
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
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
              className={`inline-flex items-center h-5 px-1.5 rounded border text-[9px] font-semibold tracking-wide uppercase transition-all ${
                disabledByProvisioning || !quickOpenTabUrl
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)]'
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
                  className={`inline-flex items-center h-5 px-1.5 rounded border text-[9px] font-semibold tracking-wide uppercase transition-all ${
                    disabledByProvisioning || Boolean(quickActionBusy)
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title="Apply repo changes from this drone into the local repo"
                >
                  {quickActionBusy === 'pull' ? 'Applying...' : 'Apply'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void pushRepoChanges();
                  }}
                  disabled={disabledByProvisioning || Boolean(quickActionBusy)}
                  className={`inline-flex items-center h-5 px-1.5 rounded border text-[9px] font-semibold tracking-wide uppercase transition-all ${
                    disabledByProvisioning || Boolean(quickActionBusy)
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title="Merge current host branch commits into this drone branch"
                >
                  {quickActionBusy === 'push' ? 'Pulling...' : 'Pull host'}
                </button>
              </>
            ) : null}
          </div>
          {quickActionError ? <div className="mt-1 text-[10px] text-[var(--red)] truncate" title={quickActionError}>{quickActionError}</div> : null}
        </div>
      </div>
      <div ref={columnScrollRef} className="flex-1 min-h-0 overflow-auto px-3 py-3">
        {loading && !transcripts ? (
          <TranscriptSkeleton />
        ) : error ? (
          <div className="rounded border border-[rgba(255,90,90,.24)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">{error}</div>
        ) : (transcripts && transcripts.length > 0) || visiblePendingPrompts.length > 0 ? (
          <div className="space-y-5">
            {(transcripts ?? []).map((item) => {
              const messageId = `${drone.id}:${item.turn}:${item.at}`;
              return (
                <TranscriptTurn
                  key={messageId}
                  item={item}
                  nowMs={nowMs}
                  parsingJobs={false}
                  onCreateJobs={onCreateJobs}
                  messageId={messageId}
                  tldr={null}
                  showTldr={false}
                  onToggleTldr={noopToggleTldr}
                  onHoverAgentMessage={noopHoverAgentMessage}
                  showRoleIcons={false}
                />
              );
            })}
            {visiblePendingPrompts.map((item) => (
              <PendingTranscriptTurn key={`${drone.id}:pending:${item.id}`} item={item} nowMs={nowMs} showRoleIcons={false} />
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
        onSend={sendPrompt}
      />
    </section>
  );
}
