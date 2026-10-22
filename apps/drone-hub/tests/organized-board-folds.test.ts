import { describe, expect, test } from 'bun:test';
import { foldChats, forgetChatInFolds, moveFoldedChat, renameChatInFolds, resolveFolds, squaresLeading, unfoldChat, type DroneChatFolds } from '../src/droneHub/canvas/organized-board-folds';

const chatNames = ['implementer', 'reviewer', 'plan', 'plan-copy', 'worker'];
const sideChats = [
  { name: 'aside', sourceChatName: 'plan', createdAt: '2026-10-02T00:00:00Z' },
  { name: 'chip', sourceChatName: 'plan', createdAt: '2026-10-01T00:00:00Z', composer: true },
  { name: 'nested', sourceChatName: 'aside', createdAt: '2026-10-03T00:00:00Z' },
];
const isSide = (name: string) => sideChats.some((chat) => chat.name === name);
const resolve = (folds?: DroneChatFolds) => resolveFolds({ chatNames, sideChats, folds });
const names = (squares: { chatName: string }[] | undefined) => (squares ?? []).map((square) => square.chatName);
// plan-copy and worker came from plan.
const followers = (lead: string) => (lead === 'plan' ? ['plan-copy', 'worker'] : []);

describe('folded chats', () => {
  test('unfolded, chats are cards and side chats squares on the chat they started from', () => {
    const { cards, squaresByHost } = resolve();
    expect([...cards]).toEqual(chatNames);
    expect(names(squaresByHost.plan)).toEqual(['chip', 'aside', 'nested']);
  });

  test('a chat folded into another is a square there, before its side chats', () => {
    const folds = foldChats(undefined, ['reviewer'], followers, 'implementer');
    const { cards, squaresByHost } = resolve(folds);
    expect(cards.has('reviewer')).toBe(false);
    expect(squaresByHost.implementer).toEqual([{ chatName: 'reviewer', kind: 'chat', composer: false }]);
  });

  test('folding a card takes the chats that came from it, and its side chats, onto the new card', () => {
    const folds = foldChats(undefined, ['plan'], followers, 'implementer');
    const { cards, squaresByHost } = resolve(folds);
    expect([...cards]).toEqual(['implementer', 'reviewer']);
    expect(names(squaresByHost.implementer)).toEqual(['plan', 'plan-copy', 'worker', 'chip', 'aside', 'nested']);
    // Dragged back out, plan brings them all back.
    const back = resolve(unfoldChat(folds, 'plan', isSide));
    expect([...back.cards]).toEqual(chatNames);
    expect(names(back.squaresByHost.plan)).toEqual(['chip', 'aside', 'nested']);
  });

  test('one chat dragged out of a group comes out alone; the others stay', () => {
    const folds = foldChats(undefined, ['plan'], followers, 'implementer');
    const { cards, squaresByHost } = resolve(unfoldChat(folds, 'worker', isSide));
    expect(cards.has('worker')).toBe(true);
    expect(names(squaresByHost.implementer)).toEqual(['plan', 'plan-copy', 'chip', 'aside', 'nested']);
  });

  test('a side chat dragged out is a card; a composer side chat never is', () => {
    const out = resolve(unfoldChat(undefined, 'aside', isSide));
    expect(out.cards.has('aside')).toBe(true);
    // A side chat of a side chat goes on the card its parent became.
    expect(names(out.squaresByHost.aside)).toEqual(['nested']);
    expect(names(out.squaresByHost.plan)).toEqual(['chip']);
    expect(resolve(unfoldChat(undefined, 'chip', isSide)).cards.has('chip')).toBe(false);
  });

  test('a side chat dragged out as a card, folded in with its source and out again, is a card again', () => {
    const asCard = unfoldChat(undefined, 'aside', isSide);
    const folded = foldChats(asCard, ['plan'], (lead) => (lead === 'plan' ? ['plan-copy', 'worker', 'aside'] : []), 'implementer');
    expect(resolve(folded).cards.has('aside')).toBe(false);
    expect(resolve(unfoldChat(folded, 'plan', isSide)).cards.has('aside')).toBe(true);
  });

  test('a square moved to another card goes there with what was folded with it', () => {
    const folds = moveFoldedChat(foldChats(undefined, ['plan'], followers, 'implementer'), 'plan', 'reviewer');
    const { squaresByHost } = resolve(folds);
    expect(names(squaresByHost.reviewer)).toEqual(['plan', 'plan-copy', 'worker', 'chip', 'aside', 'nested']);
    expect(squaresByHost.implementer).toBeUndefined();
    expect(names(resolve(moveFoldedChat(undefined, 'chip', 'reviewer')).squaresByHost.reviewer)).toEqual(['chip']);
  });

  test('a card folded into a card that is itself folded shows on the outer card', () => {
    const folds = foldChats(foldChats(undefined, ['reviewer'], followers, 'implementer'), ['implementer'], followers, 'plan');
    const { cards, squaresByHost } = resolve(folds);
    expect(cards.has('implementer')).toBe(false);
    expect(names(squaresByHost.plan)).toEqual(['implementer', 'reviewer', 'chip', 'aside', 'nested']);
  });

  test('a renamed chat keeps its folds, and those onto it or with it', () => {
    const folds = foldChats({ reviewer: { host: 'plan' } }, ['plan'], followers, 'implementer');
    expect(renameChatInFolds(folds, 'plan', 'planning')).toEqual({
      reviewer: { host: 'planning' },
      planning: { host: 'implementer' },
      'plan-copy': { host: 'implementer', via: 'planning' },
      worker: { host: 'implementer', via: 'planning' },
    });
    expect(renameChatInFolds(folds, 'unrelated', 'other')).toBe(folds);
  });

  test('folds into a chat that is gone, or round in a loop, leave the chats as cards', () => {
    expect(resolve({ reviewer: { host: 'deleted' } }).cards.has('reviewer')).toBe(true);
    const loop = resolve({ reviewer: { host: 'implementer' }, implementer: { host: 'reviewer' } });
    expect(loop.cards.has('reviewer') && loop.cards.has('implementer')).toBe(true);
    expect(loop.squaresByHost.implementer).toBeUndefined();
  });

  test('squares dragged together move once each: one that goes with another of them is left to it', () => {
    const folds = foldChats({ reviewer: { host: 'plan' } }, ['plan'], followers, 'implementer');
    const sourceOf = (name: string) => sideChats.find((chat) => chat.name === name)?.sourceChatName ?? null;
    const all = names(resolve(folds).squaresByHost.implementer);
    expect(all).toEqual(['reviewer', 'plan', 'plan-copy', 'worker', 'chip', 'aside', 'nested']);
    expect(squaresLeading(folds, all, sourceOf)).toEqual(['plan']);
    // All dragged out, they come back as they were: plan a card with its tree, reviewer still folded into it.
    let out: DroneChatFolds | undefined = folds;
    for (const name of squaresLeading(folds, all, sourceOf)) out = unfoldChat(out, name, isSide);
    expect(out).toEqual({ reviewer: { host: 'plan' } });
    expect(names(resolve(out).squaresByHost.plan)).toEqual(['reviewer', 'chip', 'aside', 'nested']);
  });

  test('a new chat with the name of one that is gone is not folded, and nothing is folded into it', () => {
    const folds: DroneChatFolds = { reviewer: { host: 'implementer' }, worker: { host: 'reviewer', via: 'plan' }, plan: { host: 'reviewer' } };
    expect(forgetChatInFolds(folds, 'reviewer')).toEqual({});
    expect(forgetChatInFolds(folds, 'plan')).toEqual({ reviewer: { host: 'implementer' }, worker: { host: 'reviewer' } });
    expect(forgetChatInFolds(folds, 'notes')).toBe(folds);
  });

  test('a side chat of a side chat whose fold loops goes back on the chat it all started from', () => {
    const { squaresByHost, cards } = resolve({ nested: { host: 'aside' }, aside: { host: 'nested' } });
    expect(cards.has('aside')).toBe(false);
    expect(names(squaresByHost.plan)).toEqual(['chip', 'aside', 'nested']);
  });
});

describe('chats created by another chat', () => {
  const chats = ['orchestrator', 'worker-a', 'worker-b', 'sub', 'notes'];
  const creators = { 'worker-a': 'orchestrator', 'worker-b': 'orchestrator', sub: 'worker-a' };
  const created = (name: string) => name in creators;
  const resolveCreated = (folds?: DroneChatFolds) => resolveFolds({ chatNames: chats, sideChats: [], folds, creators });

  test('are squares on their creator, and a chat they created goes on the same card', () => {
    const { cards, squaresByHost } = resolveCreated();
    expect([...cards]).toEqual(['orchestrator', 'notes']);
    expect(names(squaresByHost.orchestrator)).toEqual(['worker-a', 'worker-b', 'sub']);
  });

  test('dragged out, one is a card and stays one, with the chats it created on it', () => {
    const folds = unfoldChat(undefined, 'worker-a', created);
    expect(folds).toEqual({ 'worker-a': { card: true } });
    const { cards, squaresByHost } = resolveCreated(folds);
    expect([...cards]).toEqual(['orchestrator', 'worker-a', 'notes']);
    expect(names(squaresByHost.orchestrator)).toEqual(['worker-b']);
    expect(names(squaresByHost['worker-a'])).toEqual(['sub']);
  });

  test('go with their creator when it is folded into another card, and stay when it comes out', () => {
    const folds = foldChats(undefined, ['orchestrator'], () => [], 'notes');
    expect(names(resolveCreated(folds).squaresByHost.notes)).toEqual(['orchestrator', 'worker-a', 'worker-b', 'sub']);
    expect(names(resolveCreated(unfoldChat(folds, 'orchestrator', created)).squaresByHost.orchestrator)).toEqual(['worker-a', 'worker-b', 'sub']);
  });

  test('one dragged out and folded in with its creator comes back out as a card', () => {
    const asCard = unfoldChat(undefined, 'worker-a', created);
    const folded = foldChats(asCard, ['orchestrator'], () => ['worker-a'], 'notes');
    expect(resolveCreated(folded).cards.has('worker-a')).toBe(false);
    expect(resolveCreated(unfoldChat(folded, 'orchestrator', created)).cards.has('worker-a')).toBe(true);
  });

  test('dragged together with their creator, they go with it', () => {
    const folds = foldChats(undefined, ['orchestrator'], () => [], 'notes');
    const all = names(resolveCreated(folds).squaresByHost.notes);
    const leading = squaresLeading(folds, all, (name) => creators[name as keyof typeof creators] ?? null);
    expect(leading).toEqual(['orchestrator']);
  });

  test('folded into a chat that is gone, or created by one that is gone, a chat goes back on its creator or is a card', () => {
    expect(names(resolveCreated({ 'worker-b': { host: 'deleted' } }).squaresByHost.orchestrator)).toEqual(['worker-a', 'worker-b', 'sub']);
    const orphan = resolveFolds({ chatNames: ['worker-a'], sideChats: [], folds: undefined, creators });
    expect([...orphan.cards]).toEqual(['worker-a']);
  });
});
