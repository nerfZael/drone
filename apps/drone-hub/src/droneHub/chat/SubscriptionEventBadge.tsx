import React from 'react';
import {
  eventNotificationCopyText,
  eventNotificationDataFields,
  eventNotificationEventLabel,
  eventNotificationResourceLabel,
  isEventNotificationPrompt,
  parseEventNotificationPrompt,
  type EventNotificationDisplay,
} from '@drone/assistant-chat';

import { UserChatMessage } from './UserChatMessage';

export function SubscriptionEventBadge() {
  return (
    <span
      className="inline-flex min-h-6 items-center rounded-t-[var(--radius-medium)] border border-b-0 border-[color-mix(in_srgb,var(--accent)_24%,var(--user-bubble-border))] bg-[color-mix(in_srgb,var(--accent)_11%,var(--user-bubble))] px-2.5 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]"
      style={{ fontFamily: 'var(--display)' }}
    >
      Event notification
    </span>
  );
}

export function isSubscriptionEventPrompt(prompt: unknown): boolean {
  return isEventNotificationPrompt(prompt);
}

function NotificationIcon() {
  return (
    <svg
      className="h-4 w-4"
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

function EventNotificationBody({ notification }: { notification: EventNotificationDisplay }) {
  const [expanded, setExpanded] = React.useState(false);
  const first = notification.events[0]!;
  const title =
    notification.events.length === 1
      ? eventNotificationEventLabel(first.eventType)
      : `${notification.events.length} subscription events`;
  const subtitle =
    notification.events.length === 1
      ? eventNotificationResourceLabel(first)
      : 'Subscribed resources changed';

  return (
    <div className="w-[min(30rem,70vw)] min-w-0 max-w-full">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
      >
        <span className="flex h-7 w-5 shrink-0 items-center justify-start text-[var(--accent)]">
          <NotificationIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--user-bubble-fg)]">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-[var(--text-10)] text-[var(--user-muted)]">
            {subtitle}
          </span>
        </span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-[var(--user-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m4 6 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {expanded ? (
        <div className="mt-3 border-t border-[var(--user-bubble-border)]">
          {notification.events.map((event, index) => {
            const fields = eventNotificationDataFields(event.providerContentText);
            return (
              <div
                key={`${event.provider}:${event.resourceType}:${event.resourceId}:${event.eventType}:${index}`}
                className="py-3 [&+&]:border-t [&+&]:border-[var(--user-bubble-border)]"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--user-bubble-fg)]">
                    {eventNotificationEventLabel(event.eventType)}
                  </span>
                  <span className="text-[var(--text-10)] text-[var(--user-muted)]">
                    {eventNotificationResourceLabel(event)}
                  </span>
                </div>
                {event.summary ? (
                  <div className="mt-1.5 text-[var(--text-11)] leading-4 text-[var(--user-bubble-fg)]">
                    {event.summary}
                  </div>
                ) : null}
                {fields.length > 0 ? (
                  <div className="mt-2.5">
                    <div className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--user-muted)]">
                      Event data
                    </div>
                    <dl className="mt-2 grid max-h-64 grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 overflow-auto text-[var(--text-10)] leading-4">
                      {fields.map((field, fieldIndex) => (
                        <React.Fragment key={`${field.label}:${fieldIndex}`}>
                          <dt className="text-[var(--user-muted)]">{field.label}</dt>
                          <dd className="min-w-0 whitespace-pre-wrap break-words text-[var(--user-bubble-fg)]">
                            {field.value}
                          </dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SubscriptionEventMessage({
  prompt,
  at,
}: {
  prompt: unknown;
  at?: string;
}) {
  const notification = React.useMemo(() => parseEventNotificationPrompt(prompt), [prompt]);
  if (!notification) return null;
  return (
    <UserChatMessage
      at={at}
      copyText={eventNotificationCopyText(notification)}
      headerEnd={<SubscriptionEventBadge />}
      headerAttached
      attachmentContent={<EventNotificationBody notification={notification} />}
    />
  );
}
