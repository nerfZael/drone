import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import {
  Type,
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from '@mariozechner/pi-ai';

import { loadAssistantState } from '../src/host/assistant-store';
import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { HubAssistantService } from '../src/hub/assistant';
import { toBlipModelProvider } from '../src/hub/hub-settings';
import { ensureTestNativeChat } from './native-chat-test-helpers';
import { withTempDroneDataDir } from './test-helpers';

describe('Blip assistant host', () => {
  test('Stop cancels every prompt waiting for initialization and permits a later prompt', async () => {
    await withTempDroneDataDir('blip-stop-startup-', async () => {
      const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
      faux.setResponses([fauxAssistantMessage('Only the new prompt runs')]);
      const started = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const host = new BlipAssistantHost(async () => {
        started.resolve();
        await resume.promise;
        return {
          provider: 'faux',
          model: faux.getModel().id,
          thinkingLevel: 'off',
          systemPrompt: 'Test',
          tools: [],
        };
      });
      try {
        const first = host.promptThread('stopped-thread', 'Must not run');
        const second = host.promptThread('stopped-thread', 'Must not run either');
        const settled = Promise.allSettled([first, second]);
        await started.promise;
        host.stopThread('stopped-thread');
        resume.resolve();
        expect((await settled).map((result) => result.status)).toEqual(['rejected', 'rejected']);
        expect((await host.historyPage('stopped-thread')).entries).toHaveLength(0);
        await host.promptThread('stopped-thread', 'New prompt');
        expect(
          (await host.historyPage('stopped-thread')).entries.map((entry) => entry.message.role),
        ).toEqual(['user', 'assistant']);
      } finally {
        resume.resolve();
        await host.close();
        faux.unregister();
      }
    });
  });

  test('maps user-facing provider names to Blip providers', () => {
    expect(toBlipModelProvider('openai')).toBe('openai');
    expect(toBlipModelProvider('codex')).toBe('openai-codex');
    expect(toBlipModelProvider('openai-codex')).toBe('openai-codex');
    expect(toBlipModelProvider('gemini')).toBe('google');
    expect(toBlipModelProvider('google')).toBe('google');
    expect(toBlipModelProvider('openrouter')).toBe('openrouter');
  });

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
      const unsubscribe = host.subscribeEvents('thread-one', (event) =>
        subscribedEvents.push(event),
      );

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
      const olderPage = await host.historyPage('thread-one', {
        limit: 2,
        before: latestPage.page.beforeCursor!,
      });
      expect(olderPage.entries).toHaveLength(2);
      expect(olderPage.page.hasOlder).toBe(false);
      faux.unregister();
    });
  });

  test('projects durable compactions and latest context usage into thread history', async () => {
    await withTempDroneDataDir('blip-assistant-context-history-', async () => {
      const repository = new HubSessionRepository();
      const session = await repository.create({
        provider: 'faux',
        model: 'faux-1',
        permissionMode: 'workspace-write',
        toolProfile: 'local-trusted-write',
      });
      await repository.bindThread('thread-context', session.id);
      await repository.appendMessage(session, {
        role: 'user',
        content: 'Continue',
        timestamp: Date.now(),
      });
      await repository.appendEntry(session, {
        type: 'compaction',
        id: 'compact-1',
        createdAt: '2026-07-27T10:00:00.000Z',
        trigger: 'auto',
        tokensBefore: 90_000,
        tokensAfterEstimate: 24_000,
        fallbackUsed: true,
        fallbackReason: 'Provider summary timed out',
        summary: 'Earlier work was summarized.',
        details: { readFiles: [], modifiedFiles: [] },
      });
      await repository.appendRuntimeEvent(session, {
        version: 1,
        eventId: 'finished-1',
        sessionId: session.id,
        timestamp: '2026-07-27T10:00:01.000Z',
        type: 'session_finished',
        status: 'completed',
        changedFiles: [],
        durationMs: 100,
        contextUsage: {
          tokens: 24_000,
          contextWindow: 128_000,
          // History derives this value from the durable token counts instead of trusting stale data.
          percent: 99,
          confidence: 'heuristic',
          breakdown: {
            systemPrompt: 1_000,
            messages: 20_000,
            toolDefinitions: 2_000,
            images: 0,
            providerOverhead: 1_000,
          },
        },
      });

      const page = await repository.readThreadHistoryPage('thread-context');
      expect(page.entries.map((entry) => entry.message.role)).toEqual(['user', 'compaction']);
      expect(page.entries[1]).toMatchObject({
        id: 'compact-1',
        message: {
          role: 'compaction',
          details: {
            summaryId: 'compact-1',
            trigger: 'auto',
            tokensBefore: 90_000,
            tokensAfter: 24_000,
            fallbackUsed: true,
          },
        },
      });
      expect(page.contextUsage).toMatchObject({
        tokens: 24_000,
        contextWindow: 128_000,
        percent: 18.75,
        confidence: 'heuristic',
      });

      await repository.appendEntry(session, {
        type: 'compaction',
        id: 'compact-2',
        createdAt: '2026-07-27T10:00:02.000Z',
        trigger: 'manual',
        tokensBefore: 72_000,
        tokensAfterEstimate: 12_000,
        summary: 'The interrupted run was summarized.',
        details: { readFiles: [], modifiedFiles: [] },
      });
      const recoveredPage = await repository.readThreadHistoryPage('thread-context');
      expect(recoveredPage.contextUsage).toMatchObject({
        tokens: 12_000,
        contextWindow: 128_000,
        percent: 9.375,
        confidence: 'heuristic',
      });
      repository.close();
    });
  });

  test('restores a durable approval from SQLite and resolves it after host restart', async () => {
    await withTempDroneDataDir('blip-assistant-durable-approval-', async () => {
      const faux = registerFauxProvider({
        api: 'faux',
        provider: 'faux',
        tokensPerSecond: 0,
      });
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall('mutate', { value: 'original' }, { id: 'call-host-durable' }),
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage('Approved mutation completed.'),
      ]);
      const executions: Array<{ callId: string; value: string }> = [];
      const lifecycle: Array<{ phase: 'before' | 'after'; kind: string; status?: string }> = [];
      const tool: AgentTool<any> = {
        name: 'mutate',
        label: 'Mutate',
        description: 'Test mutation',
        parameters: Type.Object({ value: Type.String() }),
        execute: async (callId, args) => {
          executions.push({ callId, value: args.value });
          return { content: [{ type: 'text', text: 'done' }], details: {} };
        },
      };
      const configuration = async () => ({
        provider: 'faux',
        model: faux.getModel().id,
        thinkingLevel: 'off' as const,
        systemPrompt: 'Hub host prompt',
        tools: [tool],
        beforePrompt: ({ kind }: any) => lifecycle.push({ phase: 'before', kind }),
        afterPrompt: ({ kind, status }: any) => lifecycle.push({ phase: 'after', kind, status }),
        permissionPreflight: ({ phase }: any) =>
          phase === 'resume'
            ? { status: 'allow' as const }
            : {
                status: 'suspend' as const,
                reason: 'Needs approval',
                details: { approval: { label: 'Mutate', args: { value: 'original' } } },
              },
      });
      const firstEvents: any[] = [];
      const firstHost = new BlipAssistantHost(configuration, (_threadId, event) => {
        firstEvents.push(event);
      });

      await firstHost.promptThread('thread-durable', 'Mutate');
      const suspended = firstEvents.find((event) => event.type === 'tool_call_suspended');
      expect(suspended).toBeTruthy();
      expect(executions).toEqual([]);
      expect(lifecycle).toContainEqual({
        phase: 'after',
        kind: 'prompt',
        status: 'suspended',
      });
      firstHost.invalidateAll();

      const restoredEvents: any[] = [];
      const restoredHost = new BlipAssistantHost(configuration, (_threadId, event) => {
        restoredEvents.push(event);
      });
      await restoredHost.restorePendingApprovals();

      expect(restoredEvents).toContainEqual(
        expect.objectContaining({
          type: 'tool_call_suspended',
          suspensionId: suspended.suspensionId,
        }),
      );
      await restoredHost.resolveToolSuspension('thread-durable', suspended.suspensionId, true);
      expect(executions).toEqual([{ callId: 'call-host-durable', value: 'original' }]);
      expect(lifecycle).toContainEqual({ phase: 'before', kind: 'tool_resolution' });
      expect(lifecycle).toContainEqual({
        phase: 'after',
        kind: 'tool_resolution',
        status: 'completed',
      });
      restoredHost.invalidateAll();
      faux.unregister();
    });
  });

  test('durably accepts an approval before waiting for a long tool to finish', async () => {
    await withTempDroneDataDir('blip-assistant-approval-accept-', async () => {
      const faux = registerFauxProvider({
        api: 'faux',
        provider: 'faux',
        tokensPerSecond: 0,
      });
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall('slow_mutation', {}, { id: 'call-slow' }), {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage('Slow mutation completed.'),
      ]);
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let completed = false;
      const events: any[] = [];
      const host = new BlipAssistantHost(
        async () => ({
          provider: 'faux',
          model: faux.getModel().id,
          thinkingLevel: 'off',
          systemPrompt: 'Hub host prompt',
          tools: [
            {
              name: 'slow_mutation',
              label: 'Slow mutation',
              description: 'Test mutation',
              parameters: Type.Object({}),
              execute: async () => {
                await released;
                completed = true;
                return { content: [{ type: 'text', text: 'done' }], details: {} };
              },
            },
          ],
          permissionPreflight: ({ phase }: any) =>
            phase === 'resume'
              ? { status: 'allow' as const }
              : { status: 'suspend' as const, reason: 'Needs approval' },
        }),
        (_threadId, event) => events.push(event),
      );
      await host.promptThread('thread-slow-approval', 'Mutate slowly');
      const suspensionId = events.find(
        (event) => event.type === 'tool_call_suspended',
      )!.suspensionId;

      await host.beginToolSuspensionResolution('thread-slow-approval', suspensionId, true);

      expect(completed).toBe(false);
      expect(host.isThreadRunning('thread-slow-approval')).toBe(true);
      release();
      await host.waitForThreadIdle('thread-slow-approval');
      expect(completed).toBe(true);
      host.invalidateAll();
      faux.unregister();
    });
  });

  test('persists a native run changed-files summary in history', async () => {
    await withTempDroneDataDir('blip-assistant-run-files-', async () => {
      const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
      faux.setResponses([fauxAssistantMessage('implemented')]);
      const host = new BlipAssistantHost(async () => ({
        provider: 'faux',
        model: faux.getModel().id,
        thinkingLevel: 'off',
        systemPrompt: 'Hub host prompt',
        tools: [],
        afterPrompt: async () => ({
          fileChanges: {
            version: 1,
            capturedAt: '2026-07-21T00:00:00.000Z',
            counts: { changed: 1, additions: 1, deletions: 0 },
            workspaces: [
              {
                targetId: 'drone:d1',
                droneId: 'd1',
                label: 'Drone 1',
                repoRoot: '/work/repo',
                counts: { changed: 1, additions: 1, deletions: 0 },
                entries: [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }],
              },
            ],
          },
        }),
      }));

      await host.promptThread('thread-run-files', 'implement it');
      const page = await host.historyPage('thread-run-files', { limit: 10 });

      expect(page.entries.map((entry) => entry.message.role)).toEqual([
        'user',
        'assistant',
        'runSummary',
      ]);
      expect(page.entries.at(-1)?.message.details).toMatchObject({
        fileChanges: { counts: { changed: 1, additions: 1, deletions: 0 } },
      });
      faux.unregister();
    });
  });

  test('projects approval segments as one active duration and one final file summary', async () => {
    await withTempDroneDataDir('blip-assistant-approval-summary-', async () => {
      const repository = new HubSessionRepository();
      const session = await repository.create({
        provider: 'faux',
        model: 'faux-1',
        permissionMode: 'workspace-write',
        toolProfile: 'local-trusted-write',
      });
      await repository.bindThread('thread-approval-summary', session.id);
      await repository.appendMessage(session, {
        role: 'user',
        content: 'Implement it',
        timestamp: 1_000,
      });
      await repository.appendMessage(session, {
        role: 'assistant',
        content: 'First segment',
        timestamp: 2_000,
      });
      await repository.appendRuntimeEvent(session, {
        version: 1,
        eventId: 'suspended-segment',
        sessionId: session.id,
        turnId: 'turn-1',
        timestamp: '2026-07-28T10:00:02.000Z',
        type: 'session_finished',
        status: 'suspended',
        changedFiles: [],
        durationMs: 1_200,
        fileChanges: {
          version: 2,
          capturedAt: '2026-07-28T10:00:02.000Z',
          counts: { changed: 1, additions: 1, deletions: 0 },
          workspaces: [
            {
              targetId: 'drone:d1',
              droneId: 'd1',
              label: 'Drone 1',
              counts: { changed: 1, additions: 1, deletions: 0 },
              previewEntries: [
                { path: 'src/partial.ts', status: 'added', additions: 1, deletions: 0 },
              ],
            },
          ],
        },
      });
      await repository.appendMessage(session, {
        role: 'assistant',
        content: 'Finished',
        timestamp: 100_000,
      });
      await repository.appendRuntimeEvent(session, {
        version: 1,
        eventId: 'completed-segment',
        sessionId: session.id,
        turnId: 'turn-2',
        timestamp: '2026-07-28T10:01:40.000Z',
        type: 'session_finished',
        status: 'completed',
        changedFiles: [],
        durationMs: 800,
        fileChanges: {
          version: 2,
          capturedAt: '2026-07-28T10:01:40.000Z',
          counts: { changed: 2, additions: 4, deletions: 1 },
          workspaces: [
            {
              targetId: 'drone:d1',
              droneId: 'd1',
              label: 'Drone 1',
              counts: { changed: 2, additions: 4, deletions: 1 },
              previewEntries: [
                { path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 },
                { path: 'src/b.ts', status: 'added', additions: 1, deletions: 0 },
              ],
            },
          ],
        },
      });

      const page = await repository.readThreadHistoryPage('thread-approval-summary');

      expect(page.entries.map((entry) => entry.message.role)).toEqual([
        'user',
        'assistant',
        'assistant',
        'runSummary',
      ]);
      expect(page.entries[1]?.message.details).toMatchObject({ runDurationMs: 1_200 });
      expect(page.entries[2]?.message.details).toMatchObject({ runDurationMs: 2_000 });
      expect(page.entries[3]?.message.details).toMatchObject({
        durationMs: 2_000,
        status: 'completed',
        fileChanges: { counts: { changed: 2, additions: 4, deletions: 1 } },
      });
      repository.close();
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
      expect(page.entries.map((entry) => entry.message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(events.filter((event) => event.type === 'session_started')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'session_finished')).toHaveLength(1);
      unsubscribe();
      unsubscribeBrokenSink();
      faux.unregister();
    });
  });

  test('steers an in-flight native prompt when the request is ASAP', async () => {
    await withTempDroneDataDir('blip-assistant-steer-', async () => {
      const faux = registerFauxProvider({
        api: 'faux',
        provider: 'faux',
        tokensPerSecond: 0,
      });
      let signalStarted = () => {};
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      let releaseFirst = () => {};
      const firstReleased = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const latestUserPrompts: string[] = [];
      faux.setResponses([
        async (context) => {
          latestUserPrompts.push(String((context.messages.at(-1) as any)?.content ?? ''));
          signalStarted();
          await firstReleased;
          return fauxAssistantMessage('initial response');
        },
        (context) => {
          latestUserPrompts.push(String((context.messages.at(-1) as any)?.content ?? ''));
          return fauxAssistantMessage('steered response');
        },
      ]);
      const host = new BlipAssistantHost(async () => ({
        provider: 'faux',
        model: faux.getModel().id,
        thinkingLevel: 'off',
        promptDeliveryMode: 'queue',
        systemPrompt: 'Hub host prompt',
        tools: [],
      }));

      const running = host.promptThread('thread-steer', 'initial prompt');
      await started;
      const steered = host.promptThread('thread-steer', 'urgent steering', undefined, 'asap');
      releaseFirst();
      await Promise.all([running, steered]);

      expect(latestUserPrompts).toEqual(['initial prompt', 'urgent steering']);
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

      await host.appendExternalMessage('thread-external', {
        role: 'user',
        content: 'external request',
        timestamp: Date.now(),
      });
      await host.appendExternalMessage('thread-external', {
        role: 'assistant',
        content: [{ type: 'text', text: 'external response' }],
        timestamp: Date.now(),
      });

      const page = await host.historyPage('thread-external', { limit: 10 });
      expect(page.entries.map((entry) => entry.message.role)).toEqual(['user', 'assistant']);
      expect(
        events.filter((event) => event.type === 'transcript_changed').map((event) => event.role),
      ).toEqual(['user', 'assistant']);
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

  test('does not orphan durable approvals when deleting tool-call history', async () => {
    await withTempDroneDataDir('blip-assistant-approval-delete-', async () => {
      const faux = registerFauxProvider({
        api: 'faux',
        provider: 'faux',
        tokensPerSecond: 0,
      });
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall('mutate', { value: 'original' }, { id: 'call-delete-approval' }),
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage('The mutation was denied.'),
        fauxAssistantMessage('Continued without restoring the deleted tool result.'),
      ]);
      const tool: AgentTool<any> = {
        name: 'mutate',
        label: 'Mutate',
        description: 'Test mutation',
        parameters: Type.Object({ value: Type.String() }),
        execute: async () => ({
          content: [{ type: 'text', text: 'done' }],
          details: {},
        }),
      };
      const events: any[] = [];
      const host = new BlipAssistantHost(
        async () => ({
          provider: 'faux',
          model: faux.getModel().id,
          thinkingLevel: 'off',
          systemPrompt: 'Hub host prompt',
          tools: [tool],
          permissionPreflight: ({ phase }: any) =>
            phase === 'resume'
              ? { status: 'allow' as const }
              : {
                  status: 'suspend' as const,
                  reason: 'Needs approval',
                  details: { approval: { label: 'Mutate', args: { value: 'original' } } },
                },
        }),
        (_threadId, event) => events.push(event),
      );

      await host.promptThread('thread-approval-delete', 'Mutate');
      const pendingPage = await host.historyPage('thread-approval-delete', { limit: 10 });
      const toolCallMessage = pendingPage.entries.find(
        (entry) =>
          entry.message.role === 'assistant' &&
          Array.isArray(entry.message.content) &&
          entry.message.content.some((part: any) => part?.type === 'toolCall'),
      );
      const suspensionId = events.find(
        (event) => event.type === 'tool_call_suspended',
      )?.suspensionId;

      await expect(
        host.deleteMessage('thread-approval-delete', toolCallMessage!.id, false),
      ).rejects.toThrow('Resolve pending tool approvals');

      await host.resolveToolSuspension('thread-approval-delete', suspensionId, false);
      await host.deleteMessage('thread-approval-delete', toolCallMessage!.id, false);

      const repository = new HubSessionRepository();
      const sessionId = await repository.sessionIdForThread('thread-approval-delete');
      const session = await repository.load(sessionId!);
      expect(await repository.readToolSuspensions(session)).toEqual([]);
      expect(
        (await repository.readMessages(session)).filter((message) => message.role === 'toolResult'),
      ).toEqual([]);

      await host.promptThread('thread-approval-delete', 'Continue');
      expect(
        (await repository.readMessages(session)).filter((message) => message.role === 'toolResult'),
      ).toEqual([]);
      faux.unregister();
    });
  });
});
