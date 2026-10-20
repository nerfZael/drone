import type { ChannelAuthor, ChannelMember, ChannelMessage } from './channels-api';

/** A chat by its name, or by its drone's name when it is the drone's default chat. */
export function chatDisplayName(chat: { droneName: string; chatName: string }): { name: string; drone: string | null } {
  return chat.chatName === 'default' ? { name: chat.droneName, drone: null } : { name: chat.chatName, drone: chat.droneName };
}

export function authorDisplay(author: ChannelAuthor): { name: string; drone: string | null } {
  return author.kind === 'user' ? { name: 'You', drone: null } : chatDisplayName(author);
}

export function authorKey(author: ChannelAuthor): string {
  return author.kind === 'user' ? 'user' : `chat:${author.chatId}`;
}

const AVATAR_TONES = ['accent', 'green', 'info', 'yellow', 'red', 'user'] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/** A stable color per chat, so the same agent looks the same in every channel. */
export function avatarTone(key: string): AvatarTone {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}

export function avatarInitial(name: string): string {
  const letter = name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0);
  return (letter || '#').toUpperCase();
}

const GROUP_WINDOW_MS = 5 * 60_000;

/**
 * Messages in a row from the same author within a few minutes share one header, like a
 * chat app; a reply always starts its own group so the quote stays readable.
 */
export function groupChannelMessages(messages: readonly ChannelMessage[]): Array<{ message: ChannelMessage; continued: boolean }> {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const continued = Boolean(
      previous &&
        !message.replyTo &&
        authorKey(previous.author) === authorKey(message.author) &&
        Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS,
    );
    return { message, continued };
  });
}

/** Where `@` autocomplete applies: the `@word` right before the caret. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s(\[{"'])@([A-Za-z0-9_/-]*)$/.exec(before);
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]!.toLowerCase() };
}

export type MentionCandidate = { handle: string; label: string; detail: string | null; key: string };

export function mentionCandidates(members: readonly ChannelMember[], query: string): MentionCandidate[] {
  const candidates = members.map((member) => {
    const display = chatDisplayName(member);
    return { handle: member.handle, label: display.name, detail: display.drone, key: member.chatId };
  });
  const q = query.toLowerCase();
  if (!q) return candidates.slice(0, 8);
  const rank = (candidate: MentionCandidate) => {
    const handle = candidate.handle.toLowerCase();
    const label = candidate.label.toLowerCase();
    if (handle.startsWith(q)) return 0;
    if (label.startsWith(q)) return 1;
    if (handle.includes(q) || label.includes(q) || candidate.detail?.toLowerCase().includes(q)) return 2;
    return -1;
  };
  return candidates
    .map((candidate) => ({ candidate, rank: rank(candidate) }))
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.candidate.handle.localeCompare(b.candidate.handle))
    .slice(0, 8)
    .map((item) => item.candidate);
}

/** Replaces the `@query` at the caret with a full handle and a space. */
export function insertMention(text: string, start: number, caret: number, handle: string): { text: string; caret: number } {
  const inserted = `@${handle} `;
  return { text: `${text.slice(0, start)}${inserted}${text.slice(caret)}`, caret: start + inserted.length };
}

/** One line of a message for a reply quote: markdown marks dropped, whitespace collapsed. */
export function plainPreview(text: string): string {
  return text
    .replace(/```[a-z0-9_-]*\n?/gi, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S)/g, '$1$2')
    .replace(/(\S)[*_](?=\s|$)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function subscriptionLabel(mode: ChannelMember['subscription'], paused = false): string {
  const label = mode === 'all' ? 'Every message' : mode === 'mentions' ? 'Mentions and replies' : 'Not subscribed';
  return paused ? `${label} (paused while the chat is archived)` : label;
}
