import { expect, test } from 'bun:test';
import { deletableChatNames } from '../src/sidebar/chat-deletion';

test('default can be deleted alone or with some of the other chats', () => {
  expect(deletableChatNames(['default', 'review'], ['default'])).toEqual(['default']);
  expect(deletableChatNames(['default', 'review', 'plan'], ['default', 'plan'])).toEqual(['default', 'plan']);
});
test('bulk deletion preserves an existing chat, even without default', () => {
  expect(deletableChatNames(['default', 'review'], ['default', 'review'])).toEqual(['review']);
  expect(deletableChatNames(['review', 'plan'], ['review', 'plan'])).toEqual(['plan']);
  expect(deletableChatNames(['review'], ['review'])).toEqual([]);
  expect(deletableChatNames(['default'], ['default'])).toEqual([]);
});
