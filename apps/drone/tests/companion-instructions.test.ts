import { expect, test } from 'bun:test';
import { createBlipSession } from '@blip/core';
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai';
import { COMPANION_INSTRUCTIONS_MAX_CHARS, COMPANION_INSTRUCTIONS_SKILL } from '@drone/assistant-chat';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { getHubSettingsRepository, resetHubSettingsRepositoryForTests } from '../src/host/hub-settings-repository';
import { readCompanionInstructions, writeCompanionInstructions, patchCompanionInstructions } from '../src/hub/companion/companion-instructions';
import { CompanionSkills } from '../src/hub/companion/companion-skills';
import { withTempDroneDataDir } from './test-helpers';
import { HubRouter } from '../src/hub/hub-router';
import { registerCompanionRoutes } from '../src/hub/companion/companion-routes';

const patch = (before: string, after: string) =>
  `*** Begin Patch\n*** Update File: companion-instructions.md\n@@\n${before ? `-${before}\n` : ''}+${after}\n*** End Patch`;

test('desktop instructions API returns versions and reports conflicting saves as HTTP 409', async () => {
  await withTempDroneDataDir('companion-instructions-api-', async () => {
    let body: unknown;
    let response: { status: number; body: any } | undefined;
    const router = new HubRouter((_res, status, value) => { response = { status, body: value }; }, async () => body);
    registerCompanionRoutes(router);
    const request = async (method: string, value?: unknown) => {
      body = value;
      response = undefined;
      await router.handle({ method } as any, {} as any, new URL('http://hub.test/api/companion/instructions'));
      return response!;
    };
    expect((await request('GET')).body.instructions).toEqual({ content: '', revision: 0 });
    expect((await request('PUT', { content: 'User instructions', revision: 0 })).status).toBe(200);
    expect((await request('PUT', { content: 'Stale edit', revision: 0 })).status).toBe(409);
    expect((await request('PUT', { content: 3, revision: 1 })).status).toBe(400);
    expect((await request('GET')).body.instructions).toEqual({ content: 'User instructions', revision: 1 });
  });
});

test('instructions start empty, persist exact text independently, and can be cleared', async () => {
  await withTempDroneDataDir('companion-instructions-', async () => {
    expect(await readCompanionInstructions()).toEqual({ content: '', revision: 0 });
    const saved = await writeCompanionInstructions('  Read before editing.\n', 0);
    expect(saved).toEqual({ content: '  Read before editing.\n', revision: 1 });
    await (await getHubSettingsRepository()).put('companion', { systemPrompt: 'Other settings' });
    resetHubSettingsRepositoryForTests();
    expect(await readCompanionInstructions()).toEqual(saved);
    expect(await writeCompanionInstructions('', 1)).toEqual({ content: '', revision: 2 });
    await expect(writeCompanionInstructions('x'.repeat(COMPANION_INSTRUCTIONS_MAX_CHARS + 1), 2)).rejects.toThrow('cannot exceed');
    await expect(writeCompanionInstructions(null, 2)).rejects.toThrow('must be text');
    await expect(writeCompanionInstructions('x', -1)).rejects.toThrow('revision');
  });
});

test('competing editor and agent saves reject stale revisions without losing the winning edit', async () => {
  await withTempDroneDataDir('companion-instructions-race-', async () => {
    const snapshot = await writeCompanionInstructions('original', 0);
    const results = await Promise.allSettled([
      writeCompanionInstructions('user edit', snapshot.revision),
      patchCompanionInstructions(snapshot, patch('original', 'agent edit')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.code).toBe('STALE_INSTRUCTIONS');
    const current = await readCompanionInstructions();
    expect(current.revision).toBe(2);
    await expect(writeCompanionInstructions('stale editor', 1)).rejects.toThrow('Read the latest');
    expect(await readCompanionInstructions()).toEqual(current);
  });
});

test('instructions patches enforce the target, support empty text, and honor cancellation', async () => {
  await withTempDroneDataDir('companion-instructions-patch-', async () => {
    const empty = await readCompanionInstructions();
    await expect(patchCompanionInstructions(empty, patch('', 'hello').replace('companion-instructions.md', 'other.md'))).rejects.toThrow('path');
    await expect(patchCompanionInstructions(empty, '*** Begin Patch\n*** Delete File: companion-instructions.md\n*** End Patch')).rejects.toThrow('Update File');
    await expect(patchCompanionInstructions(empty, patch('', 'cancelled'), () => { throw new Error('cancelled'); })).rejects.toThrow('cancelled');
    expect(await readCompanionInstructions()).toEqual(empty);
    expect((await patchCompanionInstructions(empty, patch('', 'Read first.'))).content.trim()).toBe('Read first.');
    await writeCompanionInstructions('one\r\ntwo\r\n', 1);
    const crlf = await patchCompanionInstructions(await readCompanionInstructions(), patch('two', 'three'));
    expect(crlf.content).toBe('one\r\nthree\r\n');
  });
});

test('cancelling a queued instructions write prevents it from committing when the queue drains', async () => {
  await withTempDroneDataDir('companion-instructions-queued-cancel-', async () => {
    const repository = await getHubSettingsRepository();
    // Hold the real Bun persistence queue behind an unfinished preceding write.
    const backend = (repository as any).compatibility;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    backend.queue = gate;
    const controller = new AbortController();
    let checks = 0;
    const writing = writeCompanionInstructions('must not be saved', 0, () => {
      checks++;
      controller.signal.throwIfAborted();
    });
    const outcome = writing.then(() => 'committed', () => 'cancelled');
    try {
      await Promise.resolve();
      expect(backend.queue).not.toBe(gate);
      expect(checks).toBe(0);
      controller.abort();
      release();
      expect(await outcome).toBe('cancelled');
      expect(checks).toBe(1);
      expect(await readCompanionInstructions()).toEqual({ content: '', revision: 0 });
      expect(await writeCompanionInstructions('later valid write', 0)).toEqual({ content: 'later valid write', revision: 1 });
    } finally { release(); await writing.catch(() => {}); }
  });
});

test('session restoration keeps a newer patch when a parallel older read was persisted last', async () => {
  await withTempDroneDataDir('companion-instructions-order-', async () => {
    const repository = new HubSessionRepository({ inMemory: true });
    const faux = registerFauxProvider({ api: 'faux-companion-order', provider: 'faux-companion-order', tokensPerSecond: 0 });
    const state = await repository.create({ provider: faux.getModel().provider, model: faux.getModel().id,
      permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write' });
    const context = { session: state, repository, model: faux.getModel(), workspaceRoot: 'drone-hub',
      permissionMode: 'workspace-write' as const, toolProfile: 'no-shell-workspace-write' as const };
    try {
      const skills = new CompanionSkills(() => {});
      const [read, apply] = skills.load(context);
      const older = await read!.execute('old-read', { name: COMPANION_INSTRUCTIONS_SKILL });
      const newer = await apply!.execute('patch', { baseRevision: 0, patch: patch('', 'Newer instructions') });
      for (const [toolName, toolCallId, result] of [
        ['apply_instructions_patch', 'patch', newer], ['read_skill', 'old-read', older],
      ] as const) {
        await repository.appendMessage(state, { role: 'toolResult', toolName, toolCallId, ...result, isError: false, timestamp: Date.now() });
      }
      const restored = new CompanionSkills(() => {});
      restored.load(context);
      expect(await restored.promptContext({ ...context, prompt: { role: 'user', content: 'Continue', timestamp: 0 }, turnId: 'turn', kind: 'prompt' })).toEqual([]);
      const history = await repository.readMessages(state);
      const transformed = await restored.transformContext(history);
      expect((transformed.at(-1) as any).details).toMatchObject({ revision: 1, content: (newer.details as any).content });
      expect(await restored.transformContext(transformed)).toEqual(transformed);
      expect(await repository.readMessages(state)).toEqual(history);
      expect((await restored.transformContext([{ role: 'user', content: 'Compacted summary', timestamp: 0 }])).at(-1))
        .toMatchObject({ details: { revision: 1, content: (newer.details as any).content } });
    } finally { repository.close(); faux.unregister(); }
  });
});

test('the first model call receives a persisted skill read, can patch immediately, and follow-ups do not reload it', async () => {
  await withTempDroneDataDir('companion-instructions-session-', async () => {
    const repository = new HubSessionRepository({ inMemory: true });
    const faux = registerFauxProvider({ api: 'faux-companion-instructions', provider: 'faux-companion-instructions', tokensPerSecond: 0 });
    const skills = new CompanionSkills(() => {});
    let modelCalls = 0;
    faux.setResponses([
      (context) => {
        modelCalls++;
        expect(context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult']);
        expect(context.systemPrompt).toContain(COMPANION_INSTRUCTIONS_SKILL);
      const result = context.messages[2]!;
        expect(result.role).toBe('toolResult');
        expect(JSON.stringify(result.content)).toContain('revision');
        expect((context.messages[1] as any).content[0].synthetic).toBe(true);
        return fauxAssistantMessage([fauxToolCall('apply_instructions_patch', { baseRevision: 0, patch: patch('', 'Read before editing.') })]);
      },
      () => { modelCalls++; return fauxAssistantMessage('Saved.'); },
      () => { modelCalls++; return fauxAssistantMessage('Follow-up.'); },
      () => { modelCalls++; return fauxAssistantMessage('Reopened handle.'); },
    ]);
    const options = {
      workspaceRoot: 'drone-hub', model: faux.getModel(), permissionMode: 'workspace-write' as const,
      toolProfile: 'no-shell-workspace-write' as const, sessionRepository: repository,
      toolProviders: [skills], promptContext: skills.promptContext.bind(skills), transformContext: skills.transformContext.bind(skills),
    };
    let session = await createBlipSession(options);
    try {
      await session.prompt('Remember to read first.');
      expect(modelCalls).toBe(2);
      expect((await readCompanionInstructions()).content.trim()).toBe('Read before editing.');
      expect(session.state.loadedSkills).toContain(COMPANION_INSTRUCTIONS_SKILL);
      await session.prompt('Continue.');
      const sessionId = session.state.id;
      session.close();
      const rebuiltSkills = new CompanionSkills(() => {});
      session = await createBlipSession({ ...options, sessionId, toolProviders: [rebuiltSkills],
        promptContext: rebuiltSkills.promptContext.bind(rebuiltSkills), transformContext: rebuiltSkills.transformContext.bind(rebuiltSkills) });
      await session.prompt('Continue after settings changed.');
      const history = await repository.readMessages(session.state);
      expect(history.filter((message) => message.role === 'toolResult' && message.toolName === 'read_skill')).toHaveLength(1);
      expect(history.filter((message) => message.role === 'user')).toHaveLength(3);
      expect(modelCalls).toBe(4);
      // A compacted context has lost the original read; restore the latest saved snapshot exactly once.
      const compacted = [{ role: 'user' as const, content: 'Summary of earlier conversation.', timestamp: Date.now() }];
      const restored = await rebuiltSkills.transformContext(compacted);
      expect(restored.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult']);
      expect(JSON.stringify(restored)).toContain('Read before editing.');
      expect(await rebuiltSkills.transformContext(restored)).toEqual(restored);
      expect(await repository.readMessages(session.state)).toEqual(history);
    } finally {
      session.close();
      repository.close();
      faux.unregister();
    }
  });
});

test('callable skills require a read, reject unknown skills, and reread after another client saves', async () => {
  await withTempDroneDataDir('companion-instructions-tools-', async () => {
    const skills = new CompanionSkills(() => {});
    const tools = skills.load({} as any);
    const read = tools[0]!;
    const apply = tools[1]!;
    // No session is needed to verify the guarded failure paths.
    await expect(apply.execute('unread', { baseRevision: 0, patch: patch('', 'x') })).rejects.toThrow('not read');
    await expect(read.execute('unknown', { name: 'missing' })).rejects.toThrow('Unknown');
    const repository = new HubSessionRepository({ inMemory: true });
    const session = await repository.create({ provider: 'codex', model: 'test', permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write' });
    try {
      skills.load({ session, repository } as any);
      await read.execute('read', { name: COMPANION_INSTRUCTIONS_SKILL });
      await writeCompanionInstructions('user edit', 0);
      await expect(apply.execute('stale', { baseRevision: 0, patch: patch('', 'x') })).rejects.toThrow('Read the latest');
      await read.execute('reread', { name: COMPANION_INSTRUCTIONS_SKILL });
      await apply.execute('patch', { baseRevision: 1, patch: patch('user edit', 'updated') });
      expect((await readCompanionInstructions()).content.trim()).toBe('updated');
    } finally { repository.close(); }
  });
});

test('automatic mid-turn compaction preserves the exact instructions in the next model request', async () => {
  await withTempDroneDataDir('companion-instructions-compaction-', async () => {
    await writeCompanionInstructions('Always read files before editing them.', 0);
    const repository = new HubSessionRepository({ inMemory: true });
    const faux = registerFauxProvider({ api: 'faux-companion-compaction', provider: 'faux-companion-compaction', tokensPerSecond: 0 });
    const skills = new CompanionSkills(() => {});
    let compacted = false;
    let answered = false;
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('large_output', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Summary: the user requested a large tool result.'),
      (context) => {
        answered = true;
        expect(JSON.stringify(context.messages)).toContain('Always read files before editing them.');
        expect(context.messages.filter((message) => message.role === 'toolResult' && message.toolName === 'read_skill')).toHaveLength(1);
        return fauxAssistantMessage('Done.');
      },
    ]);
    const session = await createBlipSession({
      workspaceRoot: 'drone-hub', model: { ...faux.getModel(), contextWindow: 4_000, maxTokens: 500 },
      permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write', sessionRepository: repository,
      toolProviders: [skills], promptContext: skills.promptContext.bind(skills), transformContext: skills.transformContext.bind(skills),
      compactionSettings: { auto: true, reserveTokens: 500, keepRecentTokens: 100, keepRecentTurns: 1 },
      tools: [{ name: 'large_output', label: 'Large output', description: 'Read a large result',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: [{ type: 'text', text: 'large '.repeat(5_000) }], details: {} }),
      }],
      eventSink: (event) => { if (event.type === 'compaction_completed') compacted = true; },
    });
    try {
      await session.prompt('Read the large output.');
      expect(compacted).toBe(true);
      expect(answered).toBe(true);
      // Restoration affects the model context only; the initial read remains unique in history.
      expect((await repository.readMessages(session.state)).filter((message) => message.role === 'toolResult' && message.toolName === 'read_skill')).toHaveLength(1);
    } finally { session.close(); repository.close(); faux.unregister(); }
  });
});
