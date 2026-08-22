import { readFileSync } from 'node:fs';
import {
  cloneDefaultShortcutBindings,
  formatShortcutBinding,
  isShortcutMatch,
  migrateChatComposerShortcuts,
  migrateCompanionShortcut,
  migrateFormerPullRequestsShortcut,
  sanitizeSingleShortcutBinding,
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
    expect(defaults.createDraftGroup).toBeNull();
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
    expect(defaults.toggleSelectedDronePinned).toBeNull();
    expect(defaults.moveSelectedDroneToTop).toBeNull();
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
    expect(defaults.sendActiveChatComposer).toEqual({
      key: 's',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.toggleRightPanelWidth).toBeNull();
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
    expect(defaults.toggleChatVoiceRecording).toEqual({
      key: 'q',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.toggleChatVoiceRecordingPause).toEqual({
      key: 'w',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.discardChatVoiceRecording).toEqual({
      key: 'e',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.clearChatComposer).toEqual({
      key: 'r',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(defaults.toggleContinuousDictation).toEqual({
      key: 't',
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
    expect(defaults.openTerminalTab).toBeNull();
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

  test('preserves an explicit unbound value when updating one shortcut', () => {
    const current = {
      key: 'q',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    };

    expect(sanitizeSingleShortcutBinding(null, current)).toBeNull();
    expect(sanitizeSingleShortcutBinding(undefined, current)).toEqual(current);
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

  test('moves the former QWERT shortcuts to chat composer voice controls', () => {
    expect(migrateChatComposerShortcuts({
      toggleSelectedDronePinned: { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      moveSelectedDroneToTop: { key: 'w', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      createDraftGroup: { key: 'e', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      toggleContinuousDictation: { key: 'r', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      openTerminalTab: { key: 't', mod: false, ctrl: false, meta: false, alt: false, shift: false },
    })).toMatchObject({
      toggleSelectedDronePinned: null,
      moveSelectedDroneToTop: null,
      createDraftGroup: null,
      toggleChatVoiceRecording: { key: 'q' },
      toggleChatVoiceRecordingPause: { key: 'w' },
      discardChatVoiceRecording: { key: 'e' },
      clearChatComposer: { key: 'r' },
      toggleContinuousDictation: { key: 't' },
      openTerminalTab: null,
    });
  });

  test('moves the former S workspace shortcut to send chat message', () => {
    expect(migrateChatComposerShortcuts({
      toggleRightPanelWidth: {
        key: 's', mod: false, ctrl: false, meta: false, alt: false, shift: false,
      },
    })).toMatchObject({
      sendActiveChatComposer: { key: 's', mod: false },
      toggleRightPanelWidth: null,
    });
  });

  test('preserves a customized workspace shortcut when adding send chat message', () => {
    expect(migrateChatComposerShortcuts({
      toggleRightPanelWidth: {
        key: 'j', mod: false, ctrl: false, meta: false, alt: false, shift: false,
      },
    })).toMatchObject({
      sendActiveChatComposer: { key: 's', mod: false },
      toggleRightPanelWidth: { key: 'j', mod: false },
    });
  });

  test('preserves customized bindings while adding the composer shortcuts', () => {
    expect(migrateChatComposerShortcuts({
      toggleSelectedDronePinned: { key: 'q', mod: true, ctrl: false, meta: false, alt: false, shift: false },
      moveSelectedDroneToTop: { key: 'j', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      createDraftGroup: null,
      toggleContinuousDictation: { key: 'u', mod: false, ctrl: false, meta: false, alt: false, shift: false },
      openTerminalTab: { key: 'y', mod: false, ctrl: false, meta: false, alt: false, shift: false },
    })).toMatchObject({
      toggleSelectedDronePinned: { key: 'q', mod: true },
      moveSelectedDroneToTop: { key: 'j' },
      createDraftGroup: null,
      toggleContinuousDictation: { key: 'u' },
      openTerminalTab: { key: 'y' },
      toggleChatVoiceRecording: { key: 'q', mod: false },
      toggleChatVoiceRecordingPause: { key: 'w' },
      discardChatVoiceRecording: { key: 'e' },
      clearChatComposer: { key: 'r' },
    });
  });

  test('keeps E available to the global shortcut while the Changes editor is open', () => {
    const changesDockSource = readFileSync(
      new URL('../src/droneHub/changes/DroneChangesDock.tsx', import.meta.url),
      'utf8',
    );

    expect(changesDockSource).not.toContain("key === 'e'");
    expect(changesDockSource).not.toContain('Open in editor (E)');
  });

  test('resolves the root-drone shortcut repository through the sidebar selection', () => {
    const lifecycleSource = readFileSync(
      new URL('../src/droneHub/app/use-drone-hub-lifecycle-effects.ts', import.meta.url),
      'utf8',
    );
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );

    expect(lifecycleSource).toContain('requestSidebarRootDroneDraft()');
    expect(sidebarSource).toContain(
      "onOpenDraftChatComposer({ ...selectedDroneDraftLocation, group: '' })",
    );
  });
});
