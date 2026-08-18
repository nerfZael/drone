import { readFileSync } from 'node:fs';
import {
  cloneDefaultShortcutBindings,
  formatShortcutBinding,
  isShortcutMatch,
  migrateCompanionShortcut,
  migrateFormerPullRequestsShortcut,
  sanitizeShortcutBindings,
  shortcutBindingFromKeyboardEvent,
} from '../src/droneHub/app/shortcuts';

describe('shortcut defaults', () => {
  test('uses 1/2/3/4 for root drone, grouped drone, draft chat, and chat clone', () => {
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
    expect(defaults.createDraftDroneInCurrentGroup).toEqual({
      key: '2',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.createDroneChat).toEqual({
      key: '3',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.cloneDroneChat).toEqual({
      key: '4',
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
    expect(defaults.toggleChatComposerEditorMode).toEqual({
      key: 'e',
      mod: false,
      ctrl: true,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(
      isShortcutMatch(defaults.toggleChatComposerEditorMode, {
        key: 'e',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(defaults.toggleContinuousDictation).toEqual({
      key: 'r',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.toggleFileDictation).toEqual({
      key: 'd',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.openPullRequestsTab).toBeNull();
    expect(defaults.toggleCompanion).toEqual({
      key: '`',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.applyCompanionProposal).toEqual({
      key: 'capslock',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(formatShortcutBinding(defaults.applyCompanionProposal)).toBe('Caps Lock');
    expect(defaults.toggleVoiceClipboardRecording).toBeNull();
    expect(defaults.openHoveredGroupMultiChat).toEqual({
      key: 'g',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.openQuickOpen).toEqual({
      key: 'p',
      mod: true,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
  });

  test('captures and matches portable shortcuts with multiple modifiers', () => {
    const binding = shortcutBindingFromKeyboardEvent(
      { key: 'P', ctrlKey: true, metaKey: false, altKey: true, shiftKey: true },
      { preferPortablePrimaryModifier: true },
    );

    expect(binding).toEqual({ key: 'p', mod: true, ctrl: false, meta: false, alt: true, shift: true });
    expect(formatShortcutBinding(binding)).toBe('Ctrl/Cmd+Alt+Shift+P');
    expect(isShortcutMatch(binding, { key: 'p', ctrlKey: true, metaKey: false, altKey: true, shiftKey: true })).toBe(true);
    expect(isShortcutMatch(binding, { key: 'p', ctrlKey: false, metaKey: true, altKey: true, shiftKey: true })).toBe(true);
    expect(isShortcutMatch(binding, { key: 'p', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(false);
  });

  test('restores and accepts customization of the full-editor shortcut', () => {
    expect(sanitizeShortcutBindings({}).toggleChatComposerEditorMode).toEqual(
      cloneDefaultShortcutBindings().toggleChatComposerEditorMode,
    );

    expect(
      sanitizeShortcutBindings({
        toggleChatComposerEditorMode: {
          key: 'u',
          mod: true,
          ctrl: false,
          meta: false,
          alt: true,
          shift: false,
        },
      }).toggleChatComposerEditorMode,
    ).toEqual({
      key: 'u',
      mod: true,
      ctrl: false,
      meta: false,
      alt: true,
      shift: false,
    });
  });

  test('moves the former default R binding from pull requests to continuous dictation', () => {
    expect(
      migrateFormerPullRequestsShortcut({
        openPullRequestsTab: {
          key: 'r',
          mod: false,
          ctrl: false,
          meta: false,
          alt: false,
          shift: false,
        },
      }),
    ).toMatchObject({
      toggleContinuousDictation: {
        key: 'r',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
      openPullRequestsTab: null,
    });

    const explicitlyConfigured = {
      toggleContinuousDictation: null,
      openPullRequestsTab: {
        key: 'r',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      },
    };
    expect(migrateFormerPullRequestsShortcut(explicitlyConfigured)).toBe(explicitlyConfigured);
  });

  test('moves the former default backtick binding from voice clipboard to Companion', () => {
    expect(migrateCompanionShortcut({
      toggleVoiceClipboardRecording: {
        key: '`', mod: false, ctrl: false, meta: false, alt: false, shift: false,
      },
    })).toMatchObject({
      toggleCompanion: {
        key: '`', mod: false, ctrl: false, meta: false, alt: false, shift: false,
      },
      toggleVoiceClipboardRecording: null,
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
