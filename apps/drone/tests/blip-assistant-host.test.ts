import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';

import { loadAssistantState } from '../src/host/assistant-store';
import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { HubAssistantService } from '../src/hub/assistant';
import { ensureTestNativeChat } from './native-chat-test-helpers';
import { withTempDroneDataDir } from './test-helpers';

describe('Blip assistant host', () => {
  test('discards legacy standalone metadata and stores native chat metadata', async () => {
    await withTempDroneDataDir('blip-assistant-state-', async (dataDir) => {
      const legacyPath = path.join(dataDir, 'assistant.json');
      fs.writeFileSync(legacyPath, JSON.stringify({ threads: [{ id: 'legacy-thread' }] }));
      const service = new HubAssistantService({
        listDrones: async () => [],
      });
      const snapshot = await ensureTestNativeChat(service, {
        id: 'native-chat',
        droneId: 'drone-a',
        chatName: 'SQLite chat',
      });
      expect(snapshot.threads.map((thread) => thread.id)).toEqual(['native-chat']);

      const stored = await loadAssistantState();
      expect(stored?.threads.some((thread: any) => thread.title === 'SQLite chat')).toBe(true);
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
      expect(events.filter((event) => event.type === 'assistant_delta')).toHaveLength(0);
      expect(subscribedEvents.filter((event) => event.type === 'session_finished')).toHaveLength(1);
      expect(subscribedEvents.filter((event) => event.type === 'assistant_delta')).toHaveLength(0);
      expect(
        (await repository.readTranscript(session)).filter(
          (entry) => entry.type === 'runtime_event' && entry.event.type === 'assistant_delta',
        ),
      ).toHaveLength(0);
      const latestPage = await host.historyPage('thread-one', { limit: 2 });
      expect(latestPage.entries).toHaveLength(2);
      expect(latestPage.page.hasOlder).toBe(true);
      const latestTimestamps = await host.latestMessageTimestamps([
        'thread-one',
        'thread-one',
        'missing-thread',
      ]);
      expect(latestTimestamps.get('thread-one')).toBe(latestPage.entries[1]!.timestamp);
      expect(latestTimestamps.has('missing-thread')).toBe(false);
      await expect(host.message('thread-one', latestPage.entries[0]!.id)).resolves.toEqual(
        latestPage.entries[0],
      );
      const olderPage = await host.historyPage('thread-one', { limit: 2, before: latestPage.page.beforeCursor! });
      expect(olderPage.entries).toHaveLength(2);
      expect(olderPage.page.hasOlder).toBe(false);
      faux.unregister();
    });
  });

  test('forks a completed thread transcript into an independent thread', async () => {
    await withTempDroneDataDir('blip-assistant-clone-', async () => {
      const faux = registerFauxProvider({
        api: 'faux',
        provider: 'faux',
        tokensPerSecond: 0,
      });
      faux.setResponses([fauxAssistantMessage('source response')]);
      const host = new BlipAssistantHost(async () => ({
        provider: 'faux',
        model: faux.getModel().id,
        thinkingLevel: 'off',
        systemPrompt: 'Hub host prompt',
        tools: [],
      }));

      await host.promptThread('source-thread', 'source prompt');
      await host.cloneThread('source-thread', 'cloned-thread');

      const source = await host.historyPage('source-thread', { limit: 10 });
      const cloned = await host.historyPage('cloned-thread', { limit: 10 });
      expect(cloned.entries.map((entry) => entry.message)).toEqual(
        source.entries.map((entry) => entry.message),
      );
      const repository = new HubSessionRepository();
      const sourceSessionId = await repository.sessionIdForThread('source-thread');
      const clonedSessionId = await repository.sessionIdForThread('cloned-thread');
      expect(clonedSessionId).not.toBe(sourceSessionId);
      expect((await repository.load(clonedSessionId!)).parentSessionId).toBe(sourceSessionId);
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

  test('persists externally produced messages and publishes transcript changes', async () => {
    await withTempDroneDataDir('blip-assistant-external-message-', async () => {
      const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
      const host = new BlipAssistantHost(async () => ({
        provider: 'faux',
        model: faux.getModel().id,
        thinkingLevel: 'off',
        systemPrompt: 'Hub host prompt',
        tools: [],
      }));
      const events: any[] = [];
      const unsubscribe = host.subscribeEvents('thread-external', (event) => events.push(event));

      await host.appendExternalMessage('thread-external', { role: 'user', content: 'external request', timestamp: Date.now() });
      await host.appendExternalMessage('thread-external', {
        role: 'assistant',
        content: [{ type: 'text', text: 'external response' }],
        timestamp: Date.now(),
      });

      const page = await host.historyPage('thread-external', { limit: 10 });
      expect(page.entries.map((entry) => entry.message.role)).toEqual(['user', 'assistant']);
      expect(events.filter((event) => event.type === 'transcript_changed').map((event) => event.role)).toEqual(['user', 'assistant']);
      unsubscribe();
      faux.unregister();
    });
  });

  test('deletes one canonical message or the selected message and its suffix', async () => {
    await withTempDroneDataDir('blip-assistant-message-delete-', async () => {
      const faux = registerFauxProvider({
        api: 'faux',
        provider: 'faux',
        tokensPerSecond: 0,
      });
      faux.setResponses([fauxAssistantMessage('first'), fauxAssistantMessage('second')]);
      const host = new BlipAssistantHost(async () => ({
        provider: 'faux',
        model: faux.getModel().id,
        thinkingLevel: 'off',
        systemPrompt: 'Hub host prompt',
        tools: [],
      }));

      await host.promptThread('thread-delete', 'one');
      await host.promptThread('thread-delete', 'two');
      const original = await host.historyPage('thread-delete', { limit: 10 });
      expect(original.entries.map((entry) => entry.message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);

      await host.deleteMessage('thread-delete', original.entries[1]!.id, false);
      const afterSingle = await host.historyPage('thread-delete', { limit: 10 });
      expect(afterSingle.entries.map((entry) => entry.message.role)).toEqual([
        'user',
        'user',
        'assistant',
      ]);

      await host.deleteMessage('thread-delete', afterSingle.entries[1]!.id, true);
      const afterSuffix = await host.historyPage('thread-delete', { limit: 10 });
      expect(afterSuffix.entries.map((entry) => entry.message.role)).toEqual(['user']);
      faux.unregister();
    });
  });
});
