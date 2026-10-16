import { create } from 'zustand';
import type { DroneSummary } from '../types';
import type { SideChatKind } from '../chat/chat-send-shortcuts';

export type SummarySideChat = NonNullable<DroneSummary['sideChats']>[number];

/** A side chat sent from a source's composer: it shows as a chip there, never as a floating window. */
export function isComposerSideChat(chat: Pick<SummarySideChat, 'presentation'> | null | undefined): boolean {
  return chat?.presentation === 'composer';
}

/** Floating windows and the canvas show the other side chats. */
export function withoutComposerSideChats<T extends Pick<SummarySideChat, 'presentation'>>(
  sideChats: readonly T[] | null | undefined,
): T[] {
  return (sideChats ?? []).filter((chat) => !isComposerSideChat(chat));
}

/** The Hub's name for a side chat until its first message names it. */
export function isGeneratedSideChatName(name: string): boolean {
  return /^side-[0-9a-f]{8}$/.test(name);
}

export function newComposerSideChatName(): string {
  return `side-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/** A composer side chat between its creation request and the summary that lists it. */
export type PendingComposerSideChat = {
  name: string;
  sourceChatName: string;
  kind: SideChatKind;
  createdAt: string;
};

export const usePendingComposerSideChatsStore = create<{ byDrone: Record<string, PendingComposerSideChat[]> }>(
  () => ({ byDrone: {} }),
);

export function addPendingComposerSideChat(droneId: string, chat: PendingComposerSideChat): void {
  usePendingComposerSideChatsStore.setState((state) => ({
    byDrone: { ...state.byDrone, [droneId]: [...(state.byDrone[droneId] ?? []), chat] },
  }));
}

export function removePendingComposerSideChat(droneId: string, chatName: string): void {
  usePendingComposerSideChatsStore.setState((state) => {
    const current = state.byDrone[droneId];
    if (!current?.some((chat) => chat.name === chatName)) return state;
    return { byDrone: { ...state.byDrone, [droneId]: current.filter((chat) => chat.name !== chatName) } };
  });
}

export type ComposerSideChatChip = {
  name: string;
  /** The label: the chat name, or "Fork 2" / "New chat 3" until the chat is named. */
  label: string;
  kind: SideChatKind;
  sourceChatName: string;
  busy: boolean;
  unread: boolean;
  approval: boolean;
  /** Created but not listed by the Hub yet. */
  pending: boolean;
};

export type ComposerSideChatFamily = {
  /** The chat the side chats were sent from, or from whose side chats they were sent. */
  rootChatName: string;
  chips: ComposerSideChatChip[];
};

/**
 * The chip row for a chat: the composer side chats of its root chat and of
 * those side chats, oldest first. Viewing a side chat shows the same row as its
 * root, so moving between them and back keeps one stable row.
 */
export function composerSideChatFamily(
  sideChats: readonly SummarySideChat[] | null | undefined,
  chatName: string,
  pending: readonly PendingComposerSideChat[] = [],
): ComposerSideChatFamily {
  const listed = (sideChats ?? []).filter(isComposerSideChat);
  const listedNames = new Set(listed.map((chat) => chat.name));
  const all = [
    ...listed.map((chat) => ({
      name: chat.name,
      sourceChatName: chat.sourceChatName,
      kind: (chat.kind === 'new' ? 'new' : 'fork') as SideChatKind,
      createdAt: chat.createdAt ?? '',
      busy: chat.busy === true,
      unread: chat.unread === true,
      approval: chat.approval === true,
      pending: false,
    })),
    ...pending
      .filter((chat) => !listedNames.has(chat.name))
      .map((chat) => ({ ...chat, busy: true, unread: false, approval: false, pending: true })),
  ];
  const byName = new Map(all.map((chat) => [chat.name, chat]));
  const rootOf = (name: string): string => {
    const path: string[] = [];
    let current = name;
    while (byName.has(current)) {
      const loopStart = path.indexOf(current);
      // A loop has no root chat; its first name stands in, the same from any member.
      if (loopStart >= 0) return [...path.slice(loopStart)].sort()[0];
      path.push(current);
      current = byName.get(current)!.sourceChatName;
    }
    return current;
  };
  const rootChatName = rootOf(chatName);
  const family = all
    .filter((chat) => rootOf(chat.name) === rootChatName)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  const counts: Record<SideChatKind, number> = { fork: 0, new: 0 };
  const chips = family.map((chat) => {
    counts[chat.kind] += 1;
    const fallback = `${chat.kind === 'fork' ? 'Fork' : 'New chat'} ${counts[chat.kind]}`;
    return {
      name: chat.name,
      label: isGeneratedSideChatName(chat.name) ? fallback : chat.name,
      kind: chat.kind,
      sourceChatName: chat.sourceChatName,
      busy: chat.busy,
      unread: chat.unread,
      approval: chat.approval,
      pending: chat.pending,
    };
  });
  return { rootChatName, chips };
}

/**
 * Side chats (of any kind) that go with these chats when they are archived or
 * deleted: their side chats, theirs, and so on. Mirrors the Hub's cascade.
 */
export function sideChatDescendantNames(
  sideChats: ReadonlyArray<Pick<SummarySideChat, 'name' | 'sourceChatName'>> | null | undefined,
  sourceChatNames: readonly string[],
): string[] {
  const childrenBySource = new Map<string, string[]>();
  for (const chat of sideChats ?? []) {
    if (!chat.sourceChatName || chat.sourceChatName === chat.name) continue;
    childrenBySource.set(chat.sourceChatName, [...(childrenBySource.get(chat.sourceChatName) ?? []), chat.name]);
  }
  const seen = new Set(sourceChatNames);
  const out: string[] = [];
  const queue = [...sourceChatNames];
  while (queue.length) {
    for (const child of childrenBySource.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}
