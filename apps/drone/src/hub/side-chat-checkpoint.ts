import {
  normalizeProviderMessageCheckpoint,
  type ProviderMessageCheckpoint,
} from './provider-message-checkpoint';

export type SideChatOrigin = {
  sourceChatName: string;
  checkpointId: string;
};

export function isSideChatEntry(entry: unknown): boolean {
  return (entry as any)?.visibility === 'side-chat';
}

/** Capture a stable, inclusive boundary, never the live tail of a conversation. */
export function completedChatCheckpoint(
  source: any,
  requestedId?: string,
): {
  turns: any[];
  checkpointId: string;
  codexTurnId?: string;
  providerCheckpoint?: ProviderMessageCheckpoint;
} {
  const turns: any[] = Array.isArray(source?.turns) ? source.turns : [];
  if (requestedId) {
    const index = turns.findIndex((turn) => turn.id === requestedId);
    const turn = turns[index];
    if (!turn?.ok || turn.userOnly || turn.silentCompletion || !String(turn.output ?? '').trim()) {
      throw new Error('The requested completed assistant checkpoint is no longer available');
    }
    return {
      turns: structuredClone(turns.slice(0, index + 1)),
      checkpointId: requestedId,
      ...(turn.codexTurnId ? { codexTurnId: turn.codexTurnId } : {}),
      ...(normalizeProviderMessageCheckpoint(turn.providerCheckpoint)
        ? { providerCheckpoint: normalizeProviderMessageCheckpoint(turn.providerCheckpoint) }
        : {}),
    };
  }
  let index = turns.length - 1;
  while (index >= 0) {
    const turn = turns[index];
    if (
      turn?.id &&
      turn.ok &&
      !turn.userOnly &&
      !turn.silentCompletion &&
      String(turn.output ?? '').trim()
    )
      break;
    index -= 1;
  }
  if (index < 0) throw new Error('No completed assistant answer to branch from yet');
  const turn = turns[index];
  return {
    turns: structuredClone(turns.slice(0, index + 1)),
    checkpointId: turn.id,
    ...(turn.codexTurnId ? { codexTurnId: turn.codexTurnId } : {}),
    ...(normalizeProviderMessageCheckpoint(turn.providerCheckpoint)
      ? { providerCheckpoint: normalizeProviderMessageCheckpoint(turn.providerCheckpoint) }
      : {}),
  };
}
