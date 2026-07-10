import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';

import { loadAssistantState } from '../src/host/assistant-store';
import { HubAssistantService } from '../src/hub/assistant';
import { withTempDroneDataDir } from './test-helpers';

const Type = {
  Object: (value: unknown) => value,
  String: (value?: unknown) => value,
  Optional: (value: unknown) => value,
  Number: (value?: unknown) => value,
  Boolean: (value?: unknown) => value,
  Array: (value: unknown) => value,
};

function makeAssistantService(): HubAssistantService {
  return new HubAssistantService({
    listDrones: async () => [],
    createDrone: async () => ({
      id: 'drone-a',
      name: 'Drone A',
      runtime: 'container',
      phase: 'starting',
      request: {},
    }),
    createChat: async () => ({
      droneId: 'drone-a',
      droneName: 'Drone A',
      chatName: 'new-chat',
      chats: ['default', 'new-chat'],
    }),
    setDroneGroup: async () => ({ group: null, moved: [], rejected: [], total: 0 }),
    messageDrone: async () => ({ promptId: 'prompt-a' }),
  });
}

describe('assistant system prompt settings', () => {
  test('persists the editable default to assistant state and snapshots it onto new threads', async () => {
    await withTempDroneDataDir('assistant-system-prompt-', async (droneDataDir) => {
      const service = makeAssistantService();
      const initial = await service.snapshot();
      const initialThread = initial.threads[0] as any;

      const settings = await service.updateSystemPrompt({ prompt: 'Custom DroneHub assistant prompt.' });
      expect(settings.assistantSystemPrompt.prompt).toBe('Custom DroneHub assistant prompt.');
      expect(settings.assistantSystemPrompt.promptSource).toBe('settings');

      const next = await service.createThread({});
      const newThread = next.threads.find((thread) => thread.id === next.activeThreadId) as any;
      const oldThread = next.threads.find((thread) => thread.id === initialThread.id) as any;
      expect(newThread.systemPrompt).toBe('Custom DroneHub assistant prompt.');
      expect(oldThread.systemPrompt).toBe(initialThread.systemPrompt);

      const assistantState = await loadAssistantState();
      expect(assistantState?.systemPrompt).toBe('Custom DroneHub assistant prompt.');
    });
  });

  test('keeps normal and voice default prompts independently configurable', async () => {
    await withTempDroneDataDir('assistant-voice-system-prompt-', async (droneDataDir) => {
      const service = makeAssistantService();

      const settings = await service.updateSystemPrompt({ prompt: 'Normal assistant prompt.' });
      expect(settings.assistantSystemPrompt.prompt).toBe('Normal assistant prompt.');
      expect(settings.assistantVoiceSystemPrompt.prompt).toBe(settings.assistantVoiceSystemPrompt.defaultPrompt);

      let assistantState = await loadAssistantState();
      expect(assistantState?.systemPrompt).toBe('Normal assistant prompt.');
      expect(assistantState?.voiceSystemPrompt).toBe(settings.assistantVoiceSystemPrompt.defaultPrompt);

      const reloadedService = makeAssistantService();
      const reloadedSettings = await reloadedService.systemPromptSettings();
      expect(reloadedSettings.assistantSystemPrompt.prompt).toBe('Normal assistant prompt.');
      expect(reloadedSettings.assistantVoiceSystemPrompt.prompt).toBe(settings.assistantVoiceSystemPrompt.defaultPrompt);

      const voiceSettings = await reloadedService.updateSystemPrompt({ promptType: 'voice', prompt: 'Voice assistant prompt.' });
      expect(voiceSettings.assistantSystemPrompt.prompt).toBe('Normal assistant prompt.');
      expect(voiceSettings.assistantVoiceSystemPrompt.prompt).toBe('Voice assistant prompt.');

      let snapshot = await reloadedService.createThread({ title: 'normal' });
      const normalThread = snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) as any;
      expect(normalThread.voiceEnabled).toBe(false);
      expect(normalThread.systemPrompt).toBe('Normal assistant prompt.');

      const voiceThread = await reloadedService.ensureLatestVoiceThread({ title: 'voice' });
      expect(voiceThread.thread.voiceEnabled).toBe(true);
      expect(voiceThread.thread.systemPrompt).toBe('Voice assistant prompt.');

      assistantState = await loadAssistantState();
      expect(assistantState?.systemPrompt).toBe('Normal assistant prompt.');
      expect(assistantState?.voiceSystemPrompt).toBe('Voice assistant prompt.');

      await reloadedService.updateThreadSystemPrompt(voiceThread.threadId, { prompt: 'Voice thread prompt.' });
      await reloadedService.promoteThreadSystemPrompt(voiceThread.threadId);
      const promotedSettings = await reloadedService.systemPromptSettings();
      expect(promotedSettings.assistantSystemPrompt.prompt).toBe('Normal assistant prompt.');
      expect(promotedSettings.assistantVoiceSystemPrompt.prompt).toBe('Voice thread prompt.');

      snapshot = await reloadedService.createThread({ title: 'another normal' });
      const anotherNormalThread = snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) as any;
      expect(anotherNormalThread.systemPrompt).toBe('Normal assistant prompt.');
    });
  });

  test('migrates old single global prompt into the voice prompt default', async () => {
    await withTempDroneDataDir('assistant-legacy-system-prompt-', async (droneDataDir) => {
      await fs.writeFile(
        path.join(droneDataDir, 'assistant.json'),
        JSON.stringify(
          {
            systemPrompt: 'Legacy shared prompt.',
            systemPromptUpdatedAt: '2026-01-02T03:04:05.000Z',
          },
          null,
          2,
        ),
        'utf8',
      );

      const service = makeAssistantService();
      const settings = await service.systemPromptSettings();
      expect(settings.assistantSystemPrompt.prompt).toBe('Legacy shared prompt.');
      expect(settings.assistantVoiceSystemPrompt.prompt).toBe('Legacy shared prompt.');

      const voiceThread = await service.ensureLatestVoiceThread({ title: 'voice' });
      expect(voiceThread.thread.systemPrompt).toBe('Legacy shared prompt.');
    });
  });

  test('migrates legacy chat idle prompt text and custom legacy tool enablement', async () => {
    await withTempDroneDataDir('assistant-chat-idle-tool-migration-', async (droneDataDir) => {
      const oldLine =
        'When you send a drone chat message and need the result later, call subscribe_to_chats_idle on the target chat. This returns immediately so you can continue other work. If there is nothing else to do, end your turn; the system will resume this thread when the subscribed chats become idle.';
      await fs.writeFile(
        path.join(droneDataDir, 'assistant.json'),
        JSON.stringify(
          {
            activeThreadId: 'thread-old',
            threads: [
              {
                id: 'thread-old',
                title: 'old thread',
                createdAt: '2026-01-02T03:04:05.000Z',
                updatedAt: '2026-01-02T03:04:05.000Z',
                provider: 'openai',
                model: 'gpt-5.5',
                systemPrompt: `Custom preface.\n${oldLine}`,
                enabledTools: ['subscribe_to_chats_idle'],
                messages: [],
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );

      const service = makeAssistantService();
      const snapshot = await service.snapshot();
      const thread = snapshot.threads.find((item) => item.id === 'thread-old') as any;

      expect(thread.systemPrompt).toContain('subscribe_to_any_chat_idle');
      expect(thread.systemPrompt).toContain('subscribe_to_all_chats_idle');
      expect(thread.systemPrompt).not.toContain('subscribe_to_chats_idle on the target chat');
      expect(thread.enabledTools).toEqual(['subscribe_to_all_chats_idle']);
    });
  });

  test('migrates prior default tool lists to include current assistant UI tools', async () => {
    await withTempDroneDataDir('assistant-current-default-tool-migration-', async (droneDataDir) => {
      const currentDefaultTools = ((await makeAssistantService().snapshot()).threads[0] as any).enabledTools as string[];
      const newlyDefaultedTools = ['open_drone_chat', 'highlight_drones', 'create_group', 'set_drone_groups', 'reorder_drones'];
      const priorDefaultTools = currentDefaultTools.filter((name) => !newlyDefaultedTools.includes(name));

      await fs.writeFile(
        path.join(droneDataDir, 'assistant.json'),
        JSON.stringify(
          {
            activeThreadId: 'thread-old-default',
            threads: [
              {
                id: 'thread-old-default',
                title: 'old default tools',
                createdAt: '2026-01-02T03:04:05.000Z',
                updatedAt: '2026-01-02T03:04:05.000Z',
                provider: 'openai',
                model: 'gpt-5.5',
                enabledTools: priorDefaultTools,
                messages: [],
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );

      const snapshot = await makeAssistantService().snapshot();
      const thread = snapshot.threads.find((item) => item.id === 'thread-old-default') as any;
      for (const tool of newlyDefaultedTools) {
        expect(thread.enabledTools).toContain(tool);
      }
    });
  });

  test('updates thread prompts independently and can promote one to the global prompt', async () => {
    await withTempDroneDataDir('assistant-thread-system-prompt-', async () => {
      const service = makeAssistantService();
      const initial = await service.snapshot();
      const firstThreadId = initial.activeThreadId;
      const secondSnapshot = await service.createThread({ title: 'second' });
      const secondThreadId = secondSnapshot.activeThreadId;

      await service.updateThreadSystemPrompt(firstThreadId, { prompt: 'Thread-only prompt.' });
      let snapshot = await service.snapshot();
      expect((snapshot.threads.find((thread) => thread.id === firstThreadId) as any).systemPrompt).toBe('Thread-only prompt.');
      expect((snapshot.threads.find((thread) => thread.id === secondThreadId) as any).systemPrompt).not.toBe('Thread-only prompt.');

      await service.promoteThreadSystemPrompt(firstThreadId);
      const settings = await service.systemPromptSettings();
      expect(settings.assistantSystemPrompt.prompt).toBe('Thread-only prompt.');

      await service.promoteThreadSystemPrompt(firstThreadId, { prompt: 'Draft prompt promoted.' });
      const draftPromotedSettings = await service.systemPromptSettings();
      expect(draftPromotedSettings.assistantSystemPrompt.prompt).toBe('Draft prompt promoted.');

      snapshot = await service.createThread({ title: 'third' });
      const thirdThread = snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) as any;
      expect(thirdThread.systemPrompt).toBe('Draft prompt promoted.');
    });
  });

  test('exposes prompt tools and respects per-thread tool toggles', async () => {
    await withTempDroneDataDir('assistant-system-prompt-tools-', async () => {
      const service = makeAssistantService();
      const snapshot = await service.createThread({ title: 'tools' });
      const threadId = snapshot.activeThreadId;
      let tools = (service as any).buildTools({ Type }, threadId);
      expect(snapshot.availableTools.some((tool) => tool.name === 'get_system_prompt')).toBe(true);
      expect(snapshot.availableTools.some((tool) => tool.name === 'update_system_prompt')).toBe(true);
      expect(tools.some((tool: any) => tool.name === 'get_system_prompt')).toBe(false);
      expect(tools.some((tool: any) => tool.name === 'update_system_prompt')).toBe(false);

      await service.updateThread(threadId, { enabledTools: ['get_system_prompt', 'update_system_prompt'] });
      tools = (service as any).buildTools({ Type }, threadId);
      const updatePrompt = tools.find((tool: any) => tool.name === 'update_system_prompt');
      await updatePrompt.execute('call-a', { prompt: 'Updated by tool.' });
      let next = await service.snapshot();
      expect((next.threads.find((thread) => thread.id === threadId) as any).systemPrompt).toBe('Updated by tool.');

      await updatePrompt.execute('call-b', { patches: [{ oldText: 'Updated', newText: 'Patched' }] });
      next = await service.snapshot();
      expect((next.threads.find((thread) => thread.id === threadId) as any).systemPrompt).toBe('Patched by tool.');

      await service.updateThread(threadId, { enabledTools: ['get_system_prompt'] });
      tools = (service as any).buildTools({ Type }, threadId);
      expect(tools.map((tool: any) => tool.name)).toEqual(['get_system_prompt']);
    });
  });

  test('set thinking level tool is opt-in for normal threads and updates the current model level', async () => {
    await withTempDroneDataDir('assistant-thinking-level-tool-', async () => {
      const service = makeAssistantService();
      const snapshot = await service.createThread({ title: 'thinking', provider: 'openai', model: 'gpt-5.5' });
      const threadId = snapshot.activeThreadId;
      let tools = (service as any).buildTools({ Type }, threadId);
      expect(snapshot.availableTools.some((tool) => tool.name === 'set_thinking_level')).toBe(true);
      expect(tools.some((tool: any) => tool.name === 'set_thinking_level')).toBe(false);

      await service.updateThread(threadId, { enabledTools: ['set_thinking_level'] });
      tools = (service as any).buildTools({ Type }, threadId);
      const setThinkingLevel = tools.find((tool: any) => tool.name === 'set_thinking_level');
      const result = await setThinkingLevel.execute('call-thinking', { level: 'high' });
      expect(result.details.thinkingLevel).toBe('high');

      const next = await service.snapshot();
      const thread = next.threads.find((item) => item.id === threadId) as any;
      expect(thread.model).toBe('gpt-5.5');
      expect(thread.thinkingLevel).toBe('high');

      await expect(setThinkingLevel.execute('call-thinking-bad', { level: 'xhigh' })).rejects.toThrow(/not supported/);
      await expect(setThinkingLevel.execute('call-thinking-typo', { level: 'medum' })).rejects.toThrow(/invalid thinking level/);
    });
  });
});
