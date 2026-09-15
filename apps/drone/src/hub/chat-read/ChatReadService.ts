import { pendingChatSummary, boundedTranscriptTurn } from './helpers/chat-read-presentation';
import {
  pendingChatMessages,
  readVisibleChatHistory,
  type ChatReadSnapshot,
} from './helpers/chat-read-model';

type ReadOptions = {
  droneRef: string;
  chatName: string;
  limit?: number;
  maxChars?: number;
  includeActivity?: boolean;
};
type SnapshotResult =
  | (ChatReadSnapshot & { ok: true })
  | { ok: false; statusCode: number; error: string };
type SnapshotReader = (input: {
  droneRef: string;
  chatName: string;
  selection: string;
  tailRaw: string;
  includeTranscript: boolean;
  includePending: boolean;
  excludeCompletedPending: true;
  maintenance: 'run';
  activityMode: 'summary' | 'full';
}) => Promise<SnapshotResult>;

/** One bounded, model-facing read contract; provider transcripts remain available separately. */
export class ChatReadService {
  constructor(private readonly readSnapshot: SnapshotReader) {}

  async read(input: ReadOptions) {
    const limit = bound(input.limit, 10, 20);
    const maxChars = bound(input.maxChars, 4000, 8000);
    const includeActivity = input.includeActivity === true;
    const snapshot = await this.readSnapshot({
      droneRef: input.droneRef,
      chatName: input.chatName,
      selection: 'tail',
      tailRaw: String(limit),
      includeTranscript: true,
      includePending: true,
      excludeCompletedPending: true,
      maintenance: 'run',
      activityMode: includeActivity ? 'full' : 'summary',
    });
    if (!snapshot.ok) return snapshot;
    const boundedHistory = readVisibleChatHistory(
      snapshot,
      snapshot.agent?.kind === 'native' ? limit * 2 : limit * 3,
      maxChars,
    );
    const turns = snapshot.transcripts
      .slice(-limit)
      .map((turn) => boundedTranscriptTurn(turn, maxChars, includeActivity));
    const messages = boundedHistory.messages.map((message) => {
      const turn = message.turnId ? turns.find((turn) => turn.id === message.turnId) : undefined;
      return {
        ...message,
        ...(turn
          ? {
              ...(turn.model ? { model: turn.model } : {}),
              ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
              ...(typeof turn.ok === 'boolean' ? { ok: turn.ok } : {}),
              ...(turn.activitySummary ? { activitySummary: turn.activitySummary } : {}),
              ...(turn.fileChangesSummary ? { fileChangesSummary: turn.fileChangesSummary } : {}),
              ...(turn.attachmentCount ? { attachmentCount: turn.attachmentCount } : {}),
            }
          : {}),
      };
    });
    return {
      ok: true as const,
      drone: input.droneRef,
      chat: snapshot.chat,
      chatId: snapshot.chatId ?? null,
      historyKind: 'messages' as const,
      messages,
      hasOlder: boundedHistory.hasOlder,
      ...pendingChatSummary(
        { ...snapshot, pending: pendingChatMessages(snapshot) },
        limit,
        maxChars,
      ),
      limit,
      maxCharsPerField: maxChars,
      includeActivity,
      ...(includeActivity ? { turns } : {}),
    };
  }
}

function bound(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : fallback;
}
