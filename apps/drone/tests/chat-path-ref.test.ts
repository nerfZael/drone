import { expect, test } from 'bun:test';
import { resolveChatIdInPath } from '../src/hub/chat-path-ref';

const CHAT_ID = '0b6f3c2e-8f43-4c1a-9d55-3e2a7c1b9f00';

test('a chat ID in a chat route becomes the chat current name, and a name is left alone', () => {
  const lookups: string[] = [];
  const chatNameForId = ({ droneId, chatId }: { droneId: string; chatId: string }) => {
    lookups.push(chatId);
    return droneId === 'drone-1' && chatId === CHAT_ID ? 'Release notes' : null;
  };

  const byId = new URL(`http://hub/api/drones/drone-1/chats/${CHAT_ID}/state?turn=last`);
  resolveChatIdInPath(byId, chatNameForId);
  expect(byId.pathname).toBe('/api/drones/drone-1/chats/Release%20notes/state');
  expect(byId.search).toBe('?turn=last');

  // Names are never looked up: chat IDs are UUIDs.
  const byName = new URL('http://hub/api/drones/drone-1/chats/Release%20notes/prompt');
  resolveChatIdInPath(byName, chatNameForId);
  expect(byName.pathname).toBe('/api/drones/drone-1/chats/Release%20notes/prompt');
  expect(lookups).toEqual([CHAT_ID]);

  // An ID no chat of this drone has stays as it was, and the route reports the chat missing.
  const unknown = new URL(`http://hub/api/drones/drone-2/chats/${CHAT_ID}`);
  resolveChatIdInPath(unknown, chatNameForId);
  expect(unknown.pathname).toBe(`/api/drones/drone-2/chats/${CHAT_ID}`);

  const other = new URL('http://hub/api/drones/drone-1/archived-chats');
  resolveChatIdInPath(other, chatNameForId);
  expect(other.pathname).toBe('/api/drones/drone-1/archived-chats');
});
