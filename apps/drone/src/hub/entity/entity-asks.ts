import type { AskTracker, ModelUsage } from '@entity/core';
import type { Model } from '@mariozechner/pi-ai';
import { resolveBlipProviderApiKey } from '../hub-settings';
import { trackHubGeneration } from '../usage/trackHubGeneration';
import { modelCallUsage } from './entity-evaluator';

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

/** The default instructions for splitting messages into asks; the user may replace them (see entity-prompts.ts). */
export const ASK_SPLIT_PROMPT = `You keep a short list of what a user asked an AI agent team for, so they can see later what was asked and whether it happened.
You get one new message and the asks recorded so far (id, kind, text). Reply with only a JSON object:
{"asks": [{"kind": "do" | "question" | "rule", "text": "..."}], "repeats": ["ask-id", ...], "replaces": ["ask-id", ...]}
- asks: what this message newly asks for. do: something to do or produce, including ongoing work ("keep polishing X" is a do). question: something to answer. rule: a standing preference about how all work or replies should be ("always answer briefly", "never touch the old API", "from now on use tabs").
- text: a few words in the user's terms, under 12 words, starting with a verb for do ("Make the buttons black"), a short question for question.
- One ask per distinct thing. Small talk, thanks, acknowledgements and pure answers to the agents' questions are not asks: give none.
- How to organize the work is not an ask ("use several agents", "in parallel", "add another agent for X", "keep the existing agents"): record only the work itself, e.g. "add an agent for the code examples" is the ask "Audit the code examples". Details of an ask ("report each round", "stop after four") belong in that ask's text, not in an ask of their own.
- repeats: earlier asks this message asks for again: the same specific thing, even in other words ("the buttons are still not black" repeats "Make the buttons black"). A new request about the same project or files is not a repeat. Do not also add them to asks.
- replaces: earlier asks this message overrides because the user changed their mind.
Use the user's facts only.`;

/** The default instructions for judging which asks a result or reply resolved. */
export const ASK_RESOLVE_PROMPT = `You check which of a user's asks a piece of work resolved.
You get the open asks (id, kind, a short text, and what the user actually wrote) and the evidence: finished agents' results, or a reply in the chat. Reply with only a JSON object:
{"resolved": [{"id": "ask-id", "note": "..."}]}
- Judge against what the user actually wrote. A do is resolved when the evidence shows it was done as asked. It is not resolved if the evidence shows it only planned, in progress, or partly done (some of the rounds, some of the items, one area of several).
- Every part the user named counts. "One prioritized list" needs a single combined list: separate lists from several agents do not resolve it, even if each is prioritized.
- A question is resolved if the evidence answers it.
- note: under 12 words, what was done or the answer.`;

/** The default instructions for linking new work to the asks it serves. */
export const ASK_LINK_PROMPT = `An AI agent team just started a piece of work after reading several of a user's messages. You decide which of the user's asks this work serves.
You get the candidate asks (id, kind, text, and what the user actually wrote) and the work's name and task. Reply with only a JSON object:
{"ids": ["ask-id", ...]}
- Include an ask only if this work does it, or a part of it. Work that merely mentions or happens near an ask does not serve it.
- None of them is a fine answer.`;

/** Asks with a cheap model: gpt-6-luna (on the Codex subscription), low reasoning to split messages and medium to judge results. */
export function createAskTracker(modelRef = 'openai-codex/gpt-6-luna', prompts: () => { split: string; resolve: string; link: string } = () => ({ split: ASK_SPLIT_PROMPT, resolve: ASK_RESOLVE_PROMPT, link: ASK_LINK_PROMPT })): AskTracker {
  return {
    async split({ message, earlier }, signal) {
      const { json, usage } = await completeJson(modelRef, prompts().split, `EARLIER ASKS\n${earlier.map(a => `${a.id} [${a.kind}] ${a.text}`).join('\n') || '(none)'}\n\nNEW MESSAGE\n${message}`, signal, 'low');
      const asks = Array.isArray(json.asks) ? json.asks : [];
      return { asks, repeats: strings(json.repeats), replaces: strings(json.replaces), usage };
    },
    async resolve({ asks, evidence, by }, signal) {
      const { json, usage } = await completeJson(modelRef, prompts().resolve, `OPEN ASKS\n${asks.map(a => `${a.id} [${a.kind}] ${a.text}\n  the user wrote: ${a.said.map(s => `"${s}"`).join(' / then: ') || '(unknown)'}`).join('\n')}\n\nEVIDENCE (from ${by})\n${evidence}`, signal, 'medium');
      const resolved = Array.isArray(json.resolved) ? json.resolved.filter((r: unknown): r is { id: string; note?: string } => typeof (r as { id?: unknown })?.id === 'string') : [];
      return { resolved, usage };
    },
    async link({ asks, name, task }, signal) {
      const { json, usage } = await completeJson(modelRef, prompts().link, `CANDIDATE ASKS\n${asks.map(a => `${a.id} [${a.kind}] ${a.text}\n  the user wrote: ${a.said.map(s => `"${s}"`).join(' / then: ') || '(unknown)'}`).join('\n')}\n\nNEW WORK: ${name}\n${task}`, signal, 'low');
      return { ids: strings(json.ids), usage };
    },
  };
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

async function completeJson(modelRef: string, systemPrompt: string, content: string, signal: AbortSignal, reasoning: 'low' | 'medium'): Promise<{ json: Record<string, any>; usage?: ModelUsage }> {
  const [providerId, ...rest] = modelRef.split('/');
  const modelId = rest.join('/');
  const { getModel, completeSimple } = await (importEsm('@mariozechner/pi-ai') as Promise<typeof import('@mariozechner/pi-ai')>);
  const model = getModel(providerId as never, modelId as never) as Model<any> | undefined;
  if (!model) throw new Error(`Unknown model ${modelRef}`);
  const apiKey = await resolveBlipProviderApiKey(providerId);
  if (!apiKey) throw new Error(`No credentials for ${providerId}`);
  const message = await trackHubGeneration(providerId, modelId, () => completeSimple(model, {
    systemPrompt,
    messages: [{ role: 'user', content, timestamp: Date.now() }],
  }, { apiKey, signal, maxTokens: 1500, ...(model.reasoning ? { reasoning } : {}) }), true);
  const text = message.content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}') as Record<string, any>;
  return { json, usage: modelCallUsage(providerId, modelId, message.usage) };
}
