import {
  normalizeMobileAgentPlan,
  type MobileAgentPlan,
} from '../local-assistant/mobile-transcript-runs';

export type MobileDronePendingPrompt = {
  id: string;
  prompt: string;
  status: 'queued' | 'pending' | 'failed';
  error: string | null;
  imageCount: number;
  cancelable: boolean;
  startedAt?: string;
  agentPlan?: MobileAgentPlan;
};

export type MobileOptimisticPendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  state: 'sending' | 'failed';
  imageCount: number;
  error?: string;
  optimisticSent: true;
};

const OPTIMISTIC_PENDING_GRACE_MS = 10_000;

export function optimisticMobilePendingPrompt(input: {
  id: string;
  prompt: string;
  imageCount?: number;
  at?: string;
}): MobileOptimisticPendingPrompt {
  return {
    id: input.id,
    at: input.at ?? new Date().toISOString(),
    prompt: input.prompt,
    state: 'sending',
    imageCount: Math.max(0, input.imageCount ?? 0),
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
    return {
      ...optimistic,
      ...prompt,
      state: prompt?.state === 'failed' ? 'failed' : 'sending',
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

export function mobileDronePendingPrompts(
  raw: unknown,
  turnsRaw: unknown,
): MobileDronePendingPrompt[] {
  const completedTurnIds = new Set(
    (Array.isArray(turnsRaw) ? turnsRaw : [])
      .map((turn: any) => String(turn?.id ?? '').trim())
      .filter(Boolean),
  );
  return (Array.isArray(raw) ? raw : []).flatMap((item: any) => {
    const id = String(item?.id ?? '').trim();
    const state = String(item?.state ?? 'queued');
    if (!id || !['queued', 'sending', 'sent', 'failed'].includes(state)) return [];
    // The Hub deliberately retains recently completed pending rows for reconciliation. Once the
    // matching transcript turn is visible, rendering that row again would duplicate the prompt.
    if (state !== 'failed' && completedTurnIds.has(id)) return [];
    const agentPlan = normalizeMobileAgentPlan(item?.agentPlan);
    return [
      {
        id,
        prompt: String(item?.prompt ?? ''),
        status: state === 'failed' ? 'failed' : state === 'queued' ? 'queued' : 'pending',
        error: item?.error ? String(item.error) : null,
        imageCount: Math.max(
          0,
          Number(
            item?.imageCount ?? (Array.isArray(item?.attachments) ? item.attachments.length : 0),
          ) || 0,
        ),
        cancelable: state === 'queued',
        ...(String(item?.at ?? '').trim() ? { startedAt: String(item.at).trim() } : {}),
        ...(agentPlan ? { agentPlan } : {}),
      } satisfies MobileDronePendingPrompt,
    ];
  });
}
