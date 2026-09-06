import React from 'react';

import { RelativeTimeText } from './RelativeTimeText';
import { IconBot, IconUser } from './icons';

export function ChatMessageFrame({
  role,
  at,
  error = false,
  warning = false,
  showRoleIcon = false,
  showRoleLabel = true,
  plainAssistant = false,
  headerEnd,
  headerAttached = false,
  hoverActions,
  children,
  className = '',
}: {
  role: 'user' | 'assistant';
  at?: string;
  error?: boolean;
  warning?: boolean;
  showRoleIcon?: boolean;
  showRoleLabel?: boolean;
  plainAssistant?: boolean;
  headerEnd?: React.ReactNode;
  headerAttached?: boolean;
  hoverActions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const user = role === 'user';
  const label = user ? 'You' : 'Agent';
  const transparentAssistant = !user && plainAssistant && !error && !warning;
  const showAttachedHeader = user && headerAttached && Boolean(headerEnd);
  const showHeader = !showAttachedHeader && (showRoleLabel || Boolean(headerEnd));
  const surfaceClass = transparentAssistant
    ? 'py-1'
    : user
      ? 'rounded-[var(--radius-xlarge)] rounded-tr-[4px] border border-[var(--user-bubble-border)] bg-[var(--user-bubble)] px-4 py-2.5 text-[var(--user-bubble-fg)]'
      : warning
        ? 'rounded-[var(--radius-xlarge)] rounded-tl-[4px] border border-[var(--yellow-border)] bg-[var(--yellow-subtle)] px-4 py-3'
        : error
          ? 'rounded-[var(--radius-xlarge)] rounded-tl-[4px] border border-[var(--red-border)] bg-[var(--red-subtle)] px-4 py-3'
          : 'rounded-[var(--radius-xlarge)] rounded-tl-[4px] border border-[var(--assistant-bubble-border)] bg-[var(--assistant-bubble)] px-4 py-3';
  const bubble = (
    <div
      className={`group/message relative ${showRoleIcon ? (user ? 'max-w-[min(85%,var(--chat-prose-max))]' : 'min-w-0 flex-1') : user ? 'max-w-[min(85%,var(--chat-prose-max))]' : 'w-full'} min-w-[120px]`}
    >
      {user && (at || hoverActions) ? (
        <div className="pointer-events-none absolute bottom-full right-0 z-10 mb-1 flex min-h-7 items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100">
          {at ? (
            <RelativeTimeText
              at={at}
              className="pointer-events-none whitespace-nowrap text-[var(--type-caption)] leading-none tabular-nums text-[var(--chat-user-message-time)]"
              title={new Date(at).toLocaleString()}
            />
          ) : null}
          {hoverActions}
        </div>
      ) : null}
      {!user && (at || hoverActions) ? (
        <div
          className={`pointer-events-none absolute left-0 top-full z-10 mt-1 flex min-h-7 w-full items-center gap-2 opacity-0 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 ${
            at ? 'justify-between' : 'justify-end'
          }`}
        >
          {at ? (
            <RelativeTimeText
              at={at}
              className="pointer-events-none whitespace-nowrap text-[var(--type-caption)] leading-none tabular-nums text-[var(--chat-message-time)]"
              title={new Date(at).toLocaleString()}
            />
          ) : null}
          {hoverActions}
        </div>
      ) : null}
      {showAttachedHeader ? (
        <div
          className={`relative z-[1] -mb-px flex ${showRoleLabel ? 'items-end justify-between' : 'justify-end'}`}
        >
          {showRoleLabel ? (
            <span
              className="pb-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--user-muted)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              {label}
            </span>
          ) : null}
          {headerEnd}
        </div>
      ) : null}
      {showHeader ? (
        <div
          className={`mb-1.5 flex items-center gap-2 ${user ? 'justify-end' : 'justify-between'}`}
        >
          {!user && showRoleLabel ? (
            <span
              className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--accent)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              {label}
            </span>
          ) : null}
          <div className="flex items-center gap-1.5">
            {user ? headerEnd : null}
            {user && showRoleLabel ? (
              <span
                className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--user-muted)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                {label}
              </span>
            ) : null}
            {!user ? headerEnd : null}
          </div>
        </div>
      ) : null}
      <div
        className={`group relative ${surfaceClass} ${showAttachedHeader ? 'rounded-tr-none' : ''} ${className}`}
      >
        {children}
      </div>
    </div>
  );

  return user ? (
    <div className="mb-3 flex justify-end">
      {bubble}
      {showRoleIcon ? (
        <div className="ml-3 mt-6 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--user-border)] bg-[var(--user-subtle)]">
          <IconUser className="h-3.5 w-3.5 text-[var(--user)]" />
        </div>
      ) : null}
    </div>
  ) : (
    <div className={showRoleIcon ? 'flex gap-3' : 'flex'}>
      {showRoleIcon ? (
        <div className="mt-6 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--accent-border)] bg-[var(--accent-subtle)]">
          <IconBot className="h-3.5 w-3.5 text-[var(--accent)]" />
        </div>
      ) : null}
      {bubble}
    </div>
  );
}
