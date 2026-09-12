import React, { act } from 'react';
import { createRequire } from 'node:module';
import type { ReactTestRenderer } from 'react-test-renderer';
import { expect, mock, test } from 'bun:test';
import { COMPANION_PROPOSAL_TARGET_ID, LIVE_COMPANION_PROMPT_PREFIX } from '@drone/assistant-chat';
import { COMPANION_CAPABILITY, COMPANION_RUN_OPERATIONS } from '@drone/device-protocol';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';

let enabled = false;
let livePrompt = 'Speak calmly.';
let autoApprove = false;
let rejectSettings = false;
let recorded = 0;
let nextId = 0;
let backend: ((prompt: string, signal: AbortSignal) => Promise<string>) | null = null;
const calls: { operation: string; payload: any }[] = [];
const listeners = new Set<(event: any) => void>();
const live: any = { status: 'idle', error: '', captions: '', targetDeviceId: '',
  start: async (id: string, _name: string, run: typeof backend) => { live.status = 'listening'; live.targetDeviceId = id; backend = run; },
  stop: () => { live.status = 'idle'; }, reset: () => { live.status = 'idle'; }, toggleMute() {} };
const voice = {
  session: { kind: 'idle', status: 'idle', microphoneAvailable: true }, microphoneCoordinator: new MobileMicrophoneCoordinator(),
  discardRecording: async () => {}, startRecording: async () => { recorded++; return true; }, setError() {}, getError: () => '',
};
const mesh = {
  identity: { id: 'phone' }, devices: [{ id: 'phone', grants: [{ capability: 'companion', version: 1, operations: ['*'] }] }],
  profile: { capabilitiesByDevice: { hub: [COMPANION_CAPABILITY] } }, setBackgroundActivityRequired() {},
  request: async (_id: string, _capability: string, operation: string, payload?: any) => {
    calls.push({ operation, payload });
    if (operation.startsWith('auto-approve.settings')) {
      if (rejectSettings) throw new Error('Hub unavailable');
      if (operation === 'auto-approve.settings.update') autoApprove = payload.enabled;
      return { enabled: autoApprove };
    }
    if (operation.startsWith('live.settings')) {
      if (rejectSettings) throw new Error('Hub unavailable');
      if (operation === 'live.settings.update') enabled = payload.enabled;
      return { enabled };
    }
    if (operation.startsWith('live.prompt')) {
      if (rejectSettings) throw new Error('Hub unavailable');
      if (operation === 'live.prompt.update') livePrompt = payload.systemPrompt;
      return { enabled, systemPrompt: livePrompt, defaultSystemPrompt: 'Speak calmly.', maxSystemPromptChars: 8000 };
    }
    return {};
  },
  subscribe: (_capability: string, _event: string, listener: (event: any) => void) => {
    listeners.add(listener); return () => listeners.delete(listener);
  },
};
mock.module('../src/mesh/MeshContext', () => ({ useMesh: () => mesh }));
mock.module('../src/local-assistant/MobileChatVoiceRecorderContext', () => ({ useSharedMobileChatVoiceRecorder: () => voice }));
mock.module('../src/local-assistant/use-mobile-companion-live', () => ({ useMobileCompanionLive: () => live }));
mock.module('expo-crypto', () => ({ randomUUID: () => `id-${++nextId}` }));
// Keep the renderer on the app's React instance in this multi-version workspace.
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { MobileCompanionProvider, useMobileCompanion } = await import('../src/local-assistant/MobileCompanionContext');
const { useMobileCompanionLiveSettings } = await import('../src/local-assistant/use-mobile-companion-live-settings');

async function harness(settingsOnly = false, executeProposal = async () => ({ ok: true, operations: [] }), savedAutoApprove = false) {
  autoApprove = savedAutoApprove; enabled = false; livePrompt = 'Speak calmly.'; rejectSettings = false; recorded = 0; backend = null; live.status = 'idle'; calls.length = 0;
  const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  let context!: ReturnType<typeof useMobileCompanion>;
  let settings!: ReturnType<typeof useMobileCompanionLiveSettings>;
  function Capture() { context = useMobileCompanion(); return null; }
  function Settings() { settings = useMobileCompanionLiveSettings('hub'); return null; }
  await act(async () => { root = create(settingsOnly ? <Settings /> : <MobileCompanionProvider><Capture /></MobileCompanionProvider>); });
  let workspace = 'first';
  if (!settingsOnly) await act(async () => { context.registerWorkspaceTarget({
    targetDeviceId: 'hub', targetName: 'Hub', reachable: true,
    getAppContext: () => ({ mainDroneId: workspace }),
    readComposer: () => ({ targetId: 'composer', path: '', content: '', revision: '0', mode: 'edit' }),
    applyComposer: () => ({ ok: true, revision: '1' }), executeProposal,
    openDroneChat: async () => ({}), highlightDrones: () => ({}),
  }); });
  return { context: () => context, settings: () => settings, changeWorkspace: () => { workspace = 'second'; },
    async cleanup() {
      await act(async () => root.unmount());
      if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
      else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('mobile starts Live with stale local grants and authorizes Companion requests through the Hub', async () => {
  const previous = mesh.devices[0].grants[0].operations;
  mesh.devices[0].grants[0].operations = [];
  const h = await harness();
  const abort = new AbortController();
  let reply: Promise<string> | undefined;
  try {
    enabled = true;
    await act(async () => { await h.context().toggle(); });
    expect(backend).not.toBeNull();
    expect(recorded).toBe(0);
    await act(async () => {
      reply = backend!('hello', abort.signal);
      await tick();
    });
    expect(calls.some((call) => call.operation === 'run.start')).toBe(true);
    expect(live.status).toBe('listening');
  } finally {
    const settled = reply?.catch(() => undefined);
    abort.abort();
    await settled;
    await h.cleanup();
    mesh.devices[0].grants[0].operations = previous;
  }
});

test('mobile keeps recording when Live is off, uses client delegation when on, and sends follow-ups while working', async () => {
  const h = await harness();
  const abort = new AbortController();
  try {
    mesh.devices[0].grants[0].operations = [...COMPANION_RUN_OPERATIONS];
    await act(async () => { await h.context().toggle(); });
    expect(recorded).toBe(1); expect(backend).toBeNull();
    enabled = true;
    mesh.devices[0].grants[0].operations = ['*'];
    await act(async () => { await h.context().toggle(); });
    expect(backend).not.toBeNull(); expect(recorded).toBe(1);
    let first!: Promise<string>; let second!: Promise<string>;
    await act(async () => { first = backend!('first', abort.signal); await tick(); });
    expect(h.context().status).toBe('working');
    expect(h.context().transcript).toBe('first');
    await act(async () => { second = backend!(LIVE_COMPANION_PROMPT_PREFIX + ' internal delegation instructions', abort.signal); await tick(); });
    const prompts = calls.filter((call) => call.operation === 'run.start');
    expect(prompts.map((call) => call.payload.prompt)).toEqual(['first', LIVE_COMPANION_PROMPT_PREFIX + ' internal delegation instructions']);
    expect(h.context().transcript).toBe('');
    const latest = prompts.at(-1)!.payload;
    await act(async () => {
      for (const listener of listeners) {
        listener({ sourceDeviceId: 'hub', payload: { runId: latest.runId, messageId: latest.messageId, type: 'reply', reply: 'Updated' } });
        listener({ sourceDeviceId: 'hub', payload: { runId: latest.runId, messageId: latest.messageId, type: 'status', status: 'completed' } });
      }
    });
    expect(await first).toBe('Updated'); expect(await second).toBe('Updated');
    h.changeWorkspace();
    await expect(backend!('new edit', abort.signal)).rejects.toThrow('workspace changed');
    await act(async () => { await h.context().close(); });
    expect(live.status).toBe('idle');
  } finally { abort.abort(); await h.cleanup(); }
});

test('mobile reports a failed preference read without silently recording in the wrong mode', async () => {
  const h = await harness();
  try {
    rejectSettings = true;
    await act(async () => { await h.context().toggle(); });
    expect(recorded).toBe(0); expect(backend).toBeNull();
    expect(h.context().error).toBe('Hub unavailable');
  } finally { await h.cleanup(); }
});

test('mobile refuses Live delegation while a proposal is being applied', async () => {
  const release = Promise.withResolvers<void>();
  const h = await harness(false, async () => { await release.promise; return { ok: true, operations: [] }; });
  const abort = new AbortController();
  let applying: Promise<void> | undefined;
  let reply: Promise<string> | undefined;
  try {
    enabled = true;
    await act(async () => { await h.context().toggle(); });
    await act(async () => { reply = backend!('prepare a proposal', abort.signal); await tick(); });
    const request = calls.find((call) => call.operation === 'run.start')!.payload;
    const emit = (payload: any) => {
      for (const listener of listeners) listener({ sourceDeviceId: 'hub', payload: {
        runId: request.runId, messageId: request.messageId, ...payload,
      } });
    };
    await act(async () => {
      emit({ type: 'tool_call', generation: 1, callId: 'proposal', tool: 'apply_companion_proposal_patch', args: {
        targetId: COMPANION_PROPOSAL_TARGET_ID, baseRevision: '0',
        content: JSON.stringify({ version: 1, title: 'Create review group', operations: [{ id: 'group', type: 'create_group', name: 'Review' }] }),
      } });
      await tick();
      expect(calls.find((call) => call.operation === 'tool.result')?.payload).toMatchObject({ ok: true });
      emit({ type: 'reply', reply: 'Ready to apply' });
      emit({ type: 'status', status: 'completed' });
      await reply;
      applying = h.context().executeProposal();
    });
    expect(h.context().proposalExecuting).toBe(true);
    await expect(backend!('change the plan', abort.signal)).rejects.toThrow('applying a proposal');
    expect(calls.filter((call) => call.operation === 'run.start')).toHaveLength(1);
  } finally {
    release.resolve();
    await act(async () => { await applying; });
    const settled = reply?.catch(() => undefined);
    abort.abort(); await settled; await h.cleanup();
  }
});

test('mobile Live setting persists through Hub requests and failed writes keep the saved value', async () => {
  const h = await harness(true);
  try {
    expect(h.settings().enabled).toBe(false);
    expect(h.settings().systemPrompt).toBe('Speak calmly.');
    await act(async () => { await h.settings().save(true); });
    expect(enabled).toBe(true); expect(h.settings().enabled).toBe(true);
    await act(async () => { expect(await h.settings().saveSystemPrompt('Speak warmly.')).toBe(true); });
    expect(livePrompt).toBe('Speak warmly.'); expect(h.settings().systemPrompt).toBe('Speak warmly.');
    rejectSettings = true;
    await act(async () => { await h.settings().save(false); });
    expect(h.settings().error).toBe('Hub unavailable'); expect(h.settings().enabled).toBe(true);
    rejectSettings = false;
    await act(async () => { await h.settings().load(); });
    expect(h.settings().enabled).toBe(true); expect(h.settings().error).toBe('');
  } finally { await h.cleanup(); }
});

for (const status of ['completed', 'error', 'cancelled'] as const) {
  test(`mobile auto-approval executes only a completed proposal once (${status}) and survives closing`, async () => {
    let executions = 0;
    const h = await harness(false, async () => { executions++; return { ok: true, operations: [] }; });
    try {
      await act(async () => { await h.context().autoApproveSettings.save(true); });
      expect(autoApprove).toBe(true);
      await act(async () => { await h.context().submitText('prepare a proposal'); });
      const request = calls.find((call) => call.operation === 'run.start')!.payload;
      const emit = (payload: any) => {
        for (const listener of listeners) listener({ sourceDeviceId: 'hub', payload: {
          runId: request.runId, messageId: request.messageId, ...payload,
        } });
      };
      await act(async () => {
        emit({ type: 'tool_call', generation: 1, callId: 'proposal', tool: 'apply_companion_proposal_patch', args: {
          targetId: COMPANION_PROPOSAL_TARGET_ID, baseRevision: '0',
          content: JSON.stringify({ version: 1, title: 'Create review group', operations: [{ id: 'group', type: 'create_group', name: 'Review' }] }),
        } });
        await tick();
      });
      expect(executions).toBe(0);
      await act(async () => { emit({ type: 'status', status }); await tick(); });
      expect(executions).toBe(status === 'completed' ? 1 : 0);
      await act(async () => { emit({ type: 'status', status }); await tick(); });
      expect(executions).toBe(status === 'completed' ? 1 : 0);
      await act(async () => { await h.context().close(); });
      expect(h.context().autoApproveSettings.enabled).toBe(true);
    } finally { await h.cleanup(); }
  });
}


test('mobile restores auto-approval after remount and keeps the saved value when a write fails', async () => {
  let h = await harness();
  try {
    await act(async () => { await h.context().autoApproveSettings.save(true); });
    const saved = autoApprove;
    await h.cleanup();
    h = await harness(false, undefined, saved);
    expect(h.context().autoApproveSettings.enabled).toBe(true);
    rejectSettings = true;
    await act(async () => { await h.context().autoApproveSettings.save(false); });
    expect(h.context().autoApproveSettings.enabled).toBe(true);
    expect(h.context().autoApproveSettings.error).toBe('Hub unavailable');
    rejectSettings = false;
    await act(async () => { await h.context().autoApproveSettings.save(false); });
    expect(h.context().autoApproveSettings.enabled).toBe(false);
    expect(autoApprove).toBe(false);
  } finally { await h.cleanup(); }
});
