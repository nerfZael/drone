/**
 * A plain orchestrator, as a baseline for the entity's routing eval: one model keeps the conversation (its own
 * messages, tool calls and results, and notices from workers), takes one turn per batch of new input, and starts
 * background workers. No rendered state, event wakes, code limbs, reviewer or guards. It is given the same router
 * prompt and tools as the entity's head, and logs the same events, so the same cases judge both.
 */
import { EventLog, TOOL_DESCRIPTIONS, TOOL_SCHEMAS, headSystemPrompt, toJsonSchema, type Channel, type EffectSpec, type Mind, type PromptOverrides, type ToolSpec } from '@entity/core';

/** Replaces the entity's "base" section, which describes snapshots and wakes, with a plain harness's. */
const BASE = `You talk with a user and delegate work to background workers. You see the whole conversation: the user's messages, your own tool calls and their results, and notices about workers (a question one asks the user, one finishing). That conversation, with the workspaces listed at the start, is your state: what workers exist, what they are doing, and what each workspace allows.

You act only through tools. Text you write outside tool calls is never shown to the user.

If a tool returns an error, fix the call and try again. Be brief. Do not repeat actions you already took.

In chat, write for scanning: short paragraphs, a list when you name several things, code formatting for names and paths, no headings or tables. Never repeat in the chat what a worker already said there: the user has read it.`;

const ROUTER_TOOLS = ['dispatch', 'dispatch_many', 'steer', 'cancel'] as const;

type Worker = { id: string; name: string; task: string; asked: boolean };

export class BaselineOrchestrator {
  readonly log: EventLog;
  usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0 };
  private readonly started = Date.now();
  private readonly workers = new Map<string, Worker>();
  private readonly effects: EffectSpec[];
  private readonly tools: ToolSpec[];
  private readonly system: string;
  private pending: string[] = [];
  private running: Promise<void> | null = null;
  private readonly abort = new AbortController();
  private nextWorker = 1;
  private nextGroup = 1;

  constructor(private readonly opts: { mind: Mind; model: string; channels: Channel[]; workerAsks?: string; workspaces?: string[]; prompts?: PromptOverrides }) {
    this.log = new EventLog(() => Date.now() - this.started, this.started);
    this.effects = opts.channels.flatMap(c => c.effects).filter(e => e.name !== 'set_draft');
    this.tools = [
      ...this.effects.map(e => ({ name: e.name, description: e.description, parameters: toJsonSchema(e.parameters) })),
      ...ROUTER_TOOLS.map(name => {
        const d = TOOL_DESCRIPTIONS[name];
        return { name, description: typeof d === 'function' ? d('head') : d, parameters: toJsonSchema(TOOL_SCHEMAS[name]) };
      }),
    ];
    // The entity head's prompt with code limbs off (a plain orchestrator has none) and the base section swapped.
    this.system = headSystemPrompt(opts.channels, false, false, false, false, { ...opts.prompts, base: opts.prompts?.base ?? BASE });
    if (opts.workspaces) this.pending.push(`Workspaces:\n${opts.workspaces.map(w => `- ${w}`).join('\n')}`);
  }

  /** A user message, like the entity's input('chat_message', ...). */
  input(_type: 'chat_message', data: { text: string; reply_to?: number }): void {
    const e = this.log.append('chat_message', 'user', data);
    this.notify(data.reply_to ? `[user, message #${e.seq}, answering your question #${data.reply_to} by clicking] ${data.text}` : `[user, message #${e.seq}] ${data.text}`);
  }

  /** True while the orchestrator is taking a turn. */
  busy(): boolean { return this.running !== null; }

  close(): void { this.abort.abort(); }

  private notify(line: string): void {
    this.pending.push(line);
    this.kick();
  }

  /** Starts a turn unless one is running; input that arrives during a turn waits for the next one. */
  private kick(): void {
    if (this.running || !this.pending.length) return;
    this.running = this.turn().finally(() => { this.running = null; this.kick(); });
  }

  /** One turn over everything that arrived since the last: the model calls tools until it stops. */
  private async turn(): Promise<void> {
    const prompt = this.pending.join('\n\n');
    this.pending = [];
    try {
      await this.opts.mind.run({
        limbId: 'head', runId: `r${Date.now()}`, role: 'head', model: this.opts.model, system: this.system, prompt, tools: this.tools,
        sessionKey: 'orchestrator', maxSteps: 8, signal: this.abort.signal,
        callTool: (name, args) => this.call(name, args),
        spent: u => { this.usage.input += u.input; this.usage.output += u.output; this.usage.cacheRead += u.cacheRead ?? 0; this.usage.cacheWrite += u.cacheWrite ?? 0; if (u.cost == null) this.usage.unpriced++; else this.usage.cost += u.cost; },
      });
    } catch (error) {
      if (!this.abort.signal.aborted) this.log.append('health', 'head', { message: String((error as Error)?.message ?? error) });
    }
  }

  private async call(name: string, args: Record<string, unknown>): Promise<string> {
    this.log.append('tool_called', 'head', { name, summary: JSON.stringify(args).slice(0, 200) });
    const effect = this.effects.find(e => e.name === name);
    if (effect) {
      const ctx = { caller: { id: 'head', role: 'head' }, world: {}, now: () => Date.now() - this.started, events: () => this.log.all(), emit: (type: string, data: Record<string, unknown>) => this.log.append(type, 'head', data) };
      try { return await effect.apply(args, ctx as never); } catch (error) { return `error: ${(error as Error).message}`; }
    }
    switch (name) {
      case 'dispatch': return this.spawn(String(args.task), args.name as string | undefined, args.after as string | undefined);
      case 'dispatch_many': {
        const items = (args.items ?? []) as { task: string; name?: string }[];
        let group = args.batch as string | undefined;
        if (!group) { group = `group-${this.nextGroup++}`; this.log.append('group_started', 'head', { id: group, title: args.title, count: items.length }); }
        return `batch ${group}: ${items.map(i => this.spawn(i.task, i.name, undefined, group)).join('; ')}`;
      }
      case 'steer': {
        const worker = this.workers.get(String(args.worker));
        if (!worker) return `error: no worker ${args.worker}`;
        this.log.append('steered', 'head', { id: worker.id, text: args.text, ...(args.when === 'after' ? { when: 'after' } : {}) });
        return args.when === 'after' ? `${worker.id} will do this when it finishes` : `sent to ${worker.id}`;
      }
      case 'cancel': {
        if (!this.workers.delete(String(args.id))) return `error: no worker ${args.id}`;
        this.log.append('limb_cancelled', 'head', { id: args.id });
        return `cancelled ${args.id}`;
      }
      default: return `error: unknown tool ${name}`;
    }
  }

  /** A stand-in worker, like the entity eval's: it asks the case's question first if there is one, then stays busy. */
  private spawn(task: string, name = task.slice(0, 40), after?: string, group?: string): string {
    const id = `task-${this.nextWorker++}`;
    this.workers.set(id, { id, name, task, asked: false });
    this.log.append('limb_spawned', 'head', { id, name, task, after: after ?? null, group: group ?? null });
    if (this.opts.workerAsks) {
      const question = this.opts.workerAsks;
      setTimeout(() => {
        if (this.abort.signal.aborted || !this.workers.has(id)) return;
        const e = this.log.append('chat_message', id, { text: question, question: true });
        this.notify(`[worker ${id} "${name}" asked the user (message #${e.seq}) and waits for the answer] ${question}`);
      }, 1500);
    }
    return after ? `worker ${id} "${name}" will start when ${after} finishes` : `worker ${id} "${name}" started`;
  }
}
