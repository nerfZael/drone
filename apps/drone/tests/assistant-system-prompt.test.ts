import { describe, expect, test } from 'bun:test';

import { loadAssistantState } from '../src/host/assistant-store';
import { HubAssistantService } from '../src/hub/assistant';
import { ASSISTANT_TOOL_SUMMARIES } from '../src/hub/assistant/assistant-config';
import { ensureTestNativeChat } from './native-chat-test-helpers';
import { withTempDroneDataDir } from './test-helpers';

function makeAssistantService(): HubAssistantService {
  return new HubAssistantService({ listDrones: async () => [] });
}

describe('assistant system prompt settings', () => {
  test('explains that existing-drone scope does not block global drone creation', async () => {
    await withTempDroneDataDir('assistant-global-create-scope-', async () => {
      const service = makeAssistantService();
      const snapshot = await ensureTestNativeChat(service, { chatName: 'create scope' });
      await service.updateAccessScope({
        threadId: snapshot.chatId,
        readMode: 'all',
        writeMode: 'selected',
        droneIds: [],
      });
      const prompt = service.resolvedSystemPrompt(snapshot.chatId);
      expect(prompt).toContain('Current existing-drone access scope: read=all drones; write=selected drones (native-test-drone); execute=selected drones (native-test-drone).');
      expect(prompt).toContain('This scope does not restrict enabled global creation tools such as create_drone, clone_drone, or create_group.');
    });
  });

  test('advertises the complete grouped tool catalog without legacy aliases', () => {
    const names = ASSISTANT_TOOL_SUMMARIES.map((tool) => tool.name);
    for (const name of ['list_targets', 'set_target', 'get_working_tree_status', 'delete_file', 'create_directory', 'delete_directory', 'move_path']) expect(names).toContain(name);
    for (const name of ['assistant_files', 'find_files', 'list_changed_files', 'message_drone', 'read_chat_messages']) expect(names).not.toContain(name);
    expect(ASSISTANT_TOOL_SUMMARIES.find((tool) => tool.name === 'send_message')?.group).toEqual({ kind: 'mcp', id: 'drone-hub', label: 'Drone Hub' });
    expect(ASSISTANT_TOOL_SUMMARIES.find((tool) => tool.name === 'read_file')?.group).toBeUndefined();
  });

  test('exposes target selection only when a thread has multiple workspaces', async () => {
    await withTempDroneDataDir('assistant-target-tool-cardinality-', async () => {
      const artifactsOnly = makeAssistantService();
      const single = await ensureTestNativeChat(artifactsOnly, { chatName: 'artifacts only' });
      expect(single.availableTools.map((tool) => tool.name)).not.toContain('set_target');
      expect(single.availableTools.map((tool) => tool.name)).not.toContain('transfer_files');
      expect(artifactsOnly.resolvedSystemPrompt(single.chatId, { multipleWorkspaceTargets: false })).toContain('only workspace');

      const withDrone = new HubAssistantService({
        listDrones: async () => [{ id: 'drone-a', name: 'Drone A', group: null, status: 'ready' } as any],
      });
      const multiple = await ensureTestNativeChat(withDrone, {
        droneId: 'drone-a',
        chatName: 'multiple targets',
      });
      expect(multiple.availableTools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['list_targets', 'set_target', 'transfer_files']),
      );
    });
  });

  test('keeps snapshots available when target discovery fails', async () => {
    await withTempDroneDataDir('assistant-target-discovery-failure-', async () => {
      const service = new HubAssistantService({ listDrones: async () => { throw new Error('registry unavailable'); } });
      const snapshot = await ensureTestNativeChat(service, { chatName: 'fallback tools' });
      expect(snapshot.availableTools.map((tool) => tool.name)).not.toContain('set_target');
      expect(snapshot.availableTools.map((tool) => tool.name)).not.toContain('transfer_files');
    });
  });

  test('persists the assistant default in the canonical store and applies it to new threads', async () => {
    await withTempDroneDataDir('assistant-system-prompts-', async () => {
      const service = makeAssistantService();
      const settings = await service.updateSystemPrompt({ prompt: 'Assistant prompt.' });
      expect(settings.assistantSystemPrompt.prompt).toBe('Assistant prompt.');

      const snapshot = await ensureTestNativeChat(service, { chatName: 'thread' });
      const thread = snapshot.threads.find((item) => item.id === snapshot.chatId) as any;
      expect(thread.systemPrompt).toBe('Assistant prompt.');

      const stored = await loadAssistantState();
      expect(stored?.systemPrompt).toBe('Assistant prompt.');

      const reloaded = await makeAssistantService().systemPromptSettings();
      expect(reloaded.assistantSystemPrompt.prompt).toBe('Assistant prompt.');
    });
  });

  test('updates thread prompts independently and promotes them to the matching global default', async () => {
    await withTempDroneDataDir('assistant-thread-system-prompt-', async () => {
      const service = makeAssistantService();
      const initial = await ensureTestNativeChat(service, { chatName: 'first' });
      const firstThreadId = initial.chatId;
      const second = await ensureTestNativeChat(service, { chatName: 'second' });

      await service.updateThreadSystemPrompt(firstThreadId, { prompt: 'Thread-only prompt.' });
      let snapshot = await service.threadSnapshot(firstThreadId);
      expect((snapshot.threads.find((thread) => thread.id === firstThreadId) as any).systemPrompt).toBe('Thread-only prompt.');
      expect((await service.threadSnapshot(second.chatId)).threads[0]?.systemPrompt).not.toBe('Thread-only prompt.');

      await service.promoteThreadSystemPrompt(firstThreadId, { prompt: 'Promoted prompt.' });
      expect((await service.systemPromptSettings()).assistantSystemPrompt.prompt).toBe('Promoted prompt.');
      snapshot = await ensureTestNativeChat(service, { chatName: 'third' });
      expect(snapshot.threads[0]?.systemPrompt).toBe('Promoted prompt.');
    });
  });

  test('keeps tool enablement and thinking level as thread metadata for the Blip host', async () => {
    await withTempDroneDataDir('assistant-thread-agent-settings-', async () => {
      const service = makeAssistantService();
      const created = await ensureTestNativeChat(service, { chatName: 'settings', provider: 'openai', model: 'gpt-5.5' });
      const threadId = created.chatId;
      const updated = await service.updateThread(threadId, {
        enabledTools: ['get_system_prompt', 'set_thinking_level'],
        thinkingLevel: 'high',
      });
      const thread = updated.threads.find((item) => item.id === threadId) as any;
      expect(thread.enabledTools).toEqual(['get_system_prompt', 'set_thinking_level']);
      expect(thread.thinkingLevel).toBe('high');
      expect(updated.availableTools.some((tool) => tool.name === 'set_thinking_level')).toBe(true);
    });
  });

  test('migrates legacy artifact, changed-file, and MCP toggle aliases', async () => {
    await withTempDroneDataDir('assistant-legacy-tool-settings-', async () => {
      const service = makeAssistantService();
      const created = await ensureTestNativeChat(service, { chatName: 'legacy tools' });
      const updated = await service.updateThread(created.chatId, { enabledTools: ['assistant_files', 'list_changed_files', 'message_drone', 'read_chat_messages'] });
      const thread = updated.threads[0] as any;
      expect(thread.enabledTools).toEqual(['list_targets', 'set_target', 'get_working_tree_status', 'send_message', 'list_chats', 'read_chat']);
    });
  });

  test('persists the default model used by new threads', async () => {
    await withTempDroneDataDir('assistant-default-model-', async () => {
      const service = makeAssistantService();
      await service.updateDefaultModel({ provider: 'codex', model: 'gpt-5.5', thinkingLevel: 'high' });

      const reloaded = makeAssistantService();
      const snapshot = await ensureTestNativeChat(reloaded, { chatName: 'default model thread' });
      const thread = snapshot.threads[0] as any;
      expect(snapshot.defaultModel).toEqual({ provider: 'codex', model: 'gpt-5.5', thinkingLevel: 'high' });
      expect(thread.provider).toBe('codex');
      expect(thread.model).toBe('gpt-5.5');
      expect(thread.thinkingLevel).toBe('high');
    });
  });

  test('persists default tools without changing existing threads', async () => {
    await withTempDroneDataDir('assistant-default-tools-', async () => {
      const service = makeAssistantService();
      const existing = await ensureTestNativeChat(service, { chatName: 'existing' });
      const existingThread = existing.threads[0] as any;
      const defaults = ['list_drones', 'read_chat'];

      await service.updateDefaultEnabledTools({ enabledTools: defaults });
      const unchanged = await service.threadSnapshot(existing.chatId);
      expect(unchanged.threads[0]?.enabledTools).toEqual(existingThread.enabledTools);

      const reloaded = makeAssistantService();
      const created = await ensureTestNativeChat(reloaded, { chatName: 'new defaults' });
      const thread = created.threads[0] as any;
      expect(created.defaultEnabledTools).toEqual(defaults);
      expect(thread.enabledTools).toEqual(defaults);
    });
  });

});
