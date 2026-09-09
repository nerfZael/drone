import { describe, expect, test } from 'bun:test';
import { ActiveComposerRegistry } from '../src/droneHub/chat/ActiveComposerContext';
import { routeComposerFocus } from '../src/droneHub/chat/composer-focus-routing';
import { toggleFocusedSideChatMain } from '../src/droneHub/app/side-chat-main-shortcut';

// Minimal DOM tree for the selectors used by focus routing. The important
// distinction is that Dockview's focused container PARENTS the side chat root.
class FocusNode {
  children: FocusNode[] = [];
  parent: FocusNode | null = null;
  ownerDocument!: FocusNode;
  disabled = false;
  visible = true;
  click = () => {};
  getClientRects() { return this.visible ? [{}] : []; }
  constructor(private attrs: Record<string, string> = {}) {}
  get dataset() {
    return Object.fromEntries(Object.entries(this.attrs).filter(([key]) => key.startsWith('data-')).map(
      ([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value],
    ));
  }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  removeAttribute(key: string) { delete this.attrs[key]; }
  append(attrs: Record<string, string> = {}) {
    const child = new FocusNode(attrs);
    child.parent = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }
  matches(selector: string): boolean {
    if (selector.startsWith('.')) return (this.attrs.class ?? '').split(' ').includes(selector.slice(1));
    const attributeValue = selector.match(/^\[([^=]+)="([^"]*)"\]$/);
    if (attributeValue) return this.attrs[attributeValue[1]!] === attributeValue[2];
    return selector.startsWith('[') && selector.slice(1, -1) in this.attrs;
  }
  closest(selector: string): FocusNode | null {
    return this.matches(selector) ? this : this.parent?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): FocusNode[] {
    const parts = selector.split(' ');
    const matches = (node: FocusNode): boolean => {
      if (!node.matches(parts[parts.length - 1]!)) return false;
      return parts.length === 1 || Boolean(node.parent?.closest(parts[0]!));
    };
    const descendants = (node: FocusNode): FocusNode[] => node.children.flatMap((child) => [child, ...descendants(child)]);
    return descendants(this).filter(matches);
  }
  querySelector(selector: string): FocusNode | null { return this.querySelectorAll(selector)[0] ?? null; }
}

function fixture(ids = ['side-a', 'side-b']) {
  const doc = new FocusNode();
  doc.ownerDocument = doc;
  const registry = new ActiveComposerRegistry();
  const actions: string[] = [];
  let recordingId: string | null = null;
  let editorTarget = '';
  function register(id: string, side = false) {
    const action = (name: string) => () => {
      if (name === 'q') recordingId = id;
      if (name === 'e') recordingId = null;
      actions.push(`${id}:${name}`);
      return true;
    };
    return registry.register({
      id,
      requiresExplicitFocus: side,
      isEligible: () => true,
      appendTranscript() {},
      toggleVoiceRecording: action('q'),
      voiceRecordingStatus: () => recordingId === id ? 'recording' : 'idle',
      toggleVoiceRecordingPause: action('w'),
      discardVoiceRecording: action('e'),
      sendMessage: action('s'),
    });
  }
  register('main');
  const main = doc.append({ 'data-main-workspace-chat': 'true' });
  main.append({ 'data-active-composer-id': 'main', 'data-editor-mode-target-id': 'main-editor' });
  function side(id: string) {
    register(id, true);
    const group = doc.append({ class: 'dv-groupview' });
    const header = group.append();
    const tab = header.append({ 'data-side-chat-name': id });
    const handle = header.append({ class: 'dv-void-container' });
    const container = group.append({ class: 'dv-content-container' });
    const root = container.append({ 'data-side-chat-name': id });
    const transcript = root.append();
    const composer = root.append({ 'data-active-composer-id': id, 'data-editor-mode-target-id': `${id}-editor` });
    const input = composer.append();
    const control = composer.append();
    return { group, tab, handle, container, root, transcript, composer, input, control };
  }
  const first = side(ids[0]!);
  const second = side(ids[1]!);
  const outside = doc.append();
  return {
    doc, registry, actions, main, first, second, outside, register,
    focus(node: FocusNode) { routeComposerFocus(node as unknown as Element, registry, (id) => { editorTarget = id; }); },
    editorTarget: () => editorTarget,
    shortcuts() {
      registry.toggleVoiceRecording();
      registry.toggleVoiceRecordingPause();
      registry.discardVoiceRecording();
      registry.sendMessage();
    },
  };
}

describe('floating chat shortcut focus', () => {
  test('quick action focus preserves the selected floating chat and composer', () => {
    const h = fixture();
    h.focus(h.first.tab);
    const menu = h.doc.append({ 'data-quick-action-menu': 'true' });
    h.focus(menu.append());
    h.shortcuts();
    expect(h.actions).toEqual(['side-a:q', 'side-a:w', 'side-a:e', 'side-a:s']);
    expect(h.first.tab.dataset.sideChatActive).toBe('true');
  });
  test('waits for the selected window to load instead of sending to the previous chat', () => {
    const h = fixture();
    h.focus(h.second.tab);
    h.first.composer.removeAttribute('data-active-composer-id');
    h.focus(h.first.tab);
    h.shortcuts();
    expect(h.actions).toEqual([]);
    h.first.composer.setAttribute('data-active-composer-id', 'loaded-side');
    h.register('loaded-side', true);
    h.shortcuts();
    expect(h.actions).toEqual(['loaded-side:q', 'loaded-side:w', 'loaded-side:e', 'loaded-side:s']);
  });

  test('returns to the main chat when the selected window is closed or hidden', () => {
    const h = fixture();
    h.focus(h.first.root);
    h.first.root.setAttribute('aria-hidden', 'true');
    h.shortcuts();
    expect(h.actions).toEqual(['main:q', 'main:w', 'main:e', 'main:s']);
    h.first.root.removeAttribute('aria-hidden');
    h.focus(h.first.root);
    h.first.container.children = [];
    h.actions.length = 0;
    h.shortcuts();
    expect(h.actions).toEqual(['main:q', 'main:w', 'main:e', 'main:s']);
  });

  test('clicking main content in a shared dock group does not select a side chat', () => {
    const h = fixture();
    const main = h.first.container.append({ 'data-main-workspace-chat': 'true' });
    main.append({ 'data-active-composer-id': 'main' });
    h.focus(h.first.root);
    h.focus(main.append());
    h.shortcuts();
    expect(h.actions).toEqual(['main:q', 'main:w', 'main:e', 'main:s']);
  });

  test('uses the main chat when no chat has been selected', () => {
    const h = fixture();
    h.shortcuts();
    expect(h.actions).toEqual(['main:q', 'main:w', 'main:e', 'main:s']);
  });

  test('Dockview focusing its container does not undo a click in a side transcript', () => {
    const h = fixture();
    h.focus(h.first.transcript); // pointerdown
    h.focus(h.first.container); // subsequent focusin from Dockview
    h.shortcuts();
    expect(h.actions).toEqual(['side-a:q', 'side-a:w', 'side-a:e', 'side-a:s']);
    expect(h.first.root.dataset.sideChatActive).toBe('true');
    expect(h.editorTarget()).toBe('side-a-editor');
  });

  test.each(['tab', 'handle', 'input', 'control', 'container'] as const)(
    'selects the side chat through its %s',
    (target) => {
      const h = fixture();
      h.focus(h.first[target]);
      h.shortcuts();
      expect(h.actions).toEqual(['side-a:q', 'side-a:w', 'side-a:e', 'side-a:s']);
    },
  );

  test('switches between side chats and falls back after clicking outside', () => {
    const h = fixture();
    h.focus(h.first.input);
    h.focus(h.second.tab);
    h.focus(h.second.container);
    h.shortcuts();
    expect(h.actions).toEqual(['side-b:q', 'side-b:w', 'side-b:e', 'side-b:s']);
    expect(h.first.root.dataset.sideChatActive).toBeUndefined();
    h.focus(h.outside);
    h.actions.length = 0;
    h.shortcuts();
    expect(h.actions).toEqual(['main:q', 'main:w', 'main:e', 'main:s']);
    expect(h.editorTarget()).toBe('main-editor');
  });

  test('clicking the main chat restores it as the shortcut target', () => {
    const h = fixture();
    h.focus(h.first.input);
    h.focus(h.main);
    h.shortcuts();
    expect(h.actions).toEqual(['main:q', 'main:w', 'main:e', 'main:s']);
  });
});

test('D promotes the focused fork from its tab and returns a promoted main through the same toolbar action', () => {
  const h = fixture();
  const moved: string[] = [];
  const first = h.first.root.append({ 'data-side-chat-move': 'side-a' });
  first.click = () => { moved.push('promote-a'); };
  const second = h.second.root.append({ 'data-side-chat-move': 'side-b' });
  second.click = () => { moved.push('promote-b'); };
  h.focus(h.first.tab);
  expect(toggleFocusedSideChatMain(h.doc as unknown as Document)).toBe(true);
  h.focus(h.second.transcript);
  expect(toggleFocusedSideChatMain(h.doc as unknown as Document)).toBe(true);
  const main = h.main.append({ 'data-side-chat-move': 'side-a' });
  main.click = () => { moved.push('return-a'); };
  h.focus(h.main);
  expect(toggleFocusedSideChatMain(h.doc as unknown as Document)).toBe(true);
  expect(moved).toEqual(['promote-a', 'promote-b', 'return-a']);
});

test('D ignores ordinary, busy, hidden, and detached chats without moving a different main fork', () => {
  const h = fixture();
  const doc = h.doc as unknown as Document;
  expect(toggleFocusedSideChatMain(doc)).toBe(false);
  const main = h.main.append({ 'data-side-chat-move': 'promoted' });
  main.click = () => { throw new Error('Must not move the main chat'); };
  h.focus(h.first.tab); // A detached-style scope has no promotion control.
  expect(toggleFocusedSideChatMain(doc)).toBe(false);
  const button = h.first.root.append({ 'data-side-chat-move': 'side-a' });
  button.disabled = true;
  expect(toggleFocusedSideChatMain(doc)).toBe(false);
  button.disabled = false;
  button.visible = false;
  expect(toggleFocusedSideChatMain(doc)).toBe(false);
});

test('detached chats with the same name route shortcuts by drone and chat identity', () => {
  const first = JSON.stringify(['a', 'default']);
  const second = JSON.stringify(['b', 'default']);
  const h = fixture([first, second]);
  h.focus(h.first.tab);
  h.shortcuts();
  h.focus(h.second.container);
  h.shortcuts();
  expect(h.actions).toEqual([`${first}:q`, `${first}:w`, `${first}:e`, `${first}:s`, `${second}:q`, `${second}:w`, `${second}:e`, `${second}:s`]);
});
