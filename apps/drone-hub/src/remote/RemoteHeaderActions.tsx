import React from 'react';
import { IconChat, IconCopy, IconMore, IconPencil } from '../droneHub/app/icons';
import type { DroneSummary } from '../droneHub/types';
import {
  dropdownMenuItemBaseClass,
  dropdownPanelBaseClass,
  useDropdownDismiss,
} from '../ui/dropdown';

type RemoteHeaderActionsProps = {
  selectedDrone: DroneSummary | null;
  onCreateChat: (chatName: string, opts?: { draft?: boolean }) => Promise<boolean>;
  onCloneDrone: (name: string) => Promise<boolean>;
  onRenameDrone: (name: string) => Promise<boolean>;
  onLogout: () => Promise<void>;
};

type DialogState =
  | { kind: 'create-chat'; title: string; label: string; value: string; createAsDraft: boolean }
  | { kind: 'clone-drone'; title: string; label: string; value: string }
  | { kind: 'rename-drone'; title: string; label: string; value: string }
  | { kind: 'logout' };

function nextChatName(chatsRaw: unknown): string {
  const chats = Array.isArray(chatsRaw) ? chatsRaw.map((chat) => String(chat ?? '').trim()) : [];
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `chat-${i}`;
    if (!chats.includes(candidate)) return candidate;
  }
  return `chat-${Date.now().toString(36)}`;
}

function suggestedCloneName(drone: DroneSummary | null): string {
  const base = String(drone?.name ?? '').trim() || 'Drone';
  return `${base} copy`;
}

function FieldDialog({
  dialog,
  busy,
  error,
  onValueChange,
  onCreateAsDraftChange,
  onSubmit,
  onCancel,
}: {
  dialog: Exclude<DialogState, { kind: 'logout' }>;
  busy: boolean;
  error: string | null;
  onValueChange: (value: string) => void;
  onCreateAsDraftChange: (next: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(0,0,0,.58)] px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <form
        className="w-full max-w-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        <div className="border-b border-[var(--border)] px-4 py-3">
          <div className="text-sm font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
            {dialog.title}
          </div>
        </div>
        <div className="px-4 py-4">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {dialog.label}
            </span>
            <input
              autoFocus
              value={dialog.value}
              onChange={(event) => onValueChange(event.target.value)}
              disabled={busy}
              className="h-9 w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
            />
          </label>
          {dialog.kind === 'create-chat' ? (
            <label className="mt-3 flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={dialog.createAsDraft}
                onChange={(event) => onCreateAsDraftChange(event.target.checked)}
                disabled={busy}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              Create as draft
            </label>
          ) : null}
          {error ? <div className="mt-3 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-8 rounded border border-[var(--border-subtle)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !dialog.value.trim()}
            className="h-8 rounded border border-[var(--accent)] bg-[var(--accent)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-fg)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ fontFamily: 'var(--display)' }}
          >
            {busy ? 'Working...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function LogoutDialog({
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(0,0,0,.58)] px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <div className="text-sm font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
            Log out of Remote Hub?
          </div>
        </div>
        <div className="px-4 py-4 text-[12px] leading-5 text-[var(--muted)]">
          This device will need to pair again before it can access Drone Hub.
          {error ? <div className="mt-3 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-8 rounded border border-[var(--border-subtle)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-8 rounded border border-[rgba(248,113,113,.35)] bg-[rgba(248,113,113,.12)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--red)] transition-all hover:bg-[rgba(248,113,113,.18)] disabled:cursor-wait disabled:opacity-60"
            style={{ fontFamily: 'var(--display)' }}
          >
            {busy ? 'Logging out...' : 'Log out'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RemoteHeaderActions({
  selectedDrone,
  onCreateChat,
  onCloneDrone,
  onRenameDrone,
  onLogout,
}: RemoteHeaderActionsProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  useDropdownDismiss(menuRef, menuOpen, setMenuOpen);

  const closeDialog = React.useCallback(() => {
    if (busy) return;
    setDialog(null);
    setError(null);
  }, [busy]);

  const submitDialog = React.useCallback(async () => {
    if (!dialog || busy) return;
    setBusy(true);
    setError(null);
    try {
      let ok = false;
      if (dialog.kind === 'create-chat') ok = await onCreateChat(dialog.value, { draft: dialog.createAsDraft === true });
      if (dialog.kind === 'clone-drone') ok = await onCloneDrone(dialog.value);
      if (dialog.kind === 'rename-drone') ok = await onRenameDrone(dialog.value);
      if (dialog.kind === 'logout') {
        await onLogout();
        ok = true;
      }
      if (ok) setDialog(null);
      else setError('Action failed. Check the banner above for details.');
    } catch (err: any) {
      setError(String(err?.message ?? err ?? 'Action failed.'));
    } finally {
      setBusy(false);
    }
  }, [busy, dialog, onCloneDrone, onCreateChat, onLogout, onRenameDrone]);

  const openFieldDialog = React.useCallback(
    (next: Exclude<DialogState, { kind: 'logout' }>) => {
      setError(null);
      setMenuOpen(false);
      setDialog(next);
    },
    [],
  );

  const droneActionsDisabled = !selectedDrone;
  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className={`inline-flex h-8 w-8 items-center justify-center rounded border transition-all ${
            menuOpen
              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
              : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]'
          }`}
          title="Remote actions"
          aria-label="Remote actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <IconMore className="opacity-85" />
        </button>
        {menuOpen ? (
          <div className={`absolute right-0 mt-2 w-[210px] z-[60] ${dropdownPanelBaseClass}`} role="menu">
            <div className="py-1">
              <button
                type="button"
                onClick={() =>
                  openFieldDialog({
                    kind: 'create-chat',
                    title: 'Create chat',
                    label: 'Chat name',
                    value: nextChatName(selectedDrone?.chats),
                    createAsDraft: false,
                  })
                }
                disabled={droneActionsDisabled}
                className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40`}
                role="menuitem"
              >
                <span>Create new chat</span>
                <IconChat className="opacity-65" />
              </button>
              <button
                type="button"
                onClick={() =>
                  openFieldDialog({
                    kind: 'clone-drone',
                    title: 'Clone drone',
                    label: 'Clone name',
                    value: suggestedCloneName(selectedDrone),
                  })
                }
                disabled={droneActionsDisabled}
                className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40`}
                role="menuitem"
              >
                <span>Clone drone</span>
                <IconCopy className="opacity-65" />
              </button>
              <button
                type="button"
                onClick={() =>
                  openFieldDialog({
                    kind: 'rename-drone',
                    title: 'Rename drone',
                    label: 'Drone name',
                    value: String(selectedDrone?.name ?? '').trim(),
                  })
                }
                disabled={droneActionsDisabled}
                className={`${dropdownMenuItemBaseClass} flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40`}
                role="menuitem"
              >
                <span>Rename drone</span>
                <IconPencil className="opacity-65" />
              </button>
              <div className="my-1 border-t border-[var(--border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setError(null);
                  setDialog({ kind: 'logout' });
                }}
                className={`${dropdownMenuItemBaseClass} text-[var(--red)] hover:bg-[rgba(248,113,113,.08)]`}
                role="menuitem"
              >
                Log out
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {dialog && dialog.kind !== 'logout' ? (
        <FieldDialog
          dialog={dialog}
          busy={busy}
          error={error}
          onValueChange={(value) => setDialog({ ...dialog, value })}
          onCreateAsDraftChange={(createAsDraft) =>
            setDialog(dialog.kind === 'create-chat' ? { ...dialog, createAsDraft } : dialog)
          }
          onSubmit={submitDialog}
          onCancel={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'logout' ? (
        <LogoutDialog busy={busy} error={error} onConfirm={submitDialog} onCancel={closeDialog} />
      ) : null}
    </>
  );
}
