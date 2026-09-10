import React from 'react';
import type { UsageAnalytics } from '@drone/assistant-chat';
import { useUsageData } from './useUsageData';
import { usageCost, usageNumber } from './usage-format';
import { UsagePrices } from './UsagePrices';

const inputClass = 'rounded border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1.5 text-sm';

export function UsageAnalyticsView() {
  const [groupBy, setGroupBy] = React.useState('agent');
  const [agent, setAgent] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [model, setModel] = React.useState('');
  const [provider, setProvider] = React.useState('');
  const params = new URLSearchParams({ groupBy });
  if (agent) params.set('agent', agent);
  if (model) params.set('model', model);
  if (provider) params.set('provider', provider);
  if (from) params.set('from', `${from}T00:00:00Z`);
  if (to) params.set('to', new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString());
  const { data, error, refresh } = useUsageData(`/api/usage?${params}`);
  const totals = data?.totals;
  return <div className="space-y-5 text-[var(--fg)]">
    <p className="text-sm text-[var(--fg-secondary)]">Token consumption across this Hub, including hidden and archived chats. Estimates use standard USD token rates and exclude subscription, regional, service-tier and tool charges. Unreported usage remains unavailable.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs">Group by<select className={inputClass} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
        {['agent', 'model', 'provider', 'chat', 'repo', 'purpose'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs">Agent<select className={inputClass} value={agent} onChange={(e) => setAgent(e.target.value)}>
        <option value="">All agents</option>{['native', 'codex', 'claude', 'opencode', 'cursor'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs">From (UTC)<input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">Through (UTC)<input className={inputClass} type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">Model ID<input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} placeholder="All models" /></label>
      <label className="grid gap-1 text-xs">Provider ID<input className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="All providers" /></label>
      <button className={inputClass} type="button" onClick={refresh}>Refresh</button>
    </div>
    {error ? <p role="alert" className="text-red-400">{error}. Previously loaded totals may be stale.</p> : null}
    {!data && !error ? <p role="status">Loading usage…</p> : null}
    {totals ? <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Tokens', totals.executions ? usageNumber(totals.total) : '0'], [totals.unpriced || totals.partial || totals.missing ? 'Estimated cost (partial)' : 'Estimated cost', totals.executions ? usageCost(totals.estimatedCost) : '$0.00'], ['Executions', usageNumber(totals.executions)], ['Missing / partial', `${totals.missing} / ${totals.partial}`]].map(([label, value]) =>
          <div key={label} className="rounded border border-[var(--border-subtle)] p-3"><p className="text-xs text-[var(--fg-secondary)]">{label}</p><p className="mt-1 text-lg">{value}</p></div>)}
      </div>
      <p className="text-xs text-[var(--fg-secondary)]">Tracking since {new Date(data!.trackingSince).toLocaleString()}. {totals.running} running, {totals.recovering ?? 0} recovering and {totals.interrupted ?? 0} interrupted executions; {totals.unpriced} unpriced records. Partial totals are recorded amounts, not a complete bill. Reasoning is included in output.</p>
      {totals.executions === 0 ? <p>No usage in this period. New agent executions will appear here.</p> : <>
        <UsageTable rows={data!.groups} label={`Usage by ${groupBy}`} />
        <UsageTable rows={data!.daily} label="Daily usage (UTC)" />
      </>}
    </> : null}
    <UsagePrices />
  </div>;
}

function UsageTable({ rows, label }: { rows: UsageAnalytics['groups']; label: string }) {
  const maximum = Math.max(1, ...rows.map((row) => row.total ?? 0));
  return <div className="overflow-x-auto"><table className="w-full text-left text-xs">
    <caption className="py-2 text-left text-sm font-medium">{label} · up to 1,000 groups</caption>
    <thead><tr>{['Group', 'Total', 'Input', 'Output', 'Cache read', 'Cache write', 'Reasoning', 'Estimated USD'].map((title) => <th className="px-2 py-2" key={title}>{title}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr className="border-t border-[var(--border-subtle)]" key={row.key}>
      <td className="max-w-60 break-words px-2 py-2">{row.label}<div aria-hidden="true" className="mt-1 h-1 bg-[var(--accent)]" style={{ width: `${100 * (row.total ?? 0) / maximum}%` }} /></td>
      {[row.total, row.input, row.output, row.cacheRead, row.cacheWrite, row.reasoning].map((value, index) => <td className="px-2 py-2 tabular-nums" key={index}>{usageNumber(value)}</td>)}
      <td className="px-2 py-2">{usageCost(row.estimatedCost)}{row.unpriced || row.partial || row.missing ? ' *' : ''}</td>
    </tr>)}</tbody>
  </table></div>;
}
