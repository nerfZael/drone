import React from 'react';
import { WorkspaceAccessPicker } from '../assistant/WorkspaceAccessPicker';
import { requestJson } from '../http';
import { closeChatWorkspaces, useChatWorkspacesStore, type ChatWorkspacesTarget } from './chat-workspaces-store';
import { IconFolder } from '../icons';

type ChatInfo = { agent?: { kind?: string }; chatId?: string | null };
type Source = { endpoint: string; note: string | null } | { error: string };

const chatPath = ({ droneId, chatName }: ChatWorkspacesTarget) =>
  `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}`;

/**
 * Where a chat's workspaces are chosen. A built-in chat keeps its own selection (its tools are blip's); any other
 * agent chat uses the selection the DroneHub MCP server's workspace tools are checked against.
 */
async function loadSource(target: ChatWorkspacesTarget, signal: AbortSignal): Promise<Source> {
  const info = await requestJson<ChatInfo>(`${chatPath(target)}?turns=0`, { signal });
  if (info.agent?.kind === 'native') {
    if (!info.chatId) return { error: 'Send a message first to choose this chat’s workspaces.' };
    return {
      endpoint: `/api/assistant/threads/${encodeURIComponent(info.chatId)}/workspaces`,
      note: 'Private artifacts are switched on and off from the chat’s composer.',
    };
  }
  const access = await requestJson<{ available?: boolean }>(`${chatPath(target)}/mcp-access`, { signal }).catch(
    () => null,
  );
  return {
    endpoint: `${chatPath(target)}/workspaces`,
    note:
      access && access.available === false
        ? 'The DroneHub MCP server is not enabled for this chat, so the agent cannot use these workspaces yet.'
        : null,
  };
}

export function ChatWorkspacesDialog() {
  const target = useChatWorkspacesStore((state) => state.target);
  return target ? <ChatWorkspacesPanel key={`${target.droneId}\u0000${target.chatName}`} target={target} /> : null;
}

function ChatWorkspacesPanel({ target }: { target: ChatWorkspacesTarget }) {
  const [source, setSource] = React.useState<Source | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(false);
  const panel = React.useRef<HTMLElement>(null);
  // Only a press that starts on the backdrop closes it; a drag across the permission grid can end out there.
  const pressedBackdrop = React.useRef(false);

  React.useEffect(() => {
    panel.current?.focus();
    const controller = new AbortController();
    loadSource(target, controller.signal)
      .then(setSource)
      .catch((error: any) => {
        if (!controller.signal.aborted) setSource({ error: error?.message ?? String(error) });
      });
    return () => controller.abort();
  }, [target]);

  // Unsaved edits save on their own; closing waits for them rather than dropping them.
  const dismiss = () => {
    if (busy) {
      setNotice(true);
      return;
    }
    closeChatWorkspaces();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim-soft)] px-4"
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) dismiss();
        pressedBackdrop.current = false;
      }}
    >
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Workspaces for ${target.chatName}`}
        data-app-shortcuts-disabled="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
          }
        }}
        className="flex max-h-[75dvh] w-full max-w-[560px] min-h-0 flex-col overflow-hidden rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_var(--shadow-color)] outline-none"
      >
        <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <IconFolder className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />
          <div className="min-w-0 flex-1">
            <div className="text-12 font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>
              Workspaces
            </div>
            <div className="mt-0.5 truncate text-10 text-[var(--muted)]" title={`${target.droneLabel ?? target.droneId} · ${target.chatName}`}>
              {target.droneLabel ?? target.droneId} · {target.chatName}
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            aria-label="Close workspaces"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40"
          >
            ×
          </button>
        </header>
        {source == null ? (
          <div className="px-4 py-4 text-11 text-[var(--muted)]">Loading…</div>
        ) : 'error' in source ? (
          <div role="alert" className="px-4 py-4 text-11 text-[var(--red)]">{source.error}</div>
        ) : (
          <>
            {source.note ? (
              <p className="border-b border-[var(--border-subtle)] px-4 py-2 text-10 leading-relaxed text-[var(--muted)]">{source.note}</p>
            ) : null}
            <div className="flex min-h-0 flex-col pt-2">
              <WorkspaceAccessPicker requestJson={requestJson} endpoint={source.endpoint} onBusyChange={setBusy} />
            </div>
          </>
        )}
        {notice && busy ? (
          <p role="status" className="border-t border-[var(--border-subtle)] px-4 py-2 text-10 text-[var(--muted)]">
            Saving workspace access…
          </p>
        ) : null}
      </section>
    </div>
  );
}
