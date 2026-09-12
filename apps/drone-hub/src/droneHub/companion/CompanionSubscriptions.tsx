import React from 'react';
import { Popover } from 'radix-ui';
import { requestJson } from '../http';
import {
  normalizeChatResourceSubscriptions,
  chatSubscriptionResourceLabel,
  chatSubscriptionEventLabel,
  chatSubscriptionNextRunLabel,
  chatSubscriptionDisplayIntent,
  type ChatResourceSubscription,
} from '../app/chat-resource-subscriptions';

export function useCompanionSubscriptions(sessionId: string | null, open: boolean) {
  const [snapshot, setSnapshot] = React.useState<{
    sessionId: string | null; subscriptions: ChatResourceSubscription[]; loading: boolean; error: string;
  }>({ sessionId: null, subscriptions: [], loading: false, error: '' });
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await requestJson<{ subscriptions: unknown }>(
          `/api/resource-subscriptions?subscriberChatId=${encodeURIComponent(`companion:${sessionId}`)}`,
        );
        if (alive) setSnapshot({ sessionId, subscriptions: normalizeChatResourceSubscriptions(response.subscriptions), loading: false, error: '' });
      } catch (error) {
        if (alive) setSnapshot((previous) => ({ sessionId,
          subscriptions: previous.sessionId === sessionId ? previous.subscriptions : [], loading: false,
          error: error instanceof Error ? error.message : String(error) }));
      } finally {
        if (alive) timer = setTimeout(() => void load(), 5_000);
      }
    };
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, [sessionId, open, retry]);
  const current = snapshot.sessionId === sessionId ? snapshot
    : { subscriptions: [], loading: Boolean(sessionId), error: '' };
  return { ...current, reload: () => setRetry((value) => value + 1) };
}

export function CompanionSubscriptions({ sessionId }: { sessionId: string | null }) {
  const [open, setOpen] = React.useState(false);
  const { subscriptions, loading, error, reload } = useCompanionSubscriptions(sessionId, open);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`Companion subscriptions: ${loading ? 'loading' : error ? 'unavailable' : subscriptions.length}`}
          title="Companion subscriptions"
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-1.5 text-[var(--muted)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
          </svg>
          <span className="text-[10px] tabular-nums">{loading ? '…' : error ? '!' : subscriptions.length}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={8} aria-label="Companion subscriptions" data-companion-surface="true"
          className="z-[110] max-h-[var(--radix-popover-content-available-height)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel-raised)] shadow-[var(--shadow-dialog)]">
          <div className="border-b border-[var(--border-subtle)] px-3 py-2.5 text-xs font-semibold text-[var(--fg)]">Companion subscriptions</div>
          {loading ? <p role="status" className="p-3 text-xs text-[var(--muted)]">Loading subscriptions…</p> : null}
          {error ? <p role="alert" className="p-3 text-xs text-[var(--red)]">{error} <button type="button" onClick={reload} className="underline">Retry</button></p> : null}
          {!loading && !error && subscriptions.length === 0 ? <p className="p-3 text-xs text-[var(--muted)]">Companion has no active subscriptions.</p> : null}
          <div className="space-y-1 p-1.5">
            {subscriptions.map((subscription) => {
              const nextRun = chatSubscriptionNextRunLabel(subscription);
              const intent = chatSubscriptionDisplayIntent(subscription.intent, subscriptions);
              return <div key={subscription.id} className="rounded-md px-2.5 py-2 text-xs hover:bg-[var(--surface-soft)]">
                <div className="break-words font-semibold text-[var(--fg-secondary)]">{chatSubscriptionResourceLabel(subscription)}</div>
                {subscription.resourceType === 'cron' && subscription.resourceConfig?.expression ? <div className="mt-1 font-mono text-[var(--muted)]">Cron · {subscription.resourceConfig.expression}</div> : null}
                <div className="mt-1 text-[var(--muted)]">{subscription.events.map(chatSubscriptionEventLabel).join(', ')}</div>
                {nextRun ? <time dateTime={subscription.nextEventAt ?? undefined} className="mt-1 block text-[var(--muted)]">{nextRun}</time> : null}
                {intent ? <div className="mt-1.5 whitespace-pre-wrap break-words text-[var(--muted)]">{intent}</div> : null}
              </div>;
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
