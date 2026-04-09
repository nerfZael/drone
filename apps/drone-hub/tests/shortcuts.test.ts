import { cloneDefaultShortcutBindings } from '../src/droneHub/app/shortcuts';

describe('shortcut defaults', () => {
  test('uses Tab for create draft drone, Y for the task board, Enter for chat focus, D for the side panel, and G for hovered multi-chat', () => {
    const defaults = cloneDefaultShortcutBindings();
    expect(defaults.createDraftDrone).toEqual({
      key: 'tab',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.openKanbanBoard).toEqual({
      key: 'y',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.focusPrimaryChatInput).toEqual({
      key: 'enter',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.toggleRightPanelOpen).toEqual({
      key: 'd',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.openHoveredGroupMultiChat).toEqual({
      key: 'g',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
  });
});
