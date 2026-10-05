import { useQuery } from '@tanstack/react-query';

import { requestJson } from '../http';
import { describeHelperCost, formatHelperCost, type HelperCost } from './helper-cost';
import type { TranscriptItem } from '../types';

export type NextActionsProvider = 'openai' | 'codex' | 'gemini' | 'openrouter' | 'cerebras';

export type NextActionsSettings = {
  enabled: boolean;
  provider: NextActionsProvider;
  model: string;
  thinkingLevel: string;
  actions: NextAction[];
  instructions: string;
};

/** A button's label and the message it sends. */
export type NextAction = { name: string; text: string };
export type NextActionsCost = HelperCost;

export type NextActionsSettingsResponse = {
  ok: true;
  settings: NextActionsSettings;
  revision: string;
  defaults: { actions: NextAction[]; instructions: string };
  limits: { maxActions: number; maxActionNameChars: number; maxActionChars: number; maxInstructionsChars: number; maxTurns: number };
  models: Array<{ provider: NextActionsProvider; id: string; name: string; thinkingLevel: string }>;
  credentials: Record<NextActionsProvider, boolean>;
  totalCost: NextActionsCost;
  costByChat: Array<NextActionsCost & { droneId: string; chatName: string; droneName: string | null }>;
};

export type NextActionsSuggestions = { actions: NextAction[]; cost: NextActionsCost | null };

export type NextActionsTurn = { prompt: string; response: string };

/** The finished turn suggestions are anchored to, plus the recent exchanges sent as context. */
export type NextActionsAnchor = { turnId: string; turns: NextActionsTurn[] };

export const NEXT_ACTIONS_SETTINGS_QUERY_KEY = ['next-actions', 'settings'] as const;
const CONTEXT_TURNS = 6;

export function useNextActionsSettings(enabled = true) {
  return useQuery<NextActionsSettingsResponse, Error>({
    queryKey: NEXT_ACTIONS_SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => requestJson<NextActionsSettingsResponse>('/api/settings/next-actions', { signal }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export const formatNextActionsCost = formatHelperCost;

export function describeNextActionsCost(cost: NextActionsCost, where: string): string {
  return describeHelperCost(cost, 'Next actions', where, 'have');
}

export function useNextActionsSuggestions(
  chat: { droneId: string; chatName: string },
  anchor: NextActionsAnchor | null,
  revision: string | null,
) {
  return useQuery<NextActionsSuggestions, Error>({
    queryKey: ['next-actions', 'suggest', chat.droneId, chat.chatName, anchor?.turnId ?? '', revision ?? ''],
    queryFn: async ({ signal }) => {
      const response = await requestJson<{ ok: true; actions: NextAction[]; cost?: NextActionsCost | null }>('/api/next-actions/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ droneId: chat.droneId, chatName: chat.chatName, turnId: anchor!.turnId, turns: anchor!.turns }),
        signal,
      });
      const actions = (Array.isArray(response.actions) ? response.actions : [])
        .filter((action) => action && typeof action.name === 'string' && typeof action.text === 'string');
      return { actions, cost: response.cost ?? null };
    },
    enabled: Boolean(anchor && revision),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}

/**
 * The latest transcript turn, when it is a finished agent reply the user can
 * answer. Turns are sent oldest first.
 */
export function nextActionsAnchorFromTranscript(transcripts: readonly TranscriptItem[] | null | undefined): NextActionsAnchor | null {
  const latest = transcripts?.[transcripts.length - 1];
  if (!latest || !latest.ok || latest.userOnly || latest.silentCompletion || !String(latest.output ?? '').trim()) return null;
  return {
    turnId: String(latest.id ?? '').trim() || `${latest.turn}:${latest.at}`,
    turns: transcripts!.slice(-CONTEXT_TURNS).map((item) => ({
      prompt: String(item.prompt ?? ''),
      response: item.ok && !item.silentCompletion ? String(item.output ?? '') : '',
    })),
  };
}

/** Groups a native chat's user and assistant texts into exchanges; the last assistant text of each wins. */
export function nextActionsTurnsFromMessages(
  messages: ReadonlyArray<{ role: string; text: string }>,
): NextActionsTurn[] {
  const turns: NextActionsTurn[] = [];
  for (const message of messages) {
    const text = message.text.trim();
    if (message.role === 'user') turns.push({ prompt: text, response: '' });
    else if (message.role === 'assistant' && text) {
      if (turns.length === 0) turns.push({ prompt: '', response: text });
      else turns[turns.length - 1]!.response = text;
    }
  }
  return turns.slice(-CONTEXT_TURNS);
}
