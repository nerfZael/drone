import crypto from 'node:crypto';
import { estimateUsageCost, type UsageAnalytics, type UsageObservation, type UsagePrice, type UsageTotals } from '@drone/assistant-chat';
import { droneRootPath } from '../../host/paths';
import { openUsageDatabase } from './helpers/openUsageDatabase';
import { USAGE_SCHEMA } from './usage-schema';
import { applyBundledAnthropicPrices } from './bundledPrices';

/** Hub helpers that run beside a chat's agent: they cost the chat money but never make it look busy. */
export const HELPER_USAGE_PURPOSES = ['steps', 'asks', 'next-actions'] as const;
const HELPER_PURPOSES_SQL = `(${HELPER_USAGE_PURPOSES.map((purpose) => `'${purpose}'`).join(',')})`;

export type UsageExecution = {
  id: string; chatId?: string; droneId?: string; chatName?: string; repo?: string;
  agent: string; purpose?: string; startedAt: string; status: string; observedAt?: string; snapshotAt?: string;
};
export type UsageFilter = {
  chatId?: string; droneId?: string; agent?: string; model?: string; provider?: string; repo?: string;
  from?: string; to?: string; groupBy?: 'agent' | 'model' | 'provider' | 'chat' | 'repo' | 'purpose';
};

export type ChatActivity = {
  droneId: string; chatName: string; estimatedCost: number; tokens: number; unpriced: number;
  /** Of the cost, what summarizing its steps took. */
  stepsCost: number;
  /** Usage records counted at the cost their agent reported: finished Claude Code turns, and any with no known price. */
  reported: number;
  /** When the chat's oldest running execution started, while one runs. */
  runningSince: string | null;
  lastEndedAt: string | null;
};

export class UsageStore {
  private readonly db: import('better-sqlite3').Database;
  readonly trackingSince: string;

  constructor(databasePath = droneRootPath('usage.sqlite')) {
    this.db = openUsageDatabase(databasePath);
    this.db.exec(USAGE_SCHEMA);
    this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('tracking_since', ?)").run(new Date().toISOString());
    this.trackingSince = (this.db.prepare("SELECT value FROM metadata WHERE key='tracking_since'").get() as any).value;
    applyBundledAnthropicPrices(this);
    this.repairCumulativeSessionTotals();
    this.repricePricedAnthropicCacheWrites();
  }

  record(execution: UsageExecution, observations: UsageObservation[], replace = true): void {
    if (!Number.isFinite(Date.parse(execution.startedAt)) || execution.startedAt < this.trackingSince) return;
    const cutoff = (this.db.prepare("SELECT value FROM metadata WHERE key='recovery_before'").get() as any)?.value;
    this.db.transaction(() => {
      const snapshotAt = execution.snapshotAt && Number.isFinite(Date.parse(execution.snapshotAt))
        ? new Date(execution.snapshotAt).toISOString() : undefined;
      if (replace && snapshotAt) {
        const saved = this.db.prepare('SELECT observed_at FROM execution_snapshots WHERE execution_id=?').get(execution.id) as any;
        if (saved && saved.observed_at > snapshotAt) return;
      }
      const previous = this.db.prepare('SELECT status FROM executions WHERE id=?').get(execution.id) as { status: string } | undefined;
      if ((!previous || ['running', 'recovering', 'interrupted'].includes(previous.status)) && execution.agent === 'native' && execution.status === 'running' && cutoff && execution.startedAt < cutoff) {
        execution = { ...execution, status: 'interrupted' };
      }
      if (execution.agent !== 'native' && execution.status === 'running' && cutoff && execution.observedAt && execution.observedAt < cutoff) {
        execution = { ...execution, status: 'recovering' };
      }

      // A late poll must not erase the final snapshot or reopen a finished execution.
      if (replace && previous && !['running', 'queued', 'recovering'].includes(previous.status) && ['running', 'queued', 'recovering'].includes(execution.status)) return;
      this.db.prepare(`INSERT INTO executions VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET chat_id=COALESCE(excluded.chat_id,chat_id),
        drone_id=COALESCE(excluded.drone_id,drone_id), chat_name=COALESCE(excluded.chat_name,chat_name),
        repo=COALESCE(excluded.repo,repo), status=CASE WHEN status NOT IN ('running','queued','recovering') AND excluded.status IN ('running','queued','recovering') THEN status ELSE excluded.status END, updated_at=excluded.updated_at`)
        .run(execution.id, execution.chatId ?? null, execution.droneId ?? null, execution.chatName ?? null,
          execution.repo ?? null, execution.agent, execution.purpose ?? 'chat', execution.startedAt,
          execution.status, new Date().toISOString());
      // Replayed run snapshots supersede provisional message counts with final aggregate counts.
      if (replace) {
        const retained = new Set(observations.map((o) => o.id));
        for (const row of this.db.prepare('SELECT id FROM observations WHERE execution_id=?').all(execution.id) as any[]) {
          if (!retained.has(row.id)) this.db.prepare('DELETE FROM observations WHERE execution_id=? AND id=?').run(execution.id, row.id);
        }
      }
      for (const observation of observations) this.writeObservation(execution, observation);
      if (replace && snapshotAt) {
        this.db.prepare(`INSERT INTO execution_snapshots VALUES (?,?)
          ON CONFLICT(execution_id) DO UPDATE SET observed_at=MAX(observed_at,excluded.observed_at)`).run(execution.id, snapshotAt);
      }
    })();
  }

  beginRecovery(before = new Date().toISOString()): void {
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO metadata VALUES ('recovery_before',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(before);
      // External processes may still be alive; only Hub-owned requests are known to have stopped.
      this.db.prepare(`UPDATE executions SET status=CASE WHEN agent='native' THEN 'interrupted' ELSE 'recovering' END
        WHERE status IN ('running','recovering') AND started_at<?`).run(before);
    })();
  }

  /** The price in effect for a model now (or at `at`), if one is known. */
  currentPrice(provider: string, model: string, at = new Date().toISOString()): UsagePrice | undefined {
    const row = this.db.prepare('SELECT data_json FROM prices WHERE provider=? AND model=? AND effective_at<=? ORDER BY effective_at DESC,created_at DESC,rowid DESC LIMIT 1')
      .get(provider, model, at) as any;
    return row ? JSON.parse(row.data_json) : undefined;
  }

  prices(): UsagePrice[] {
    return (this.db.prepare('SELECT data_json FROM prices ORDER BY provider,model,effective_at DESC,created_at DESC,rowid DESC').all() as any[])
      .map((row) => JSON.parse(row.data_json));
  }

  bindChat(id: string, droneId: string, name: string, repo?: string): void {
    this.db.prepare(`INSERT INTO chats VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      drone_id=excluded.drone_id,name=excluded.name,repo=COALESCE(excluded.repo,repo)`)
      .run(id, droneId, name, repo ?? null);
    this.db.prepare('UPDATE executions SET drone_id=?,chat_name=?,repo=COALESCE(?,repo) WHERE chat_id=?')
      .run(droneId, name, repo ?? null, id);
  }

  chat(id: string): { droneId?: string; chatName?: string; repo?: string } {
    const row = this.db.prepare('SELECT drone_id AS droneId,name AS chatName,repo FROM chats WHERE id=?').get(id);
    return row ? Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) : {};
  }

  addPrice(input: Omit<UsagePrice, 'id' | 'createdAt'>): UsagePrice {
    if (!input || typeof input.provider !== 'string' || !input.provider.trim() ||
      typeof input.model !== 'string' || !input.model.trim() || typeof input.source !== 'string' || !input.source.trim() ||
      !Number.isFinite(Date.parse(input.effectiveAt)) ||
      [input.input, input.output].some((v) => !Number.isFinite(v) || v < 0) ||
      [input.cacheRead, input.cacheWrite].some((v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) ||
      (input.longContext && (!(input.longContext.inputTokensAbove > 0) ||
        [input.longContext.input, input.longContext.output].some((v) => !Number.isFinite(v) || v < 0) ||
        [input.longContext.cacheRead, input.longContext.cacheWrite].some((v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))))) {
      throw new Error('Invalid price: specify provider, model, source, effective date and nonnegative rates');
    }
    const price: UsagePrice = { ...input, origin: input.origin ?? 'manual', provider: input.provider.trim(), model: input.model.trim(), source: input.source.trim(), effectiveAt: new Date(input.effectiveAt).toISOString(), id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO prices VALUES (?,?,?,?,?,?)').run(price.id, price.provider, price.model, price.effectiveAt, price.createdAt, JSON.stringify(price));
    return price;
  }

  addPrices(inputs: Array<Omit<UsagePrice, 'id' | 'createdAt'>>): void {
    this.db.transaction(() => { for (const input of inputs) this.addPrice(input); })();
  }

  analytics(filter: UsageFilter = {}): UsageAnalytics {
    const columns = { agent: 'e.agent', model: 'o.model', provider: 'o.provider', chat: 'e.chat_id', repo: 'e.repo', purpose: "COALESCE(json_extract(o.data_json,'$.purpose'),e.purpose)" };
    const conditions: string[] = [];
    const values: string[] = [];
    for (const [key, column] of Object.entries({ chatId: 'e.chat_id', droneId: 'e.drone_id', agent: 'e.agent', model: 'o.model', provider: 'o.provider', repo: 'e.repo' })) {
      const value = filter[key as keyof UsageFilter];
      if (value) { conditions.push(`${column}=?`); values.push(value); }
    }
    if (filter.from) { conditions.push('e.started_at>=?'); values.push(filter.from); }
    if (filter.to) { conditions.push('e.started_at<?'); values.push(filter.to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = (group?: string) => this.db.prepare(`SELECT ${group ? `${group} AS key,` : ''}
      json_group_array(DISTINCT CASE WHEN o.complete=0 THEN json_extract(o.data_json,'$.partialReason') END) AS reasons_json,
      COUNT(DISTINCT e.id) AS executions,
      COUNT(DISTINCT CASE WHEN o.id IS NULL THEN e.id END) AS missing,
      COUNT(DISTINCT CASE WHEN e.status IN ('interrupted','recovering') OR o.id IS NOT NULL AND (o.complete=0 OR o.input IS NULL OR o.output IS NULL OR o.cache_read IS NULL OR o.cache_write IS NULL) THEN e.id END) AS partial,
      COUNT(DISTINCT CASE WHEN e.status='running' THEN e.id END) AS running,
      COUNT(DISTINCT CASE WHEN e.status='interrupted' THEN e.id END) AS interrupted,
      COUNT(DISTINCT CASE WHEN e.status='recovering' THEN e.id END) AS recovering,
      SUM(o.input) AS input, SUM(o.output) AS output, SUM(o.cache_read) AS cacheRead,
      SUM(o.cache_write) AS cacheWrite, SUM(o.reasoning) AS reasoning,
      CASE WHEN COUNT(o.input)+COUNT(o.output)+COUNT(o.cache_read)+COUNT(o.cache_write)>0 THEN SUM(COALESCE(o.input,0)+COALESCE(o.output,0)+COALESCE(o.cache_read,0)+COALESCE(o.cache_write,0)) END AS total,
      SUM(o.estimated_cost) AS estimatedCost, SUM(o.reported_cost) AS reportedCost,
      COUNT(CASE WHEN o.id IS NOT NULL AND o.estimated_cost IS NULL THEN 1 END) AS unpriced
      FROM executions e LEFT JOIN observations o ON o.execution_id=e.id ${where}
      ${group ? `GROUP BY ${group} ORDER BY total DESC LIMIT 1000` : ''}`).all(...values).map((row: any) => {
        const { reasons_json, ...totals } = row;
        return { ...totals, partialReasons: JSON.parse(reasons_json).filter((reason: unknown) => typeof reason === 'string') };
      }) as Array<UsageTotals & { key: string }>;
    const groups = query(columns[filter.groupBy ?? 'agent']).map((row) => ({ ...row, key: row.key ?? 'unknown', label: row.key ?? 'Unattributed' }));
    if (filter.groupBy === 'chat') {
      const labels = new Map((this.db.prepare('SELECT chat_id, chat_name FROM executions ORDER BY updated_at').all() as any[]).map((r) => [r.chat_id, r.chat_name]));
      for (const group of groups) group.label = labels.get(group.key) || group.key;
    }
    return { trackingSince: this.trackingSince, totals: query()[0], groups,
      daily: query('substr(e.started_at,1,10)').map((row) => ({ ...row, label: row.key })).sort((a,b) => a.key.localeCompare(b.key)) };
  }

  /**
   * Per chat, for canvas cards: what it has cost, when its running work started, and when its last work ended.
   * Chats are named by their current name (renames rebind them), so cards can look them up by drone and chat.
   */
  chatActivity(filter: { droneId?: string } = {}): ChatActivity[] {
    const where = filter.droneId ? 'WHERE COALESCE(c.drone_id,e.drone_id)=?' : '';
    return (this.db.prepare(`SELECT COALESCE(c.drone_id,e.drone_id) AS droneId, COALESCE(c.name,e.chat_name) AS chatName,
      COALESCE(SUM(u.cost),0) AS estimatedCost, COALESCE(SUM(u.tokens),0) AS tokens, SUM(u.unpriced) AS unpriced,
      COALESCE(SUM(u.reported),0) AS reported,
      COALESCE(SUM(CASE WHEN e.purpose='steps' THEN u.cost END),0) AS stepsCost,
      MIN(CASE WHEN e.status='running' AND e.purpose NOT IN ${HELPER_PURPOSES_SQL} THEN e.started_at END) AS runningSince,
      MAX(CASE WHEN e.status NOT IN ('running','queued','recovering') AND e.purpose NOT IN ${HELPER_PURPOSES_SQL} THEN e.updated_at END) AS lastEndedAt
      FROM executions e LEFT JOIN chats c ON c.id=e.chat_id
      LEFT JOIN (SELECT execution_id, SUM(COALESCE(estimated_cost, reported_cost)) AS cost,
        SUM(COALESCE(input,0)+COALESCE(output,0)+COALESCE(cache_read,0)+COALESCE(cache_write,0)) AS tokens,
        COUNT(CASE WHEN estimated_cost IS NULL AND reported_cost IS NULL THEN 1 END) AS unpriced,
        COUNT(CASE WHEN json_extract(data_json,'$.costSource')='reported' OR (estimated_cost IS NULL AND reported_cost IS NOT NULL) THEN 1 END) AS reported
        FROM observations GROUP BY execution_id) u ON u.execution_id=e.id
      ${where}
      GROUP BY 1, 2 HAVING droneId IS NOT NULL AND chatName IS NOT NULL`).all(...(filter.droneId ? [filter.droneId] : [])) as any[])
      .map((row) => ({ ...row, unpriced: row.unpriced ?? 0, reported: row.reported ?? 0 }));
  }

  /** What one helper purpose (such as asks) has cost, in one chat or across all of them. */
  purposeCost(purpose: string, filter: { chatId?: string } = {}): { cost: number; calls: number; unpriced: number } {
    const row = this.db.prepare(`SELECT COUNT(DISTINCT e.id) AS calls,
      COALESCE(SUM(COALESCE(o.estimated_cost, o.reported_cost)),0) AS cost,
      COUNT(CASE WHEN o.id IS NOT NULL AND o.estimated_cost IS NULL AND o.reported_cost IS NULL THEN 1 END) AS unpriced
      FROM executions e LEFT JOIN observations o ON o.execution_id=e.id
      WHERE e.purpose=? ${filter.chatId ? 'AND e.chat_id=?' : ''}`).get(...[purpose, ...(filter.chatId ? [filter.chatId] : [])]) as any;
    return { cost: Number(row?.cost ?? 0), calls: Number(row?.calls ?? 0), unpriced: Number(row?.unpriced ?? 0) };
  }

  /** One helper purpose's cost per chat, most expensive first; chats are named by their current names. */
  purposeCostByChat(purpose: string, limit = 20): Array<{ droneId: string; chatName: string; cost: number; calls: number; unpriced: number }> {
    return (this.db.prepare(`SELECT COALESCE(c.drone_id,e.drone_id) AS droneId, COALESCE(c.name,e.chat_name) AS chatName,
      COUNT(DISTINCT e.id) AS calls, COALESCE(SUM(COALESCE(o.estimated_cost, o.reported_cost)),0) AS cost,
      COUNT(CASE WHEN o.id IS NOT NULL AND o.estimated_cost IS NULL AND o.reported_cost IS NULL THEN 1 END) AS unpriced
      FROM executions e LEFT JOIN chats c ON c.id=e.chat_id LEFT JOIN observations o ON o.execution_id=e.id
      WHERE e.purpose=? GROUP BY 1, 2 HAVING droneId IS NOT NULL AND chatName IS NOT NULL
      ORDER BY cost DESC, calls DESC LIMIT ?`).all(purpose, limit) as any[])
      .map((row) => ({ ...row, cost: Number(row.cost ?? 0), calls: Number(row.calls ?? 0), unpriced: Number(row.unpriced ?? 0) }));
  }

  /** Chats with agent work running now, by their current names. */
  runningChats(): Array<{ droneId: string; chatName: string; chatId: string | null; startedAt: string }> {
    return this.db.prepare(`SELECT COALESCE(c.drone_id,e.drone_id) AS droneId, COALESCE(c.name,e.chat_name) AS chatName,
      e.chat_id AS chatId, MIN(e.started_at) AS startedAt
      FROM executions e LEFT JOIN chats c ON c.id=e.chat_id
      WHERE e.status='running' AND e.purpose NOT IN ${HELPER_PURPOSES_SQL}
      GROUP BY 1, 2 HAVING droneId IS NOT NULL AND chatName IS NOT NULL`).all() as any[];
  }

  close(): void { this.db.close(); }

  /**
   * Claude Code's end-of-turn totals (`modelUsage`, `costUSD`) cover its whole session so far, not the turn: summed
   * per turn they count every earlier turn again. A turn keeps what it added since the session's previous turn; the
   * running totals stay in `cumulative`, for the next turn to subtract.
   */
  private sessionTurnDelta(execution: UsageExecution, observation: UsageObservation): UsageObservation {
    const sessionId = (observation as { sessionId?: string }).sessionId;
    if (observation.provider !== 'anthropic' || observation.scope !== 'tree' || !sessionId || execution.agent !== 'claude') return observation;
    const current = (observation as { cumulative?: SessionTotals }).cumulative ?? sessionTotals(observation);
    const previousRow = this.db.prepare(`SELECT o.data_json FROM observations o JOIN executions e ON e.id=o.execution_id
      WHERE o.provider='anthropic' AND o.model=? AND o.execution_id<>? AND e.started_at<=?
        AND json_extract(o.data_json,'$.scope')='tree' AND json_extract(o.data_json,'$.sessionId')=?
      ORDER BY e.started_at DESC, e.rowid DESC LIMIT 1`).get(observation.model, execution.id, execution.startedAt, sessionId) as any;
    const previousData = previousRow ? JSON.parse(previousRow.data_json) : null;
    const previous: SessionTotals | null = previousData ? previousData.cumulative ?? sessionTotals(previousData) : null;
    // A session that restarted its count (a new process) is already per-process: keep it as it is.
    const continues = previous && TOTAL_FIELDS.every((field) => (current[field] ?? 0) >= (previous[field] ?? 0));
    const delta = (field: keyof SessionTotals) => current[field] === null ? null
      : continues ? Math.max(0, (current[field] ?? 0) - (previous![field] ?? 0)) : current[field];
    return { ...observation, input: delta('input'), output: delta('output'), cacheRead: delta('cacheRead'),
      cacheWrite: delta('cacheWrite'), reasoning: delta('reasoning'), reportedCost: delta('reportedCost') ?? undefined,
      cumulative: current } as UsageObservation;
  }

  /** Once: rewrites Claude session totals recorded before `sessionTurnDelta`, oldest first so each finds its predecessor. */
  private repairCumulativeSessionTotals(): void {
    const key = 'claude_session_turn_deltas_v1';
    if (this.db.prepare('SELECT 1 FROM metadata WHERE key=?').get(key)) return;
    this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT e.id, e.agent, e.started_at AS startedAt, o.data_json FROM observations o
        JOIN executions e ON e.id=o.execution_id
        WHERE e.agent='claude' AND o.provider='anthropic' AND json_extract(o.data_json,'$.scope')='tree'
          AND json_extract(o.data_json,'$.cumulative') IS NULL
        ORDER BY e.started_at, e.rowid`).all() as any[];
      for (const row of rows) {
        this.writeObservation({ id: row.id, agent: row.agent, startedAt: row.startedAt, status: 'done' }, JSON.parse(row.data_json));
      }
      this.db.prepare('INSERT INTO metadata VALUES (?,?)').run(key, new Date().toISOString());
    })();
  }

  /**
   * Once: prices Anthropic usage again, now that 1-hour cache writes are told apart, Claude Opus 5.5 has a price and
   * finished Claude turns take the cost Claude reported. Oldest first, so each Claude turn still finds the session
   * totals of the one before.
   */
  private repricePricedAnthropicCacheWrites(): void {
    const key = 'anthropic_cache_writes_and_claude_reported_costs_v2';
    if (this.db.prepare('SELECT 1 FROM metadata WHERE key=?').get(key)) return;
    this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT e.id, e.agent, e.started_at AS startedAt, o.data_json FROM observations o
        JOIN executions e ON e.id=o.execution_id WHERE o.provider='anthropic' ORDER BY e.started_at, e.rowid`).all() as any[];
      for (const row of rows) {
        this.writeObservation({ id: row.id, agent: row.agent, startedAt: row.startedAt, status: 'done' }, JSON.parse(row.data_json));
      }
      this.db.prepare('INSERT INTO metadata VALUES (?,?)').run(key, new Date().toISOString());
    })();
  }

  /**
   * The cost of a finished Claude Code turn is the one Claude reported: it priced what it actually sent (1-hour and
   * 5-minute cache writes, long context, fast mode, web searches) from Anthropic's current rates. Only the Hub prices
   * the rest: requests of a turn still running, and agents that report no cost.
   */
  private static claudeReportedCost(execution: UsageExecution, observation: UsageObservation): number | null {
    return execution.agent === 'claude' && observation.provider === 'anthropic' && observation.scope === 'tree'
      && typeof observation.reportedCost === 'number' ? observation.reportedCost : null;
  }

  /**
   * Claude Code reports a request's output only when its turn ends, so while it works each request has its input and
   * cache use but no output. Priced with no output, a running turn's cost still grows (cache reads are most of it);
   * when the turn ends, the cost Claude reports replaces these.
   */
  private static claudeRequestSoFar(execution: UsageExecution, observation: UsageObservation): UsageObservation {
    return execution.agent === 'claude' && observation.provider === 'anthropic' && observation.scope === 'request' && observation.output === null
      ? { ...observation, output: 0 }
      : observation;
  }

  /** A single Anthropic request says which of its cache writes were kept for an hour. */
  private static oneHourCacheWrites(observation: UsageObservation): number | null {
    if (observation.provider !== 'anthropic' || typeof observation.cacheWrite1h === 'number') return null;
    const split = (observation as { raw?: any }).raw?.cache_creation?.ephemeral_1h_input_tokens;
    return typeof split === 'number' ? split : null;
  }

  private writeObservation(execution: UsageExecution, incoming: UsageObservation): void {
    const delta = this.sessionTurnDelta(execution, incoming);
    let observation = delta;
    const old = this.db.prepare('SELECT price_id,model,provider FROM observations WHERE execution_id=? AND id=?').get(execution.id, observation.id) as any;
    const priceRow = old?.price_id && old.model === observation.model && old.provider === observation.provider
      ? this.db.prepare('SELECT data_json FROM prices WHERE id=?').get(old.price_id) as any
      : this.db.prepare('SELECT data_json FROM prices WHERE provider=? AND model=? AND effective_at<=? ORDER BY effective_at DESC,created_at DESC,rowid DESC LIMIT 1')
        .get(observation.provider, observation.model, execution.startedAt) as any;
    const price: UsagePrice | undefined = priceRow ? JSON.parse(priceRow.data_json) : undefined;
    const reported = UsageStore.claudeReportedCost(execution, delta);
    if (reported !== null) {
      // A 1-hour share worked out from the reported cost before is not a count Claude gave: drop it.
      const { cacheWrite1h: _derived, ...rest } = delta as UsageObservation & { cacheWrite1h?: number | null };
      observation = { ...rest, costSource: 'reported' } as UsageObservation;
    } else {
      const cacheWrite1h = UsageStore.oneHourCacheWrites(delta);
      if (cacheWrite1h !== null) observation = { ...delta, cacheWrite1h };
    }
    const estimate = reported ?? estimateUsageCost(price, UsageStore.claudeRequestSoFar(execution, observation), observation.scope === 'request');
    this.db.prepare(`INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(execution_id,id) DO UPDATE SET model=excluded.model,provider=excluded.provider,
      input=excluded.input,output=excluded.output,cache_read=excluded.cache_read,cache_write=excluded.cache_write,
      reasoning=excluded.reasoning,complete=excluded.complete,price_id=excluded.price_id,
      estimated_cost=excluded.estimated_cost,reported_cost=excluded.reported_cost,data_json=excluded.data_json`)
      .run(execution.id, observation.id, observation.model, observation.provider,
        observation.input, observation.output, observation.cacheRead, observation.cacheWrite, observation.reasoning,
        observation.complete ? 1 : 0, reported === null ? price?.id ?? null : null, estimate, observation.reportedCost ?? null, JSON.stringify(observation));
  }
}

type SessionTotals = { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null; reasoning: number | null; reportedCost: number | null };
const TOTAL_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reportedCost'] as const;
function sessionTotals(o: any): SessionTotals {
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  return { input: n(o.input), output: n(o.output), cacheRead: n(o.cacheRead), cacheWrite: n(o.cacheWrite), reasoning: n(o.reasoning), reportedCost: n(o.reportedCost) };
}

let active: { path: string; store: UsageStore } | undefined;
export function getUsageStore(): UsageStore {
  const file = droneRootPath('usage.sqlite');
  if (active?.path !== file) { active?.store.close(); active = { path: file, store: new UsageStore(file) }; }
  return active.store;
}
