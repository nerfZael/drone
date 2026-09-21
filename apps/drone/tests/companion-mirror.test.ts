import { expect, test } from 'bun:test';
import type { CompanionMirrorSnapshot } from '@drone/assistant-chat';
import { CompanionMirrorService } from '../src/hub/companion/CompanionMirrorService';
import { CompanionMirrorSocket } from '../src/hub/companion/CompanionMirrorSocket';
import { createCompanionCapability } from '../src/hub/device-mesh/companion-capability';
import { withTempDroneDataDir } from './test-helpers';
import { resetHubSettingsRepositoryForTests } from '../src/host/hub-settings-repository';

const snapshot: CompanionMirrorSnapshot = {
  status: 'completed', liveStatus: 'listening', captions: 'You: hello', reply: 'Ready', error: '',
  proposal: { version: 1, title: 'Send a message', operations: [{ id: 'one', type: 'send_message', droneId: 'drone', message: 'Hello' }] },
  proposalRevision: 1, proposalExecuting: false, proposalExecution: null, proposalDefaultRepoPath: '/repo', lastExecution: null,
};

async function harness(run: (h: {
  service: CompanionMirrorService; events: any[]; views: any[];
  publish(sequence?: number, sessionId?: string, change?: Partial<CompanionMirrorSnapshot>): Promise<unknown>;
  command(change?: Record<string, unknown>): Promise<void>;
}) => Promise<void>) {
  await withTempDroneDataDir('companion-mirror-', async () => {
    const events: any[] = []; const views: any[] = [];
    const service = new CompanionMirrorService(async (event, payload, operation, deviceId) => { events.push({ event, payload, operation, deviceId }); });
    const unsubscribe = await service.subscribe((view) => views.push(JSON.parse(JSON.stringify(view))));
    try { await run({ service, events, views,
      publish: (sequence = 1, sessionId = 'session', change = {}) => service.publish('phone', 'My phone', { sessionId, sequence, snapshot: { ...snapshot, ...change } }),
      command: (change = {}) => service.command({ deviceId: 'phone', sessionId: 'session', proposalRevision: 1, action: 'approve', ...change }),
    }); } finally { unsubscribe(); service.close(); }
  });
}

test('mirroring is opt-in, persisted, and discoverable by a desktop joining later', async () => {
  await harness(async (h) => {
    expect(await h.publish()).toEqual({ enabled: false });
    expect(h.views.at(-2)).toMatchObject({ type: 'mirror_state', enabled: false, sessions: [] });
    await h.service.setEnabled(true); await h.publish();
    const late: any[] = [];
    const unsubscribe = await h.service.subscribe((view) => late.push(view));
    expect(late[0].sessions[0]).toMatchObject({ deviceName: 'My phone', captions: 'You: hello', connected: true });
    unsubscribe(); resetHubSettingsRepositoryForTests();
    const restarted = new CompanionMirrorService(async () => {});
    expect(await restarted.settings()).toEqual({ enabled: true }); restarted.close();
    await h.service.setEnabled(false);
    expect(h.views.at(-1)).toMatchObject({ enabled: false, sessions: [] });
    await expect(h.service.setEnabled('true')).rejects.toThrow('boolean');
  });
});

test('approval routes only to its phone and concurrent or stale approvals are rejected', async () => {
  await harness(async (h) => {
    await h.service.setEnabled(true); await h.publish();
    await expect(h.command({ proposalRevision: 0 })).rejects.toThrow('changed');
    const applying = h.command();
    const event = h.events.at(-1);
    expect(event).toMatchObject({ event: 'mirror.command', operation: 'run.start', deviceId: 'phone', payload: { action: 'approve', sessionId: 'session' } });
    await expect(h.command()).rejects.toThrow('already');
    h.service.result('another-phone', { ...event.payload, ok: true });
    expect(h.views.at(-1).sessions[0].pending).toBe(true);
    h.service.result('phone', { ...event.payload, ok: true });
    await applying;
    await h.publish(2, 'session', { proposalRevision: 2, proposal: null });
    await expect(h.command()).rejects.toThrow('changed');
  });
});

test('out-of-order snapshots and closed sessions cannot replace the current proposal', async () => {
  await harness(async (h) => {
    await h.service.setEnabled(true); await h.publish(2, 'session', { proposalRevision: 2 });
    await h.publish(1);
    expect(h.views.at(-1).sessions[0].proposalRevision).toBe(2);
    h.service.remove('phone', 'session'); await h.publish(3);
    expect(h.views.at(-1).sessions).toEqual([]);
    await h.publish(1, 'replacement'); await h.publish(4);
    expect(h.views.at(-1).sessions[0].sessionId).toBe('replacement');
  });
});

test('disconnect disables the mirror, fails pending controls, and allows snapshot recovery', async () => {
  await harness(async (h) => {
    await h.service.setEnabled(true); await h.publish();
    const applying = h.command().catch((error) => error);
    h.service.disconnect('phone');
    expect((await applying).message).toContain('disconnected');
    expect(h.views.at(-1).sessions[0]).toMatchObject({ connected: false, pending: false });
    await expect(h.command()).rejects.toThrow('disconnected');
    await h.publish(2);
    expect(h.views.at(-1).sessions[0].connected).toBe(true);
  });
});

test('closing a desktop observer leaves the remote session running', async () => {
  await harness(async (h) => {
    await h.service.setEnabled(true); await h.publish();
    const messages: any[] = [];
    const socket = new CompanionMirrorSocket(h.service, (message) => messages.push(message));
    socket.handle({ type: 'mirror_subscribe' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.close();
    const count = messages.length;
    await h.publish(2);
    expect(messages).toHaveLength(count);
    expect(h.views.at(-1).sessions[0].connected).toBe(true);
  });
});

test('phone errors reach desktop and auto-approve changes reach observers and phones', async () => {
  await harness(async (h) => {
    await h.service.setEnabled(true); await h.publish();
    const applying = h.command().catch((error) => error);
    h.service.result('phone', { ...h.events.at(-1).payload, ok: false, error: 'changed on phone' });
    expect((await applying).message).toContain('changed on phone');
    await h.service.autoApproveChanged({ enabled: true });
    expect(h.events.at(-1)).toMatchObject({ event: 'auto-approve.settings.changed', payload: { enabled: true } });
    expect(h.views.at(-1)).toEqual({ type: 'mirror_auto_approve', enabled: true });
  });
});

test('mesh publishes bind identity to the authenticated phone and disconnect on access changes', async () => {
  await harness(async (h) => {
    await h.service.setEnabled(true);
    const capability = createCompanionCapability({} as any, async () => {}, undefined, h.service);
    const context = { sourceDevice: { id: 'phone', name: 'Authenticated phone' }, requestId: 'request' } as any;
    await capability.invoke('mirror.publish', { deviceId: 'spoofed', deviceName: 'spoofed', sessionId: 'session', sequence: 1, snapshot }, context);
    expect(h.views.at(-1).sessions[0]).toMatchObject({ deviceId: 'phone', deviceName: 'Authenticated phone' });
    await capability.accessChanged?.('phone');
    expect(h.views.at(-1).sessions[0].connected).toBe(false);
    await capability.close?.();
  });
});
