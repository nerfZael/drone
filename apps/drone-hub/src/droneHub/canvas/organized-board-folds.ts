/**
 * Chats folded into other cards on the organized board, where they show as squares instead of cards of their own.
 * A chat is a card until it is folded; a side chat is a square on the chat it started from, and a chat another chat
 * created a square on its creator, until it is dragged out.
 * Folded with a card, the chats that came from it fold "via" it, so they come back out with it.
 */

/** A chat folded into `host`, or a side chat or created chat shown as a card. */
export type ChatFold = { host: string; via?: string } | { card: true };
export type DroneChatFolds = Record<string, ChatFold>;

export type FoldSideChat = {
  name: string;
  sourceChatName?: string;
  createdAt?: string;
  /** Shown by the composer: it can move to another card, but is never a card itself. */
  composer?: boolean;
};

export type FoldSquare = { chatName: string; kind: 'chat' | 'side-chat'; composer: boolean };

export type ResolvedFolds = {
  /** Chats shown as cards: every chat that is not folded, and side chats and created chats dragged out. */
  cards: Set<string>;
  /** The squares on each card, folded chats first in the sidebar's order, then side chats oldest first. */
  squaresByHost: Record<string, FoldSquare[]>;
  /** Chats shown as squares. */
  squared: Set<string>;
};

const hostOf = (fold: ChatFold | undefined): string | null => (fold && 'host' in fold ? fold.host : null);

/**
 * Where every chat shows. A square whose card is itself folded goes on to that card's card. A fold into a chat that
 * is gone puts a side chat back on the chat it started from and a created chat on its creator, and leaves any other
 * chat a card; a fold round in a loop leaves a chat a card (a side chat on the chat it started from).
 */
export function resolveFolds({ chatNames, sideChats, folds, creators }: {
  /** The drone's chats in the sidebar's order, side chats left out. */
  chatNames: readonly string[];
  sideChats: readonly FoldSideChat[];
  folds: DroneChatFolds | undefined;
  /** Chat name -> the chat of this drone that created it. */
  creators?: Readonly<Record<string, string>>;
}): ResolvedFolds {
  const chats = new Set(chatNames);
  const sides = [...sideChats].sort((a, b) => (Date.parse(a.createdAt ?? '') || 0) - (Date.parse(b.createdAt ?? '') || 0));
  const sideByName = new Map(sides.map((chat) => [chat.name, chat]));
  const known = (name: string) => chats.has(name) || sideByName.has(name);
  // Each chat's own host: null for a card.
  const direct = new Map<string, string | null>();
  for (const name of chatNames) {
    const fold = folds?.[name];
    const host = hostOf(fold);
    const creator = String(creators?.[name] ?? '').trim();
    if (host && host !== name && known(host)) direct.set(name, host);
    else direct.set(name, fold && 'card' in fold ? null : creator && creator !== name && known(creator) ? creator : null);
  }
  for (const chat of sides) {
    const fold = folds?.[chat.name];
    if (fold && 'card' in fold && !chat.composer) direct.set(chat.name, null);
    else {
      const host = hostOf(fold);
      direct.set(chat.name, host && host !== chat.name && known(host) ? host : String(chat.sourceChatName ?? '').trim() || null);
    }
  }
  // A side chat whose source is gone has nowhere to show, as before folding.
  const orphan = (name: string) => sideByName.has(name) && !known(direct.get(name) ?? '') && direct.get(name) !== null;
  const cards = new Set<string>();
  const finalHost = new Map<string, string | null>();
  const resolve = (name: string): string | null => {
    if (finalHost.has(name)) return finalHost.get(name)!;
    const seen = new Set([name]);
    let at = direct.get(name) ?? null;
    while (at !== null) {
      const next = direct.get(at) ?? null;
      if (next === null) break;
      if (seen.has(at)) { at = null; break; }
      seen.add(at);
      at = next;
    }
    finalHost.set(name, at);
    return at;
  };
  const squaresByHost: Record<string, FoldSquare[]> = {};
  for (const name of [...chatNames, ...sides.map((chat) => chat.name)]) {
    if (orphan(name)) continue;
    const host = direct.get(name) === null ? null : resolve(name);
    if (host === null || !known(host)) {
      // A loop, or a chain into a chat that is gone: a chat is a card again; a side chat goes back on its source.
      if (sideByName.has(name)) {
        const chat = sideByName.get(name)!;
        if (direct.get(name) === null && !chat.composer) cards.add(name);
        else {
          const source = sourceChatOf(name, sideByName);
          if (source && chats.has(source)) (squaresByHost[source] ??= []).push(square(name, chat));
        }
      } else cards.add(name);
      continue;
    }
    (squaresByHost[host] ??= []).push(square(name, sideByName.get(name)));
  }
  // Every chain ends on a chat that is not folded, so every host here is a card.
  const squared = new Set(Object.values(squaresByHost).flat().map((item) => item.chatName));
  return { cards, squaresByHost, squared };
}

/** The chat a side chat started from, through the side chats it may have started from in turn. */
function sourceChatOf(name: string, sideByName: ReadonlyMap<string, FoldSideChat>): string | null {
  const seen = new Set([name]);
  let at = String(sideByName.get(name)?.sourceChatName ?? '').trim();
  while (at && sideByName.has(at)) {
    if (seen.has(at)) return null;
    seen.add(at);
    at = String(sideByName.get(at)!.sourceChatName ?? '').trim();
  }
  return at || null;
}

function square(chatName: string, side: FoldSideChat | undefined): FoldSquare {
  return side ? { chatName, kind: 'side-chat', composer: Boolean(side.composer) } : { chatName, kind: 'chat', composer: false };
}

/**
 * Folds cards into `host`: each card in `leads`, and the chats that came from it (`followersOf`), which come back
 * out with it.
 */
export function foldChats(folds: DroneChatFolds | undefined, leads: readonly string[], followersOf: (lead: string) => readonly string[], host: string): DroneChatFolds {
  const next: DroneChatFolds = { ...folds };
  for (const lead of leads) {
    if (lead === host) continue;
    next[lead] = { host };
    for (const follower of followersOf(lead)) if (follower !== host && !leads.includes(follower)) next[follower] = { host, via: lead };
  }
  return next;
}

/**
 * A square dragged out: it is a card again, with the chats folded with it. A side chat or created chat among them
 * stays a card, rather than going back on the chat it started from or its creator.
 */
export function unfoldChat(folds: DroneChatFolds | undefined, chatName: string, foldsByDefault: (name: string) => boolean): DroneChatFolds {
  const next: DroneChatFolds = {};
  for (const [name, fold] of Object.entries(folds ?? {})) {
    if (name === chatName || ('via' in fold && fold.via === chatName)) {
      if (foldsByDefault(name)) next[name] = { card: true };
      continue;
    }
    next[name] = fold;
  }
  if (foldsByDefault(chatName)) next[chatName] = { card: true };
  return next;
}

/** A chat renamed: its folds, and the folds onto it or with it, follow the new name. */
export function renameChatInFolds(folds: DroneChatFolds | undefined, oldName: string, newName: string): DroneChatFolds | undefined {
  if (!folds || oldName === newName) return folds;
  const rename = (name: string) => (name === oldName ? newName : name);
  let changed = false;
  const next: DroneChatFolds = {};
  for (const [name, fold] of Object.entries(folds)) {
    const renamed: ChatFold = 'host' in fold
      ? { host: rename(fold.host), ...(fold.via ? { via: rename(fold.via) } : {}) }
      : fold;
    if (name === oldName || ('host' in fold && (fold.host === oldName || fold.via === oldName))) changed = true;
    next[rename(name)] = renamed;
  }
  return changed ? next : folds;
}

/** A square dragged onto another card: it moves there, with the chats folded with it. */
export function moveFoldedChat(folds: DroneChatFolds | undefined, chatName: string, host: string): DroneChatFolds {
  if (chatName === host) return { ...folds };
  const next: DroneChatFolds = {};
  for (const [name, fold] of Object.entries(folds ?? {})) {
    next[name] = 'via' in fold && fold.via === chatName ? { host, via: chatName } : fold;
  }
  next[chatName] = { host };
  return next;
}

/**
 * Of squares dragged together, the ones that move themselves: a square folded with another of them, folded into it,
 * or a side chat started from it or chat created by it, goes with that one, as it would dragged alone.
 */
export function squaresLeading(folds: DroneChatFolds | undefined, names: readonly string[], defaultHostOf: (name: string) => string | null): string[] {
  const moving = new Set(names);
  return names.filter((name) => {
    const fold = folds?.[name];
    const above = fold && 'host' in fold ? [fold.host, fold.via] : [defaultHostOf(name)];
    return !above.some((other) => other && other !== name && moving.has(other));
  });
}

/** A new chat takes the name of one that is gone: it is not folded, and nothing is folded into it. */
export function forgetChatInFolds(folds: DroneChatFolds | undefined, chatName: string): DroneChatFolds | undefined {
  if (!folds) return folds;
  let changed = false;
  const next: DroneChatFolds = {};
  for (const [name, fold] of Object.entries(folds)) {
    if (name === chatName || ('host' in fold && fold.host === chatName)) {
      changed = true;
      continue;
    }
    if ('host' in fold && fold.via === chatName) {
      changed = true;
      next[name] = { host: fold.host };
      continue;
    }
    next[name] = fold;
  }
  return changed ? next : folds;
}
