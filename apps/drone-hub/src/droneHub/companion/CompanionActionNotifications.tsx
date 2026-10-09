import React from 'react';
import { CompanionOperationHeadline } from './CompanionOperationHeadline';
import type { CompanionActionNotification } from './companion-action-notifications';

export const COMPANION_NOTIFICATION_DURATION_MS = 8_000;

/** Dismisses each notification once it has been shown for the full duration. */
export function useNotificationExpiry(notifications: ReadonlyArray<{ id: string; createdAt: number }>, onDismiss: (id: string) => void) {
  React.useEffect(() => {
    if (!notifications.length) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      for (const notification of notifications) {
        if (now - notification.createdAt >= COMPANION_NOTIFICATION_DURATION_MS) onDismiss(notification.id);
      }
    }, Math.max(0, Math.min(...notifications.map((item) => item.createdAt + COMPANION_NOTIFICATION_DURATION_MS - Date.now()))));
    return () => window.clearTimeout(timer);
  }, [notifications, onDismiss]);
}

export function CompanionNotificationCard({ status, label, error, onDismiss, children }: {
  status: 'completed' | 'failed';
  label: string;
  error?: string;
  onDismiss(): void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-2 text-xs shadow-[var(--shadow-dialog)]">
      <span aria-hidden="true" className={status === 'failed' ? 'text-[var(--red)]' : 'text-[var(--green)]'}>
        {status === 'failed' ? '!' : '✓'}
      </span>
      <div className="min-w-0 flex-1 break-words text-[var(--fg-secondary)]">
        {status === 'failed'
          ? <span className="font-[var(--weight-semibold)] text-[var(--red)]">Failed: </span>
          : <span className="sr-only">Completed: </span>}
        {children}
        {error ? <div className="mt-1 text-[var(--red)]">{error}</div> : null}
      </div>
      <button type="button" aria-label={`Dismiss notification: ${label}`} onClick={onDismiss} className="shrink-0 rounded px-1 text-[var(--muted)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">×</button>
    </div>
  );
}

export function CompanionActionNotifications({ notifications, onDismiss }: {
  notifications: CompanionActionNotification[];
  onDismiss(id: string): void;
}) {
  useNotificationExpiry(notifications, onDismiss);

  return (
    <div aria-label="Companion action notifications" role="status" aria-live="polite" aria-relevant="additions" className="flex w-full shrink-0 flex-col gap-2 min-[860px]:w-[28rem] min-[860px]:self-end">
      {notifications.map((notification) => (
        <CompanionNotificationCard key={notification.id} status={notification.status} label={notification.label}
          error={notification.error} onDismiss={() => onDismiss(notification.id)}>
          <CompanionOperationHeadline operation={notification.operation} droneLabel={() => notification.droneName} />
        </CompanionNotificationCard>
      ))}
    </div>
  );
}
