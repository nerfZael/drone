import { expect, test } from 'bun:test';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';
import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { CompanionRunSession } from '../src/hub/companion/companion-run-session';
import { runCompanionPrompt } from '../src/hub/companion/companion-run-outcome';
import { withTempDroneDataDir } from './test-helpers';
import type { BlipRuntimeEvent } from '@blip/core';

for (const transport of ['websocket', 'device_mesh'] as const) {
  test(`${transport}: a resolved agent error emits a correlated failure, never an empty success`, async () => {
    await withTempDroneDataDir('companion-outcome-', async () => {
      const faux = registerFauxProvider({ api: 'faux', provider: 'faux', tokensPerSecond: 0 });
      faux.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: '402 status code (no body)' }),
        fauxAssistantMessage('Recovered')]);
      const host = new BlipAssistantHost(async () => ({ provider: 'faux', model: faux.getModel().id,
        thinkingLevel: 'off', systemPrompt: 'Test', tools: [], getApiKey: () => 'test' }));
      const messages: any[] = [];
      const failed = Promise.withResolvers<void>();
      let readReply = false;
      const session = new CompanionRunSession({ clientRunId: 'client', runtimeRunId: 'runtime', transport,
        isAvailable: () => true, unavailableMessage: 'offline', onClose() {},
        emit(event) { messages.push(event); if (event.type === 'error') failed.resolve(); },
        runtime: {
          run: async input => {
            await runCompanionPrompt('cerebras', observe => host.promptThread('companion:test', input.prompt, observe), input.onEvent);
            readReply = true;
            return host.latestAssistantVisibleText('companion:test');
          },
          steer: () => false, deleteSession: async () => {},
        },
      });
      try {
        await session.submit({ prompt: 'Make an edit', messageId: 'request-1' });
        await failed.promise;
        expect(messages.filter(m => m.type === 'error')).toEqual([{ type: 'error', messageId: 'request-1', error: 'cerebras: 402 status code (no body)' }]);
        expect(messages.some(m => m.type === 'reply' || m.status === 'completed')).toBe(false);
        expect(readReply).toBe(false);
        // A provider failure is not sticky: the next successful run still works.
        await runCompanionPrompt('cerebras', observe => host.promptThread('companion:test', 'Try again', observe), () => {});
        expect(await host.latestAssistantVisibleText('companion:test')).toBe('Recovered');
      } finally { await session.close('test done'); await host.close(); faux.unregister(); }
    });
  });
}

test('cancelled and failed terminal events reject even without an error description', async () => {
  for (const status of ['cancelled', 'error'] as const) {
    await expect(runCompanionPrompt('provider', async observe => {
      await observe({ type: 'session_finished', status } as BlipRuntimeEvent);
    }, () => {})).rejects.toThrow(status === 'cancelled' ? 'Companion run cancelled' : 'failed without an error description');
  }
});
