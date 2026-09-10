import React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { UiToolbarButton } from '../../ui/components';
import { settingsQueryKey, type SettingsRequestJson } from './settings-query';

type CatalogPage = {
  events: Array<{ name: string; description: string; lastEmittedAt: string | null }>;
  nextCursor: string | null;
};
type HistoryPage = {
  events: Array<{
    eventId: string;
    name: string;
    occurredAt: string;
    source: { droneId: string; chatId: string; chatName: string };
    data: Record<string, unknown>;
  }>;
  nextCursor: string | null;
  retentionDays: number;
};

export function EventData({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null) return <span className="text-[var(--muted)]">Null</span>;
  if (typeof value !== 'object') {
    return <span className="whitespace-pre-wrap break-words">{value === '' ? '(empty text)' : String(value)}</span>;
  }
  const entries = Object.entries(value);
  if (!entries.length) return <span className="text-[var(--muted)]">{Array.isArray(value) ? 'Empty list' : 'No fields'}</span>;
  if (depth >= 8) return <details><summary>Nested data</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre></details>;
  return (
    <dl className="min-w-0 divide-y divide-[var(--border-subtle)]">
      {entries.map(([key, item]) => (
        <div key={key} className="grid min-w-0 gap-1 py-2 sm:grid-cols-[minmax(100px,1fr)_minmax(0,3fr)] sm:gap-4">
          <dt className="break-words text-[var(--muted)]">{Array.isArray(value) ? Number(key) + 1 : key}</dt>
          <dd className="min-w-0"><EventData value={item} depth={depth + 1} /></dd>
        </div>
      ))}
    </dl>
  );
}

export function CustomEventsSettingsTab({ requestJson }: { requestJson: SettingsRequestJson }) {
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState('');
  const catalog = useInfiniteQuery({
    queryKey: settingsQueryKey('custom-event-catalog', search),
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ query: search, limit: '100' });
      if (pageParam) params.set('after', pageParam);
      return requestJson<CatalogPage>(`/api/custom-events?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const names = catalog.data?.pages.flatMap((page) => page.events) ?? [];
  const name = selected || names.find((event) => event.lastEmittedAt)?.name || names[0]?.name || '';
  const history = useInfiniteQuery({
    queryKey: settingsQueryKey('custom-event-history', name),
    initialPageParam: '',
    enabled: Boolean(name),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ name, limit: '50' });
      if (pageParam) params.set('after', pageParam);
      return requestJson<HistoryPage>(`/api/settings/custom-events/history?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const events = history.data?.pages.flatMap((page) => page.events) ?? [];
  const description = names.find((event) => event.name === name)?.description;
  const controlClass = 'rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[var(--fg)]';
  return (
    <section className="flex min-w-0 flex-col gap-4 text-sm text-[var(--fg)]">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">Find event names
          <input className={controlClass} type="search" value={search} placeholder="Search names or descriptions" onChange={(event) => { setSearch(event.target.value); setSelected(''); }} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">Event name
          <select className={controlClass} value={name} onChange={(event) => setSelected(event.target.value)}>
            {!names.length && <option value="">No event names</option>}
            {names.map((event) => <option key={event.name} value={event.name}>{event.name}</option>)}
          </select>
        </label>
        {catalog.hasNextPage && <UiToolbarButton disabled={catalog.isFetching} onClick={() => void catalog.fetchNextPage()}>More event names</UiToolbarButton>}
        <UiToolbarButton disabled={catalog.isFetching || history.isFetching} onClick={() => { void catalog.refetch(); if (name) void history.refetch(); }}>Refresh</UiToolbarButton>
      </div>
      {description && <p className="whitespace-pre-wrap break-words text-[var(--muted)]">{description}</p>}
      {(catalog.error || history.error) && <p role="alert">{catalog.error?.message || history.error?.message}</p>}
      {(catalog.isPending || (name && history.isPending)) && <p role="status">Loading custom events…</p>}
      {!catalog.isPending && !catalog.error && !names.length && <p>No custom events match your search.</p>}
      {history.data && <p className="text-[var(--muted)]">{events.length} loaded · Newest first · Configured retention: {history.data.pages[0].retentionDays} days</p>}
      {name && history.data && !events.length && <p>No retained emissions for this event.</p>}
      {events.map((event) => (
        <details key={event.eventId} className="min-w-0 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] p-3">
          <summary className="cursor-pointer break-words">
            <span className="font-medium">{event.name}</span>
            <span className="ml-3 text-[var(--muted)]">{new Date(event.occurredAt).toLocaleString()} · {event.source.chatName}</span>
          </summary>
          <dl className="mt-3 grid gap-1 break-all text-xs text-[var(--muted)]">
            <div><dt className="inline">Drone: </dt><dd className="inline">{event.source.droneId}</dd></div>
            <div><dt className="inline">Chat: </dt><dd className="inline">{event.source.chatId}</dd></div>
            <div><dt className="inline">Event ID: </dt><dd className="inline">{event.eventId}</dd></div>
            <div><dt className="inline">Occurred at: </dt><dd className="inline">{event.occurredAt}</dd></div>
          </dl>
          <div className="mt-3"><EventData value={event.data} /></div>
        </details>
      ))}
      {history.hasNextPage && <UiToolbarButton disabled={history.isFetching} onClick={() => void history.fetchNextPage()}>Load older events</UiToolbarButton>}
    </section>
  );
}
