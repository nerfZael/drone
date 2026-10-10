import { create } from 'zustand';

export type ChatWorkspacesTarget = { droneId: string; chatName: string; droneLabel?: string };

/** The chat whose Workspaces dialog is open; any menu can open it, the overlays render it. */
export const useChatWorkspacesStore = create<{ target: ChatWorkspacesTarget | null }>(() => ({
  target: null,
}));

export function openChatWorkspaces(target: ChatWorkspacesTarget) {
  useChatWorkspacesStore.setState({ target });
}

export function closeChatWorkspaces() {
  useChatWorkspacesStore.setState({ target: null });
}
