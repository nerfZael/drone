import React from 'react';
import { requestSideChat } from '../app/side-chat-events';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { SideChatForkContext } from './SideChatForkContext';
import { IconSpinner } from './icons';

export function ChatMessageActions({
  text,
  checkpointId,
}: {
  text: string;
  checkpointId?: string;
}) {
  const scope = React.useContext(SideChatForkContext);
  const [error, setError] = React.useState<string | null>(null);
  const label = !scope?.supported
    ? 'Message forks are not supported for this agent'
    : scope.busy
      ? 'Side chat operation in progress'
      : 'Fork into a side chat through this answer';
  return (
    <div className="relative flex items-center gap-1">
      <ChatMessageCopyAction text={text} position="hover-rail" />
      {scope && checkpointId ? (
        <button
          type="button"
          data-fork-checkpoint-id={checkpointId}
          data-fork-source-chat={scope.chatName}
          aria-label={label}
          title={label}
          aria-busy={scope.busy}
          disabled={scope.busy || !scope.supported}
          className="pointer-events-auto relative z-20 inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={(event) => {
            event.stopPropagation();
            setError(null);
            if (!requestSideChat(scope.droneId, { sourceChatName: scope.chatName, checkpointId })) {
              setError('The chat workspace is unavailable. Reopen the chat and try again.');
            }
          }}
        >
          {scope.busy ? <IconSpinner className="h-3.5 w-3.5" /> : <ForkIcon />}
        </button>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded border border-[var(--border)] bg-[var(--panel)] p-2 text-11 text-[var(--red)]"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

function ForkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M6 7.5v9M18 7.5a9 9 0 0 1-9 9H6" />
    </svg>
  );
}
