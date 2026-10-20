import React from 'react';
import { formatWorkspaceLink } from '@drone/assistant-chat';

import { requestJson } from '../http';
import { openWorkspaceLink } from '../workspaces/workspace-links';
import { subscribeChatWorkspacesChanged, subscribeWorkspacesChanged } from '../workspaces/workspaces-client';

export type ChatHome = {
  id: string;
  path: string;
  /** What the chat may do in its home; null when the user removed it from the chat's workspaces. */
  access: { read: boolean; write: boolean; execute: boolean } | null;
};

/** Each chat's home as last heard, so switching back to a chat shows its pill at once. */
const homes = new Map<string, ChatHome | null>();

export function useChatHome(droneIdRaw: string | null | undefined, chatNameRaw: string | null | undefined): ChatHome | null {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim();
  const key = droneId && chatName ? `${droneId}\u0000${chatName}` : '';
  const [snapshot, setSnapshot] = React.useState<{ key: string; home: ChatHome | null }>(() => ({ key, home: homes.get(key) ?? null }));
  React.useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let request = 0;
    const load = () => {
      const current = ++request;
      void requestJson<{ home?: ChatHome | null }>(
        `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/workspaces/home`,
      )
        .then((response) => {
          if (cancelled || current !== request) return;
          const home = response?.home ?? null;
          homes.set(key, home);
          setSnapshot({ key, home });
        })
        // Keep the last known home across transient Hub failures.
        .catch(() => undefined);
    };
    load();
    // Removing the home from the chat's workspaces (here or in another window) changes what the pill says.
    const unsubscribeChat = subscribeChatWorkspacesChanged(load);
    const unsubscribeWorkspaces = subscribeWorkspacesChanged(load);
    return () => {
      cancelled = true;
      unsubscribeChat();
      unsubscribeWorkspaces();
    };
  }, [chatName, droneId, key]);
  return snapshot.key === key ? snapshot.home : homes.get(key) ?? null;
}

function HomeIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9" />
    </svg>
  );
}

function accessLabel(access: ChatHome['access']): string {
  if (!access) return 'Not in this chat’s workspaces; add it back from Workspaces';
  return [access.read ? 'Read' : '', access.write ? 'Write' : '', access.execute ? 'Execute' : ''].filter(Boolean).join(' · ');
}

/**
 * The chat's home beside its runtime: a folder of its own, deleted with the chat. Clicking shows it in the File
 * Explorer, adding it as a root there or opening the root it already has, as a link to the folder would.
 */
export function ChatHomeIndicator({ droneId, chatName }: { droneId?: string | null; chatName?: string | null }) {
  const home = useChatHome(droneId, chatName);
  if (!home) return null;
  const title = `This chat's home: ${home.path}\n${accessLabel(home.access)}\nIts own folder, deleted with the chat. Click to show it in the File Explorer.`;
  return (
    <button
      type="button"
      data-chat-home-indicator={home.id}
      aria-label="Show this chat's home in the File Explorer"
      title={title}
      onClick={() => openWorkspaceLink(formatWorkspaceLink({ workspace: home.id, path: '', line: null, column: null }))}
      className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded px-1.5 text-[.6875rem] font-medium text-[var(--chat-composer-model-fg)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--chat-composer-control-fg)] ${
        home.access ? '' : 'opacity-60'
      }`}
    >
      <span className="text-[var(--muted-dim)]">
        <HomeIcon />
      </span>
      <span>Home</span>
    </button>
  );
}
