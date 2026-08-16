import type { CompanionClientTransport, CompanionServerMessage } from '@drone/assistant-chat';
import { COMPANION_CAPABILITY, type CapabilityEvent } from '@drone/device-protocol';

type MeshRequest = (
  targetDeviceId: string,
  capability: string,
  operation: string,
  payload?: unknown,
) => Promise<unknown>;

type MeshSubscribe = (
  capability: string,
  event: string,
  listener: (message: CapabilityEvent) => void,
) => () => void;

export function createMobileCompanionTransport(input: {
  targetDeviceId: string;
  request: MeshRequest;
  subscribe: MeshSubscribe;
}): CompanionClientTransport {
  let unsubscribe: (() => void) | null = null;

  return {
    async open({ runId, onMessage }) {
      unsubscribe = input.subscribe(COMPANION_CAPABILITY.id, 'run.event', (event) => {
        const payload = event.payload ?? {};
        if (
          event.sourceDeviceId !== input.targetDeviceId ||
          String(payload.runId ?? '') !== runId
        ) {
          return;
        }
        onMessage(payload as CompanionServerMessage);
      });
      return undefined;
    },
    async sendPrompt(prompt) {
      await input.request(input.targetDeviceId, COMPANION_CAPABILITY.id, 'run.start', prompt);
    },
    async sendToolResult(result) {
      await input.request(input.targetDeviceId, COMPANION_CAPABILITY.id, 'tool.result', result);
    },
    async cancel(runId) {
      await input.request(input.targetDeviceId, COMPANION_CAPABILITY.id, 'run.cancel', { runId });
    },
    close() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
