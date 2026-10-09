/** Longest single chat message any model-facing read returns. Long reviews run past 14k chars. */
export const CHAT_MESSAGE_MAX_CHARS = 40_000;
/** Shared budget for one read_chat result; per-message caps shrink as the turn limit grows. */
export const CHAT_READ_TOTAL_CHARS = 80_000;
export const CHAT_READ_DEFAULT_CHARS = 4_000;
/** Idle notifications carry a preview only; the subscriber reads the chat for the full reply. */
export const CHAT_IDLE_PREVIEW_CHARS = 2_000;

/** Per-message cap for a read of `limit` turns, never below the default. */
export function chatReadMaxChars(requested: unknown, limit: number): number {
  const n = Number(requested);
  const wanted = Number.isFinite(n) && n >= 1 ? Math.floor(n) : CHAT_READ_DEFAULT_CHARS;
  const budget = Math.max(CHAT_READ_DEFAULT_CHARS, Math.floor(CHAT_READ_TOTAL_CHARS / Math.max(1, limit)));
  return Math.min(wanted, budget, CHAT_MESSAGE_MAX_CHARS);
}
