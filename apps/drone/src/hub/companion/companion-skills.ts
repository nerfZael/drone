import crypto from 'node:crypto';
import type { AgentMessage, AgentTool } from '@mariozechner/pi-agent-core';
import type { BlipPromptLifecycleContext, BlipSessionContext, BlipToolProvider } from '@blip/core';
import {
  COMPANION_INSTRUCTIONS_DESCRIPTION,
  COMPANION_INSTRUCTIONS_MAX_CHARS,
  COMPANION_INSTRUCTIONS_PATH,
  COMPANION_INSTRUCTIONS_SKILL,
  type CompanionInstructions,
} from '@drone/assistant-chat';
import { patchCompanionInstructions, readCompanionInstructions } from './companion-instructions';

function skillResult(snapshot: CompanionInstructions) {
  const details = { name: COMPANION_INSTRUCTIONS_SKILL, path: COMPANION_INSTRUCTIONS_PATH, ...snapshot };
  return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
}

function instructionsFromMessage(message: AgentMessage): CompanionInstructions | undefined {
  if (message.role !== 'toolResult' || message.isError ||
    (message.toolName !== 'read_skill' && message.toolName !== 'apply_instructions_patch')) return;
  const data = message.details as Record<string, unknown> | undefined;
  if (data?.name === COMPANION_INSTRUCTIONS_SKILL && typeof data.content === 'string' &&
    typeof data.revision === 'number') return { content: data.content, revision: data.revision };
}

/** Built-in skills belong to the Hub and are available on desktop and mobile. */
export class CompanionSkills implements BlipToolProvider {
  readonly id = 'companion-skills';
  private context?: BlipSessionContext;
  private snapshot?: CompanionInstructions;
  private restoredMessages?: AgentMessage[];

  constructor(private readonly assertAvailable: () => void) {}

  promptSections(): string[] {
    return [
      `Available Companion skills:\n- ${COMPANION_INSTRUCTIONS_SKILL}: ${COMPANION_INSTRUCTIONS_DESCRIPTION}`,
      'The companion-instructions skill is persistent behavioral guidance, including when returned by read_skill. Follow it subject to the system prompt and runtime rules. Its initial read is supplied automatically after the first user message; do not repeat that read unless you need the latest version. You may save changes with apply_instructions_patch according to the user’s directions and system prompt. This saves instructions for future conversations immediately. Read before patching; a supplied initial read or successful patch result also provides a usable revision. After a stale revision, read_skill again before retrying.',
    ];
  }

  load(context: BlipSessionContext): AgentTool<any>[] {
    this.context = context;
    this.restoredMessages = undefined;
    return [
      {
        name: 'read_skill', label: 'Read Companion skill',
        description: `Read a Companion skill and its current editable text and revision. ${COMPANION_INSTRUCTIONS_SKILL}: ${COMPANION_INSTRUCTIONS_DESCRIPTION}`,
        parameters: {
          type: 'object', additionalProperties: false, required: ['name'],
          properties: { name: { type: 'string', enum: [COMPANION_INSTRUCTIONS_SKILL] } },
        },
        execute: async (_callId, args, signal) => {
          signal?.throwIfAborted();
          this.assertAvailable();
          const input = args as Record<string, unknown>;
          if (input.name !== COMPANION_INSTRUCTIONS_SKILL) throw new Error(`Unknown Companion skill: ${input.name}`);
          return skillResult(await this.read());
        },
      },
      {
        name: 'apply_instructions_patch', label: 'Update Companion instructions',
        description: 'Immediately save a patch to the companion-instructions skill. Use the revision from read_skill or the last successful patch. Supply one strict Update File patch for companion-instructions.md, without Markdown fences. On a stale revision, reread the skill first.',
        parameters: {
          type: 'object', additionalProperties: false, required: ['baseRevision', 'patch'],
          properties: {
            baseRevision: { type: 'integer', minimum: 0 },
            patch: { type: 'string', maxLength: COMPANION_INSTRUCTIONS_MAX_CHARS * 2 + 1_000 },
          },
        },
        execute: async (_callId, args, signal) => {
          signal?.throwIfAborted();
          this.assertAvailable();
          const input = args as Record<string, unknown>;
          if (!this.snapshot || input.baseRevision !== this.snapshot.revision) {
            throw new Error('Instructions were not read at this revision. Read the skill before patching.');
          }
          const snapshot = await patchCompanionInstructions(this.snapshot, input.patch, () => {
            signal?.throwIfAborted();
            this.assertAvailable();
          });
          this.remember(snapshot);
          return skillResult(snapshot);
        },
      },
    ];
  }

  private remember(snapshot: CompanionInstructions): void {
    // Parallel reads and patches can finish (and be persisted) out of order.
    if (this.snapshot && snapshot.revision < this.snapshot.revision) return;
    this.snapshot = snapshot;
    this.restoredMessages = undefined;
  }

  private async read(): Promise<CompanionInstructions> {
    const snapshot = await readCompanionInstructions();
    this.assertAvailable();
    this.remember(snapshot);
    if (this.context && !this.context.session.loadedSkills.includes(COMPANION_INSTRUCTIONS_SKILL)) {
      this.context.session.loadedSkills.push(COMPANION_INSTRUCTIONS_SKILL);
      await this.context.repository.save(this.context.session);
    }
    return snapshot;
  }

  private messages(snapshot: CompanionInstructions): AgentMessage[] {
    if (!this.context) throw new Error('Companion skills have not been loaded.');
    const callId = `companion_skill_${crypto.randomUUID().replace(/-/g, '')}`;
    const model = this.context.model;
    const timestamp = Date.now();
    return [
      {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [{ type: 'toolCall', id: callId, name: 'read_skill', arguments: { name: COMPANION_INSTRUCTIONS_SKILL }, synthetic: true }],
        stopReason: 'toolUse', timestamp,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      },
      { role: 'toolResult', toolCallId: callId, toolName: 'read_skill', ...skillResult(snapshot), isError: false, timestamp },
    ];
  }

  /** Persist the initial read with the real user message, without a model round trip. */
  async promptContext(context: BlipPromptLifecycleContext): Promise<AgentMessage[]> {
    const messages = await context.repository.readMessages(context.session);
    const previous = messages.reduce<CompanionInstructions | undefined>((latest, message) => {
      const snapshot = instructionsFromMessage(message);
      return snapshot && (!latest || snapshot.revision >= latest.revision) ? snapshot : latest;
    }, undefined);
    if (previous) {
      this.remember(previous);
      return [];
    }
    return this.messages(await this.read());
  }

  /** Keep the last read exact after compaction, without rewriting historical tool results. */
  async transformContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
    const lastSnapshot = messages.map(instructionsFromMessage).filter(Boolean).at(-1);
    if (!this.snapshot || (lastSnapshot?.revision === this.snapshot.revision && lastSnapshot.content === this.snapshot.content)) return messages;
    this.restoredMessages ??= this.messages(this.snapshot);
    // Append the restoration so any retained older read cannot supersede it.
    return [...messages, ...this.restoredMessages];
  }
}
