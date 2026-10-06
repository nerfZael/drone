import React from 'react';
import {
  isBackgroundTaskNotificationPrompt,
  parseBackgroundTaskNotificationPrompt,
} from '@drone/assistant-chat';

import { SubscriptionEventBadge } from './SubscriptionEventBadge';
import { UserChatMessage } from './UserChatMessage';

export function isBackgroundTaskPrompt(prompt: unknown): boolean {
  return isBackgroundTaskNotificationPrompt(prompt);
}

export function BackgroundTaskIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** A turn Claude started on its own because background work it left running reported. */
export function BackgroundTaskMessage({
  prompt,
  at,
  footer,
  ...messageProps
}: {
  prompt: unknown;
  at?: string;
  footer?: React.ReactNode;
} & Pick<
  React.ComponentProps<typeof UserChatMessage>,
  'followUps' | 'autoExpand' | 'showRoleIcons' | 'onOpenFileReference' | 'onOpenLink'
>) {
  const notification = React.useMemo(() => parseBackgroundTaskNotificationPrompt(prompt), [prompt]);
  if (!notification) return null;
  const summaries =
    notification.summaries.length > 0 ? notification.summaries : ['A background task reported.'];
  return (
    <UserChatMessage
      {...messageProps}
      at={at}
      copyText={summaries.join('\n')}
      headerEnd={<SubscriptionEventBadge label="Background task" />}
      headerAttached
      attachmentContent={
        <>
          <div
            data-background-task-notification="true"
            className="flex w-[min(30rem,70vw)] min-w-0 max-w-full items-start gap-2.5"
          >
            <span className="flex h-5 w-5 shrink-0 items-center text-[var(--accent)]">
              <BackgroundTaskIcon />
            </span>
            <ul className="min-w-0 flex-1 space-y-1">
              {summaries.map((summary, index) => (
                <li
                  key={`${index}:${summary}`}
                  className="break-words text-12 leading-5 text-[var(--user-bubble-fg)]"
                >
                  {summary}
                </li>
              ))}
            </ul>
          </div>
          {footer}
        </>
      }
    />
  );
}
