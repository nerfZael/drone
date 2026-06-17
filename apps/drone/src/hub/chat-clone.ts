import type { BuiltinTranscriptAgentId } from './pendingPromptEnqueue';

type TranscriptTurnLike = {
  at?: string;
  promptAt?: string;
  prompt?: string;
  ok?: boolean;
  output?: string;
  error?: string;
};

const CLONED_TRANSCRIPT_BOOTSTRAP_MAX_TURNS = 12;
const CLONED_TRANSCRIPT_BOOTSTRAP_MAX_CHARS = 24_000;
const CLONED_TRANSCRIPT_BOOTSTRAP_FIELD_MAX_CHARS = 4_000;

function transcriptTurnSortKey(raw: TranscriptTurnLike | null | undefined): number {
  const iso = String(raw?.promptAt ?? raw?.at ?? '').trim();
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export function cloneChatEntryForDroneClone(entryRaw: any): any {
  const cloned = entryRaw && typeof entryRaw === 'object' ? JSON.parse(JSON.stringify(entryRaw)) : {};
  if (Array.isArray(cloned.turns)) {
    cloned.turns = cloned.turns.map((turn: any) =>
      turn && typeof turn === 'object'
        ? {
            ...turn,
            inheritedFromClone: true,
          }
        : turn,
    );
  }
  delete cloned.pendingPrompts;
  return cloned;
}

function builtinChatNeedsTranscriptBootstrap(agentId: BuiltinTranscriptAgentId, entry: any): boolean {
  if (!entry || typeof entry !== 'object') return false;
  if (agentId === 'cursor') return !String(entry?.chatId ?? '').trim();
  if (agentId === 'codex') return !String(entry?.codexThreadId ?? '').trim();
  if (agentId === 'claude') return !String(entry?.claudeSessionId ?? '').trim();
  if (agentId === 'opencode') return !String(entry?.openCodeSessionId ?? '').trim();
  if (agentId === 'pi') return !String(entry?.piSessionId ?? '').trim();
  if (agentId === 'blip') return !String(entry?.blipSessionId ?? '').trim();
  return false;
}

function trimTranscriptBootstrapField(raw: unknown, maxChars = CLONED_TRANSCRIPT_BOOTSTRAP_FIELD_MAX_CHARS): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 15)).trimEnd()}\n...[truncated]`;
}

function renderTranscriptBootstrapTurn(turn: TranscriptTurnLike): string {
  const prompt = trimTranscriptBootstrapField(turn?.prompt);
  const output = trimTranscriptBootstrapField(turn?.output ?? '');
  const error = trimTranscriptBootstrapField(turn?.error ?? '');
  const assistantLabel = turn?.ok === false ? 'Assistant error' : 'Assistant';
  const assistantBody = output || error || (turn?.ok === false ? '(failed without output)' : '(no output)');
  return ['User:', prompt || '(empty)', '', `${assistantLabel}:`, assistantBody].join('\n');
}

export function maybeBootstrapPromptFromTranscript(opts: {
  agentId: BuiltinTranscriptAgentId;
  prompt: string;
  chatEntry: any;
  maxTurns?: number;
  maxChars?: number;
}): string {
  const prompt = String(opts.prompt ?? '').trim();
  if (!prompt) return prompt;
  if (!builtinChatNeedsTranscriptBootstrap(opts.agentId, opts.chatEntry)) return prompt;
  const turnsRaw = Array.isArray(opts.chatEntry?.turns) ? (opts.chatEntry.turns as TranscriptTurnLike[]) : [];
  if (turnsRaw.length === 0) return prompt;

  const ordered = turnsRaw
    .filter((turn) => turn && typeof turn === 'object' && (String(turn.prompt ?? '').trim() || String(turn.output ?? '').trim() || String(turn.error ?? '').trim()))
    .map((turn, idx) => ({ turn, idx }))
    .sort((a, b) => {
      const diff = transcriptTurnSortKey(a.turn) - transcriptTurnSortKey(b.turn);
      return diff !== 0 ? diff : a.idx - b.idx;
    })
    .map((item) => item.turn);
  if (ordered.length === 0) return prompt;

  const maxTurns = Math.max(1, Math.floor(opts.maxTurns ?? CLONED_TRANSCRIPT_BOOTSTRAP_MAX_TURNS));
  const maxChars = Math.max(2_000, Math.floor(opts.maxChars ?? CLONED_TRANSCRIPT_BOOTSTRAP_MAX_CHARS));
  const selected: string[] = [];
  let used = 0;
  for (let idx = ordered.length - 1; idx >= 0; idx -= 1) {
    if (selected.length >= maxTurns) break;
    const rendered = renderTranscriptBootstrapTurn(ordered[idx] as TranscriptTurnLike);
    if (!rendered.trim()) continue;
    if (selected.length > 0 && used + rendered.length > maxChars) break;
    if (selected.length === 0 && rendered.length > maxChars) {
      selected.unshift(trimTranscriptBootstrapField(rendered, maxChars));
      used = selected[0].length;
      break;
    }
    selected.unshift(rendered);
    used += rendered.length;
  }
  if (selected.length === 0) return prompt;

  const omitted = Math.max(0, ordered.length - selected.length);
  const transcriptBlock = selected.map((chunk, idx) => `Turn ${omitted + idx + 1}:\n${chunk}`).join('\n\n');
  const intro = [
    'You are continuing a chat in a new session.',
    'Treat the transcript below as prior conversation context and continue naturally from it.',
    omitted > 0 ? `Only the most recent ${selected.length} of ${ordered.length} prior turns are included.` : 'All prior turns are included below.',
  ].join('\n');
  return [intro, '', 'Prior transcript:', transcriptBlock, '', 'New user message:', prompt].join('\n');
}
