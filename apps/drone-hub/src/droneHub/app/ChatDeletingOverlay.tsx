import React from 'react';
import { UiSpinner } from '../../ui/components';
import { useChatDeleting } from './chat-deletion-store';

/**
 * Covers a chat (transcript and composer) while it is being deleted, so nothing typed
 * there could still be sent. Place inside a positioned container.
 */
export function ChatDeletingOverlay({ droneId, chatName }: { droneId: string; chatName: string }) {
  const deleting = useChatDeleting(droneId, chatName);
  if (!deleting) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-chat-deleting-overlay="true"
      className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--panel)]/70 backdrop-blur-[1px]"
    >
      <div className="inline-flex max-w-[calc(100%-2rem)] items-center gap-2.5 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3.5 py-2 text-[var(--fg-secondary)] shadow-[0_8px_24px_var(--shadow-color)]">
        <UiSpinner size="small" label={null} inheritColor />
        <span className="dh-type-control truncate">Deleting “{chatName}”…</span>
      </div>
    </div>
  );
}
