import { expect, test } from 'bun:test';
import { CompanionRuntime } from '../src/hub/companion/companion-runtime';
import { DEFAULT_COMPANION_SETTINGS, normalizeCompanionSettings } from '../src/hub/companion/companion-config';
import { executeCompanionBrowserTool, type CompanionBrowserWorkspace } from '@drone/assistant-chat';

test('layout tools are separate immediate browser calls and unavailable in mobile sessions', async () => {
  const calls: string[] = [];
  const context = { settings: DEFAULT_COMPANION_SETTINGS, windowLayoutTools: true, callBrowser: async (name: string) => { calls.push(name); return { ok: true }; } };
  const runtime = Object.create(CompanionRuntime.prototype);
  const tools = await runtime.customTools(context, []);
  for (const name of ['get_chat_window_layout', 'arrange_chat_windows', 'get_workspace_window_layout', 'arrange_workspace_windows', 'open_workspace_files', 'set_editor_file_presentation']) {
    const tool = tools.find((t: any) => t.name === name);
    expect(tool).toBeDefined();
    await tool.execute('call', {}, undefined);
  }
  expect(calls).toEqual(['get_chat_window_layout', 'arrange_chat_windows', 'get_workspace_window_layout', 'arrange_workspace_windows', 'open_workspace_files', 'set_editor_file_presentation']);
  const mobile = await runtime.customTools({ ...context, windowLayoutTools: false }, []);
  expect(mobile.some((t: any) => ['get_chat_window_layout', 'arrange_chat_windows', 'get_workspace_window_layout', 'arrange_workspace_windows', 'open_workspace_files', 'set_editor_file_presentation'].includes(t.name))).toBe(false);
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


test('editor tools route without proposals and have no native mobile fallback', async () => {
  const workspace = {
    openWorkspaceFiles: (args: unknown) => args,
    setEditorFilePresentation: (args: unknown) => args,
  } as unknown as CompanionBrowserWorkspace;
  const open = { droneId: 'a', paths: ['src/a.ts'], presentation: 'panes' };
  expect(await executeCompanionBrowserTool(workspace, 'open_workspace_files', open)).toEqual(open);
  const present = { droneId: 'a', tabIds: ['file:a'], presentation: 'tabs' };
  expect(await executeCompanionBrowserTool(workspace, 'set_editor_file_presentation', present)).toEqual(present);
  await expect(executeCompanionBrowserTool({} as CompanionBrowserWorkspace, 'open_workspace_files', open)).rejects.toThrow('UNSUPPORTED');
  await expect(executeCompanionBrowserTool({} as CompanionBrowserWorkspace, 'set_editor_file_presentation', present)).rejects.toThrow('UNSUPPORTED');
});

test('v9 enables file presentation for existing workspace arrangers but respects explicit choices', () => {
  const migrated = normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, schemaVersion: 8, enabledTools: ['arrange_workspace_windows'] });
  expect(migrated.enabledTools).toContain('open_workspace_files');
  expect(migrated.enabledTools).toContain('set_editor_file_presentation');
  const explicit = normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, schemaVersion: 9, enabledTools: ['arrange_workspace_windows'] });
  expect(explicit.enabledTools).not.toContain('open_workspace_files');
  expect(explicit.enabledTools).not.toContain('set_editor_file_presentation');
  expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, enabledTools: ['set_editor_file_presentation'] }).enabledTools).toContain('get_workspace_window_layout');
});
