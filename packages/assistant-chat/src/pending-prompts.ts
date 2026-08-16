export const PENDING_PROMPT_STATES = ['queued', 'sending', 'sent', 'failed'] as const;

export type PendingPromptState = (typeof PENDING_PROMPT_STATES)[number];

export type PendingPromptPriority = 'queue' | 'asap';

export type PendingPromptRecord = Record<string, unknown> & {
  id?: unknown;
  state?: unknown;
  at?: unknown;
};

export type PromptQueueInterruptionState =
  | 'blocked'
  | 'continuing'
  | 'continued'
  | 'skipped';

export type PromptQueueInterruption = {
  state: PromptQueueInterruptionState;
  at: string;
  resolvedAt?: string;
  recoveryPromptId?: string;
};

export type PromptQueueInterruptionResolution = 'skip';

export function normalizePromptQueueInterruptionResolution(
  raw: unknown,
): PromptQueueInterruptionResolution | undefined {
  return raw === 'skip' ? raw : undefined;
}

export function normalizePromptQueueInterruption(
  raw: unknown,
): PromptQueueInterruption | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const state = String((raw as any).state ?? '') as PromptQueueInterruptionState;
  if (!['blocked', 'continuing', 'continued', 'skipped'].includes(state)) {
    return undefined;
  }
  const at = String((raw as any).at ?? '').trim();
  const resolvedAt = String((raw as any).resolvedAt ?? '').trim();
  const recoveryPromptId = String((raw as any).recoveryPromptId ?? '').trim();
  return {
    state,
    at,
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(recoveryPromptId ? { recoveryPromptId } : {}),
  };
}

export function promptQueueInterruptionBlocks(raw: unknown): boolean {
  const state = normalizePromptQueueInterruption(raw)?.state;
  return state === 'blocked' || state === 'continuing';
}

export type CompletedTurnRecord = {
  id?: unknown;
};

export type MergeOptimisticPendingPromptsInput<T extends PendingPromptRecord> = {
  serverPrompts: readonly T[];
  optimisticPrompts: readonly T[];
  nowMs: number;
  optimisticGraceMs?: number;
  mergeMatched?: (input: {
    optimisticPrompt: T;
    serverPrompt: T;
    state: PendingPromptState;
  }) => T;
};

const ACTIVE_PENDING_PROMPT_STATES: ReadonlySet<PendingPromptState> = new Set([
  'sending',
  'sent',
]);

const TERMINAL_PENDING_PROMPT_STATES: ReadonlySet<PendingPromptState> = new Set([
  'failed',
]);

export function normalizePendingPromptState(
  raw: unknown,
  fallback: PendingPromptState = 'sending',
): PendingPromptState {
  const state = String(raw ?? '').trim();
  if (isPendingPromptState(state)) return state;
  return isPendingPromptState(fallback) ? fallback : 'sending';
}

export function isActivePendingPromptState(raw: unknown): boolean {
  return ACTIVE_PENDING_PROMPT_STATES.has(String(raw ?? '').trim() as PendingPromptState);
}

export function isTerminalPendingPromptState(raw: unknown): boolean {
  return TERMINAL_PENDING_PROMPT_STATES.has(String(raw ?? '').trim() as PendingPromptState);
}

export function isActivePendingPrompt(promptRaw: unknown): boolean {
  return isActivePendingPromptState(
    (promptRaw as PendingPromptRecord | null)?.state,
  );
}

export function isTerminalPendingPrompt(promptRaw: unknown): boolean {
  return isTerminalPendingPromptState(
    (promptRaw as PendingPromptRecord | null)?.state,
  );
}

export function completedTurnIds(turnsRaw: unknown): Set<string> {
  return new Set(
    (Array.isArray(turnsRaw) ? turnsRaw : [])
      .map((turn: CompletedTurnRecord) => normalizedId(turn?.id))
      .filter(Boolean),
  );
}

export function pendingPromptMatchesCompletedTurn(
  promptRaw: unknown,
  turnRaw: unknown,
): boolean {
  const promptId = normalizedId((promptRaw as PendingPromptRecord | null)?.id);
  const turnId = normalizedId((turnRaw as CompletedTurnRecord | null)?.id);
  return Boolean(promptId && turnId && promptId === turnId);
}

export function pendingPromptHasCompletedTurn(
  promptRaw: unknown,
  completedIds: ReadonlySet<string>,
): boolean {
  const promptId = normalizedId((promptRaw as PendingPromptRecord | null)?.id);
  return Boolean(promptId && completedIds.has(promptId));
}

export function hasActivePendingPrompt(
  promptsRaw: unknown,
  turnsRaw: unknown,
): boolean {
  return hasBlockingPendingPrompt(promptsRaw, turnsRaw, 'asap');
}

export function hasBlockingPendingPrompt(
  promptsRaw: unknown,
  turnsRaw: unknown,
  priority: PendingPromptPriority = 'queue',
): boolean {
  const completedIds = completedTurnIds(turnsRaw);
  return (Array.isArray(promptsRaw) ? promptsRaw : []).some((prompt: PendingPromptRecord) => {
    const id = normalizedId(prompt?.id);
    if (!id || completedIds.has(id)) return false;
    return priority === 'asap'
      ? isActivePendingPrompt(prompt)
      : !isTerminalPendingPrompt(prompt);
  });
}

export function filterCompletedPendingPrompts<T extends PendingPromptRecord>(
  prompts: readonly T[],
  turnsRaw: unknown,
  opts: { keepTerminal?: boolean } = {},
): T[] {
  const completedIds = completedTurnIds(turnsRaw);
  if (completedIds.size === 0) return prompts.slice();
  const keepTerminal = opts.keepTerminal !== false;
  return prompts.filter(
    (prompt) =>
      (keepTerminal && isTerminalPendingPrompt(prompt)) ||
      !pendingPromptHasCompletedTurn(prompt, completedIds),
  );
}

export function replaceOptimisticPendingPromptId<T extends PendingPromptRecord>(
  prompts: T[],
  optimisticIdRaw: unknown,
  confirmedIdRaw: unknown,
): T[] {
  const optimisticId = normalizedId(optimisticIdRaw);
  const confirmedId = normalizedId(confirmedIdRaw);
  if (!optimisticId || !confirmedId || optimisticId === confirmedId) return prompts;

  let changed = false;
  const next = prompts.map((prompt) => {
    if (normalizedId(prompt?.id) !== optimisticId) return prompt;
    changed = true;
    return { ...prompt, id: confirmedId };
  });
  return changed ? next : prompts;
}

export function reconcileOptimisticPendingPromptState(input: {
  optimisticState: unknown;
  serverState: unknown;
}): PendingPromptState {
  const optimisticState = normalizePendingPromptState(input.optimisticState);
  const serverState = normalizePendingPromptState(input.serverState, optimisticState);
  if (optimisticState === 'sending' && serverState === 'queued') return 'sending';
  return serverState;
}

export function mergeOptimisticPendingPrompts<T extends PendingPromptRecord>(
  input: MergeOptimisticPendingPromptsInput<T>,
): T[] {
  const optimisticById = new Map<string, T>();
  for (const prompt of input.optimisticPrompts) {
    const id = normalizedId(prompt?.id);
    if (id) optimisticById.set(id, prompt);
  }

  const server: T[] = [];
  const serverIndexById = new Map<string, number>();
  for (const prompt of input.serverPrompts) {
    const id = normalizedId(prompt?.id);
    if (!id) continue;
    const existingIndex = serverIndexById.get(id);
    if (existingIndex !== undefined) {
      server[existingIndex] = prompt;
      continue;
    }
    serverIndexById.set(id, server.length);
    server.push(prompt);
  }

  const merged: T[] = [];
  for (const serverPrompt of server) {
    const id = normalizedId(serverPrompt?.id);
    const optimisticPrompt = id ? optimisticById.get(id) : undefined;
    if (!optimisticPrompt) {
      merged.push(serverPrompt);
      continue;
    }

    optimisticById.delete(id);
    const state = reconcileOptimisticPendingPromptState({
      optimisticState: optimisticPrompt.state,
      serverState: serverPrompt.state,
    });
    merged.push(
      input.mergeMatched
        ? input.mergeMatched({ optimisticPrompt, serverPrompt, state })
        : ({ ...optimisticPrompt, ...serverPrompt, state } as T),
    );
  }

  for (const optimisticPrompt of optimisticById.values()) {
    if (optimisticPromptExpired(optimisticPrompt, input)) continue;
    merged.push(optimisticPrompt);
  }

  return merged;
}

function isPendingPromptState(value: string): value is PendingPromptState {
  return (PENDING_PROMPT_STATES as readonly string[]).includes(value);
}

function normalizedId(raw: unknown): string {
  return String(raw ?? '').trim();
}

function optimisticPromptExpired<T extends PendingPromptRecord>(
  prompt: T,
  input: Pick<
    MergeOptimisticPendingPromptsInput<T>,
    'nowMs' | 'optimisticGraceMs'
  >,
): boolean {
  if (isTerminalPendingPrompt(prompt)) return false;
  if (
    typeof input.optimisticGraceMs !== 'number' ||
    !Number.isFinite(input.optimisticGraceMs) ||
    input.optimisticGraceMs < 0 ||
    !Number.isFinite(input.nowMs)
  ) {
    return false;
  }
  const submittedAtMs = Date.parse(String(prompt.at ?? ''));
  return (
    Number.isFinite(submittedAtMs) &&
    input.nowMs - submittedAtMs > input.optimisticGraceMs
  );
}
