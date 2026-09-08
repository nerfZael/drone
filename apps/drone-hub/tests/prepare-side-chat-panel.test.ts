import { expect, test } from 'bun:test';
import type { IDockviewPanel } from 'dockview';
import { prepareSideChatPanel } from '../src/droneHub/app/prepareSideChatPanel';

test('selects content in an empty floating group without activating the workspace group', () => {
  const opened: unknown[] = [];
  const attributes = new Map<string, string>();
  const panel = {
    group: {
      activePanel: undefined,
      model: { openPanel: (...args: unknown[]) => opened.push(args) },
      element: {
        querySelector: () => ({
          setAttribute: (key: string, value: string) => attributes.set(key, value),
        }),
      },
    },
  } as unknown as IDockviewPanel;
  prepareSideChatPanel(panel);
  expect(opened).toEqual([[panel, { skipSetGroupActive: true }]]);
  expect(attributes.get('title')).toContain('Drag to move');
});

test('does not switch a restored group away from its selected tab', () => {
  const panel = {
    group: {
      activePanel: { id: 'another-tab' },
      model: {
        openPanel: () => {
          throw new Error('must not change the active tab');
        },
      },
      element: { querySelector: () => null },
    },
  } as unknown as IDockviewPanel;
  prepareSideChatPanel(panel);
});
