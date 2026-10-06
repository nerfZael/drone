import { expect, test } from 'bun:test';

import { beginTerminalOpen, takeTerminalFocusIntent } from '../src/droneHub/terminal/terminal-performance';

test('a terminal takes focus only once after the user asks for one', () => {
  // A terminal that appears with a drone's layout has nothing to claim.
  expect(takeTerminalFocusIntent()).toBe(false);
  beginTerminalOpen();
  expect(takeTerminalFocusIntent()).toBe(true);
  // The request is spent by the terminal it opened, not by the next one to mount.
  expect(takeTerminalFocusIntent()).toBe(false);
});
