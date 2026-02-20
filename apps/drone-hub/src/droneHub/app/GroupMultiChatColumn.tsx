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
import { TypingDots } from '../overview/icons';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../types';
import { IconChat } from './icons';
import { fetchJson, isNotFoundError, usePoll } from './hooks';
import { isDroneStartingOrSeeding, resolveChatNameForDrone } from './helpers';

export type GroupMultiChatColumnProps = {
  drone: DroneSummary;
  droneLabel?: string;
  preferredChat: string;
  nowMs: number;
  onOpenDrone: () => void;
  onCreateJobs: (opts: { turn: number; message: string }) => void;
  columnWidthPx: number;
};

export function GroupMultiChatColumn({
  drone,
  droneLabel,
  preferredChat,
  nowMs,
  onOpenDrone,
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
  const columnScrollRef = React.useRef<HTMLDivElement | null>(null);

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

  const noopToggleTldr = React.useCallback((_item: TranscriptItem) => {}, []);
  const noopHoverAgentMessage = React.useCallback((_item: TranscriptItem | null) => {}, []);

  return (
    <section
      className="flex-none h-full rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden flex flex-col"
      style={{ width: columnWidthPx, minWidth: columnWidthPx }}
    >
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onOpenDrone}
              className="text-left text-[12px] font-semibold text-[var(--fg-secondary)] hover:text-[var(--accent)] transition-colors truncate min-w-0"
              style={{ fontFamily: 'var(--display)' }}
              title={`Open ${shownName}`}
            >
              {shownName}
            </button>
            <div className="flex items-center flex-shrink-0 ml-2">
              {waitingForAgent ? (
                <span className="inline-flex items-center" title="Agent responding">
                  <TypingDots color="var(--yellow)" />
                </span>
              ) : (
                <StatusBadge
                  ok={drone.statusOk}
                  error={drone.statusError}
                  hubPhase={drone.hubPhase}
                  hubMessage={drone.hubMessage}
                />
              )}
            </div>
          </div>
          <div className="text-[10px] text-[var(--muted-dim)] font-mono mt-0.5">chat: {chatName}</div>
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
