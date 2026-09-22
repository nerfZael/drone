import { expect, test } from 'bun:test';
import { createBlipSession } from '@blip/core';
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type Context } from '@mariozechner/pi-ai';
import { LIVE_COMPANION_PROMPT_PREFIX } from '@drone/assistant-chat';
import { CompanionAppContext } from '../src/hub/companion/companion-app-context';
import { CompanionSkills } from '../src/hub/companion/companion-skills';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { withTempDroneDataDir } from './test-helpers';

function latestContext(context: Context) {
  return context.messages.findLast(message => message.role === 'toolResult' && message.toolName === 'get_app_context');
}

test('each normal message supplies fresh context with the instructions, without an extra model round trip', async () => {
  await withTempDroneDataDir('companion-app-context-', async () => {
    const repository = new HubSessionRepository({ inMemory: true });
    const faux = registerFauxProvider({ api: 'faux-companion-context', provider: 'faux-companion-context', tokensPerSecond: 0 });
    let selectedChat = 'first'; let reads = 0; let calls = 0; let enabled = true; let fail = false;
    const context = new CompanionAppContext({ enabled: () => enabled, assertAvailable: () => {}, read: async () => {
      reads++; if (fail) throw new Error('NO_ACTIVE_WORKSPACE'); return { selectedChat };
    } });
    const skills = new CompanionSkills(() => {});
    const check = (expected: string) => (input: Context) => {
      calls++;
      expect(JSON.stringify(latestContext(input)?.content)).toContain(expected);
      return fauxAssistantMessage('Done');
    };
    faux.setResponses([
      input => {
        calls++;
        expect(input.messages.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant', 'toolResult']);
        expect(JSON.stringify(latestContext(input)?.content)).toContain('first');
        expect((input.messages[3] as any).content[0]).toMatchObject({ name: 'get_app_context', synthetic: true });
        return fauxAssistantMessage('First done');
      }, check('second'),
      input => { calls++; expect(input.messages.at(-1)?.role).toBe('user'); return fauxAssistantMessage('Live'); },
      input => { calls++; expect(input.messages.at(-1)?.role).toBe('user'); return fauxAssistantMessage('Disabled'); },
      input => { calls++; expect(latestContext(input)).toMatchObject({ isError: true }); return fauxAssistantMessage('Context unavailable'); },
    ]);
    const session = await createBlipSession({
      workspaceRoot: 'drone-hub', model: faux.getModel(), permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository, toolProviders: [skills, context],
      promptContext: async lifecycle => [...await skills.promptContext(lifecycle), ...await context.promptContext(lifecycle)],
      transformContext: (messages, signal) => context.transformContext(messages, signal),
    });
    try {
      await session.prompt('First request');
      selectedChat = 'second'; await session.prompt('Another request');
      await session.prompt(`${LIVE_COMPANION_PROMPT_PREFIX} A live request`);
      enabled = false; await session.prompt('Tool disabled');
      enabled = true; fail = true; await session.prompt('Missing workspace');
      expect(calls).toBe(5); expect(reads).toBe(3);
      const messages = await repository.readMessages(session.state);
      expect(messages.filter(message => message.role === 'toolResult' && message.toolName === 'read_skill')).toHaveLength(1);
      expect(messages.filter(message => message.role === 'toolResult' && message.toolName === 'get_app_context')).toHaveLength(3);
    } finally { session.close(); repository.close(); faux.unregister(); }
  });
});

test('ASAP follow-ups supply context once before reasoning and retain the same read across tool rounds', async () => {
  await withTempDroneDataDir('companion-app-context-steer-', async () => {
    const repository = new HubSessionRepository({ inMemory: true });
    const faux = registerFauxProvider({ api: 'faux-companion-context-steer', provider: 'faux-companion-context-steer', tokensPerSecond: 0 });
    const started = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    let selection = 'first'; let reads = 0; let calls = 0; let resultId = '';
    const context = new CompanionAppContext({ enabled: () => true, assertAvailable: () => {}, read: async (_signal, messageId) => { reads++; if (reads === 2) expect(messageId).toBe('correction-id'); return { selection }; } });
    faux.setResponses([
      async () => { calls++; started.resolve(); await release.promise; return fauxAssistantMessage('First answer'); },
      input => {
        calls++;
        const result = latestContext(input)!;
        expect(JSON.stringify(result.content)).toContain('correction');
        expect(result.role).toBe('toolResult');
        if (result.role === 'toolResult') resultId = result.toolCallId;
        return fauxAssistantMessage([fauxToolCall('inspect', {})]);
      },
      input => {
        calls++;
        expect(latestContext(input)).toMatchObject({ toolCallId: resultId });
        return fauxAssistantMessage('Corrected');
      },
    ]);
    const session = await createBlipSession({
      workspaceRoot: 'drone-hub', model: faux.getModel(), permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write',
      sessionRepository: repository, toolProviders: [context], promptContext: lifecycle => context.promptContext(lifecycle),
      transformContext: (messages, signal) => context.transformContext(messages, signal),
      tools: [{ name: 'inspect', label: 'Inspect', description: 'Inspect', parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: [{ type: 'text', text: 'Done' }], details: {} }) }],
    });
    const running = session.prompt('Initial request');
    try {
      await started.promise;
      selection = 'correction'; session.steer(context.steeringPrompt('Correct this request', 'correction-id'));
      release.resolve(); await running;
      expect(calls).toBe(3); expect(reads).toBe(2);
      const messages = await repository.readMessages(session.state);
      const correction = messages.findIndex(message => message.role === 'user' && message.content === 'Correct this request');
      expect(messages[correction + 1]).toMatchObject({ role: 'assistant', content: [{ name: 'get_app_context', synthetic: true }] });
      expect(messages[correction + 2]).toMatchObject({ role: 'toolResult', toolCallId: resultId });
      expect(messages.filter(message => message.role === 'toolResult' && message.toolName === 'get_app_context')).toHaveLength(2);
    } finally { release.resolve(); await running; session.close(); repository.close(); faux.unregister(); }
  });
});

test('cancelled prefetches do not fabricate context or persist a tool error', async () => {
  const repository = new HubSessionRepository({ inMemory: true });
  const faux = registerFauxProvider({ api: 'faux-companion-context-abort', provider: 'faux-companion-context-abort', tokensPerSecond: 0 });
  let available = true;
  const context = new CompanionAppContext({ enabled: () => true,
    assertAvailable: () => { if (!available) throw new Error('Companion run cancelled'); },
    read: async () => { available = false; throw new Error('Connection closed'); },
  });
  const state = await repository.create({ provider: faux.getModel().provider, model: faux.getModel().id,
    permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write' });
  context.load({ session: state, repository, model: faux.getModel(), workspaceRoot: 'drone-hub',
    permissionMode: 'workspace-write', toolProfile: 'no-shell-workspace-write' });
  try {
    await expect(context.transformContext([context.steeringPrompt('Request')])).rejects.toThrow('cancelled');
    expect(await repository.readMessages(state)).toEqual([]);
  } finally { repository.close(); faux.unregister(); }
});
