import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { PermissionMode, ToolProfile } from '@blip/tools';
import type {
  BlipRuntimeEvent,
  BlipSessionState,
  BlipToolSuspension,
  BlipToolSuspensionStatus,
  TranscriptEntry,
} from './types.js';

export interface CreateSessionInput {
  provider: string;
  model: string;
  permissionMode: PermissionMode;
  toolProfile: ToolProfile;
  parentSessionId?: string;
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
  readMessages(session: BlipSessionState): Promise<AgentMessage[]>;
  readModelMessages(session: BlipSessionState): Promise<AgentMessage[]>;
  fork(source: BlipSessionState, input: ForkSessionInput): Promise<BlipSessionState>;
}
