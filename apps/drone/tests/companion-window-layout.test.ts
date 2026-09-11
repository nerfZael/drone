import { expect, test } from 'bun:test';
import { CompanionRuntime } from '../src/hub/companion/companion-runtime';
import { DEFAULT_COMPANION_SETTINGS, normalizeCompanionSettings } from '../src/hub/companion/companion-config';
import { executeCompanionBrowserTool, type CompanionBrowserWorkspace } from '@drone/assistant-chat';

test('layout tools are separate immediate browser calls and unavailable in mobile sessions', async () => {
  const calls: string[] = [];
  const context = { settings: DEFAULT_COMPANION_SETTINGS, windowLayoutTools: true, callBrowser: async (name: string) => { calls.push(name); return { ok: true }; } };
  const runtime = Object.create(CompanionRuntime.prototype);
  const tools = await runtime.customTools(context, []);
  for (const name of ['get_chat_window_layout', 'arrange_chat_windows', 'get_workspace_window_layout', 'arrange_workspace_windows']) {
    const tool = tools.find((t: any) => t.name === name);
    expect(tool).toBeDefined();
    await tool.execute('call', {}, undefined);
  }
  expect(calls).toEqual(['get_chat_window_layout', 'arrange_chat_windows', 'get_workspace_window_layout', 'arrange_workspace_windows']);
  const mobile = await runtime.customTools({ ...context, windowLayoutTools: false }, []);
  expect(mobile.some((t: any) => ['get_chat_window_layout', 'arrange_chat_windows', 'get_workspace_window_layout', 'arrange_workspace_windows'].includes(t.name))).toBe(false);
});

test('browser executor dispatches layout without reading app context or a proposal', async () => {
  const calls: string[] = [];
  const workspace = { getAppContext: () => { throw new Error('unexpected context read'); }, getChatWindowLayout: () => { calls.push('read'); return { supported: true }; }, arrangeChatWindows: (args: unknown) => { calls.push('arrange'); return args; } } as unknown as CompanionBrowserWorkspace;
  expect(await executeCompanionBrowserTool(workspace, 'get_chat_window_layout', {})).toEqual({ supported: true });
  expect(await executeCompanionBrowserTool(workspace, 'arrange_chat_windows', { mode: 'tile' })).toEqual({ mode: 'tile' });
  expect(calls).toEqual(['read', 'arrange']);
  expect(await executeCompanionBrowserTool({} as CompanionBrowserWorkspace, 'get_chat_window_layout', {})).toEqual({ supported: false });
  await expect(executeCompanionBrowserTool({} as CompanionBrowserWorkspace, 'arrange_chat_windows', {})).rejects.toThrow('UNSUPPORTED');
});

test('v7 migrates navigation profiles and respects explicit tool disablement', () => {
  const previous = normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, schemaVersion: 6, enabledTools: ['open_drone_chat'] });
  expect(previous.enabledTools).toContain('get_chat_window_layout');
  expect(previous.enabledTools).toContain('arrange_chat_windows');
  expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, enabledTools: [] }).enabledTools).toEqual([]);
  expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, enabledTools: ['arrange_chat_windows'] }).enabledTools).toContain('get_chat_window_layout');
});


test('workspace layout routes independently without file access or proposal execution', async () => {
  const workspace = {
    getAppContext: () => { throw new Error('unexpected context read'); },
    getWorkspaceWindowLayout: () => ({ supported: true, panels: [{ panelId: 'file-tab:one', filePath: 'src/one.ts' }] }),
    arrangeWorkspaceWindows: (args: unknown) => args,
  } as unknown as CompanionBrowserWorkspace;
  expect(await executeCompanionBrowserTool(workspace, 'get_workspace_window_layout', {})).toMatchObject({ supported: true });
  expect(await executeCompanionBrowserTool(workspace, 'arrange_workspace_windows', { mode: 'columns' })).toEqual({ mode: 'columns' });
  expect(await executeCompanionBrowserTool({} as CompanionBrowserWorkspace, 'get_workspace_window_layout', {})).toEqual({ supported: false });
  await expect(executeCompanionBrowserTool({} as CompanionBrowserWorkspace, 'arrange_workspace_windows', {})).rejects.toThrow('UNSUPPORTED');
});

test('v8 enables workspace layout for previous window arrangers and preserves explicit choices', () => {
  expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, schemaVersion: 7, enabledTools: ['arrange_chat_windows'] }).enabledTools).toContain('arrange_workspace_windows');
  expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, schemaVersion: 8, enabledTools: ['arrange_chat_windows'] }).enabledTools).not.toContain('arrange_workspace_windows');
  expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, enabledTools: ['arrange_workspace_windows'] }).enabledTools).toContain('get_workspace_window_layout');
});
