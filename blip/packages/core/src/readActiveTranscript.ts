import type { SessionRepository } from './session-repository.js';
import type { BlipSessionState, TranscriptEntry } from './types.js';

/** Older embedded repositories remain compatible through the full-history fallback. */
export function readActiveTranscript(
  repository: SessionRepository,
  session: BlipSessionState,
): Promise<TranscriptEntry[]> {
  return repository.readActiveTranscript?.(session) ?? repository.readTranscript(session);
}
