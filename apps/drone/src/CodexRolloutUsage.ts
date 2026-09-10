import fs from 'node:fs';
import readline from 'node:readline';
import type { UsageObservation } from '@drone/assistant-chat';

const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'] as const;
const valid = (usage: any): boolean => fields.every((key) => Number.isSafeInteger(usage?.[key]) && usage[key] >= 0)
  && usage.input_tokens >= usage.cached_input_tokens + usage.cache_write_input_tokens
  && usage.reasoning_output_tokens <= usage.output_tokens
  && usage.total_tokens === usage.input_tokens + usage.output_tokens;

/** Read only the requested live turn. Copied history and other turns never become spend. */
export async function readCodexRolloutUsage(file: string, threadId: string, turnId: string, model = 'unknown'): Promise<UsageObservation[] | null> {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const timer = setTimeout(() => stream.destroy(new Error('Codex usage read timed out')), 5_000);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const records = new Map<string, any>();
  const compactions = new Set<string>();
  const requiredCompactions = new Set<string>();
  let latest: any;
  let currentModel = model;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const p = row.payload;
      if (row.type === 'turn_context' && p?.turn_id === turnId && typeof p.model === 'string') currentModel = p.model;
      if (row.type === 'compacted' && typeof p?.compaction_response_id === 'string') {
        compactions.add(p.compaction_response_id);
        if (p.latest_token_usage_record?.thread_id === threadId && p.latest_token_usage_record?.turn_id === turnId) {
          requiredCompactions.add(p.compaction_response_id);
        }
      }
      if (row.type !== 'token_usage_record' || p?.thread_id !== threadId || p?.turn_id !== turnId) continue;
      if (typeof p.response_id !== 'string' || !p.response_id || !valid(p.usage) || !valid(p.turn_token_usage)) return null;
      const old = records.get(p.response_id);
      if (old && JSON.stringify(old.usage) !== JSON.stringify(p.usage)) return null;
      records.set(p.response_id, { ...p, model: currentModel });
      latest = p.turn_token_usage;
    }
    if (!latest || !records.size || [...requiredCompactions].some((id) => !records.has(id))) return null;
    // A truncated/missing prefix cannot masquerade as a complete response ledger.
    if (!fields.every((key) => [...records.values()].reduce((sum, p) => sum + p.usage[key], 0) === latest[key])) return null;
    return [...records.values()].map((p): UsageObservation => ({
      id: `codex-response:${threadId}:${p.response_id}`, sessionId: threadId, turnId,
      provider: 'openai-codex', model: p.model, scope: 'request', complete: true,
      purpose: compactions.has(p.response_id) ? 'compaction' : 'chat',
      input: p.usage.input_tokens - p.usage.cached_input_tokens - p.usage.cache_write_input_tokens,
      cacheRead: p.usage.cached_input_tokens, cacheWrite: p.usage.cache_write_input_tokens,
      output: p.usage.output_tokens, reasoning: p.usage.reasoning_output_tokens, raw: p.usage,
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    lines.close();
    stream.destroy();
  }
}
