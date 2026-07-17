import { MESH_CHAT_PAYLOAD_BYTES } from '@drone/device-protocol';

const MAX_TURNS_PER_PAGE = 40;
const MAX_TURN_TEXT_BYTES = 24 * 1024;

function truncateUtf8(value: unknown, maxBytes: number): { value: string; truncated: boolean } {
  const source = String(value ?? '');
  const bytes = Buffer.from(source);
  if (bytes.length <= maxBytes) return { value: source, truncated: false };
  return {
    value: `${bytes
      .subarray(0, Math.max(0, maxBytes - 3))
      .toString('utf8')
      .replace(/\uFFFD+$/u, '')}…`,
    truncated: true,
  };
}

function compactAttachments(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((attachment: any) => ({
    name: String(attachment?.name ?? attachment?.fileName ?? '').slice(0, 240),
    mime: String(attachment?.mime ?? attachment?.mimeType ?? 'file').slice(0, 120),
    size: Number.isFinite(Number(attachment?.size)) ? Number(attachment.size) : null,
  }));
}

function compactTurn(turn: any, sourceIndex: number): Record<string, unknown> {
  const prompt = truncateUtf8(turn?.prompt, MAX_TURN_TEXT_BYTES);
  const output = truncateUtf8(turn?.output, MAX_TURN_TEXT_BYTES);
  const error = truncateUtf8(turn?.error, 4 * 1024);
  const meshTruncated = prompt.truncated || output.truncated || error.truncated;
  const turnNumber = Number.isFinite(Number(turn?.turn)) ? Number(turn.turn) : null;
  return {
    id:
      String(turn?.id ?? '').trim() ||
      (turnNumber !== null ? `turn-${turnNumber}` : `turn-${sourceIndex}`),
    turn: turnNumber,
    at: String(turn?.at ?? ''),
    promptAt: String(turn?.promptAt ?? ''),
    completedAt: String(turn?.completedAt ?? ''),
    prompt: prompt.value,
    output: output.value,
    error: error.value,
    ok: turn?.ok !== false,
    model: String(turn?.model ?? ''),
    reasoning: String(turn?.reasoning ?? ''),
    attachments: compactAttachments(turn?.attachments),
    ...(meshTruncated ? { meshTruncated: true } : {}),
  };
}

function beforeIndex(value: unknown, length: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed, length) : length;
}

export function boundedDroneChatPage(
  rawTurns: unknown,
  before?: unknown,
  maxBytes = MESH_CHAT_PAYLOAD_BYTES,
) {
  const source = Array.isArray(rawTurns) ? rawTurns : [];
  const end = beforeIndex(before, source.length);
  const candidateStart = Math.max(0, end - MAX_TURNS_PER_PAGE);
  const candidates = source
    .slice(candidateStart, end)
    .map((turn, index) => compactTurn(turn, candidateStart + index));
  const turns: Array<Record<string, unknown>> = [];
  let bytes = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const turn = candidates[index]!;
    const turnBytes = Buffer.byteLength(JSON.stringify(turn));
    if (turns.length > 0 && bytes + turnBytes > maxBytes) break;
    turns.unshift(turn);
    bytes += turnBytes;
  }
  const start = Math.max(0, end - turns.length);
  return {
    turns,
    page: {
      beforeCursor: start > 0 ? start : null,
      hasOlder: start > 0,
      responseTruncated: turns.length < end,
      contentTruncated: turns.some((turn) => turn.meshTruncated === true),
    },
  };
}
