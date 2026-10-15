import { expect, test } from 'bun:test';
import {
  activeMentionQuery,
  avatarTone,
  chatDisplayName,
  groupChannelMessages,
  insertMention,
  mentionCandidates,
  plainPreview,
} from '../src/droneHub/channels/channel-presentation';
import type { ChannelMember, ChannelMessage } from '../src/droneHub/channels/channels-api';

const member = (chatId: string, handle: string, droneName: string, chatName: string): ChannelMember => ({
  chatId, handle, droneId: `drone-${chatId}`, droneName, chatName, available: true, canRead: true, canSend: true,
  subscription: 'mentions', subscriptionPaused: false, addedBy: { kind: 'user' }, addedAt: '2026-10-14T10:00:00.000Z',
});

const message = (id: string, author: ChannelMessage['author'], at: string, replyTo: ChannelMessage['replyTo'] = null): ChannelMessage => ({
  id, seq: Number(id), createdAt: at, author, text: id, replyTo, mentions: [], mentionsUser: false,
});

test('a default chat goes by its drone name', () => {
  expect(chatDisplayName({ droneName: 'api', chatName: 'default' })).toEqual({ name: 'api', drone: null });
  expect(chatDisplayName({ droneName: 'api', chatName: 'review' })).toEqual({ name: 'review', drone: 'api' });
  expect(avatarTone('chat-1')).toBe(avatarTone('chat-1'));
});

test('messages from one author within minutes group, and replies start a new group', () => {
  const alpha = { kind: 'chat' as const, chatId: 'a', droneId: 'd', droneName: 'api', chatName: 'default', handle: 'api' };
  const grouped = groupChannelMessages([
    message('1', alpha, '2026-10-14T10:00:00.000Z'),
    message('2', alpha, '2026-10-14T10:01:00.000Z'),
    message('3', alpha, '2026-10-14T10:02:00.000Z', { id: '1', author: alpha, text: '1' }),
    message('4', { kind: 'user', handle: 'user' }, '2026-10-14T10:02:30.000Z'),
    message('5', { kind: 'user', handle: 'user' }, '2026-10-14T10:20:00.000Z'),
  ]);
  expect(grouped.map((item) => item.continued)).toEqual([false, true, false, false, false]);
});

test('@ autocomplete finds the word at the caret and inserts a full handle', () => {
  expect(activeMentionQuery('hi @we', 6)).toEqual({ start: 3, query: 'we' });
  expect(activeMentionQuery('mail x@we', 9)).toBeNull();
  expect(activeMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  const members = [member('1', 'api', 'api', 'default'), member('2', 'web/review', 'web', 'review'), member('3', 'ops/review', 'ops', 'review')];
  expect(mentionCandidates(members, 'rev').map((candidate) => candidate.handle)).toEqual(['ops/review', 'web/review']);
  expect(mentionCandidates(members, 'web').map((candidate) => candidate.handle)).toEqual(['web/review']);
  expect(insertMention('hi @we there', 3, 6, 'web/review')).toEqual({ text: 'hi @web/review  there', caret: 15 });
});

test('reply quotes read as plain text', () => {
  expect(plainPreview('Kicking off the **2.4 release**.\n\n- `0042_add` and [docs](http://x)\n```ts\nconst a = 1;\n```')).toBe(
    'Kicking off the 2.4 release. 0042_add and docs const a = 1;',
  );
  expect(plainPreview('# Title\n> quoted _emphasis_ snake_case')).toBe('Title quoted emphasis snake_case');
});

test('a channel counts as being read while any window shows it', async () => {
  const { isChannelBeingRead, markChannelBeingRead } = await import('../src/droneHub/channels/channels-ui-store');
  expect(isChannelBeingRead('c1')).toBe(false);
  const docked = markChannelBeingRead('c1');
  const desktop = markChannelBeingRead('c1');
  docked();
  expect(isChannelBeingRead('c1')).toBe(true);
  desktop();
  expect(isChannelBeingRead('c1')).toBe(false);
});
