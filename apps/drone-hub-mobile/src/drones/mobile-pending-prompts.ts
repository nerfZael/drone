import {
  normalizeMobileAgentPlan,
  type MobileAgentPlan,
} from '../local-assistant/mobile-transcript-runs';
import { isStoppedRunError, normalizeAgentRunActivity } from '@drone/assistant-chat';

export type MobileDronePendingPrompt = {
  id: string;
  prompt: string;
  status: 'queued' | 'pending' | 'stopped' | 'failed';
  error: string | null;
  attachmentCount?: number;
  imageCount: number;
  cancelable: boolean;
  startedAt?: string;
  agentPlan?: MobileAgentPlan;
  delivered?: boolean;
};

export type MobileOptimisticPendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  state: 'queued' | 'sending' | 'sent' | 'failed';
  attachmentCount?: number;
  imageCount: number;
  error?: string;
  optimisticSent: true;
};

const OPTIMISTIC_PENDING_GRACE_MS = 10_000;

function positiveCount(value: unknown): number {
  return Math.max(0, Number(value) || 0);
}

export function optimisticMobilePendingPrompt(input: {
  id: string;
  prompt: string;
  attachmentCount?: number;
  imageCount?: number;
  at?: string;
  state?: 'queued' | 'sending';
}): MobileOptimisticPendingPrompt {
  const attachmentCount = positiveCount(input.attachmentCount ?? input.imageCount);
  return {
    id: input.id,
    at: input.at ?? new Date().toISOString(),
    prompt: input.prompt,
    state: input.state ?? 'sending',
    ...(attachmentCount > 0 ? { attachmentCount } : {}),
    imageCount: positiveCount(input.imageCount),
    optimisticSent: true,
  };
}

export function mergeOptimisticMobilePendingPrompts(input: {
  serverPrompts: unknown;
  localPrompts: unknown;
  turns: unknown;
  nowMs?: number;
}): any[] {
  const server = Array.isArray(input.serverPrompts) ? input.serverPrompts : [];
  const local = Array.isArray(input.localPrompts) ? input.localPrompts : [];
  const completedIds = new Set(
    (Array.isArray(input.turns) ? input.turns : [])
      .map((turn: any) => String(turn?.id ?? '').trim())
      .filter(Boolean),
  );
  const nowMs = input.nowMs ?? Date.now();
  const optimisticById = new Map(
    local
      .filter((prompt: any) => prompt?.optimisticSent === true)
      .map((prompt: any) => [String(prompt.id ?? '').trim(), prompt] as const)
      .filter(([id]) => Boolean(id)),
  );
  const merged = server.map((prompt: any) => {
    const id = String(prompt?.id ?? '').trim();
    const optimistic = optimisticById.get(id);
    if (!optimistic) return prompt;
    optimisticById.delete(id);
    if (completedIds.has(id)) return null;
    const serverState = String(prompt?.state ?? '');
    const reconciledState =
      optimistic.state === 'sending' && serverState === 'queued'
        ? 'sending'
        : serverState === 'queued' ||
            serverState === 'sending' ||
            serverState === 'sent' ||
            serverState === 'failed'
          ? serverState
          : serverState === 'running'
            ? 'sending'
            : optimistic.state;
    return {
      ...optimistic,
      ...prompt,
      state: reconciledState,
      optimisticSent: true,
    };
  });
  for (const [id, prompt] of optimisticById) {
    if (completedIds.has(id)) continue;
    // A locally failed upload/send has no server row to reconcile with. Keep its actionable error
    // visible until the user leaves the chat instead of aging it out like an unconfirmed send.
    if (prompt?.state === 'failed') {
      merged.push(prompt);
      continue;
    }
    const submittedAtMs = Date.parse(String(prompt?.at ?? ''));
    if (Number.isFinite(submittedAtMs) && nowMs - submittedAtMs > OPTIMISTIC_PENDING_GRACE_MS)
      continue;
    merged.push(prompt);
  }
  return merged.filter(Boolean);
}

export function confirmedMobilePendingPromptState(input: {
  pendingState?: unknown;
  queuedPromptId?: unknown;
  optimisticState?: 'queued' | 'sending';
}): 'queued' | 'sending' | 'sent' {
  const state = String(input.pendingState ?? '').trim();
  if (input.optimisticState === 'queued') return 'queued';
  if (input.optimisticState === 'sending') return state === 'sent' ? 'sent' : 'sending';
  if (String(input.queuedPromptId ?? '').trim()) return 'queued';
  if (state === 'queued' || state === 'sent') return state;
  return 'sending';
}

function completedMobileTurnIds(turnsRaw: unknown): Set<string> {
  return new Set(
    (Array.isArray(turnsRaw) ? turnsRaw : [])
      .map((turn: any) => String(turn?.id ?? '').trim())
      .filter(Boolean),
  );
}

export function hasActiveMobileDronePendingPrompt(raw: unknown, turnsRaw: unknown): boolean {
  const completedTurnIds = completedMobileTurnIds(turnsRaw);
  return (Array.isArray(raw) ? raw : []).some((item: any) => {
    const state = String(item?.state ?? '').trim();
    const id = String(item?.id ?? '').trim();
    return Boolean(id && (state === 'sending' || state === 'sent') && !completedTurnIds.has(id));
  });
}

export function mobileChatRespondingStatus(input: {
  localActivity: boolean;
  nativeRuntimeActive: boolean;
  nativeTranscriptLoaded: boolean;
  serverChatBusy: boolean;
}): boolean {
  return (
    input.localActivity ||
    input.nativeRuntimeActive ||
    (input.nativeTranscriptLoaded && input.serverChatBusy)
  );
}

export function mobileDronePendingPrompts(
  raw: unknown,
  turnsRaw: unknown,
  messagesRaw: unknown = [],
): MobileDronePendingPrompt[] {
  const completedTurnIds = completedMobileTurnIds(turnsRaw);
  const transcriptMessageIds = new Set(
    (Array.isArray(messagesRaw) ? messagesRaw : [])
      .map((message: any) => String(message?.id ?? '').trim())
      .filter(Boolean),
  );
  return (Array.isArray(raw) ? raw : []).flatMap((item: any) => {
    const id = String(item?.id ?? '').trim();
    const state = String(item?.state ?? 'queued');
    if (!id || !['queued', 'sending', 'sent', 'failed'].includes(state)) return [];
    // The Hub deliberately retains recently completed pending rows for reconciliation. Once the
    // matching transcript turn is visible, rendering that row again would duplicate the prompt.
    if (state !== 'failed' && completedTurnIds.has(id)) return [];
    if (
      (state === 'sending' || state === 'sent') &&
      normalizeAgentRunActivity(item?.activity)?.messages.length
    ) {
      return [];
    }
    const stopped = state === 'failed' && isStoppedRunError(item?.error);
    const messageId = String(item?.messageId ?? '').trim();
    const delivered =
      stopped &&
      (completedTurnIds.has(id) ||
        transcriptMessageIds.has(id) ||
        Boolean(messageId && transcriptMessageIds.has(messageId)));
    const agentPlan = normalizeMobileAgentPlan(item?.agentPlan);
    const attachmentCount = positiveCount(
      item?.attachmentCount ??
        item?.imageCount ??
        (Array.isArray(item?.attachments) ? item.attachments.length : 0),
    );
    return [
      {
        id,
        prompt: String(item?.prompt ?? ''),
        status: stopped
          ? 'stopped'
          : state === 'failed'
            ? 'failed'
            : state === 'queued'
              ? 'queued'
              : 'pending',
        error: item?.error ? String(item.error) : null,
        ...(attachmentCount > 0 ? { attachmentCount } : {}),
        imageCount: positiveCount(item?.imageCount),
        cancelable: state === 'queued',
        ...(String(item?.at ?? '').trim() ? { startedAt: String(item.at).trim() } : {}),
        ...(agentPlan ? { agentPlan } : {}),
        ...(delivered ? { delivered: true } : {}),
      } satisfies MobileDronePendingPrompt,
    ];
  });
}
