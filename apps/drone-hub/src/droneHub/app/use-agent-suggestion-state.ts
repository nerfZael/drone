import React from 'react';
import { stripAnsi } from '../../domain';
import type { PendingPrompt, TranscriptItem } from '../types';
import type { AgentSuggestionState } from './app-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseAgentSuggestionStateArgs = {
  transcripts: TranscriptItem[] | null;
  pendingPrompts: PendingPrompt[];
  chatUiModeRef: React.MutableRefObject<'transcript' | 'cli'>;
  requestJson: RequestJsonFn;
  transcriptMessageId: (item: TranscriptItem) => string;
  enabled: boolean;
  currentPolicyFingerprint: string;
};

type AgentSuggestionResponse = {
  ok: true;
  suggestion: string;
  reason: string;
  kind: string;
  policyFingerprint: string;
};

const CONTEXT_TURNS = 3;

export function resolveLatestAgentSuggestionTarget(
  transcripts: TranscriptItem[] | null,
  pendingPrompts: PendingPrompt[],
): TranscriptItem | null {
  const list = Array.isArray(transcripts) ? transcripts : [];
  if (list.length === 0) return null;
  if (Array.isArray(pendingPrompts) && pendingPrompts.length > 0) return null;
  return list[list.length - 1] ?? null;
}

export function useAgentSuggestionState({
  transcripts,
  pendingPrompts,
  chatUiModeRef,
  requestJson,
  transcriptMessageId,
  enabled,
  currentPolicyFingerprint,
}: UseAgentSuggestionStateArgs) {
  const [agentSuggestionByMessageId, setAgentSuggestionByMessageId] = React.useState<Record<string, AgentSuggestionState>>({});
  const agentSuggestionByMessageIdRef = React.useRef<Record<string, AgentSuggestionState>>({});
  const transcriptsRef = React.useRef<TranscriptItem[] | null>(null);
  const latestRequestPolicyByMessageIdRef = React.useRef<Record<string, string>>({});
  const latestRequestTokenByMessageIdRef = React.useRef<Record<string, string>>({});

  React.useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  React.useEffect(() => {
    agentSuggestionByMessageIdRef.current = agentSuggestionByMessageId;
  }, [agentSuggestionByMessageId]);

  const cleanedAgentText = React.useCallback((item: TranscriptItem): string => {
    return stripAnsi(item.ok ? item.output : item.error || 'failed');
  }, []);

  const cleanedPromptText = React.useCallback((item: TranscriptItem): string => {
    return stripAnsi(item.prompt ?? '');
  }, []);

  const clip = React.useCallback((value: string, max: number) => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
  }, []);

  const latestAgentSuggestionTarget = React.useMemo(() => {
    return resolveLatestAgentSuggestionTarget(transcripts, pendingPrompts);
  }, [pendingPrompts, transcripts]);

  const requestAgentSuggestionForMessage = React.useCallback(
    async (target: TranscriptItem, opts?: { force?: boolean }) => {
      const messageId = transcriptMessageId(target);
      const existing = agentSuggestionByMessageIdRef.current?.[messageId] ?? null;
      const existingPolicyFingerprint =
        existing?.status === 'ready' ? String(existing.policyFingerprint ?? '').trim() : '';
      const inFlightPolicyFingerprint = String(latestRequestPolicyByMessageIdRef.current?.[messageId] ?? '').trim();
      if (!opts?.force) {
        if (existing?.status === 'ready' && existingPolicyFingerprint === currentPolicyFingerprint) return;
        if (existing?.status === 'loading' && inFlightPolicyFingerprint === currentPolicyFingerprint) return;
      }

      const list = transcriptsRef.current ?? [];
      let idx = list.findIndex((item) => transcriptMessageId(item) === messageId);
      if (idx < 0) idx = list.findIndex((item) => item.session === target.session && item.turn === target.turn);
      const end = idx >= 0 ? idx + 1 : list.length;
      const start = Math.max(0, end - CONTEXT_TURNS);
      const slice = list.length > 0 ? list.slice(start, end) : [target];
      const requestToken = `${messageId}:${currentPolicyFingerprint}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
      latestRequestPolicyByMessageIdRef.current[messageId] = currentPolicyFingerprint;
      latestRequestTokenByMessageIdRef.current[messageId] = requestToken;

      setAgentSuggestionByMessageId((prev) => ({ ...prev, [messageId]: { status: 'loading' } }));
      try {
        const data = await requestJson<AgentSuggestionResponse>('/api/agent-suggestion/from-message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: clip(cleanedPromptText(target), 6_000),
            response: clip(cleanedAgentText(target), 14_000),
            context: slice.map((item) => ({
              turn: item.turn,
              prompt: clip(cleanedPromptText(item), 2_200),
              response: clip(cleanedAgentText(item), 5_200),
            })),
          }),
        });
        const suggestion = String(data?.suggestion ?? '').trim();
        if (!suggestion) throw new Error('Empty assistant suggestion response.');
        if (latestRequestTokenByMessageIdRef.current?.[messageId] !== requestToken) return;
        setAgentSuggestionByMessageId((prev) => ({
          ...prev,
          [messageId]: {
            status: 'ready',
            suggestion,
            reason: String(data?.reason ?? '').trim(),
            kind: String(data?.kind ?? '').trim(),
            policyFingerprint: String(data?.policyFingerprint ?? '').trim(),
          },
        }));
      } catch (e: any) {
        if (latestRequestTokenByMessageIdRef.current?.[messageId] !== requestToken) return;
        setAgentSuggestionByMessageId((prev) => ({
          ...prev,
          [messageId]: { status: 'error', error: e?.message ?? String(e) },
        }));
      }
    },
    [cleanedAgentText, cleanedPromptText, clip, currentPolicyFingerprint, requestJson, transcriptMessageId],
  );

  React.useEffect(() => {
    if (!enabled || chatUiModeRef.current !== 'transcript' || !latestAgentSuggestionTarget) return;
    void requestAgentSuggestionForMessage(latestAgentSuggestionTarget);
  }, [chatUiModeRef, currentPolicyFingerprint, enabled, latestAgentSuggestionTarget, requestAgentSuggestionForMessage]);

  const latestAgentSuggestionState = React.useMemo(() => {
    if (!latestAgentSuggestionTarget) return null;
    return agentSuggestionByMessageId[transcriptMessageId(latestAgentSuggestionTarget)] ?? null;
  }, [agentSuggestionByMessageId, latestAgentSuggestionTarget, transcriptMessageId]);

  return {
    agentSuggestionByMessageId,
    latestAgentSuggestionTarget,
    latestAgentSuggestionState,
    requestAgentSuggestionForMessage,
  };
}
