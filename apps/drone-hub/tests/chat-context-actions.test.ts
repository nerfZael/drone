import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { chatActionMenuItems } from '../src/droneHub/app/ChatContextActions';
import { cloneDefaultShortcutBindings } from '../src/droneHub/app/shortcuts';

function harness() {
  const dom = new Window();
  const group = dom.document.createElement('div');
  group.className = 'dv-groupview';
  const scope = dom.document.createElement('div');
  const marker = dom.document.createElement('span');
  marker.dataset.chatForkSupported = 'true';
  marker.dataset.chatForkBusy = 'false';
  scope.append(marker);
  group.append(scope);
  dom.document.body.append(group);
  const items = () => chatActionMenuItems({ droneId: 'drone', chatName: 'fork-A' }, scope as unknown as HTMLElement,
    { createChat() {}, cloneChat() {} }, cloneDefaultShortcutBindings());
  return { dom, group, scope, marker, items };
}

test('fork menu explains missing history, unsupported agents, and busy operations', () => {
  const h = harness();
  const fork = () => h.items().find(item => item.id === 'fork-side-chat')!;
  expect(fork().disabledReason).toBe('Wait for a completed assistant answer.');
  h.scope.dataset.sideChatCheckpointId = 'answer';
  expect(fork().disabled).toBe(false);
  const previouslyEnabled = fork();
  h.marker.dataset.chatForkSupported = 'false';
  expect(fork().disabled).toBe(true);
  expect(fork().disabledReason).toContain('not supported');
  h.marker.dataset.chatForkSupported = 'true';
  h.marker.dataset.chatForkBusy = 'true';
  expect(fork().disabled).toBe(true);
  expect(fork().disabledReason).toContain('already in progress');
  // Recheck availability even if the operation started after the menu opened.
  expect(() => previouslyEnabled.onSelect()).not.toThrow();
  h.dom.happyDOM.cancelAsync();
});

test('menu moves the clicked chat through its existing toolbar control and respects its busy guard', () => {
  const h = harness();
  let moves = 0;
  const button = h.dom.document.createElement('button');
  button.dataset.sideChatMove = 'fork-A';
  button.addEventListener('click', () => moves++);
  h.group.append(button);
  for (const label of ['Open as main chat', 'Return to floating window', 'Restore as main chat']) {
    button.setAttribute('aria-label', label);
    const item = h.items().find(item => item.id === 'move-chat')!;
    expect(item.label).toBe(label);
    expect(item.shortcut).toBeTruthy();
    item.onSelect();
  }
  expect(moves).toBe(3);
  const staleItem = h.items().find(item => item.id === 'move-chat')!;
  button.disabled = true;
  expect(h.items().find(item => item.id === 'move-chat')!.disabled).toBe(true);
  staleItem.onSelect();
  expect(moves).toBe(3);
  button.dataset.sideChatMove = 'fork-B';
  expect(h.items().some(item => item.id === 'move-chat')).toBe(false);
  h.dom.happyDOM.cancelAsync();
});
