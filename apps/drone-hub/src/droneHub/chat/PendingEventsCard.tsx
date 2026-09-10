import React from 'react';
import { eventNotificationEventLabel } from '@drone/assistant-chat';
import { pendingEventStatus, type PendingEventsState } from './use-pending-events';

export function PendingEventsCard({ state }: { state: PendingEventsState }) {
  const [clock, setClock] = React.useState(Date.now);
  React.useEffect(() => {
    if (!state.deliveries.length) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state.deliveries.length]);
  if (!state.deliveries.length && !state.error) return null;
  const now =
    state.serverNow && state.receivedAt
      ? Date.parse(state.serverNow) + Math.max(0, clock - state.receivedAt)
      : clock;
  return (
    <section
      aria-label="Pending events"
      className="rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-4 py-3 text-11"
    >
      <div className="font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
        {state.deliveries.length
          ? `${state.deliveries.length} pending event${state.deliveries.length === 1 ? '' : 's'}`
          : 'Pending events'}
      </div>
      {(['queue', 'asap'] as const).map((mode) => {
        const events = state.deliveries.filter((event) => event.deliveryMode === mode);
        if (!events.length) return null;
        const timed = events
          .filter((event) => event.releaseAt)
          .sort((a, b) => a.releaseAt!.localeCompare(b.releaseAt!));
        const status = state.stale
          ? 'Status unavailable'
          : pendingEventStatus(timed[0] ?? events[0]!, now);
        const releasable = events.filter((event) => event.canRelease).slice(0, 1_000);
        const deliveryHelp =
          mode === 'queue'
            ? 'Skip the batch delay. Events wait for the current response to finish.'
            : 'Skip the batch delay. Events use the next available delivery point.';
        return (
          <div key={mode} className="mt-2 border-t border-[var(--border-subtle)] pt-2">
            <div className="flex items-center justify-between gap-3">
              <span>
                {mode === 'queue' ? 'Queued delivery' : 'ASAP delivery'} · {events.length}
              </span>
              <button
                type="button"
                title={deliveryHelp}
                aria-label={`Send ${mode === 'queue' ? 'queued' : 'ASAP'} events now`}
                disabled={state.busy || state.stale || !releasable.length}
                onClick={() => state.release(releasable.map((event) => event.id))}
                className="rounded px-2 py-1 font-[var(--weight-semibold)] text-[var(--accent)] hover:bg-[var(--accent-subtle)] focus-visible:outline focus-visible:outline-2 disabled:opacity-40"
              >
                {state.busy ? 'Sending…' : 'Send now'}
              </button>
            </div>
            <div className="text-[var(--muted)]">{status}</div>
            <details className="mt-1">
              <summary className="cursor-pointer text-[var(--fg-secondary)]">
                {Array.from(
                  new Set(events.map((event) => eventNotificationEventLabel(event.eventType))),
                )
                  .slice(0, 3)
                  .join(' · ')}
              </summary>
              <ul className="mt-2 space-y-2">
                {events.map((event) => (
                  <li key={event.id}>
                    <div>{event.summary}</div>
                    <div className="text-[var(--muted)]">
                      {state.stale ? 'Status unavailable' : pendingEventStatus(event, now)}
                    </div>
                    {event.error && ['failed', 'retrying'].includes(event.status) ? (
                      <div className="text-[var(--red)]">{event.error}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        );
      })}
      {state.error ? (
        <div role="alert" className="mt-2 text-[var(--red)]">
          Pending event status: {state.error}
        </div>
      ) : null}
    </section>
  );
}
