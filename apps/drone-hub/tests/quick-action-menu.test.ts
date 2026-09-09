import { describe, expect, test } from 'bun:test';
import { createQuickActionController, QUICK_ACTIONS, QUICK_ACTION_ROWS, quickActionDisabledReason, type QuickAction } from '../src/droneHub/app/quick-action-menu';
import { cloneDefaultShortcutBindings, migrateQuickActionShortcuts, type ShortcutActionId } from '../src/droneHub/app/shortcuts';
import { migrateDroneHubUiPersistedState } from '../src/droneHub/app/use-drone-hub-ui-store';

const key = (key: string, overrides = {}) => ({ key, repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides });
const plain = (key: string) => ({ key, mod: false, ctrl: false, meta: false, alt: false, shift: false });

describe('quick action sequences', () => {
  test('executes direct and nested actions without waiting for a render', () => {
    const actions: ShortcutActionId[] = [];
    const menu = createQuickActionController((action) => {
      expect(menu.getSnapshot()).toBeNull();
      actions.push(action);
    });
    for (const sequence of ['q', 'r', 'we', 'wq', 'ww', 'ae', 'f']) {
      menu.open();
      for (const letter of sequence) expect(menu.handleKey(key(letter))).toBe(true);
      expect(menu.getSnapshot()).toBeNull();
    }
    expect(actions).toEqual(['createDroneChat', 'createSideChat', 'createDraftGroup', 'createDraftDrone', 'createDraftDroneInCurrentGroup', 'toggleSelectedDronesToDo', 'openFilesTab']);
  });

  test('supports deeper nesting and backs up exactly one level', () => {
    const root: QuickAction[] = [{ key: 'q', label: 'One', children: [{ key: 'q', label: 'Two', children: [{ key: 'e', label: 'Home', action: 'openHome' }] }] }];
    const actions: string[] = [];
    const menu = createQuickActionController((action) => actions.push(action), undefined, root);
    menu.open();
    menu.select('q');
    menu.select('q');
    expect(menu.getSnapshot()?.path.map((node) => node.label)).toEqual(['One', 'Two']);
    menu.handleKey(key('Backspace'));
    expect(menu.getSnapshot()?.path).toHaveLength(1);
    menu.select('q');
    menu.select('e');
    expect(actions).toEqual(['openHome']);
  });

  test('Escape dismisses every level and reopening resets the path', () => {
    const menu = createQuickActionController(() => { throw Error('Unexpected action'); });
    menu.open();
    menu.select('w');
    menu.handleKey(key('Escape'));
    expect(menu.getSnapshot()).toBeNull();
    expect(menu.handleKey(key('q'))).toBe(false);
    menu.open();
    expect(menu.getSnapshot()?.path).toEqual([]);
    menu.back();
    expect(menu.getSnapshot()?.items).toBe(QUICK_ACTIONS);
    menu.close(); // Pointer dismissal uses the same operation.
    expect(menu.getSnapshot()).toBeNull();
  });

  test('held trigger, composition, modified and unknown keys do not execute or escape to background actions', () => {
    const actions: string[] = [];
    const menu = createQuickActionController((action) => actions.push(action));
    menu.open();
    for (const event of [key('r', { repeat: true }), key('q', { isComposing: true }), key('q', { ctrlKey: true }), key('q', { metaKey: true }), key('q', { altKey: true }), key('q', { shiftKey: true }), key('b'), key('Delete')]) {
      expect(menu.handleKey(event)).toBe(true);
    }
    expect(actions).toEqual([]);
    expect(menu.getSnapshot()).not.toBeNull();
    for (const native of ['Tab', 'Enter', ' ']) expect(menu.handleKey(key(native))).toBe(false);
    menu.handleKey(key('r'));
    expect(actions).toEqual(['createSideChat']);
  });

  test('disabled buttons keep their positions and ignore clicks and keys', () => {
    const actions: string[] = [];
    const menu = createQuickActionController((action) => actions.push(action));
    menu.open({ createDroneChat: 'Select a drone', toggleSelectedDronePinned: 'Select a drone', moveSelectedDroneToTop: 'Select a drone', toggleSelectedDronesToDo: 'Select a drone' });
    const state = menu.getSnapshot()!;
    expect(state.items.map((item) => item.key).join('')).toBe(QUICK_ACTION_ROWS.join(''));
    expect(quickActionDisabledReason(state.items.find((item) => item.key === 'a')!, state.unavailable)).toBe('Select a drone');
    menu.select('q');
    menu.handleKey(key('q'));
    menu.select('a');
    expect(menu.getSnapshot()?.path).toEqual([]);
    expect(actions).toEqual([]);
    menu.select('v');
    expect(actions).toEqual(['openHome']);
  });
});

describe('quick action shortcut migration', () => {
  test('sets new defaults and migrates saved defaults through the persisted store', () => {
    const defaults = cloneDefaultShortcutBindings();
    expect(defaults.openQuickActions).toEqual(plain('r'));
    expect(defaults.createSideChat).toBeNull();
    expect(defaults.openFilesTab).toBeNull();
    expect(defaults.toggleSidebarCollapsed).toEqual({ ...plain('d'), ctrl: true });
    const old: Record<string, unknown> = { ...defaults, createSideChat: plain('r'), openFilesTab: plain('f'), toggleSidebarCollapsed: plain('a') };
    delete old.openQuickActions;
    expect(migrateDroneHubUiPersistedState({ shortcutBindings: old }).shortcutBindings).toEqual(defaults);
  });

  test('preserves custom shortcuts and explicit unbindings across repeated migrations', () => {
    const old = { createSideChat: plain('j'), openFilesTab: plain('k'), toggleSidebarCollapsed: null };
    const migrated = migrateQuickActionShortcuts(old);
    expect(migrated).toMatchObject({ ...old, openQuickActions: plain('r') });
    expect(migrateQuickActionShortcuts(migrated)).toBe(migrated);
    const configured = { ...old, openQuickActions: null };
    expect(migrateQuickActionShortcuts(configured)).toBe(configured);
  });

  test('does not steal R or Ctrl+D from unrelated custom actions', () => {
    expect(migrateQuickActionShortcuts({ openHome: plain('r'), toggleSidebarCollapsed: plain('a'), openTerminalTab: { ...plain('d'), ctrl: true } })).toMatchObject({ openHome: plain('r'), openQuickActions: null, toggleSidebarCollapsed: null, openTerminalTab: { ...plain('d'), ctrl: true } });
  });

  test('unbinds former Ctrl+D recording when moving the sidebar', () => {
    expect(migrateQuickActionShortcuts({ toggleSidebarCollapsed: plain('a'), toggleFileDictation: { ...plain('d'), ctrl: true } })).toMatchObject({ toggleFileDictation: null, toggleSidebarCollapsed: { ...plain('d'), ctrl: true } });
  });
});
