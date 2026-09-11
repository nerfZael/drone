import { expect, test } from 'bun:test';
import { createQuickActionController, type QuickActionId } from '../src/droneHub/app/quick-action-menu';
import { WINDOW_LAYOUT_SLOTS } from '@drone/hub-model';

const key = (key: string) => ({ key, repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

test('all ten slots save and load through rapid nested sequences', async () => {
  const actions: QuickActionId[] = [];
  const menu = createQuickActionController(action => { actions.push(action); });
  for (const slot of WINDOW_LAYOUT_SLOTS) {
    for (const [sequence, action] of [[`fq${slot}`, `saveLayout${slot}`], [`f${slot}`, `loadLayout${slot}`]]) {
      menu.open();
      for (const letter of sequence!) menu.handleKey(key(letter));
      expect(menu.getSnapshot()?.busy).toBe(true);
      await settled();
      expect(menu.getSnapshot()).toBeNull();
      expect(actions.at(-1)).toBe(action);
    }
  }
});

test('failed requests remain visible and retryable; in-flight actions cannot repeat or navigate away', async () => {
  let reject!: (error: Error) => void;
  let calls = 0;
  const menu = createQuickActionController(() => {
    calls++;
    return new Promise<void>((_, fail) => { reject = fail; });
  });
  menu.open();
  for (const letter of 'f0') menu.handleKey(key(letter));
  await settled();
  menu.handleKey(key('0'));
  menu.handleKey(key('Backspace'));
  menu.handleKey(key('Escape'));
  expect(menu.getSnapshot()?.busy).toBe(true);
  expect(calls).toBe(1);
  reject(new Error('Slot 0 is empty'));
  await settled();
  expect(menu.getSnapshot()?.error).toBe('Slot 0 is empty');
  expect(menu.getSnapshot()?.busy).toBe(false);
  menu.select('q');
  expect(menu.getSnapshot()?.path.at(-1)?.label).toBe('Save preset');
});

test('unavailable workspace disables presets without disabling ordinary window actions', () => {
  const menu = createQuickActionController(() => {});
  menu.open({ closeDockedWindows: 'No workspace', ...Object.fromEntries(WINDOW_LAYOUT_SLOTS.flatMap(slot => [
    [`saveLayout${slot}`, 'No workspace'], [`loadLayout${slot}`, 'No workspace'],
  ])) });
  menu.select('f');
  expect(menu.getSnapshot()?.path).toHaveLength(0);
  menu.select('w');
  expect(menu.getSnapshot()?.path[0]?.label).toBe('Open window');
});


test('F then E closes docked windows through the organize subgroup', async () => {
  const actions: QuickActionId[] = [];
  const menu = createQuickActionController(action => { actions.push(action); });
  menu.open();
  for (const letter of 'fe') menu.handleKey(key(letter));
  await settled();
  expect(actions).toEqual(['closeDockedWindows']);
  expect(menu.getSnapshot()).toBeNull();
});
