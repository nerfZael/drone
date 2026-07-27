import {
  createPortableId,
  modelMessagesFromTranscript,
  toolSuspensionsFromTranscript,
  type BlipRuntimeEvent,
  type BlipSessionState,
  type BlipToolSuspension,
  type BlipToolSuspensionStatus,
  type CreateSessionInput,
  type ForkSessionInput,
  type SessionRepository,
  type TranscriptEntry,
} from '@blip/core';
import type { AgentMessage } from '@mariozechner/pi-agent-core/portable';
import type { AssistantMessage, ToolCall, Usage } from '@mariozechner/pi-ai/agent-core';
import type {
  LocalAssistantMessage,
  LocalAssistantThread,
  LocalBlipSessionSnapshot,
} from './local-assistant-types';
import { createMobileBlipSessionState } from './mobile-session-snapshot';

export type MobileSessionSnapshotWriter = (
  snapshot: LocalBlipSessionSnapshot,
  startIndex: number,
  appendedEntries: TranscriptEntry[],
) => Promise<void>;

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function timestamp(message: LocalAssistantMessage): number {
  const parsed = Date.parse(message.createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toAgentMessage(
  message: LocalAssistantMessage,
  provider: string,
  model: string,
): AgentMessage {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.content ?? '',
      timestamp: timestamp(message),
    } as AgentMessage;
  }
  if (message.role === 'toolResult') {
    const content = Array.isArray(message.content)
      ? message.content.filter((part) => part.type === 'text' || part.type === 'image')
      : [{ type: 'text' as const, text: String(message.content ?? '') }];
    return {
      role: 'toolResult',
      toolCallId: String(message.toolCallId ?? ''),
      toolName: String(message.toolName ?? ''),
      content,
      details: message.details,
      isError: message.isError === true,
      timestamp: timestamp(message),
    } as AgentMessage;
  }
  const content = Array.isArray(message.content)
    ? message.content
    : typeof message.content === 'string'
      ? [{ type: 'text' as const, text: message.content }]
      : [];
  const toolCalls = content.filter((part): part is ToolCall => part.type === 'toolCall');
  return {
    role: 'assistant',
    content,
    api: `mobile-${provider}`,
    provider,
    model,
    usage: EMPTY_USAGE,
    stopReason: message.errorMessage ? 'error' : toolCalls.length > 0 ? 'toolUse' : 'stop',
    errorMessage: message.errorMessage,
    timestamp: timestamp(message),
  } as AssistantMessage;
}

function toLocalMessage(message: AgentMessage, id = createPortableId()): LocalAssistantMessage {
  const createdAt = new Date(message.timestamp || Date.now()).toISOString();
  if (message.role === 'user') return { id, createdAt, role: 'user', content: message.content };
  if (message.role === 'toolResult') {
    return {
      id,
      createdAt,
      role: 'toolResult',
      content: message.content,
      toolName: message.toolName,
      toolCallId: message.toolCallId,
      isError: message.isError,
      details: message.details,
    };
  }
  return {
    id,
    createdAt,
    role: 'assistant',
    content: message.content,
    errorMessage: message.errorMessage,
  };
}

export class MobileSessionRepository implements SessionRepository {
  readonly state: BlipSessionState;
  private transcript: TranscriptEntry[];
  private persistedEntryCount: number;
  private visibleMessages: LocalAssistantMessage[];
  private deleted = false;

  private assertActive(): void {
    if (this.deleted) throw new Error(`mobile session was deleted: ${this.state.id}`);
  }

  constructor(
    thread: LocalAssistantThread,
    history: LocalAssistantMessage[],
    provider: string,
    private readonly onMessages: (messages: LocalAssistantMessage[]) => Promise<void>,
    snapshot: LocalBlipSessionSnapshot | null = null,
    private readonly onSnapshot: MobileSessionSnapshotWriter = async () => undefined,
    private readonly onDelete: () => Promise<void> = async () => undefined,
  ) {
    this.state = snapshot
      ? {
          ...snapshot.state,
          loadedSkills: [...snapshot.state.loadedSkills],
          changedFiles: [...snapshot.state.changedFiles],
          readFiles: [...snapshot.state.readFiles],
        }
      : createMobileBlipSessionState(thread, provider);
    this.transcript = snapshot
      ? [...snapshot.transcript]
      : history.map((message) => ({
          type: 'message' as const,
          id: message.id || createPortableId(),
          timestamp: message.createdAt,
          message: toAgentMessage(message, provider, thread.model),
        }));
    this.persistedEntryCount = snapshot?.transcript.length ?? 0;
    this.visibleMessages = this.projectVisibleMessages();
  }

  private async persist(): Promise<void> {
    this.assertActive();
    const snapshot: LocalBlipSessionSnapshot = {
      version: 1,
      state: { ...this.state },
      transcript: [...this.transcript],
    };
    const startIndex = this.persistedEntryCount;
    const appendedEntries = this.transcript.slice(startIndex);
    await this.onSnapshot(snapshot, startIndex, appendedEntries);
    this.persistedEntryCount = this.transcript.length;
  }

  private projectVisibleMessages(): LocalAssistantMessage[] {
    const messages: LocalAssistantMessage[] = [];
    for (let index = this.transcript.length - 1; index >= 0 && messages.length < 120; index -= 1) {
      const entry = this.transcript[index];
      if (entry.type === 'message') messages.push(toLocalMessage(entry.message, entry.id));
    }
    return messages.reverse();
  }

  async create(input: CreateSessionInput): Promise<BlipSessionState> {
    Object.assign(this.state, {
      modelProvider: input.provider,
      modelId: input.model,
      permissionMode: input.permissionMode,
      toolProfile: input.toolProfile,
    });
    if (input.transcriptSeed) {
      this.transcript = [...input.transcriptSeed];
      this.persistedEntryCount = 0;
      this.visibleMessages = this.projectVisibleMessages();
    }
    return this.state;
  }

  async save(session: BlipSessionState): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await this.persist();
  }

  async delete(sessionId: string): Promise<void> {
    if (sessionId !== this.state.id) throw new Error(`mobile session not found: ${sessionId}`);
    await this.onDelete();
    this.transcript = [];
    this.visibleMessages = [];
    this.persistedEntryCount = 0;
    this.deleted = true;
  }

  async load(sessionId: string): Promise<BlipSessionState> {
    this.assertActive();
    if (sessionId !== this.state.id) throw new Error(`mobile session not found: ${sessionId}`);
    return this.state;
  }

  async list(): Promise<BlipSessionState[]> {
    return this.deleted ? [] : [this.state];
  }

  async latest(): Promise<BlipSessionState | undefined> {
    return this.deleted ? undefined : this.state;
  }

  async appendEntry(_session: BlipSessionState, entry: TranscriptEntry): Promise<void> {
    this.assertActive();
    this.transcript.push(entry);
    if (entry.type === 'message') {
      this.visibleMessages.push(toLocalMessage(entry.message, entry.id));
      if (this.visibleMessages.length > 120) this.visibleMessages.shift();
    }
  }

  async appendMessage(session: BlipSessionState, message: AgentMessage): Promise<void> {
    await this.appendEntry(session, {
      type: 'message',
      id: createPortableId(),
      timestamp: new Date(message.timestamp || Date.now()).toISOString(),
      message,
    });
    await this.persist();
    await this.onMessages(this.localMessages());
  }

  async appendRuntimeEvent(session: BlipSessionState, event: BlipRuntimeEvent): Promise<void> {
    await this.appendEntry(session, {
      type: 'runtime_event',
      id: createPortableId(),
      timestamp: new Date().toISOString(),
      event,
    });
  }

  async appendToolSuspension(
    session: BlipSessionState,
    suspension: BlipToolSuspension,
  ): Promise<void> {
    await this.appendEntry(session, {
      type: 'tool_suspension',
      id: createPortableId(),
      timestamp: new Date().toISOString(),
      suspension,
    });
    await this.persist();
  }

  async transitionToolSuspension(
    session: BlipSessionState,
    suspension: BlipToolSuspension,
    expectedStatuses: BlipToolSuspensionStatus[],
  ): Promise<boolean> {
    const latest = toolSuspensionsFromTranscript(this.transcript).find(
      (candidate) => candidate.id === suspension.id,
    );
    if (!latest || !expectedStatuses.includes(latest.status)) return false;
    await this.appendToolSuspension(session, suspension);
    return true;
  }

  async readToolSuspensions(): Promise<BlipToolSuspension[]> {
    return toolSuspensionsFromTranscript(this.transcript);
  }

  async readTranscript(): Promise<TranscriptEntry[]> {
    return [...this.transcript];
  }

  async readMessages(): Promise<AgentMessage[]> {
    return this.transcript.flatMap((entry) => (entry.type === 'message' ? [entry.message] : []));
  }

  async readModelMessages(): Promise<AgentMessage[]> {
    return modelMessagesFromTranscript(this.transcript);
  }

  async fork(_source: BlipSessionState, input: ForkSessionInput): Promise<BlipSessionState> {
    void input;
    throw new Error('Forking a session requires a separate mobile thread repository');
  }

  localMessages(): LocalAssistantMessage[] {
    return [...this.visibleMessages];
  }

  async flush(): Promise<void> {
    await this.persist();
  }
}
