import React from 'react';
import { QueryClientContext, useMutation, useQuery, type QueryClient } from '@tanstack/react-query';

import { requestJson } from '../http';
import { droneHubQueryClient } from '../query-client';
import { describeHelperCost, formatHelperCost, type HelperCost } from './helper-cost';

export type AskKind = 'request' | 'question' | 'rule';
export type AskStatus = 'open' | 'done' | 'partial' | 'not_done' | 'replaced' | 'dismissed';
export type AskProvider = 'openai' | 'codex' | 'gemini' | 'openrouter' | 'cerebras';
export type AskModelSelection = { provider: AskProvider; model: string; thinkingLevel: string };
export type AskCost = HelperCost;

export type ChatAsk = {
  id: string;
  kind: AskKind;
  text: string;
  messageIds: string[];
  runId: string;
  at: string;
  status: AskStatus;
  note?: string;
  statusAt?: string;
  manual?: boolean;
  previous?: { status: AskStatus; note?: string; at?: string };
  reopenedAt?: string;
  inProgress: boolean;
};

export type ChatAsksResponse = {
  ok: true;
  /** Asks are on in Settings. */
  enabled: boolean;
  /** This chat is tracked. */
  tracking: boolean;
  asks: ChatAsk[];
  processing: boolean;
  error: string | null;
  cost: AskCost;
};

export type ChatAsksSettings = {
  enabled: boolean;
  autoTrack: boolean;
  record: AskModelSelection;
  check: AskModelSelection;
  prompts: { record: string; check: string; backfill: string };
};

export type ChatAsksSettingsResponse = {
  ok: true;
  settings: ChatAsksSettings;
  defaults: { prompts: ChatAsksSettings['prompts'] };
  limits: { maxPromptChars: number; backfillMessages: number };
  models: Array<{ provider: AskProvider; id: string; name: string; thinkingLevel: string }>;
  credentials: Record<AskProvider, boolean>;
  totalCost: AskCost;
};

export type AskChat = { droneId: string; chatName: string };

export const CHAT_ASKS_SETTINGS_QUERY_KEY = ['chat-asks', 'settings'] as const;
const chatAsksQueryKey = (chat: AskChat) => ['chat-asks', 'chat', chat.droneId, chat.chatName] as const;
/** While the model is catching up or the agent works, the list changes every few seconds. */
const BUSY_POLL_MS = 4_000;
const IDLE_POLL_MS = 20_000;

/** The composer uses asks everywhere it renders, including surfaces mounted without a query provider. */
function useAsksQueryClient(): QueryClient {
  return React.useContext(QueryClientContext) ?? droneHubQueryClient;
}

export function useChatAsksSettings(enabled = true) {
  const client = useAsksQueryClient();
  return useQuery<ChatAsksSettingsResponse, Error>({
    queryKey: CHAT_ASKS_SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => requestJson<ChatAsksSettingsResponse>('/api/settings/chat-asks', { signal }),
    enabled,
    staleTime: 60_000,
  }, client);
}

/** A chat's asks while the feature is on in Settings; polled faster while anything is still being worked out. */
export function useChatAsks(chat: AskChat | null | undefined) {
  const queryClient = useAsksQueryClient();
  const settings = useChatAsksSettings(Boolean(chat));
  const featureOn = settings.data?.settings?.enabled === true;
  const autoTrack = settings.data?.settings?.autoTrack === true;
  const query = useQuery<ChatAsksResponse, Error>({
    queryKey: chat ? chatAsksQueryKey(chat) : ['chat-asks', 'chat', 'none'],
    queryFn: ({ signal }) => requestJson<ChatAsksResponse>(
      `/api/chat-asks?${new URLSearchParams({ droneId: chat!.droneId, chatName: chat!.chatName })}`,
      { signal },
    ),
    enabled: Boolean(chat && featureOn),
    refetchInterval: (current) => {
      const data = current.state.data;
      // With automatic tracking, the Hub starts tracking this chat once its agent runs; keep checking so the list appears.
      if (!data?.tracking) return autoTrack ? IDLE_POLL_MS : false;
      return data.processing || data.asks?.some((ask) => ask.inProgress) ? BUSY_POLL_MS : IDLE_POLL_MS;
    },
  }, queryClient);
  const accept = (response: ChatAsksResponse) => {
    if (chat) queryClient.setQueryData(chatAsksQueryKey(chat), response);
  };
  const post = (url: string, body: Record<string, unknown>) => requestJson<ChatAsksResponse>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...chat, ...body }),
  });
  const tracking = useMutation<ChatAsksResponse, Error, boolean>({
    mutationFn: (next) => post('/api/chat-asks/tracking', { enabled: next }),
    onSuccess: accept,
  }, queryClient);
  const status = useMutation<ChatAsksResponse, Error, { askId: string; status: 'open' | 'done' | 'dismissed' }>({
    mutationFn: (change) => post('/api/chat-asks/status', change),
    onSuccess: accept,
  }, queryClient);
  const data = featureOn && Array.isArray(query.data?.asks) ? query.data : null;
  return { featureOn: Boolean(chat && featureOn), query, data, tracking, status };
}

export type ChatAsksState = ReturnType<typeof useChatAsks>;

export function askStatusLabel(ask: Pick<ChatAsk, 'kind' | 'status' | 'inProgress'>): string {
  if (ask.kind === 'rule') return ask.status === 'replaced' ? 'Replaced' : ask.status === 'dismissed' ? 'Dismissed' : 'Active';
  if (ask.inProgress) return 'In progress';
  const question = ask.kind === 'question';
  switch (ask.status) {
    case 'done': return question ? 'Answered' : 'Done';
    case 'partial': return question ? 'Partly answered' : 'Partly done';
    case 'not_done': return question ? 'Not answered' : 'Not done';
    case 'replaced': return 'Replaced';
    case 'dismissed': return 'Dismissed';
    default: return 'Open';
  }
}

/** Asks still waiting on the agent: open, partly done, or not done (rules never count). */
export function isAskOutstanding(ask: Pick<ChatAsk, 'kind' | 'status'>): boolean {
  return ask.kind !== 'rule' && (ask.status === 'open' || ask.status === 'partial' || ask.status === 'not_done');
}

/** Same shape and display as Next actions' cost. */
export const formatAskCost = formatHelperCost;

export function describeAskCost(cost: AskCost, where: string): string {
  return describeHelperCost(cost, 'Tracking asks', where);
}

/** Groups asks by the agent run that first heard them, in order. */
export function groupAsksByRun(asks: readonly ChatAsk[]): Array<{ runId: string; at: string; asks: ChatAsk[] }> {
  const groups = new Map<string, { runId: string; at: string; asks: ChatAsk[] }>();
  for (const ask of asks) {
    const group = groups.get(ask.runId) ?? { runId: ask.runId, at: ask.at, asks: [] };
    if (ask.at < group.at) group.at = ask.at;
    group.asks.push(ask);
    groups.set(ask.runId, group);
  }
  return [...groups.values()].sort((a, b) => a.at.localeCompare(b.at));
}
