import React from 'react';
import { stripAnsi } from '../../domain';
import type { TranscriptItem } from '../types';
import type { TldrState } from './app-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseTranscriptTldrStateArgs = {
  transcripts: TranscriptItem[] | null;
  chatUiModeRef: React.MutableRefObject<'transcript' | 'cli'>;
  requestJson: RequestJsonFn;
};

export function useTranscriptTldrState({
  transcripts,
  chatUiModeRef,
  requestJson,
}: UseTranscriptTldrStateArgs) {
  const [tldrByMessageId, setTldrByMessageId] = React.useState<
    Record<string, TldrState>
  >({});
  const tldrByMessageIdRef = React.useRef<Record<string, TldrState>>({});
  const [showTldrByMessageId, setShowTldrByMessageId] = React.useState<
    Record<string, boolean>
  >({});
  const showTldrByMessageIdRef = React.useRef<Record<string, boolean>>({});
  const [hoveredAgentMessageId, setHoveredAgentMessageId] = React.useState<
    string | null
  >(null);
  const hoveredAgentMessageIdRef = React.useRef<string | null>(null);
  const transcriptsRef = React.useRef<TranscriptItem[] | null>(null);

  React.useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  React.useEffect(() => {
    tldrByMessageIdRef.current = tldrByMessageId;
  }, [tldrByMessageId]);

  React.useEffect(() => {
    showTldrByMessageIdRef.current = showTldrByMessageId;
  }, [showTldrByMessageId]);

  React.useEffect(() => {
    hoveredAgentMessageIdRef.current = hoveredAgentMessageId;
  }, [hoveredAgentMessageId]);

  const transcriptMessageId = React.useCallback((t: TranscriptItem): string => {
    const explicit = typeof t?.id === 'string' ? t.id.trim() : '';
    if (explicit) return explicit;
    const session = String(t?.session ?? '').trim() || 'session';
    const turn = String(t?.turn ?? '');
    const iso = String(t?.completedAt ?? t?.at ?? '').trim() || 'at';
    return `${session}:${turn}:${iso}`;
  }, []);

  const cleanedAgentTextForTldr = React.useCallback((t: TranscriptItem): string => {
    return stripAnsi(t.ok ? t.output : t.error || 'failed');
  }, []);

  const cleanedPromptTextForTldr = React.useCallback((t: TranscriptItem): string => {
    return stripAnsi(t.prompt ?? '');
  }, []);

  const requestTldrForAgentMessage = React.useCallback(
    async (target: TranscriptItem) => {
      const messageId = transcriptMessageId(target);
      const existing = tldrByMessageIdRef.current?.[messageId] ?? null;
      if (existing?.status === 'loading' || existing?.status === 'ready') return;

      const clip = (s: string, max: number) => {
        const text = String(s ?? '').trim();
        if (!text) return '';
        return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
      };

      const list = transcriptsRef.current ?? [];
      let idx = list.findIndex((x) => transcriptMessageId(x) === messageId);
      if (idx < 0) idx = list.findIndex((x) => x.session === target.session && x.turn === target.turn);
      const end = idx >= 0 ? idx + 1 : list.length;
      const start = Math.max(0, end - 3);
      const slice = list.length > 0 ? list.slice(start, end) : [target];

      const context = slice.map((t) => ({
        turn: t.turn,
        prompt: clip(cleanedPromptTextForTldr(t), 2200),
        response: clip(cleanedAgentTextForTldr(t), 5200),
      }));

      setTldrByMessageId((prev) => ({ ...prev, [messageId]: { status: 'loading' } }));
      try {
        const data = await requestJson<{ ok: true; tldr: string }>(`/api/tldr/from-message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: clip(cleanedPromptTextForTldr(target), 6000),
            response: clip(cleanedAgentTextForTldr(target), 14_000),
            context,
          }),
        });
        const tldr = String((data as any)?.tldr ?? '').trim();
        if (!tldr) throw new Error('Empty TLDR response.');
        setTldrByMessageId((prev) => ({ ...prev, [messageId]: { status: 'ready', summary: tldr } }));
      } catch (e: any) {
        setTldrByMessageId((prev) => ({ ...prev, [messageId]: { status: 'error', error: e?.message ?? String(e) } }));
      }
    },
    [cleanedAgentTextForTldr, cleanedPromptTextForTldr, requestJson, transcriptMessageId],
  );

  const toggleTldrForAgentMessage = React.useCallback(
    (target: TranscriptItem) => {
      const messageId = transcriptMessageId(target);
      const cur = Boolean(showTldrByMessageIdRef.current?.[messageId]);
      const next = !cur;
      setShowTldrByMessageId((prev) => ({ ...prev, [messageId]: next }));
      if (next) void requestTldrForAgentMessage(target);
    },
    [requestTldrForAgentMessage, transcriptMessageId],
  );

  const handleAgentMessageHover = React.useCallback(
    (t: TranscriptItem | null) => {
      setHoveredAgentMessageId(t ? transcriptMessageId(t) : null);
    },
    [transcriptMessageId],
  );

  const toggleTldrFromShortcut = React.useCallback(() => {
    if (chatUiModeRef.current !== 'transcript') return;
    const list = transcriptsRef.current ?? [];
    if (list.length === 0) return;
    const hoveredId = hoveredAgentMessageIdRef.current;
    const target = hoveredId ? list.find((t) => transcriptMessageId(t) === hoveredId) ?? null : null;
    const chosen = target ?? list[list.length - 1];
    toggleTldrForAgentMessage(chosen);
  }, [chatUiModeRef, toggleTldrForAgentMessage, transcriptMessageId]);

  return {
    transcriptMessageId,
    tldrByMessageId,
    showTldrByMessageId,
    toggleTldrForAgentMessage,
    handleAgentMessageHover,
    toggleTldrFromShortcut,
  };
}
