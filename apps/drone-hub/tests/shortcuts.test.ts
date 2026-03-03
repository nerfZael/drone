import { cloneDefaultShortcutBindings } from '../src/droneHub/app/shortcuts';

describe('shortcut defaults', () => {
  test('uses Tab for create draft drone and Enter for focusing the primary chat input', () => {
    const defaults = cloneDefaultShortcutBindings();
    expect(defaults.createDraftDrone).toEqual({
      key: 'tab',
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
  });
});
