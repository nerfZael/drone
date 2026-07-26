import React from 'react';
import { UiButton, UiDialog } from './components';

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
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);

  return (
    <UiDialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      icon={<AlertMark />}
      tone={destructive ? 'danger' : 'accent'}
      size="small"
      showCloseButton={false}
      initialFocusRef={destructive ? cancelButtonRef : confirmButtonRef}
      footer={
        <>
          <UiButton
            ref={cancelButtonRef}
            onClick={onCancel}
            size="medium"
          >
            {cancelLabel}
          </UiButton>
          <UiButton
            ref={confirmButtonRef}
            onClick={onConfirm}
            variant={destructive ? 'danger' : 'primary'}
            size="medium"
          >
            {confirmLabel}
          </UiButton>
        </>
      }
    />
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
