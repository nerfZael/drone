import { describe, expect, test } from 'bun:test';

import { loadAssistantState } from '../src/host/assistant-store';
import { HubAssistantService } from '../src/hub/assistant';
import { withTempDroneDataDir } from './test-helpers';

function makeAssistantService(): HubAssistantService {
  return new HubAssistantService({ listDrones: async () => [] });
}

describe('assistant system prompt settings', () => {
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

  test('persists the default model used by new threads', async () => {
    await withTempDroneDataDir('assistant-default-model-', async () => {
      const service = makeAssistantService();
      await service.updateDefaultModel({ provider: 'codex', model: 'gpt-5.5' });

      const reloaded = makeAssistantService();
      const snapshot = await reloaded.createThread({ title: 'default model thread' });
      const thread = snapshot.threads.find((item) => item.id === snapshot.activeThreadId) as any;
      expect(snapshot.defaultModel).toEqual({ provider: 'codex', model: 'gpt-5.5' });
      expect(thread.provider).toBe('codex');
      expect(thread.model).toBe('gpt-5.5');
    });
  });
});
