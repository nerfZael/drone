import { describe, expect, test } from 'bun:test';

import { loadAssistantState } from '../src/host/assistant-store';
import { HubAssistantService } from '../src/hub/assistant';
import { ASSISTANT_TOOL_SUMMARIES } from '../src/hub/assistant/assistant-config';
import { withTempDroneDataDir } from './test-helpers';

function makeAssistantService(): HubAssistantService {
  return new HubAssistantService({ listDrones: async () => [] });
}

describe('assistant system prompt settings', () => {
  test('explains that existing-drone scope does not block global drone creation', async () => {
    await withTempDroneDataDir('assistant-global-create-scope-', async () => {
      const service = makeAssistantService();
      const snapshot = await service.createThread({ title: 'create scope' });
      await service.updateAccessScope({
        threadId: snapshot.activeThreadId,
        readMode: 'all',
        writeMode: 'selected',
        droneIds: [],
      });
      const prompt = service.resolvedSystemPrompt(snapshot.activeThreadId);
      expect(prompt).toContain('Current existing-drone access scope: read=all drones; write=no selected drones.');
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
      const single = await artifactsOnly.createThread({ title: 'artifacts only' });
      expect(single.availableTools.map((tool) => tool.name)).not.toContain('set_target');
      expect(single.availableTools.map((tool) => tool.name)).not.toContain('transfer_files');
      expect(artifactsOnly.resolvedSystemPrompt(single.activeThreadId, { multipleWorkspaceTargets: false })).toContain('only workspace');

      const withDrone = new HubAssistantService({
        listDrones: async () => [{ id: 'drone-a', name: 'Drone A', group: null, status: 'ready' } as any],
      });
      const multiple = await withDrone.createThread({ title: 'multiple targets' });
      expect(multiple.availableTools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['list_targets', 'set_target', 'transfer_files']),
      );
    });
  });

  test('keeps snapshots available when target discovery fails', async () => {
    await withTempDroneDataDir('assistant-target-discovery-failure-', async () => {
      const service = new HubAssistantService({ listDrones: async () => { throw new Error('registry unavailable'); } });
      const snapshot = await service.createThread({ title: 'fallback tools' });
      expect(snapshot.availableTools.map((tool) => tool.name)).not.toContain('set_target');
      expect(snapshot.availableTools.map((tool) => tool.name)).not.toContain('transfer_files');
    });
  });

  test('persists normal and voice defaults in the canonical assistant store and applies them to new threads', async () => {
    await withTempDroneDataDir('assistant-system-prompts-', async () => {
      const service = makeAssistantService();
      await service.updateSystemPrompt({ prompt: 'Normal assistant prompt.' });
      const settings = await service.updateSystemPrompt({ promptType: 'voice', prompt: 'Voice assistant prompt.' });
      expect(settings.assistantSystemPrompt.prompt).toBe('Normal assistant prompt.');
      expect(settings.assistantVoiceSystemPrompt.prompt).toBe('Voice assistant prompt.');

      const normalSnapshot = await service.createThread({ title: 'normal' });
      const normalThread = normalSnapshot.threads.find((thread) => thread.id === normalSnapshot.activeThreadId) as any;
      expect(normalThread.systemPrompt).toBe('Normal assistant prompt.');
      const voice = await service.ensureLatestVoiceThread({ title: 'voice' });
      expect(voice.thread.systemPrompt).toBe('Voice assistant prompt.');

      const stored = await loadAssistantState();
      expect(stored?.systemPrompt).toBe('Normal assistant prompt.');
      expect(stored?.voiceSystemPrompt).toBe('Voice assistant prompt.');

      const reloaded = await makeAssistantService().systemPromptSettings();
      expect(reloaded.assistantSystemPrompt.prompt).toBe('Normal assistant prompt.');
      expect(reloaded.assistantVoiceSystemPrompt.prompt).toBe('Voice assistant prompt.');
    });
  });

  test('updates thread prompts independently and promotes them to the matching global default', async () => {
    await withTempDroneDataDir('assistant-thread-system-prompt-', async () => {
      const service = makeAssistantService();
      const initial = await service.snapshot();
      const firstThreadId = initial.activeThreadId;
      const second = await service.createThread({ title: 'second' });

      await service.updateThreadSystemPrompt(firstThreadId, { prompt: 'Thread-only prompt.' });
      let snapshot = await service.snapshot();
      expect((snapshot.threads.find((thread) => thread.id === firstThreadId) as any).systemPrompt).toBe('Thread-only prompt.');
      expect((snapshot.threads.find((thread) => thread.id === second.activeThreadId) as any).systemPrompt).not.toBe('Thread-only prompt.');

      await service.promoteThreadSystemPrompt(firstThreadId, { prompt: 'Promoted prompt.' });
      expect((await service.systemPromptSettings()).assistantSystemPrompt.prompt).toBe('Promoted prompt.');
      snapshot = await service.createThread({ title: 'third' });
      expect((snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) as any).systemPrompt).toBe('Promoted prompt.');
    });
  });

  test('keeps tool enablement and thinking level as thread metadata for the Blip host', async () => {
    await withTempDroneDataDir('assistant-thread-agent-settings-', async () => {
      const service = makeAssistantService();
      const created = await service.createThread({ title: 'settings', provider: 'openai', model: 'gpt-5.5' });
      const threadId = created.activeThreadId;
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
      const created = await service.createThread({ title: 'legacy tools' });
      const updated = await service.updateThread(created.activeThreadId, { enabledTools: ['assistant_files', 'list_changed_files', 'message_drone', 'read_chat_messages'] });
      const thread = updated.threads.find((item) => item.id === created.activeThreadId) as any;
      expect(thread.enabledTools).toEqual(['list_targets', 'set_target', 'get_working_tree_status', 'send_message', 'list_chats', 'read_chat']);
    });
  });

  test('persists the default model used by new threads', async () => {
    await withTempDroneDataDir('assistant-default-model-', async () => {
      const service = makeAssistantService();
      await service.updateDefaultModel({ provider: 'codex', model: 'gpt-5.5', thinkingLevel: 'high' });

      const reloaded = makeAssistantService();
      const snapshot = await reloaded.createThread({ title: 'default model thread' });
      const thread = snapshot.threads.find((item) => item.id === snapshot.activeThreadId) as any;
      expect(snapshot.defaultModel).toEqual({ provider: 'codex', model: 'gpt-5.5', thinkingLevel: 'high' });
      expect(thread.provider).toBe('codex');
      expect(thread.model).toBe('gpt-5.5');
      expect(thread.thinkingLevel).toBe('high');
    });
  });

  test('persists default tools without changing existing threads', async () => {
    await withTempDroneDataDir('assistant-default-tools-', async () => {
      const service = makeAssistantService();
      const existing = await service.createThread({ title: 'existing' });
      const existingThread = existing.threads.find((item) => item.id === existing.activeThreadId) as any;
      const defaults = ['list_drones', 'read_chat'];

      await service.updateDefaultEnabledTools({ enabledTools: defaults });
      const unchanged = await service.threadSnapshot(existing.activeThreadId);
      expect((unchanged.threads.find((item) => item.id === existing.activeThreadId) as any).enabledTools).toEqual(existingThread.enabledTools);

      const reloaded = makeAssistantService();
      const created = await reloaded.createThread({ title: 'new defaults' });
      const thread = created.threads.find((item) => item.id === created.activeThreadId) as any;
      expect(created.defaultEnabledTools).toEqual(defaults);
      expect(thread.enabledTools).toEqual(defaults);
    });
  });

  test('persists and manages queued assistant prompts', async () => {
    await withTempDroneDataDir('assistant-queued-prompts-', async () => {
      const service = makeAssistantService();
      const created = await service.createThread({ title: 'queue' });
      const queued = await service.enqueueThreadPrompt(created.activeThreadId, {
        prompt: 'Follow up after the current turn',
        promptImages: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
      });
      expect(queued).toMatchObject({ status: 'queued', prompt: 'Follow up after the current turn', imageCount: 1 });
      expect(queued.promptImages[0]?.data).toBe('');

      const reloaded = makeAssistantService();
      const claimed = await reloaded.claimNextQueuedPrompt(created.activeThreadId);
      expect(claimed?.promptImages[0]?.data).toBe('aW1hZ2U=');
      await reloaded.completeQueuedPrompt(created.activeThreadId, claimed!.id);
      expect((await reloaded.threadSnapshot(created.activeThreadId)).threads.find((thread) => thread.id === created.activeThreadId)?.queuedPrompts).toEqual([]);

      const failed = await reloaded.enqueueThreadPrompt(created.activeThreadId, { prompt: 'This one fails' });
      await reloaded.claimNextQueuedPrompt(created.activeThreadId);
      await reloaded.failQueuedPrompt(created.activeThreadId, failed.id, new Error('provider unavailable'));
      const failedSnapshot = await reloaded.threadSnapshot(created.activeThreadId);
      expect(failedSnapshot.threads.find((thread) => thread.id === created.activeThreadId)?.queuedPrompts[0]).toMatchObject({
        id: failed.id,
        status: 'failed',
        error: 'provider unavailable',
      });
      await reloaded.cancelQueuedPrompt(created.activeThreadId, failed.id);
      expect(await reloaded.hasQueuedPrompts(created.activeThreadId)).toBe(false);
      for (let index = 0; index < 32; index += 1) {
        await reloaded.enqueueThreadPrompt(created.activeThreadId, { prompt: `Queued ${index + 1}` });
      }
      await expect(reloaded.enqueueThreadPrompt(created.activeThreadId, { prompt: 'Too many' })).rejects.toThrow('queue is full');
    });
  });
});
