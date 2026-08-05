import React from 'react';

import { requestJson } from '../http';
import { useDropdownDismiss } from '../../ui/dropdown';
import { DroneRuntimeIndicator, type DroneRuntime } from './DroneRuntimeIndicator';
import {
  chatSubscriptionEventLabel,
  chatSubscriptionResourceLabel,
  chatSubscriptionSummary,
  normalizeChatResourceSubscriptions,
  type ChatResourceSubscription,
} from './chat-resource-subscriptions';

const SUBSCRIPTION_REFRESH_MS = 5_000;

function sameSubscriptions(
  left: ChatResourceSubscription[],
  right: ChatResourceSubscription[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function useChatResourceSubscriptions(droneIdRaw: string, chatNameRaw: string) {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  const [subscriptions, setSubscriptions] = React.useState<ChatResourceSubscription[]>([]);

  React.useEffect(() => {
    let mounted = true;
    let busy = false;
    let subscriberChatId = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (!mounted) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), SUBSCRIPTION_REFRESH_MS);
    };
    const load = async () => {
      if (!droneId || busy) return;
      busy = true;
      try {
        if (!subscriberChatId) {
          const metadata = await requestJson<any>(
            `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}`,
          );
          subscriberChatId = String(metadata?.chatId ?? '').trim();
        }
        if (!subscriberChatId) {
          if (mounted) setSubscriptions([]);
          return;
        }
        const response = await requestJson<any>(
          `/api/resource-subscriptions?subscriberChatId=${encodeURIComponent(subscriberChatId)}`,
        );
        if (!mounted) return;
        const next = normalizeChatResourceSubscriptions(response?.subscriptions);
        setSubscriptions((current) => (sameSubscriptions(current, next) ? current : next));
      } catch {
        // Keep the last known active list across transient Hub/API failures.
      } finally {
        busy = false;
        schedule();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      timer = null;
      void load();
    };

    setSubscriptions([]);
    void load();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [chatName, droneId]);

  return subscriptions;
}

function SubscriptionIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

export function ChatSubscriptionIndicator({
  subscriptions,
}: {
  subscriptions: ChatResourceSubscription[];
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  useDropdownDismiss(rootRef, open, setOpen);

  React.useEffect(() => {
    if (subscriptions.length === 0) setOpen(false);
  }, [subscriptions.length]);

  if (subscriptions.length === 0) return null;
  const summary = chatSubscriptionSummary(subscriptions);
  const hoverSummary = subscriptions
    .map((subscription) => {
      const events = subscription.events.map(chatSubscriptionEventLabel).join(', ');
      return `${chatSubscriptionResourceLabel(subscription)}${events ? ` — ${events}` : ''}`;
    })
    .join('\n');

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        data-chat-subscription-indicator="true"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        title={hoverSummary}
        className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded px-1.5 text-[.6875rem] font-medium text-[var(--muted-dim)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--chat-composer-control-fg)]"
      >
        <span className="text-[var(--accent)]">
          <SubscriptionIcon />
        </span>
        <span className="truncate">{summary}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Chat subscriptions"
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_55px_var(--shadow-color)]"
        >
          <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
            <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">
              Chat subscriptions
            </div>
            <div className="mt-0.5 text-[var(--text-10)] text-[var(--muted-dim)]">
              This chat is watching {subscriptions.length} resource{subscriptions.length === 1 ? '' : 's'}.
            </div>
          </div>
          <div className="max-h-[min(20rem,55vh)] overflow-y-auto p-1.5">
            {subscriptions.map((subscription) => (
              <div
                key={subscription.id}
                className="rounded-[var(--radius-medium)] px-2.5 py-2 hover:bg-[var(--surface-soft)]"
              >
                <div className="truncate text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
                  {chatSubscriptionResourceLabel(subscription)}
                </div>
                <div className="mt-1 text-[var(--text-10)] text-[var(--muted-dim)]">
                  {subscription.events.map(chatSubscriptionEventLabel).join(', ')}
                </div>
                {subscription.intent ? (
                  <div className="mt-1.5 whitespace-pre-wrap text-[var(--text-10)] leading-4 text-[var(--muted)]">
                    {subscription.intent}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DroneChatComposerMetadata({
  runtime,
  droneId,
  chatName,
  branch,
}: {
  runtime: DroneRuntime;
  droneId: string;
  chatName: string;
  branch?: string | null;
}) {
  const subscriptions = useChatResourceSubscriptions(droneId, chatName);

  return (
    <div className="flex min-w-0 w-full items-center justify-between gap-3 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="shrink-0">
          <DroneRuntimeIndicator runtime={runtime} />
        </div>
        <ChatSubscriptionIndicator subscriptions={subscriptions} />
      </div>
      <DroneBranchIndicator branch={branch} />
    </div>
  );
}

export function DroneBranchIndicator({ branch: branchRaw }: { branch?: string | null }) {
  const branch = String(branchRaw ?? '').trim();
  if (!branch) return null;

  return (
    <span
      data-drone-branch-indicator={branch}
      aria-label={`Current branch: ${branch}`}
      title={`Current branch: ${branch}`}
      className="inline-flex min-h-7 min-w-0 max-w-[min(18rem,42vw)] shrink items-center gap-1.5 text-[.6875rem] font-medium text-[var(--chat-composer-model-fg)]"
    >
      <svg
        className="h-3.5 w-3.5 shrink-0 text-[var(--muted-dim)]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="6" x2="6" y1="3" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
      <span className="truncate font-mono">{branch}</span>
    </span>
  );
}
