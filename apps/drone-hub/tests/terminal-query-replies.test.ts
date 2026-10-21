import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Terminal as XTerm } from '@xterm/xterm';
import { leaveQueryRepliesToTmux } from '../src/droneHub/terminal/terminal-query-replies';

// Colour reports come from xterm's theme service, which exists only once the
// terminal is opened in a document.
const dom = new Window({ url: 'http://localhost' });
const originals = new Map<string, PropertyDescriptor | undefined>();
let Terminal: typeof XTerm;
beforeAll(async () => {
  for (const [key, value] of Object.entries({
    window: dom,
    self: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    matchMedia: dom.matchMedia.bind(dom),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  ({ Terminal } = await import('@xterm/xterm'));
});
afterAll(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as any)[key];
  }
  dom.close();
});

async function replies(output: string, filtered: boolean) {
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const terminal = new Terminal({ theme: { background: '#11111b' } });
  if (filtered) leaveQueryRepliesToTmux(terminal);
  terminal.open(host as unknown as HTMLElement);
  const sent: string[] = [];
  terminal.onData((data) => sent.push(data));
  await new Promise<void>((resolve) => terminal.write(output, resolve));
  terminal.dispose();
  host.remove();
  return sent.join('');
}

// Each of these is answered by tmux 3.4 itself for a control-mode client.
const answeredByTmux = [
  '\x1b[c',
  '\x1b[0c',
  '\x1b[>c',
  '\x1b[5n',
  '\x1b[6n',
  '\x1b]10;?\x07',
  '\x1b]11;?\x1b\\',
];

test('an unfiltered view answers the queries tmux also answers', async () => {
  for (const query of answeredByTmux) expect(await replies(query, false)).not.toBe('');
  expect(await replies('\x1b]11;?\x1b\\', false)).toBe('\x1b]11;rgb:1111/1111/1b1b\x1b\\');
});

test('the view leaves the queries tmux answers to tmux', async () => {
  for (const query of answeredByTmux) expect(await replies(query, true)).toBe('');
});

test('the view still answers the queries tmux leaves unanswered', async () => {
  expect(await replies('\x1b[?6n', true)).toBe('\x1b[?1;1R');
  expect(await replies('\x1b[?2004$p', true)).toBe('\x1b[?2004;2$y');
  expect(await replies('\x1b]12;?\x07', true)).not.toBe('');
});

test('colours a program sets still reach the view', async () => {
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const terminal = new Terminal({ theme: { background: '#11111b' } });
  leaveQueryRepliesToTmux(terminal);
  terminal.open(host as unknown as HTMLElement);
  await new Promise<void>((resolve) => terminal.write('\x1b]11;#102030\x07', resolve));
  expect((terminal as any)._core._themeService.colors.background.css).toBe('#102030');
  terminal.dispose();
  host.remove();
});
