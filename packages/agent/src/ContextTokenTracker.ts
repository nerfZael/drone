import {
  estimateContextTokens,
  type AssistantMessage,
  type Context,
  type ContextTokenEstimate,
  type Model,
} from '@mariozechner/pi-ai/agent-core';

/** Request-scoped usage calibration. A rewritten prefix invalidates old usage. */
export class ContextTokenTracker {
  private previous?: { envelope: string; messages: string[]; estimated: number; actual: number };

  estimate(model: Model<any>, context: Context): ContextTokenEstimate {
    const estimate = estimateContextTokens(model, context);
    const previous = this.previous;
    if (
      !previous ||
      previous.envelope !== envelope(model, context) ||
      context.messages.length < previous.messages.length
    )
      return estimate;
    for (let i = 0; i < previous.messages.length; i++) {
      if (JSON.stringify(context.messages[i]) !== previous.messages[i]) return estimate;
    }
    // New assistant content and tool results are counted once, by the delta.
    // Usage can raise the estimate, but cannot erase conservative image/tool costs.
    const correction = Math.max(0, previous.actual - previous.estimated);
    return {
      ...estimate,
      inputTokens: estimate.inputTokens + correction,
      providerOverheadTokens: estimate.providerOverheadTokens + correction,
    };
  }

  record(model: Model<any>, context: Context, response: AssistantMessage): void {
    this.previous = undefined;
    if (response.stopReason === 'error' || response.stopReason === 'aborted') return;
    const actual = response.usage.input + response.usage.cacheRead + response.usage.cacheWrite;
    if (!Number.isFinite(actual) || actual <= 0) return;
    this.previous = {
      envelope: envelope(model, context),
      messages: context.messages.map((message) => JSON.stringify(message)),
      estimated: estimateContextTokens(model, context).inputTokens,
      actual,
    };
  }
}

function envelope(model: Model<any>, context: Context): string {
  return JSON.stringify([
    model.provider,
    model.api,
    model.id,
    model.baseUrl,
    context.systemPrompt,
    context.tools,
  ]);
}
