import {
  completedTurnIds,
  filterCompletedPendingPrompts,
  hasActivePendingPrompt,
  isStoppedRunError,
  isSendInNewChatQueueAction,
  isEventNotificationPrompt,
  mergeOptimisticPendingPrompts,
  normalizeAgentPlan,
  normalizeAgentRunActivity,
  normalizePromptQueueInterruption,
  promptQueueInterruptionBlocks,
  replaceOptimisticPendingPromptId,
  resolveChatQueueActionPresentation,
  type AgentPlan,
  type PendingPromptState,
  type PromptQueueInterruption,
  type SendInNewChatQueueAction,
} from '@drone/assistant-chat';
import {
  mobileMessageAsapFollowUps,
  type MobileAsapFollowUp,
} from '../local-assistant/mobile-asap-follow-ups';

export type MobileDronePendingPrompt = {
  id: string;
  prompt: string;
  status: 'queued' | 'pending' | 'stopped' | 'failed';
  error: string | null;
  attachmentCount?: number;
  imageCount: number;
  cancelable: boolean;
  startedAt?: string;
  deliveryMode?: 'queue' | 'asap';
  asapFollowUps?: MobileAsapFollowUp[];
  agentPlan?: AgentPlan;
  delivered?: boolean;
  queueInterruption?: PromptQueueInterruption;
  action?: SendInNewChatQueueAction;
};

export type MobileOptimisticPendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  state: PendingPromptState;
  attachmentCount?: number;
  imageCount: number;
  deliveryMode?: 'queue' | 'asap';
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
  deliveryMode?: 'queue' | 'asap';
}): MobileOptimisticPendingPrompt {
  const attachmentCount = positiveCount(input.attachmentCount ?? input.imageCount);
  return {
    id: input.id,
    at: input.at ?? new Date().toISOString(),
    prompt: input.prompt,
    state: input.state ?? 'sending',
    ...(attachmentCount > 0 ? { attachmentCount } : {}),
    imageCount: positiveCount(input.imageCount),
    ...(input.deliveryMode ? { deliveryMode: input.deliveryMode } : {}),
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
  const local = (Array.isArray(input.localPrompts) ? input.localPrompts : []).filter(
    (prompt: any) => prompt?.optimisticSent === true,
  );
  const nowMs = input.nowMs ?? Date.now();
  const merged = mergeOptimisticPendingPrompts<any>({
    serverPrompts: server,
    optimisticPrompts: local,
    nowMs,
    optimisticGraceMs: OPTIMISTIC_PENDING_GRACE_MS,
    mergeMatched: ({ optimisticPrompt, serverPrompt, state }) => ({
      ...optimisticPrompt,
      ...serverPrompt,
      state: String(serverPrompt?.state ?? '').trim() === 'running' ? 'sending' : state,
      optimisticSent: true,
    }),
  });
  return filterCompletedPendingPrompts(merged.filter(Boolean), input.turns);
}

export function confirmOptimisticMobilePendingPrompt(
  prompts: any[],
  input: {
    optimisticId: string;
    confirmedId: string;
    state: PendingPromptState;
  },
): any[] {
  const optimisticId = String(input.optimisticId ?? '').trim();
  const replaced = replaceOptimisticPendingPromptId(prompts, optimisticId, input.confirmedId);
  return replaced.map((prompt, index) =>
    String(prompts[index]?.id ?? '').trim() === optimisticId
      ? {
          ...prompt,
          state: input.state,
          optimisticSent: true,
        }
      : prompt,
  );
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

export function hasActiveMobileDronePendingPrompt(raw: unknown, turnsRaw: unknown): boolean {
  const agentPrompts = (Array.isArray(raw) ? raw : []).filter(
    (prompt: any) =>
      resolveChatQueueActionPresentation(prompt?.action, String(prompt?.state ?? ''))
        ?.countsAsAgentRun ?? true,
  );
  return hasActivePendingPrompt(agentPrompts, turnsRaw);
}

export function latestActiveMobileAgentPrompt<
  T extends { status: string; action?: SendInNewChatQueueAction },
>(prompts: T[]): T | undefined {
  return [...prompts]
    .reverse()
    .find(
      (prompt) =>
        prompt.status === 'pending' &&
        (resolveChatQueueActionPresentation(prompt.action, prompt.status)?.countsAsAgentRun ??
          true),
    );
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
  const completedIds = completedTurnIds(turnsRaw);
  const transcriptMessageIds = new Set(
    (Array.isArray(messagesRaw) ? messagesRaw : [])
      .map((message: any) => String(message?.id ?? '').trim())
      .filter(Boolean),
  );
  for (const message of Array.isArray(messagesRaw) ? messagesRaw : []) {
    for (const followUp of mobileMessageAsapFollowUps(message)) {
      transcriptMessageIds.add(followUp.id);
    }
  }
  const prompts = (Array.isArray(raw) ? raw : []).flatMap((item: any) => {
    const id = String(item?.id ?? '').trim();
    const state = String(item?.state ?? 'queued');
    if (!id || !['queued', 'sending', 'sent', 'failed'].includes(state)) return [];
    // The Hub deliberately retains recently completed pending rows for reconciliation. Once the
    // matching transcript turn is visible, rendering that row again would duplicate the prompt.
    if (state !== 'failed' && completedIds.has(id)) return [];
    if (state !== 'failed' && transcriptMessageIds.has(id)) return [];
    const activity = normalizeAgentRunActivity(item?.activity);
    const stopped = state === 'failed' && isStoppedRunError(item?.error);
    const queueInterruption = normalizePromptQueueInterruption(item?.queueInterruption);
    const blockedByInterruption = promptQueueInterruptionBlocks(queueInterruption);
    if (
      activity &&
      (state === 'sending' ||
        state === 'sent' ||
        (state === 'failed' && !stopped && !blockedByInterruption))
    ) {
      return [];
    }
    const messageId = String(item?.messageId ?? '').trim();
    const delivered =
      (stopped || blockedByInterruption) &&
      (Boolean(activity) ||
        completedIds.has(id) ||
        transcriptMessageIds.has(id) ||
        Boolean(messageId && transcriptMessageIds.has(messageId)));
    const agentPlan = normalizeAgentPlan(item?.agentPlan);
    const startedAt = String(item?.startedAt ?? item?.at ?? item?.createdAt ?? '').trim();
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
        ...(item?.deliveryMode === 'asap' || item?.deliveryMode === 'queue'
          ? { deliveryMode: item.deliveryMode }
          : {}),
        ...(isSendInNewChatQueueAction(item?.action) ? { action: item.action } : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(agentPlan ? { agentPlan } : {}),
        ...(delivered ? { delivered: true } : {}),
        ...(queueInterruption ? { queueInterruption } : {}),
      } satisfies MobileDronePendingPrompt,
    ];
  });
  const grouped: MobileDronePendingPrompt[] = [];
  for (const prompt of prompts) {
    let owner: MobileDronePendingPrompt | undefined;
    if (prompt.deliveryMode === 'asap' && prompt.status === 'pending' && !prompt.action) {
      for (let index = grouped.length - 1; index >= 0; index -= 1) {
        const candidate = grouped[index]!;
        if (
          candidate.status === 'pending' &&
          candidate.deliveryMode !== 'asap' &&
          !candidate.action &&
          !isEventNotificationPrompt(candidate.prompt)
        ) {
          owner = candidate;
          break;
        }
      }
    }
    if (!owner) {
      grouped.push(prompt);
      continue;
    }
    owner.asapFollowUps = [
      ...(owner.asapFollowUps ?? []),
      {
        id: prompt.id,
        prompt: prompt.prompt,
        ...(prompt.startedAt ? { at: prompt.startedAt } : {}),
        ...(prompt.attachmentCount
          ? { attachmentCount: prompt.attachmentCount }
          : prompt.imageCount > 0
            ? { attachmentCount: prompt.imageCount }
            : {}),
      },
    ];
  }
  return grouped;
}
