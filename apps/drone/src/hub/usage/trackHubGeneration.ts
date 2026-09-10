import crypto from 'node:crypto';
import { getUsageStore } from './UsageStore';
import { getUsageJournal } from './UsageJournal';
import type { UsageObservation } from '@drone/assistant-chat';

/** Covers Hub helper requests such as generated drone names, including failed responses with usage. */
export async function trackHubGeneration<T>(provider: string, model: string, generate: () => Promise<T>, native = false): Promise<T> {
  const store = getUsageStore();
  const execution = { id: `hub:${crypto.randomUUID()}`, agent: 'native', purpose: 'auxiliary',
    startedAt: new Date().toISOString(), status: 'running' };
  const journal = getUsageJournal();
  journal.append({ execution, observations: [], replace: true });
  try { journal.drain(store); } catch { /* The request intent is durable for restart recovery. */ }
  const finish = (response: any, status: string) => {
    const usage = response?.totalUsage ?? response?.usage;
    const counts = usage ? native ? {
      input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
      reasoning: usage.reasoning ?? null,
    } : {
      input: usage.inputTokenDetails?.noCacheTokens ?? difference(usage.inputTokens, usage.inputTokenDetails?.cacheReadTokens, usage.inputTokenDetails?.cacheWriteTokens),
      output: usage.outputTokens ?? null, cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? null,
      cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? null,
      reasoning: usage.outputTokenDetails?.reasoningTokens ?? null,
    } : null;
    const observation: UsageObservation | null = counts ? { ...counts, id: execution.id,
      model: response?.model ?? model, provider: provider === 'codex' ? 'openai-codex' : provider === 'gemini' ? 'google' : provider,
      complete: status === 'completed', scope: 'request', raw: usage } : null;
    try {
      journal.append({ execution: { ...execution, status }, observations: observation ? [observation] : [], replace: true });
      journal.drain(store);
    }
    catch (error) { console.warn('Hub generation usage unavailable:', error instanceof Error ? error.message : String(error)); }
  };
  let result: T;
  try { result = await generate(); }
  catch (error) {
    finish(error, 'failed');
    throw error;
  }
  const reason = (result as any)?.stopReason;
  finish(result, reason === 'error' || reason === 'aborted' ? 'failed' : 'completed');
  return result;
}

function difference(input: unknown, read: unknown, write: unknown): number | null {
  return typeof input === 'number' && typeof read === 'number' && typeof write === 'number'
    ? Math.max(0, input - read - write) : null;
}
