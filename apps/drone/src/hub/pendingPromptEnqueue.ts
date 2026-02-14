export type BuiltinTranscriptAgentId = 'cursor' | 'codex' | 'claude' | 'opencode';

export type PendingPromptState = 'queued' | 'sending' | 'sent' | 'failed';

export type PendingPromptLike = {
  id: string;
  state: PendingPromptState | string;
};

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

