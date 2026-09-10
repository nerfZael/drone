import React from 'react';
import type { UsagePrice } from '@drone/assistant-chat';
import { requestJson } from '../http';

const fieldClass = 'rounded border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1 text-sm';

export function UsagePrices() {
  const [prices, setPrices] = React.useState<UsagePrice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [revision, reload] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void requestJson<{ prices: UsagePrice[] }>('/api/usage/prices', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setPrices(result.prices); setError(''); } })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const refresh = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await requestJson<{ added: number }>('/api/usage/prices/refresh', { method: 'POST' });
      setNotice(`${result.added} new price versions saved. Existing priced usage keeps its original rates.`); reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    try {
      await requestJson('/api/usage/prices', { method: 'POST', body: JSON.stringify({
        provider: fields.get('provider'), model: fields.get('model'), source: fields.get('source'),
        effectiveAt: new Date().toISOString(),
        ...Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].map((key) => [key, Number(fields.get(key))])),
      }) });
      setNotice('Price saved for new usage. Previous estimates are unchanged.'); form.reset(); reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };
  const filtered = prices.filter((price) => `${price.provider} ${price.model}`.toLowerCase().includes(search.toLowerCase()));
  return <details className="rounded border border-[var(--border-subtle)] p-3">
    <summary className="cursor-pointer text-sm font-medium">Model price registry</summary>
    <p className="my-3 text-xs text-[var(--fg-secondary)]">USD per million tokens. Versions are retained; refreshing does not rewrite recorded estimates. Catalog rates describe standard token usage. Add an explicit provider/model price when your rate differs. Manual prices are preserved during catalog refreshes.</p>
    <div className="flex flex-wrap gap-2">
      <label className="text-xs">Find model or provider <input className={fieldClass} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <button className={fieldClass} type="button" disabled={busy || loading} onClick={() => void refresh()}>{busy ? 'Saving…' : 'Refresh catalog'}</button>
    </div>
    {loading ? <p role="status" className="mt-2 text-xs">Loading prices…</p> : null}
    {error ? <p role="alert" className="mt-2 text-xs">{error} <button type="button" className="underline" disabled={busy} onClick={reload}>Retry</button></p> : null}
    {notice ? <p role="status" className="mt-2 text-xs">{notice}</p> : null}
    {!loading && !filtered.length ? <p className="mt-3 text-xs">No matching prices. Refresh the catalog or add a price below.</p> : null}
    <div className="my-3 max-h-72 overflow-auto"><table className="w-full text-left text-xs">
      <caption className="text-left">Showing {Math.min(100, filtered.length)} of {filtered.length} matching price versions</caption>
      <thead><tr>{['Provider / model', 'Input', 'Output', 'Cache read', 'Cache write', 'Effective / source'].map((label) => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
      <tbody>{filtered.slice(0, 100).map((price) => <tr key={price.id} className="border-t border-[var(--border-subtle)]">
        <td className="p-2">{price.provider} / {price.model}</td>
        {[price.input, price.output, price.cacheRead, price.cacheWrite].map((value, index) => <td className="p-2" key={index}>{value === null ? 'Unavailable' : `$${value}`}</td>)}
        <td className="max-w-64 break-words p-2">{new Date(price.effectiveAt).toLocaleString()}<br />{price.source}</td>
      </tr>)}</tbody>
    </table></div>
    <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-2">
      {['provider', 'model', 'source'].map((key) => <label className="grid gap-1 text-xs" key={key}>{key}<input name={key} className={fieldClass} required maxLength={500} disabled={busy} /></label>)}
      {([['input', 'Input'], ['output', 'Output'], ['cacheRead', 'Cache read'], ['cacheWrite', 'Cache write']] as const).map(([key, label]) =>
        <label key={key} className="grid gap-1 text-xs">{label}<input className={`${fieldClass} w-24`} name={key} type="number" min="0" step="any" required disabled={busy} /></label>)}
      <button className={fieldClass} type="submit" disabled={busy || loading}>Save new price</button>
    </form>
  </details>;
}
