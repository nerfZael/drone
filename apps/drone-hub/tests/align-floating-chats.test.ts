import { describe, expect, test } from 'bun:test';
import { alignFloatingChats } from '../src/droneHub/app/align-floating-chats';

type Frame = { style: Record<string, string>; parentElement: object };

function fakePanel(id: string, location: 'floating' | 'grid', frame: Frame | null) {
  const element = { closest: (selector: string) => (selector === '.dv-resize-container' ? frame : null) };
  return {
    id,
    group: { element, api: { location: { type: location }, isMaximized: () => false, exitMaximized() {} } },
    api: { setActive() { throw new Error('align must not touch the active panel'); } },
  };
}

describe('align floating chats', () => {
  test('moves each floating side chat frame in place without re-adding it or changing focus', () => {
    const frames = [{ style: {}, parentElement: {} }, { style: {}, parentElement: {} }] as Frame[];
    const added: unknown[] = [];
    const api = {
      width: 1200,
      height: 900,
      panels: [
        fakePanel('side-chat:one', 'floating', frames[0]!),
        fakePanel('side-chat:two', 'floating', frames[1]!),
        fakePanel('agent-chat', 'grid', null),
      ],
      activePanel: fakePanel('agent-chat', 'grid', null),
      addFloatingGroup: (...args: unknown[]) => { added.push(args); },
    };
    const bounds = alignFloatingChats(api as never);
    expect(Object.keys(bounds)).toEqual(['one', 'two']);
    expect(added).toEqual([]);
    expect(frames[0]!.style).toEqual({
      left: `${bounds.one!.x}px`, top: `${bounds.one!.y}px`, right: 'auto', bottom: 'auto',
      width: `${bounds.one!.width}px`, height: `${bounds.one!.height}px`,
    });
    expect(frames[1]!.style.top).toBe(`${bounds.two!.y}px`);
    expect(bounds.two!.y + bounds.two!.height).toBeLessThanOrEqual(bounds.one!.y);
  });
});
