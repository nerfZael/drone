import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { PermissionMode, ToolProfile } from '@blip/tools';
import type {
  BlipRuntimeEvent,
  BlipSessionState,
  BlipToolSuspension,
  BlipToolSuspensionStatus,
  TranscriptEntry,
} from './types.js';

/**
 * The identity a session's provider prompt cache knows it by. A copy goes by its original's, so the history they share
 * is found in the cache; copies made before copies kept one go by their parent's.
 */
export function sessionCacheKey(session: Pick<BlipSessionState, 'id' | 'cacheKey' | 'parentSessionId'>): string {
  return session.cacheKey ?? session.parentSessionId ?? session.id;
}

export interface CreateSessionInput {
  provider: string;
  model: string;
  permissionMode: PermissionMode;
  toolProfile: ToolProfile;
  parentSessionId?: string;
  cacheKey?: string;
  forkedFromEntryId?: string;
  transcriptSeed?: TranscriptEntry[];
}

export interface ForkSessionInput {
  provider: string;
  model: string;
  permissionMode: PermissionMode;
  toolProfile: ToolProfile;
}

/** Persistence boundary used by the Blip runtime. Implementations must preserve append order. */
export interface SessionRepository {
  create(input: CreateSessionInput): Promise<BlipSessionState>;
  save(session: BlipSessionState): Promise<void>;
  delete(sessionId: string): Promise<void>;
  load(sessionId: string): Promise<BlipSessionState>;
  list(): Promise<BlipSessionState[]>;
  latest(): Promise<BlipSessionState | undefined>;
  appendEntry(session: BlipSessionState, entry: TranscriptEntry): Promise<void>;
  appendMessage(session: BlipSessionState, message: AgentMessage): Promise<void>;
  appendRuntimeEvent(session: BlipSessionState, event: BlipRuntimeEvent): Promise<void>;
  appendToolSuspension(session: BlipSessionState, suspension: BlipToolSuspension): Promise<void>;
  transitionToolSuspension(
    session: BlipSessionState,
    suspension: BlipToolSuspension,
    expectedStatuses: BlipToolSuspensionStatus[],
  ): Promise<boolean>;
  readToolSuspensions(session: BlipSessionState): Promise<BlipToolSuspension[]>;
  readTranscript(session: BlipSessionState): Promise<TranscriptEntry[]>;
  /** Latest checkpoint, retained tail and pinned user instruction, then subsequent messages.
   * Preserve transcript order; fall back to all messages if any retained reference is invalid. */
  readActiveTranscript?(session: BlipSessionState): Promise<TranscriptEntry[]>;
  /** Retrieve an original result, including results preceding a compaction checkpoint. */
  readToolResult?(
    session: BlipSessionState,
    callId: string,
  ): Promise<Extract<AgentMessage, { role: 'toolResult' }> | undefined>;
  readMessages(session: BlipSessionState): Promise<AgentMessage[]>;
  readModelMessages(session: BlipSessionState): Promise<AgentMessage[]>;
  fork(source: BlipSessionState, input: ForkSessionInput): Promise<BlipSessionState>;
}
