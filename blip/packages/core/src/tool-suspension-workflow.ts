import type { AgentMessage } from '@mariozechner/pi-agent-core/portable';
import type { ToolResultMessage } from '@mariozechner/pi-ai/agent-core';
import { createPortableId } from './platform.js';
import type { SessionRepository } from './session-repository.js';
import { isTerminalToolSuspension } from './tool-suspension.js';
import type { BlipRuntimeEvent, BlipSessionState, BlipToolSuspension } from './types.js';

type ToolResolutionStatus = 'completed' | 'denied' | 'failed';

type ToolSuspensionWorkflowOptions = {
  state: BlipSessionState;
  repository: SessionRepository;
  emit: (event: BlipRuntimeEvent) => Promise<void>;
  activeTurnId: () => string | undefined;
};

function nowIso(): string {
  return new Date().toISOString();
}

function eventBase(
  sessionId: string,
  turnId?: string,
): Pick<BlipRuntimeEvent, 'version' | 'eventId' | 'sessionId' | 'timestamp'> & {
  turnId?: string;
} {
  return {
    version: 1,
    eventId: createPortableId(),
    sessionId,
    timestamp: nowIso(),
    ...(turnId ? { turnId } : {}),
  };
}

function lastToolResultIndex(
  entries: Awaited<ReturnType<SessionRepository['readTranscript']>>,
  callId: string,
): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.type === 'message' &&
      entry.message.role === 'toolResult' &&
      entry.message.toolCallId === callId
    ) {
      return index;
    }
  }
  return -1;
}

function resultText(message: ToolResultMessage): string {
  return message.content
    .map((item) => (item.type === 'text' ? item.text : `[${item.type}]`))
    .join('\n');
}

/**
 * Owns the durable state machine for suspended tool calls. Tool lookup,
 * execution, and model continuation remain session concerns.
 */
export class ToolSuspensionWorkflow {
  constructor(private readonly options: ToolSuspensionWorkflowOptions) {}

  async pending(): Promise<BlipToolSuspension[]> {
    return (await this.options.repository.readToolSuspensions(this.options.state)).filter(
      (suspension) => !isTerminalToolSuspension(suspension.status),
    );
  }

  async requireResolvable(suspensionId: string): Promise<BlipToolSuspension> {
    const suspension = (await this.options.repository.readToolSuspensions(this.options.state)).find(
      (candidate) => candidate.id === suspensionId,
    );
    if (!suspension) throw new Error(`unknown tool suspension: ${suspensionId}`);
    if (suspension.status !== 'pending' && suspension.status !== 'interrupted') {
      throw new Error(`tool suspension is already ${suspension.status}: ${suspensionId}`);
    }
    return suspension;
  }

  async approve(suspension: BlipToolSuspension): Promise<BlipToolSuspension> {
    const at = nowIso();
    return this.transition(
      {
        ...suspension,
        status: 'approved',
        decisionAt: at,
        updatedAt: at,
      },
      ['pending', 'interrupted'],
    );
  }

  async beginExecution(suspension: BlipToolSuspension): Promise<BlipToolSuspension> {
    return this.transition(
      {
        ...suspension,
        status: 'executing',
        attempt: suspension.attempt + 1,
        updatedAt: nowIso(),
      },
      ['approved'],
    );
  }

  async resolve(
    suspension: BlipToolSuspension,
    message: ToolResultMessage,
    status: ToolResolutionStatus,
  ): Promise<void> {
    const at = nowIso();
    const next: BlipToolSuspension = {
      ...suspension,
      status,
      result: message,
      ...(status === 'denied' ? { decisionAt: at } : {}),
      completedAt: at,
      updatedAt: at,
      ...(status === 'failed' ? { error: resultText(message) } : {}),
    };
    await this.transition(next, status === 'denied' ? ['pending', 'interrupted'] : ['executing']);
    await this.options.repository.appendMessage(this.options.state, message);
    await this.options.emit({
      ...eventBase(this.options.state.id, this.options.activeTurnId()),
      type: 'transcript_changed',
      role: message.role,
    });
    await this.options.emit({
      ...eventBase(this.options.state.id, this.options.activeTurnId()),
      type: 'tool_call_resolved',
      suspensionId: suspension.id,
      callId: suspension.toolCallId,
      tool: suspension.toolName,
      decision: status === 'denied' ? 'denied' : 'approved',
      status,
    });
  }

  async interrupt(suspensionId: string): Promise<void> {
    const latest = (await this.options.repository.readToolSuspensions(this.options.state)).find(
      (candidate) => candidate.id === suspensionId,
    );
    if (latest?.status !== 'approved' && latest?.status !== 'executing') return;
    await this.transition(
      {
        ...latest,
        status: 'interrupted',
        updatedAt: nowIso(),
        error:
          latest.status === 'executing'
            ? 'Execution failed or was interrupted after it may have started. Confirm before retrying.'
            : 'Approved execution did not start successfully. Confirm before retrying.',
      },
      [latest.status],
      false,
    );
  }

  async recover(): Promise<{ continuationRequired: boolean; messages: AgentMessage[] }> {
    const transcript = await this.options.repository.readTranscript(this.options.state);
    const results = new Map(
      transcript.flatMap((entry) =>
        entry.type === 'message' && entry.message.role === 'toolResult'
          ? [[entry.message.toolCallId, entry.message] as const]
          : [],
      ),
    );
    const suspensions = await this.options.repository.readToolSuspensions(this.options.state);
    for (const suspension of suspensions) {
      const persistedResult = results.get(suspension.toolCallId);
      if (suspension.status !== 'executing' && suspension.status !== 'approved') continue;
      const updatedAt = nowIso();
      await this.transition(
        persistedResult
          ? {
              ...suspension,
              status: persistedResult.isError ? 'failed' : 'completed',
              result: persistedResult,
              completedAt: updatedAt,
              updatedAt,
            }
          : {
              ...suspension,
              status: 'interrupted',
              error:
                suspension.status === 'executing'
                  ? 'Execution may have started before the process stopped. Confirm before retrying.'
                  : 'Approval was recorded before the process stopped. Confirm before executing.',
              updatedAt,
            },
        [suspension.status],
        false,
      );
    }

    const recovered = await this.options.repository.readToolSuspensions(this.options.state);
    for (const suspension of recovered) {
      const result = results.get(suspension.toolCallId);
      if (isTerminalToolSuspension(suspension.status) && suspension.result && !result) {
        await this.options.repository.appendMessage(this.options.state, suspension.result);
        results.set(suspension.toolCallId, suspension.result);
      }
      if (suspension.status !== 'pending' && suspension.status !== 'interrupted') continue;
      await this.options.emit({
        ...eventBase(this.options.state.id),
        type: 'tool_call_suspended',
        suspensionId: suspension.id,
        callId: suspension.toolCallId,
        tool: suspension.toolName,
        reason: suspension.error ?? suspension.reason,
        details: suspension.details,
        recoveryRequired: suspension.status === 'interrupted',
      });
    }

    const messages = await this.options.repository.readModelMessages(this.options.state);
    const repairedTranscript = await this.options.repository.readTranscript(this.options.state);
    const terminal = recovered
      .filter((suspension) => isTerminalToolSuspension(suspension.status) && suspension.result)
      .at(-1);
    const resultIndex = terminal
      ? lastToolResultIndex(repairedTranscript, terminal.toolCallId)
      : -1;
    const continuationRequired =
      resultIndex >= 0 &&
      !repairedTranscript
        .slice(resultIndex + 1)
        .some((entry) => entry.type === 'message' && entry.message.role === 'assistant');
    return { continuationRequired, messages };
  }

  private async transition(
    suspension: BlipToolSuspension,
    expected: BlipToolSuspension['status'][],
    required = true,
  ): Promise<BlipToolSuspension> {
    const transitioned = await this.options.repository.transitionToolSuspension(
      this.options.state,
      suspension,
      expected,
    );
    if (!transitioned && required) {
      throw new Error(`tool suspension changed concurrently: ${suspension.id}`);
    }
    return suspension;
  }
}
