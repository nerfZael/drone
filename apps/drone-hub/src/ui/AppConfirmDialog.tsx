import React from 'react';
import { UiButton, UiDialog, UiInput } from './components';

export type AppConfirmationOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

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
  portalContainer,
}: AppConfirmationOptions & {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  portalContainer?: HTMLElement;
}) {
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
      portalContainer={portalContainer}
      // The question was asked because the person chose the action, so Enter completes it;
      // Escape is always there to back out. Destructive dialogs stand out by colour instead.
      initialFocusRef={confirmButtonRef}
      footer={
        <>
          <UiButton
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

export type AppPromptOptions = {
  title: string;
  message?: string;
  /** Names the field for assistive technology; the title is used when it is left out. */
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel?: string;
};

export type AppAlertOptions = { title: string; message?: string; closeLabel?: string };

export type AppDialogRequest = { id: number; container?: HTMLElement } & (
  | ({ kind: 'confirm'; resolve: (confirmed: boolean) => void } & AppConfirmationOptions)
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & AppPromptOptions)
  | ({ kind: 'alert'; resolve: () => void } & AppAlertOptions)
);

// Dialogs are asked for from hooks and plain functions as well as components, so the
// requests live outside React; the host mounted at the app root shows them one at a time.
let requests: AppDialogRequest[] = [];
let nextRequestId = 1;
let hosts = 0;
const listeners = new Set<() => void>();

function setRequests(next: AppDialogRequest[]): void {
  requests = next;
  for (const listener of listeners) listener();
}

// Chats can live in their own desktop windows. A dialog opens in the window that was being
// used when it was asked for, not in the main window behind it.
const surfaces = new Set<Document>();

export function registerAppDialogSurface(surface: Document): () => void {
  surfaces.add(surface);
  return () => surfaces.delete(surface);
}

function focusedSurface(): HTMLElement | undefined {
  for (const surface of surfaces) {
    try {
      if (surface.hasFocus()) return surface.body;
    } catch {
      // A closed window's document; it unregisters itself shortly.
    }
  }
  return undefined;
}

function request<T>(build: (id: number, resolve: (value: T) => void) => AppDialogRequest, whenUnavailable: T): Promise<T> {
  if (hosts === 0) {
    // Nothing can show the dialog, so the question counts as declined rather than hanging.
    console.warn('An app dialog was requested before AppDialogHost was mounted.');
    return Promise.resolve(whenUnavailable);
  }
  return new Promise<T>((resolve) => {
    const id = nextRequestId++;
    setRequests([...requests, { ...build(id, resolve), container: focusedSurface() }]);
  });
}

/** The app's own replacement for window.confirm. Resolves false when dismissed. */
export function confirmDialog(options: AppConfirmationOptions): Promise<boolean> {
  return request<boolean>((id, resolve) => ({ ...options, kind: 'confirm', id, resolve }), false);
}

/** "Discard unsaved …?" before leaving something with edits in it. */
export function confirmDiscardDialog(title: string, message?: string): Promise<boolean> {
  return confirmDialog({ title, message: message ?? 'Your unsaved changes will be lost.', confirmLabel: 'Discard', destructive: true });
}

/** "Delete …?" with the destructive treatment. */
export function confirmDeleteDialog(title: string, message?: string, confirmLabel = 'Delete'): Promise<boolean> {
  return confirmDialog({ title, message: message ?? 'This cannot be undone.', confirmLabel, destructive: true });
}

/** The app's own replacement for window.prompt. Resolves null when cancelled, otherwise the text as typed. */
export function promptDialog(options: AppPromptOptions): Promise<string | null> {
  return request<string | null>((id, resolve) => ({ ...options, kind: 'prompt', id, resolve }), null);
}

/** The app's own replacement for window.alert. Resolves once it is closed. */
export function alertDialog(options: AppAlertOptions): Promise<void> {
  return request<void>((id, resolve) => ({ ...options, kind: 'alert', id, resolve }), undefined);
}

/**
 * The waiting dialogs, apart from React so they can be asked for from anywhere. A host attaches
 * while it is mounted, shows `current()`, and answers it with `settle`.
 */
export const appDialogQueue = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  current: (): AppDialogRequest | null => requests[0] ?? null,
  /** Answers the dialog being shown: true/false for a confirmation, text or null for a prompt. */
  settle(answer?: boolean | string | null): void {
    const [current, ...rest] = requests;
    if (!current) return;
    setRequests(rest);
    if (current.kind === 'confirm') current.resolve(answer === true);
    else if (current.kind === 'prompt') current.resolve(typeof answer === 'string' ? answer : null);
    else current.resolve();
  },
  attachHost(): () => void {
    hosts += 1;
    return () => {
      hosts -= 1;
      // Whoever is still waiting gets the same answer as a dismissal.
      while (hosts === 0 && requests.length > 0) appDialogQueue.settle(null);
    };
  },
};

export function AppPromptDialog({ request: current, onSettle }: {
  request: Extract<AppDialogRequest, { kind: 'prompt' }>;
  onSettle: (value: string | null) => void;
}) {
  const [value, setValue] = React.useState(current.initialValue ?? '');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => inputRef.current?.select(), []);
  return (
    <UiDialog
      open
      onClose={() => onSettle(null)}
      title={current.title}
      description={current.message}
      size="small"
      showCloseButton={false}
      portalContainer={current.container}
      initialFocusRef={inputRef}
      footer={
        <>
          <UiButton onClick={() => onSettle(null)} size="medium">{current.cancelLabel ?? 'Cancel'}</UiButton>
          <UiButton onClick={() => onSettle(value)} variant="primary" size="medium">{current.confirmLabel}</UiButton>
        </>
      }
    >
      <UiInput
        ref={inputRef}
        aria-label={current.label ?? current.title}
        value={value}
        placeholder={current.placeholder}
        className="w-full"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onSettle(value);
        }}
      />
    </UiDialog>
  );
}

/** Shows the dialogs asked for through confirmDialog, promptDialog and alertDialog. Mounted once, at the app root. */
export function AppDialogHost() {
  const current = React.useSyncExternalStore(appDialogQueue.subscribe, appDialogQueue.current, () => null);
  React.useEffect(() => appDialogQueue.attachHost(), []);
  if (!current) return null;
  if (current.kind === 'confirm') {
    return (
      <AppConfirmDialog
        key={current.id}
        open
        {...current}
        portalContainer={current.container}
        onCancel={() => appDialogQueue.settle(false)}
        onConfirm={() => appDialogQueue.settle(true)}
      />
    );
  }
  if (current.kind === 'prompt') {
    return <AppPromptDialog key={current.id} request={current} onSettle={appDialogQueue.settle} />;
  }
  return (
    <UiDialog
      key={current.id}
      open
      onClose={() => appDialogQueue.settle()}
      title={current.title}
      description={current.message}
      icon={<AlertMark />}
      size="small"
      showCloseButton={false}
      portalContainer={current.container}
      footer={<UiButton onClick={() => appDialogQueue.settle()} variant="primary" size="medium">{current.closeLabel ?? 'OK'}</UiButton>}
    />
  );
}

/** Mounts the dialog host around the app. */
export function AppConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AppDialogHost />
    </>
  );
}

export function useAppConfirmDialog(): (options: AppConfirmationOptions) => Promise<boolean> {
  return confirmDialog;
}
