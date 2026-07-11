import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';

import { loadAssistantState } from '../src/host/assistant-store';
import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { HubAssistantService } from '../src/hub/assistant';
import { withTempDroneDataDir } from './test-helpers';

describe('Blip assistant host', () => {
  test('migrates legacy Hub thread metadata into the canonical assistant store', async () => {
    await withTempDroneDataDir('blip-assistant-state-', async (dataDir) => {
      const legacyPath = path.join(dataDir, 'assistant.json');
      fs.writeFileSync(legacyPath, JSON.stringify({ threads: [{ id: 'legacy-thread' }] }));
      const service = new HubAssistantService({
        listDrones: async () => [],
      });
      const snapshot = await service.createThread({ title: 'SQLite thread' });
      expect(snapshot.threads.some((thread) => thread.id === 'legacy-thread')).toBe(true);

      const stored = await loadAssistantState();
      expect(stored?.threads.some((thread: any) => thread.title === 'SQLite thread')).toBe(true);
    });
  });

  test('reuses one Hub-backed Blip session for a thread', async () => {
    await withTempDroneDataDir('blip-assistant-host-', async () => {
      const faux = registerFauxProvider({
        api: 'faux',
        provider: 'faux',
        tokensPerSecond: 0,
      });
      faux.setResponses([fauxAssistantMessage('first'), fauxAssistantMessage('second')]);
      const events: any[] = [];
      const host = new BlipAssistantHost(async () => ({
        provider: 'faux',
        model: faux.getModel().id,
        thinkingLevel: 'off',
        systemPrompt: 'Hub host prompt',
        tools: [],
      }));
      const subscribedEvents: any[] = [];
      const unsubscribe = host.subscribeEvents('thread-one', (event) => subscribedEvents.push(event));

      await host.promptThread('thread-one', 'one', (event) => events.push(event));
      unsubscribe();
      await host.promptThread('thread-one', 'two', (event) => events.push(event));

      const repository = new HubSessionRepository();
      const sessionId = await repository.sessionIdForThread('thread-one');
      expect(sessionId).toBeTruthy();
      const session = await repository.load(sessionId!);
      expect(session.transcriptPath).toStartWith('sqlite:assistant-blip:');
      const messages = await repository.readMessages(session);
      expect(messages.filter((message) => message.role === 'user')).toHaveLength(2);
      expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(2);
      expect(events.filter((event) => event.type === 'session_started')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'session_finished')).toHaveLength(2);
      expect(subscribedEvents.filter((event) => event.type === 'session_finished')).toHaveLength(1);
      const latestPage = await host.historyPage('thread-one', { limit: 2 });
      expect(latestPage.entries).toHaveLength(2);
      expect(latestPage.page.hasOlder).toBe(true);
      const olderPage = await host.historyPage('thread-one', { limit: 2, before: latestPage.page.beforeCursor! });
      expect(olderPage.entries).toHaveLength(2);
      expect(olderPage.page.hasOlder).toBe(false);
      faux.unregister();
    });
  });

  test('serializes concurrent first prompts onto one thread session', async () => {
    await withTempDroneDataDir('blip-assistant-concurrent-', async () => {
      const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
      faux.setResponses([fauxAssistantMessage('first'), fauxAssistantMessage('second')]);
      const events: any[] = [];
      const host = new BlipAssistantHost(async () => ({
        provider: 'faux',
        model: faux.getModel().id,
        thinkingLevel: 'off',
        systemPrompt: 'Hub host prompt',
        tools: [],
      }));
      const unsubscribe = host.subscribeEvents('thread-concurrent', (event) => events.push(event));
      const unsubscribeBrokenSink = host.subscribeEvents('thread-concurrent', () => {
        throw new Error('stale stream');
      });

      await Promise.all([
        host.promptThread('thread-concurrent', 'one'),
        host.promptThread('thread-concurrent', 'two'),
      ]);

      const page = await host.historyPage('thread-concurrent', { limit: 10 });
      expect(page.entries.map((entry) => entry.message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect(events.filter((event) => event.type === 'session_started')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'session_finished')).toHaveLength(1);
      unsubscribe();
      unsubscribeBrokenSink();
      faux.unregister();
    });
  });
});
