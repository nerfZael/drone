import React from 'react';

export type AppConfirmationOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PendingConfirmation = AppConfirmationOptions & {
  id: number;
  resolve: (confirmed: boolean) => void;
};

type RequestConfirmation = (options: AppConfirmationOptions) => Promise<boolean>;

const missingProviderConfirmation: RequestConfirmation = async () => {
  throw new Error('AppConfirmDialogProvider is not mounted');
};

const AppConfirmDialogContext = React.createContext<RequestConfirmation | null>(null);

function AlertMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M8 1.75 14.25 13H1.75L8 1.75Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path d="M8 5.25v3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <circle cx="8" cy="11" r=".75" fill="currentColor" />
    </svg>
  );
}

export function AppConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onCancel,
  onConfirm,
}: AppConfirmationOptions & {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = React.useId();
  const messageId = React.useId();
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (destructive ? cancelButtonRef.current : confirmButtonRef.current)?.focus();
    return () => previousFocus?.focus();
  }, [destructive, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--scrim)] px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key !== 'Tab') return;
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={`w-full max-w-[27rem] overflow-hidden rounded-[var(--radius-large)] border bg-[var(--panel-overlay)] shadow-[0_24px_80px_var(--shadow-color)] ${
          destructive ? 'border-[var(--red-border)]' : 'border-[var(--accent-border)]'
        }`}
      >
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <div
            className={`mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--radius-medium)] border ${
              destructive
                ? 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]'
                : 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
            }`}
          >
            <AlertMark />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-[1rem] font-[var(--weight-semibold)] leading-6 text-[var(--fg-strong)]">
              {title}
            </h2>
            <p id={messageId} className="mt-1.5 text-[var(--text-12)] leading-5 text-[var(--muted)]">
              {message}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-3.5">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)] transition-colors hover:border-[var(--border)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-muted)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className={`inline-flex h-8 items-center justify-center rounded-[var(--radius-medium)] border px-3 text-[var(--text-10)] font-[var(--weight-semibold)] transition-colors focus-visible:outline-none focus-visible:ring-1 ${
              destructive
                ? 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] hover:border-[var(--red)] focus-visible:ring-[var(--red)]'
                : 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:border-[var(--accent)] focus-visible:ring-[var(--accent)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const pendingRef = React.useRef<PendingConfirmation | null>(null);
  const nextIdRef = React.useRef(1);
  const [pending, setPending] = React.useState<PendingConfirmation | null>(null);

  const settle = React.useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(confirmed);
  }, []);

  const requestConfirmation = React.useCallback<RequestConfirmation>((options) => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const request = { ...options, id: nextIdRef.current++, resolve };
      pendingRef.current = request;
      setPending(request);
    });
  }, []);

  React.useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  return (
    <AppConfirmDialogContext.Provider value={requestConfirmation}>
      {children}
      <AppConfirmDialog
        open={pending != null}
        title={pending?.title ?? ''}
        message={pending?.message ?? ''}
        confirmLabel={pending?.confirmLabel ?? 'Confirm'}
        cancelLabel={pending?.cancelLabel}
        destructive={pending?.destructive}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    </AppConfirmDialogContext.Provider>
  );
}

export function useAppConfirmDialog(): RequestConfirmation {
  return React.useContext(AppConfirmDialogContext) ?? missingProviderConfirmation;
}
