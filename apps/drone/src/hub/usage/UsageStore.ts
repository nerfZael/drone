import crypto from 'node:crypto';
import type { UsageAnalytics, UsageObservation, UsagePrice, UsageTotals } from '@drone/assistant-chat';
import { droneRootPath } from '../../host/paths';
import { openUsageDatabase } from './helpers/openUsageDatabase';
import { USAGE_SCHEMA } from './usage-schema';

export type UsageExecution = {
  id: string; chatId?: string; droneId?: string; chatName?: string; repo?: string;
  agent: string; purpose?: string; startedAt: string; status: string; observedAt?: string; snapshotAt?: string;
};
export type UsageFilter = {
  chatId?: string; droneId?: string; agent?: string; model?: string; provider?: string; repo?: string;
  from?: string; to?: string; groupBy?: 'agent' | 'model' | 'provider' | 'chat' | 'repo' | 'purpose';
};

export class UsageStore {
  private readonly db: import('better-sqlite3').Database;
  readonly trackingSince: string;

  constructor(databasePath = droneRootPath('usage.sqlite')) {
    this.db = openUsageDatabase(databasePath);
    this.db.exec(USAGE_SCHEMA);
    this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('tracking_since', ?)").run(new Date().toISOString());
    this.trackingSince = (this.db.prepare("SELECT value FROM metadata WHERE key='tracking_since'").get() as any).value;
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
      [input.cacheRead, input.cacheWrite].some((v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))) {
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

  close(): void { this.db.close(); }

  private writeObservation(execution: UsageExecution, observation: UsageObservation): void {
    const old = this.db.prepare('SELECT price_id,model,provider FROM observations WHERE execution_id=? AND id=?').get(execution.id, observation.id) as any;
    const priceRow = old?.price_id && old.model === observation.model && old.provider === observation.provider
      ? this.db.prepare('SELECT data_json FROM prices WHERE id=?').get(old.price_id) as any
      : this.db.prepare('SELECT data_json FROM prices WHERE provider=? AND model=? AND effective_at<=? ORDER BY effective_at DESC,created_at DESC,rowid DESC LIMIT 1')
        .get(observation.provider, observation.model, execution.startedAt) as any;
    const price: UsagePrice | undefined = priceRow ? JSON.parse(priceRow.data_json) : undefined;
    const fields = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
    const estimate = price && fields.every((field) => observation[field] !== null && (observation[field] === 0 || price[field] !== null))
      ? fields.reduce((sum, field) => sum + observation[field]! * (price[field] ?? 0) / 1_000_000, 0) : null;
    this.db.prepare(`INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(execution_id,id) DO UPDATE SET model=excluded.model,provider=excluded.provider,
      input=excluded.input,output=excluded.output,cache_read=excluded.cache_read,cache_write=excluded.cache_write,
      reasoning=excluded.reasoning,complete=excluded.complete,price_id=excluded.price_id,
      estimated_cost=excluded.estimated_cost,reported_cost=excluded.reported_cost,data_json=excluded.data_json`)
      .run(execution.id, observation.id, observation.model, observation.provider,
        observation.input, observation.output, observation.cacheRead, observation.cacheWrite, observation.reasoning,
        observation.complete ? 1 : 0, price?.id ?? null, estimate, observation.reportedCost ?? null, JSON.stringify(observation));
  }
}

let active: { path: string; store: UsageStore } | undefined;
export function getUsageStore(): UsageStore {
  const file = droneRootPath('usage.sqlite');
  if (active?.path !== file) { active?.store.close(); active = { path: file, store: new UsageStore(file) }; }
  return active.store;
}
