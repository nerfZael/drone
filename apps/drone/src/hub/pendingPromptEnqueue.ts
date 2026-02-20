export type BuiltinTranscriptAgentId = 'cursor' | 'codex' | 'claude' | 'opencode';

export type PendingPromptState = 'queued' | 'sending' | 'sent' | 'failed';

export type PendingPromptLike = {
  id: string;
  state: PendingPromptState | string;
};

type PendingPromptStalenessOpts = {
  state: PendingPromptState | string;
  updatedAt?: string | null;
  at?: string | null;
  enqueueTimeoutMs: number;
  nowMs?: number;
};

const MIN_SENDING_STALE_MS = 180_000;
const MIN_SENT_STALE_MS = 10 * 60_000;

function parseTimestampMs(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Returns the stale pending state when a prompt has been waiting too long to
 * reconcile from daemon job status lookups.
 */
export function stalePendingPromptState(opts: PendingPromptStalenessOpts): 'sending' | 'sent' | null {
  const state = String(opts.state ?? '').trim();
  if (state !== 'sending' && state !== 'sent') return null;
  const tsMs = parseTimestampMs(opts.updatedAt ?? opts.at);
  if (!Number.isFinite(tsMs)) return null;
  const nowMs = typeof opts.nowMs === 'number' && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const ageMs = nowMs - Number(tsMs);
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  const enqueueTimeoutMs = Number.isFinite(opts.enqueueTimeoutMs) ? Math.max(1, Math.floor(opts.enqueueTimeoutMs)) : MIN_SENDING_STALE_MS;
  const staleAfterMs =
    state === 'sending'
      ? Math.max(enqueueTimeoutMs, MIN_SENDING_STALE_MS)
      : Math.max(enqueueTimeoutMs * 2, MIN_SENT_STALE_MS);
  return ageMs >= staleAfterMs ? state : null;
}

/**
 * For agents whose continuation/session identifier is only discoverable after the first turn
 * completes (notably Codex thread ids and OpenCode session ids), we must avoid enqueuing
 * follow-up queued prompts that would otherwise start a brand new session.
 *
 * If a prior prompt is already enqueued/running (state: sent/sending) and the session is not
 * yet known, defer the new prompt until the session id is available (or the prior prompt fails).
 */
export function shouldDeferQueuedTranscriptPrompt(opts: {
  agentId: BuiltinTranscriptAgentId;
  sessionKnown: boolean;
  priorPendingPrompts: PendingPromptLike[];
  transcriptDoneIds?: Set<string>;
}): boolean {
  const done = opts.transcriptDoneIds ?? new Set<string>();
  const agent = opts.agentId;
  if (agent !== 'codex' && agent !== 'opencode') return false;
  if (opts.sessionKnown) return false;

  // If any earlier prompt is already enqueued in the daemon (sent/sending) and not yet
  // present in the transcript, a follow-up prompt would start a new underlying session.
  for (const p of opts.priorPendingPrompts ?? []) {
    const id = String(p?.id ?? '').trim();
    if (!id) continue;
    if (done.has(id)) continue;
    const st = String(p?.state ?? '').trim();
    if (st === 'failed') continue;
    if (st === 'sent' || st === 'sending') return true;
  }
  return false;
}
