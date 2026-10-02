import React from 'react';

import { IconSpinner } from './icons';
import {
  useNextActionsSettings,
  useNextActionsSuggestions,
  type NextActionsAnchor,
} from './next-actions';

export type NextActionsRowProps = {
  droneId: string;
  chatName: string;
  /** Null while the chat has no finished agent reply to answer, such as during a run. */
  anchor: NextActionsAnchor | null;
  /** Sends the chosen one-liner as the next prompt; resolves false when it was not sent. */
  onSend: (prompt: string) => Promise<boolean>;
};

/**
 * Configured one-line replies that fit the agent's latest message, offered as
 * buttons under it. Renders nothing while Next actions are off.
 */
export function NextActionsRow({ droneId, chatName, anchor, onSend }: NextActionsRowProps) {
  const settings = useNextActionsSettings();
  const current = settings.data?.settings;
  const active = current?.enabled === true && (current.actions?.length ?? 0) > 0;
  const suggestions = useNextActionsSuggestions({ droneId, chatName }, active ? anchor : null, settings.data?.revision ?? null);
  const [sending, setSending] = React.useState<string | null>(null);
  React.useEffect(() => setSending(null), [anchor?.turnId]);

  if (!active || !anchor) return null;
  if (suggestions.isPending) {
    return (
      <div data-next-actions="loading" role="status" className="-mt-3 flex items-center gap-1.5 text-11 text-[var(--muted-dim)]">
        <IconSpinner className="h-3 w-3" />
        <span>Next actions…</span>
      </div>
    );
  }
  if (suggestions.isError) {
    return (
      <div data-next-actions="error" className="-mt-3 flex items-center gap-1.5 text-11 text-[var(--muted-dim)]">
        <span className="min-w-0 truncate" title={suggestions.error.message}>Next actions unavailable</span>
        <button
          type="button"
          onClick={() => void suggestions.refetch()}
          disabled={suggestions.isFetching}
          className="shrink-0 underline-offset-2 hover:text-[var(--fg-secondary)] hover:underline disabled:opacity-50"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!Array.isArray(suggestions.data) || suggestions.data.length === 0) return null;

  const send = async (prompt: string) => {
    if (sending) return;
    setSending(prompt);
    // On success the row unmounts once the new prompt shows up; stay disabled until then.
    if (!(await onSend(prompt).catch(() => false))) setSending(null);
  };

  return (
    <div data-next-actions="ready" aria-label="Suggested next actions" className="-mt-3 flex flex-wrap items-center gap-1.5">
      {suggestions.data.map((action) => (
        <button
          key={action}
          type="button"
          disabled={Boolean(sending)}
          onClick={() => void send(action)}
          title={`Send “${action}”`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2.5 py-1 text-11 text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--surface-inset-strong)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-50 disabled:hover:border-[var(--border-subtle)] disabled:hover:bg-[var(--surface-inset)] disabled:hover:text-[var(--fg-secondary)]"
        >
          {sending === action ? <IconSpinner className="h-3 w-3 shrink-0" /> : null}
          <span className="truncate">{action}</span>
        </button>
      ))}
    </div>
  );
}
