import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { cloneDefaultShortcutBindings } from '../src/droneHub/app/shortcuts';
import { COMPANION_WINDOW_SHORTCUT_CANCEL, relayCompanionWindowShortcuts } from '../src/droneHub/companion/companion-window-shortcuts';

test('floating Companion relays local recording and proposal keys, preserves release and cancels holds on blur', () => {
  const owner = new Window();
  const child = new Window();
  const bindings = cloneDefaultShortcutBindings();
  const events: string[] = [];
  const handle = (event: any) => { events.push(`${event.type}:${event.key}`); event.preventDefault(); };
  owner.document.addEventListener('keydown', handle);
  owner.document.addEventListener('keyup', handle);
  owner.addEventListener(COMPANION_WINDOW_SHORTCUT_CANCEL, () => events.push('cancel'));
  const dispose = relayCompanionWindowShortcuts(child as any, owner as any, () => bindings);
  const press = (key: string, type = 'keydown', target = child.document.body) => {
    const event = new child.KeyboardEvent(type, { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    expect(press('`')).toBe(true);
    expect(press('`', 'keyup')).toBe(true);
    expect(press('CapsLock')).toBe(true);
    expect(press('CapsLock', 'keyup')).toBe(true);
    expect(events).toEqual(['keydown:`', 'keyup:`', 'keydown:CapsLock', 'keyup:CapsLock']);
    events.length = 0;
    for (const key of ['1', '2', 'a', 'Escape']) expect(press(key)).toBe(false);
    const input = child.document.createElement('input');
    input.setAttribute('data-shortcut-capture', 'true');
    child.document.body.append(input);
    expect(press('`', 'keydown', input)).toBe(false);
    const dialog = child.document.createElement('div');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    child.document.body.append(dialog);
    expect(press('`')).toBe(false);
    dialog.remove();
    expect(events).toEqual([]);
    press('`');
    child.dispatchEvent(new child.Event('blur'));
    expect(events).toEqual(['keydown:`', 'cancel']);
    events.length = 0;
    bindings.toggleCompanion = { ...bindings.toggleCompanion!, key: 'x' };
    expect(press('`')).toBe(false);
    expect(press('x')).toBe(true);
    // A shortcut modal opened during a hold must not swallow its release.
    child.document.body.append(dialog);
    expect(press('x', 'keyup')).toBe(true);
    dialog.remove();
    expect(events).toEqual(['keydown:x', 'keyup:x']);
    Object.defineProperty(child.document, 'hasFocus', { value: () => false, configurable: true });
    expect(press('x')).toBe(false);
    Object.defineProperty(child.document, 'hasFocus', { value: () => true });
    press('x'); dispose();
    expect(events.at(-1)).toBe('cancel');
    expect(press('x')).toBe(false);
  } finally {
    dispose(); owner.happyDOM.abort(); child.happyDOM.abort();
  }
});
