import React from 'react';
import { expect, mock, spyOn, test } from 'bun:test';
import type { CompanionProposal } from '@drone/assistant-chat';
import type { MobileCompanionWorkspaceTarget } from '../src/local-assistant/MobileCompanionContext';

let registered: MobileCompanionWorkspaceTarget | null = null;
mock.module('../src/local-assistant/MobileCompanionContext', () => ({
  useMobileCompanion: () => ({ registerWorkspaceTarget: (target: MobileCompanionWorkspaceTarget) => {
    registered = target;
    return () => { if (registered === target) registered = null; };
  } }),
}));
mock.module('../src/drones/create-preferences-storage', () => ({ loadMobileDroneCreatePreferences: async () => null }));
// Load after mocks so the native provider is not evaluated in the Node test runner.
const { useMobileCompanionWorkspaceTarget } = await import('../src/local-assistant/use-mobile-companion-workspace-target');

function harness(options: { phone?: boolean; reachable?: boolean; failAt?: number } = {}) {
  const calls: { operation: string; payload: any }[] = [];
  const effects: React.EffectCallback[] = [];
  let refreshed = 0;
  const effectSpy = spyOn(React, 'useEffect').mockImplementation((effect) => { effects.push(effect); });
  const refSpy = spyOn(React, 'useRef').mockImplementation((value) => ({ current: value }));
  const stateSpy = spyOn(React, 'useState').mockImplementation((value: any) => [value, () => {}]);
  function Capture() {
    useMobileCompanionWorkspaceTarget({
      targetDeviceId: 'device-a', targetName: 'Test device', targetReachable: options.reachable ?? true,
      phoneTarget: options.phone ?? false,
      drones: [{ id: 'drone', name: 'Drone', repoPath: '/repo', chats: ['default', 'api'] } as any],
      selectedDrone: { id: 'drone', name: 'Drone', repoPath: '/repo', chats: ['default', 'api'] } as any,
      composerAvailable: true, workspaceVisible: true, chatName: 'api', prompt: 'draft', setPrompt() {},
      openFile: { visible: false, path: '', kind: 'text' }, createDrone: async () => null, openChat: async () => {},
      requestDroneControl: async (operation, payload) => {
        calls.push({ operation, payload });
        if (options.failAt === calls.length) throw new Error('Group unavailable');
        return { ok: true } as any;
      },
      onProposalApplied: () => { refreshed++; },
    });
    return null;
  }
  try { Capture(); } finally { effectSpy.mockRestore(); refSpy.mockRestore(); stateSpy.mockRestore(); }
  const cleanups = effects.map((effect) => effect());
  const target = registered!;
  return { target, calls, refreshed: () => refreshed, cleanup: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

const proposal: CompanionProposal = { version: 1, title: 'Organize', operations: [
  { id: 'group', type: 'create_chat_group', droneId: 'drone', group: 'Work' },
  { id: 'rename', type: 'rename_chat_group', droneId: 'drone', group: 'Work', newName: 'Tasks' },
  { id: 'move', type: 'move_chats', droneId: 'drone', chats: ['api'], targetGroup: 'Tasks' },
  { id: 'drone', type: 'set_drone_group', droneId: 'drone', group: '' },
  { id: 'delete', type: 'delete_chat_group', droneId: 'drone', group: 'Tasks' },
  { id: 'clone', type: 'clone_chat', droneId: 'drone', sourceChat: 'api', chatName: 'review' },
  { id: 'send', type: 'send_message', droneId: 'drone', chatName: 'review', message: 'Review this' },
] };
const context = { defaultRepoPath: '', targetDeviceId: 'device-a' };

for (const phone of [false, true]) {
  test(`${phone ? 'phone-local' : 'connected Hub'} proposals dispatch all organization operations and preserve ordinary clone/message behavior`, async () => {
    const h = harness({ phone });
    try {
      expect(h.target.getAppContext()).toMatchObject({ selectedChat: 'api', mainChat: 'api', mainDroneId: 'drone' });
      const execution = await h.target.executeProposal(proposal, context);
      expect(execution.ok).toBe(true);
      expect(h.calls.slice(0, 5)).toEqual(proposal.operations.slice(0, 5).map((payload) => ({ operation: 'sidebar.organize', payload })));
      expect(h.calls[5]).toEqual({ operation: 'chat.create', payload: { droneId: 'drone', name: 'review', copyFrom: 'api', mode: 'fork' } });
      expect(h.calls[6]).toMatchObject({ operation: 'chat.prompt', payload: { chatName: 'review', prompt: 'Review this', deliveryMode: 'queue' } });
      expect(h.refreshed()).toBe(1);
    } finally { h.cleanup(); }
  });
}

test('mobile refreshes partial execution and never continues past an organization failure', async () => {
  const h = harness({ failAt: 2 });
  try {
    const execution = await h.target.executeProposal(proposal, context);
    expect(execution.ok).toBe(false);
    expect(execution.operations.map((item) => item.status)).toEqual(['completed', 'failed', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(h.calls).toHaveLength(2);
    expect(h.refreshed()).toBe(1);
  } finally { h.cleanup(); }
});

test('mobile cannot apply a proposal to another device or to an offline device', async () => {
  const h = harness();
  try {
    await expect(h.target.executeProposal(proposal, { ...context, targetDeviceId: 'other-device' })).rejects.toThrow('PROPOSAL_TARGET_CHANGED');
    expect(h.calls).toHaveLength(0);
  } finally { h.cleanup(); }
  const offline = harness({ reachable: false });
  try {
    await expect(offline.target.executeProposal(proposal, context)).rejects.toThrow('TARGET_DEVICE_OFFLINE');
    expect(offline.calls).toHaveLength(0);
  } finally { offline.cleanup(); }
});
