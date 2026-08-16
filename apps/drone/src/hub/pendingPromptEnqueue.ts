import type { PendingPromptState } from '@drone/assistant-chat';

export type BuiltinTranscriptAgentId = 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' | 'blip';

export type { PendingPromptState } from '@drone/assistant-chat';

const FAILED_PROMPT_RETRY_WINDOW_MS = 10 * 60_000;

function parseTimestampMs(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function looksLikeTerminalFailedPromptError(raw: unknown): boolean {
  const msg = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('access token could not be refreshed') ||
    msg.includes('refresh token was already used') ||
    msg.includes('please log out and sign in again') ||
    msg.includes('authentication failed') ||
    msg.includes('unauthorized')
  );
}

export function looksLikeTransientPromptEnqueueError(raw: unknown): boolean {
  const msg = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!msg) return false;
  if (looksLikeTerminalFailedPromptError(msg)) return false;
  return (
    msg.includes('prompt enqueue failed') ||
    msg.includes('queued prompt enqueue failed') ||
    msg.includes('timed out after') ||
    msg.includes('request timeout after') ||
    msg.includes('timed out acquiring registry lock') ||
    msg.includes('drone daemon not ready') ||
    msg.includes('drone daemon not reachable') ||
    msg.includes('daemon unavailable') ||
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('connection terminated') ||
    msg.includes('failed to connect')
  );
}

function looksLikeRecoverableTranscriptParseFailure(raw: unknown): boolean {
  const msg = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!msg) return false;
  return (
    (msg.includes('finished but no') && msg.includes('message was parsed')) ||
    msg.includes('prompt wrapper ended without writing an exit code') ||
    msg.includes('codex turn started but exited before producing a response')
  );
}

export function shouldRetryFailedPendingPrompt(opts: {
  error?: unknown;
  updatedAt?: string | null;
  at?: string | null;
  nowMs?: number;
}): boolean {
  if (looksLikeTerminalFailedPromptError(opts.error)) return false;
  if (!looksLikeRecoverableTranscriptParseFailure(opts.error)) return false;
  const tsMs = parseTimestampMs(opts.updatedAt ?? opts.at);
  if (!Number.isFinite(tsMs)) return true;
  const nowMs =
    typeof opts.nowMs === 'number' && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const ageMs = nowMs - Number(tsMs);
  return !Number.isFinite(ageMs) || ageMs < 0 || ageMs <= FAILED_PROMPT_RETRY_WINDOW_MS;
}

type PendingPromptStalenessOpts = {
  state: PendingPromptState | string;
  updatedAt?: string | null;
  at?: string | null;
  enqueueTimeoutMs: number;
  nowMs?: number;
};

const MIN_SENDING_STALE_MS = 180_000;
const MIN_SENT_STALE_MS = 10 * 60_000;

/**
 * Returns the stale pending state when a prompt has been waiting too long to
 * reconcile from daemon job status lookups.
 */
export function stalePendingPromptState(
  opts: PendingPromptStalenessOpts,
): 'sending' | 'sent' | null {
  const state = String(opts.state ?? '').trim();
  if (state !== 'sending' && state !== 'sent') return null;
  const tsMs = parseTimestampMs(opts.updatedAt ?? opts.at);
  if (!Number.isFinite(tsMs)) return null;
  const nowMs =
    typeof opts.nowMs === 'number' && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const ageMs = nowMs - Number(tsMs);
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  const enqueueTimeoutMs = Number.isFinite(opts.enqueueTimeoutMs)
    ? Math.max(1, Math.floor(opts.enqueueTimeoutMs))
    : MIN_SENDING_STALE_MS;
  const staleAfterMs =
    state === 'sending'
      ? Math.max(enqueueTimeoutMs, MIN_SENDING_STALE_MS)
      : Math.max(enqueueTimeoutMs * 2, MIN_SENT_STALE_MS);
  return ageMs >= staleAfterMs ? state : null;
}
