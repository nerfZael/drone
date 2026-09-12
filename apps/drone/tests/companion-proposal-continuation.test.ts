import { expect, test } from 'bun:test';

import { createCompanionCapability } from '../src/hub/device-mesh/companion-capability';

const requestContext = {
  requestId: 'request-1',
  sourceDevice: {
    id: 'phone-1',
    name: 'Phone',
    platform: 'android' as const,
    publicKey: {},
    administrator: false,
    grants: [],
    endpoints: [],
    revokedAt: null,
    addedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
};

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('expected Companion event was not emitted');
}

test('mobile relays an applied proposal result into a Companion continuation', async () => {
  const events: any[] = [];
  const resumed: any[] = [];
  const runtime = {
    async run() { return 'Ready to apply.'; },
    async resumeWithProposalResult(input: any) {
      resumed.push(input.result);
      return 'Applied from mobile.';
    },
    steer: () => false,
    async deleteSession() {},
  };
  const capability = createCompanionCapability(
    runtime as any,
    async (_capability, _event, payload) => { events.push(payload); },
  );
  const result = {
    applied: true,
    autoApproved: false,
    proposal: {
      version: 1,
      title: 'Create chat',
      operations: [{ id: 'create', type: 'create_chat', droneId: 'd1', chatName: 'new' }],
    },
    execution: {
      ok: true,
      operations: [{ id: 'create', type: 'create_chat', status: 'completed' }],
    },
  };
  try {
    await capability.invoke(
      'run.start',
      { runId: 'mobile-proposal', messageId: 'draft', prompt: 'Create it' },
      requestContext,
    );
    await waitFor(() => events.some(
      (event) => event.messageId === 'draft' && event.status === 'completed',
    ));
    await capability.invoke(
      'proposal.result',
      { runId: 'mobile-proposal', messageId: 'applied', result },
      requestContext,
    );
    await waitFor(() => events.some(
      (event) => event.messageId === 'applied' && event.status === 'completed',
    ));
    expect(resumed).toEqual([result]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'reply', messageId: 'applied', reply: 'Applied from mobile.',
    }));
  } finally {
    await capability.close?.();
  }
});
