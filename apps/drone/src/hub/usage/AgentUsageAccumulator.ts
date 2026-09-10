import type { TokenCounts, UsageObservation } from '@drone/assistant-chat';

/** Rebuilding this accumulator from a durable log produces the same observation IDs. */
export class AgentUsageAccumulator {
  private observations = new Map<string, UsageObservation>();
  private codexCoverage = new Map<string, string>();
  private model = 'unknown';
  private sessionId = '';
  private finalModels = new Set<string>();
  private openCodeSteps = new Map<string, { messageId: string; observation: UsageObservation }>();

  constructor(private readonly agent: string) {}

  pushLine(line: string): void {
    let event: any;
    try { event = JSON.parse(line); } catch { return; }
    if (!event || typeof event !== 'object') return;
    if (event.type === 'usage.snapshot' && this.agent === 'opencode' && Array.isArray(event.observations)) {
      this.observations.clear();
      for (const observation of event.observations) this.put(observation);
      // Older CLI versions lack message IDs; discard their provisional counts at a snapshot.
      for (const [id, step] of this.openCodeSteps) {
        if (!step.messageId) this.openCodeSteps.delete(id);
      }
      return;
    }
    if (this.agent === 'codex' && event.sessionId && event.turnId) {
      const key = JSON.stringify([event.sessionId, event.turnId]);
      const matches = (o: UsageObservation) => o.sessionId === event.sessionId && o.turnId === event.turnId;
      if (event.type === 'usage.coverage' && typeof event.partialReason === 'string') {
        this.codexCoverage.set(key, event.partialReason);
        for (const o of this.observations.values()) if (matches(o)) {
          o.complete = false; o.partialReason = event.partialReason;
        }
        return;
      }
      if (event.type === 'usage.snapshot' && Array.isArray(event.observations) && event.observations.length) {
        const incoming: UsageObservation[] = event.observations;
        const existing = [...this.observations.values()].filter(matches);
        const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const;
        if (!incoming.every((o) => matches(o) && o.complete && typeof o.id === 'string' &&
          fields.every((f) => number(o[f]) !== null)) ||
          new Set(incoming.map((o) => o.id)).size !== incoming.length ||
          this.codexCoverage.get(key) === 'compaction-unverified' && !incoming.some((o) => o.purpose === 'compaction') ||
          !fields.every((f) => incoming.reduce((sum, o) => sum + o[f]!, 0) >= existing.reduce((sum, o) => sum + (o[f] ?? 0), 0))) return;
        for (const o of existing) this.observations.delete(o.id);
        this.codexCoverage.delete(key);
        for (const o of incoming) this.put(o);
        return;
      }
    }
    this.sessionId = event.session_id ?? event.sessionID ?? event.thread_id ?? this.sessionId;
    if (!event.parent_tool_use_id) this.model = event.model ?? event.message?.model ?? this.model;
    if (event.type === 'usage.delta' || event.type === 'usage_observed') {
      const raw = event.usage;
      if (!raw) return;
      const codex = this.agent === 'codex';
      this.put({
        id: event.eventId, model: event.model ?? this.model,
        provider: event.provider ?? (codex ? 'openai-codex' : 'unknown'),
        sessionId: event.sessionId ?? this.sessionId, turnId: event.turnId, purpose: event.purpose,
        partialReason: event.partialReason,
        scope: 'request', complete: event.complete !== false,
        ...counts(raw, codex ? 'codex' : 'native'),
        ...(number(raw.cost?.total) ? { reportedCost: raw.cost.total } : {}), raw,
      });
    }
    if (this.agent === 'opencode' && event.type === 'step_finish') {
      const part = event.part;
      if (!part?.tokens || !part.id) return;
      const tokens = part.tokens;
      const item: UsageObservation = { id: part.id, model: event.model ?? this.model, provider: event.provider ?? 'unknown',
        sessionId: part.sessionID ?? this.sessionId, scope: 'request', complete: false,
        input: number(tokens.input), output: add(number(tokens.output), number(tokens.reasoning)),
        reasoning: number(tokens.reasoning), cacheRead: number(tokens.cache?.read), cacheWrite: number(tokens.cache?.write),
        reportedCost: number(part.cost) ?? undefined, raw: tokens };
      this.openCodeSteps.set(part.id, { messageId: part.messageID ?? '', observation: item });
    }
    if (this.agent === 'cursor' && event.type === 'result' && event.usage) {
      this.put({ id: `result:${event.request_id ?? this.sessionId}`, model: this.model, provider: 'cursor',
        sessionId: this.sessionId, scope: 'tree', complete: false,
        ...counts(event.usage, 'camel'), reportedCost: number(event.total_cost_usd) ?? undefined, raw: event.usage });
    }
    if (this.agent !== 'claude') return;
    if (event.type === 'assistant' && event.message?.usage && event.message.id && !event.parent_tool_use_id) {
      const raw = event.message.usage;
      // Assistant messages contain initial output placeholders; only input/cache is recoverable here.
      this.put({ id: event.message.id, model: event.message.model ?? this.model, provider: 'anthropic',
        sessionId: this.sessionId, scope: 'request', complete: false,
        ...counts(raw, 'anthropic'), output: null, reasoning: null, raw });
    }
    if (event.type === 'result' && !event.parent_tool_use_id) {
      const models = event.modelUsage;
      if (models && typeof models === 'object' && Object.values(models).some(hasTokens)) {
        for (const [model, raw] of Object.entries<any>(models)) {
          // A crash can emit a zeroed result: retain useful observations already collected.
          if (!hasTokens(raw)) continue;
          this.finalModels.add(model);
          this.put({ id: `model:${model}`, model, provider: 'anthropic', sessionId: this.sessionId,
            scope: 'tree', complete: true, ...counts(raw, 'camel'),
            reportedCost: number(raw.costUSD) ?? undefined, raw });
        }
      } else if (hasTokens(event.usage)) {
        this.finalModels.add(this.model);
        this.put({ id: `model:${this.model}`, model: this.model, provider: 'anthropic', sessionId: this.sessionId,
          scope: 'thread', complete: false, ...counts(event.usage, 'anthropic'), raw: event.usage });
      }
    }
  }

  result(): UsageObservation[] {
    if (this.agent === 'opencode') {
      const steps = [...this.openCodeSteps.values()].filter((step) => !this.observations.get(step.messageId)?.complete);
      const provisionalMessages = new Set(steps.map((step) => step.messageId));
      return [...this.observations.values()].filter((item) => !provisionalMessages.has(item.id))
        .concat(steps.map((step) => step.observation));
    }
    return [...this.observations.values()].filter((item) =>
      !this.finalModels.has(item.model) || item.id === `model:${item.model}`);
  }

  private put(item: UsageObservation): void {
    if (!item || typeof item.id !== 'string' || !item.id) return;
    const normalized = { ...item,
      model: typeof item.model === 'string' ? item.model : 'unknown',
      provider: typeof item.provider === 'string' ? item.provider : 'unknown',
      input: number(item.input), output: number(item.output), cacheRead: number(item.cacheRead),
      cacheWrite: number(item.cacheWrite), reasoning: number(item.reasoning), complete: item.complete === true,
      reportedCost: number(item.reportedCost) ?? undefined,
    };
    if (!hasCounts(normalized)) return;
    const reason = this.codexCoverage.get(JSON.stringify([item.sessionId, item.turnId]));
    if (this.agent === 'codex' && reason) { normalized.complete = false; normalized.partialReason = reason; }
    this.observations.set(item.id, normalized);
  }
}

export function nativeUsageObservation(event: any): UsageObservation | null {
  const parser = new AgentUsageAccumulator('native');
  parser.pushLine(JSON.stringify(event));
  const observation = parser.result()[0] ?? null;
  if (observation && ![observation.input, observation.output, observation.cacheRead, observation.cacheWrite].some((n) => n !== null && n > 0)) {
    observation.complete = false;
    observation.input = observation.output = observation.cacheRead = observation.cacheWrite = observation.reasoning = null;
  }
  return observation;
}

function counts(raw: any, format: 'native' | 'camel' | 'codex' | 'anthropic'): TokenCounts {
  if (format === 'native') return { input: number(raw.input), output: number(raw.output),
    cacheRead: number(raw.cacheRead), cacheWrite: number(raw.cacheWrite), reasoning: number(raw.reasoning) };
  if (format === 'anthropic') return { input: number(raw.input_tokens), output: number(raw.output_tokens),
    cacheRead: number(raw.cache_read_input_tokens), cacheWrite: number(raw.cache_creation_input_tokens),
    reasoning: number(raw.output_tokens_details?.thinking_tokens) };
  const cacheRead = number(raw.cachedInputTokens ?? raw.cacheReadInputTokens ?? raw.cacheReadTokens);
  const cacheWrite = number(raw.cacheWriteInputTokens ?? raw.cacheCreationInputTokens ?? raw.cacheWriteTokens);
  const input = number(raw.inputTokens);
  return { input: format === 'codex' && input !== null && cacheRead !== null
    ? Math.max(0, input - cacheRead - (cacheWrite ?? 0)) : input,
    output: number(raw.outputTokens), cacheRead, cacheWrite,
    reasoning: number(raw.reasoningOutputTokens ?? raw.reasoningTokens) };
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function add(a: number | null, b: number | null): number | null { return a === null || b === null ? null : a + b; }
function hasCounts(value: TokenCounts): boolean { return [value.input, value.output, value.cacheRead, value.cacheWrite].some((v) => v !== null); }
function hasTokens(raw: any): boolean {
  return raw && ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens',
    'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
    .some((key) => typeof raw[key] === 'number' && raw[key] > 0);
}
