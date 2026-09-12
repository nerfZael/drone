import React from 'react';
import { Popover } from 'radix-ui';
import {
  chatSubscriptionResourceLabel,
  chatSubscriptionEventLabel,
  chatSubscriptionNextRunLabel,
  chatSubscriptionDisplayIntent,
  type ChatResourceSubscription,
} from '../app/chat-resource-subscriptions';

export function CompanionSubscriptions({ subscriptions }: { subscriptions: ChatResourceSubscription[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`Companion subscriptions: ${subscriptions.length}`}
          title="Companion subscriptions"
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-1.5 text-[var(--muted)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
          </svg>
          <span className="text-[10px] tabular-nums">{subscriptions.length}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={8} aria-label="Companion subscriptions" data-companion-surface="true"
          className="z-[110] max-h-[var(--radix-popover-content-available-height)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel-raised)] shadow-[var(--shadow-dialog)]">
          <div className="border-b border-[var(--border-subtle)] px-3 py-2.5 text-xs font-semibold text-[var(--fg)]">Companion subscriptions</div>
          {subscriptions.length === 0 ? <p className="p-3 text-xs text-[var(--muted)]">Companion has no active subscriptions.</p> : null}
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
