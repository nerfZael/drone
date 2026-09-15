import { expect, test } from 'bun:test';
import { CompanionRuntime } from '../src/hub/companion/companion-runtime';
import { DEFAULT_COMPANION_SETTINGS } from '../src/hub/companion/companion-config';
import { COMPANION_BROWSER_TOOL_NAMES } from '../../../packages/assistant-chat/src/companion';

test('show_on_screen forwards browser measurements and respects enabled tools', async () => {
  const delivered: unknown[] = [];
  const feedback = { displayed: false, error: 'CONTENT_DOES_NOT_FIT', constraints: { width: 300, height: 200 }, measured: { width: 300, height: 220 } };
  const context = {
    settings: DEFAULT_COMPANION_SETTINGS,
    snapshots: new Map(),
    callBrowser: async (...args: unknown[]) => { delivered.push(args); return feedback; },
  };
  const runtime = Object.create(CompanionRuntime.prototype);
  const tools = await runtime.customTools(context, []);
  const tool = tools.find((tool: any) => tool.name === 'show_on_screen');
  expect(COMPANION_BROWSER_TOOL_NAMES).toContain('show_on_screen');
  expect(tool).toBeDefined();
  const args = { action: 'show', markdown: '**Working**' };
  const signal = new AbortController().signal;
  const result = await tool.execute('screen-1', args, signal);
  expect(delivered).toEqual([['show_on_screen', args, signal]]);
  expect(result.details).toEqual(feedback);
  expect(JSON.parse(result.content[0].text)).toEqual(feedback);
  const disabled = await runtime.customTools({ ...context, settings: { ...DEFAULT_COMPANION_SETTINGS, enabledTools: [] } }, []);
  expect(disabled.some((tool: any) => tool.name === 'show_on_screen')).toBe(false);
});
