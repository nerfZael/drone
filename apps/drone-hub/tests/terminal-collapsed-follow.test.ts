import { expect, test } from 'bun:test';

import { collapsedFollowOffset } from '../src/droneHub/terminal/DroneTerminalDock';

// A terminal kept at its expanded 600px height, showing a 200px collapsed strip.
const collapsed = { panelHeight: 600, stripHeight: 200 };

test('a prompt near the top shows from the top instead of sinking under empty space', () => {
  // The cursor line ends 20px from the top: 580px above the panel's bottom.
  expect(collapsedFollowOffset({ ...collapsed, atBottom: true, cursorBottomFromPanelBottom: 580 })).toBe(400);
});

test('a cursor deep in output sits at the bottom of the strip', () => {
  expect(collapsedFollowOffset({ ...collapsed, atBottom: true, cursorBottomFromPanelBottom: 150 })).toBe(146);
});

test('history being read and an expanded terminal are left alone', () => {
  expect(collapsedFollowOffset({ ...collapsed, atBottom: false, cursorBottomFromPanelBottom: 580 })).toBe(0);
  expect(
    collapsedFollowOffset({ panelHeight: 600, stripHeight: 600, atBottom: true, cursorBottomFromPanelBottom: 580 }),
  ).toBe(0);
});
