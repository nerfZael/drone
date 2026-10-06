import { afterEach, expect, test } from 'bun:test';
import { detachedChatKey } from '../src/droneHub/app/detached-chat-store';
import { useDesktopChatRequests } from '../src/droneHub/app/desktop-chat-requests';

afterEach(() => useDesktopChatRequests.setState({ windows: {} }));

test('a renamed chat keeps its open desktop window', () => {
  const key = detachedChatKey('drone', 'old');
  useDesktopChatRequests.setState({ windows: { [key]: { droneId: 'drone', chatName: 'old', request: 1 } } });

  useDesktopChatRequests.getState().rename('drone', 'old', 'new');
  expect(useDesktopChatRequests.getState().windows).toEqual({ [key]: { droneId: 'drone', chatName: 'new', request: 1 } });

  // Opening the chat again focuses that window rather than opening a second one.
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { droneHubDesktop: { setChatWindowAlwaysOnTop: () => {} } };
  try {
    useDesktopChatRequests.getState().request('drone', 'new');
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
  expect(useDesktopChatRequests.getState().windows).toEqual({ [key]: { droneId: 'drone', chatName: 'new', request: 2 } });
});
