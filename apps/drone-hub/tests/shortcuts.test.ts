import { readFileSync } from 'node:fs';
import { cloneDefaultShortcutBindings } from '../src/droneHub/app/shortcuts';

describe('shortcut defaults', () => {
  test('uses 1/2/3 for drone creation, E for group creation, and Q/W for selected-drone organization', () => {
    const defaults = cloneDefaultShortcutBindings();
    expect(defaults.createDraftDrone).toEqual({
      key: '1',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.createDraftGroup).toEqual({
      key: 'e',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.createChildDraftDrone).toEqual({
      key: '3',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.createDroneChat).toEqual({
      key: '2',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.toggleSelectedDronePinned).toEqual({
      key: 'q',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.moveSelectedDroneToTop).toEqual({
      key: 'w',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.toggleSelectedDronesToDo).toBeNull();
    expect(defaults.markSelectedDronesUnread).toEqual({
      key: 'z',
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
    expect(defaults.toggleVoiceClipboardRecording).toEqual({
      key: '`',
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

  test('keeps the Changes editor E binding available for the global create-group action', () => {
    const changesDockSource = readFileSync(
      new URL('../src/droneHub/changes/DroneChangesDock.tsx', import.meta.url),
      'utf8',
    );

    expect(changesDockSource).not.toContain("key === 'e'");
    expect(changesDockSource).not.toContain('Open in editor (E)');
  });
});
