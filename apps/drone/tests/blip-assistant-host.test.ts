import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';

import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { HubAssistantService } from '../src/hub/assistant';
import { HubAssistantStateStore } from '../src/hub/assistant/hub-assistant-state-store';
import { withTempDroneDataDir } from './test-helpers';

describe('Blip assistant host', () => {
  test('stores Hub thread metadata in SQLite and removes the legacy assistant file', async () => {
    await withTempDroneDataDir('blip-assistant-state-', async (dataDir) => {
      const legacyPath = path.join(dataDir, 'assistant.json');
      fs.writeFileSync(legacyPath, JSON.stringify({ threads: [{ id: 'legacy-thread' }] }));
      const service = new HubAssistantService({
        listDrones: async () => [],
      });
      const snapshot = await service.createThread({ title: 'SQLite thread' });
      expect(snapshot.threads.some((thread) => thread.id === 'legacy-thread')).toBe(false);
      expect(fs.existsSync(legacyPath)).toBe(false);

      const store = new HubAssistantStateStore(path.join(dataDir, 'assistant-blip.sqlite'));
      const stored = store.read<any>();
      expect(stored?.threads.some((thread: any) => thread.title === 'SQLite thread')).toBe(true);
      store.close();
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

      await host.promptThread('thread-one', 'one', (event) => events.push(event));
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
      const projected = await host.projectSnapshot('thread-one', {
        threads: [{ id: 'thread-one', messages: [], status: 'idle', error: null }],
      });
      expect(projected.threads[0].messages).toHaveLength(4);
      expect(projected.threads[0]).toMatchObject({ status: 'idle', error: null, messageCount: 4 });
      faux.unregister();
    });
  });
});
