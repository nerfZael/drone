import React from 'react';

import { RelativeTimeText } from './RelativeTimeText';
import { IconBot, IconUser } from './icons';

export function ChatMessageFrame({
  role,
  at,
  error = false,
  warning = false,
  showRoleIcon = false,
  headerEnd,
  children,
  className = '',
  onMouseEnter,
  onMouseLeave,
  messageId,
}: {
  role: 'user' | 'assistant';
  at?: string;
  error?: boolean;
  warning?: boolean;
  showRoleIcon?: boolean;
  headerEnd?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  messageId?: string;
}) {
  const user = role === 'user';
  const label = user ? 'You' : 'Agent';
  const bubble = (
    <div className={`${showRoleIcon ? (user ? 'max-w-[85%]' : 'min-w-0 flex-1') : user ? 'max-w-full' : 'w-full'} min-w-[120px]`}>
      <div className={`mb-1.5 flex items-center gap-2 ${user ? 'justify-end' : 'justify-between'}`}>
        {!user ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]" style={{ fontFamily: 'var(--display)' }}>
            {label}
          </span>
        ) : null}
        <div className="flex items-center gap-1.5">
          {user ? headerEnd : null}
          {at ? (
            <RelativeTimeText
              at={at}
              className="font-mono text-[9px] leading-none text-[var(--muted-dim)]"
              title={new Date(at).toLocaleString()}
            />
          ) : null}
          {user ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--user-muted)]" style={{ fontFamily: 'var(--display)' }}>
              {label}
            </span>
          ) : null}
          {!user ? headerEnd : null}
        </div>
      </div>
      <div
        data-message-id={messageId}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`group relative rounded-lg border px-4 py-3 ${
          user
            ? 'rounded-tr-sm border-[rgba(148,163,184,.14)] bg-[var(--user-dim)]'
            : warning
              ? 'rounded-tl-sm border-[rgba(255,178,36,.18)] bg-[var(--yellow-subtle)]'
              : error
                ? 'rounded-tl-sm border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)]'
                : 'rounded-tl-sm border-[rgba(167,139,250,.12)] bg-[var(--accent-subtle)]'
        } ${className}`}
      >
        {children}
      </div>
    </div>
  );

  return user ? (
    <div className="mb-3 flex justify-end">
      {bubble}
      {showRoleIcon ? (
        <div className="ml-3 mt-6 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[rgba(148,163,184,.15)] bg-[var(--user-subtle)]">
          <IconUser className="h-3.5 w-3.5 text-[var(--user)]" />
        </div>
      ) : null}
    </div>
  ) : (
    <div className={showRoleIcon ? 'flex gap-3' : 'flex'}>
      {showRoleIcon ? (
        <div className="mt-6 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[rgba(167,139,250,.15)] bg-[var(--accent-subtle)]">
          <IconBot className="h-3.5 w-3.5 text-[var(--accent)]" />
        </div>
      ) : null}
      {bubble}
    </div>
  );
}
