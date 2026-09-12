import React, { act } from 'react';
import { createRequire } from 'node:module';
import type { ReactTestRenderer } from 'react-test-renderer';
import { expect, mock, test } from 'bun:test';
import { COMPANION_PROPOSAL_TARGET_ID, LIVE_COMPANION_PROMPT_PREFIX } from '@drone/assistant-chat';
import { COMPANION_CAPABILITY, COMPANION_RUN_OPERATIONS } from '@drone/device-protocol';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';
import type { MobileCompanionWorkspaceTarget } from '../src/local-assistant/MobileCompanionContext';

let headsetCallbacks: { start(): Promise<void>; ended(): void };
mock.module('../src/local-assistant/use-mobile-companion-headset-shortcut', () => ({ useMobileCompanionHeadsetShortcut: () => ({ enabled: false, ended() {} }) }));
let enabled = false;
let livePrompt = 'Speak calmly.';
let autoApprove = false;
let rejectSettings = false;
let recorded = 0;
let nextId = 0;
let backend: ((prompt: string, signal: AbortSignal) => Promise<string>) | null = null;
const calls: { operation: string; payload: any }[] = [];
const listeners = new Set<(event: any) => void>();
const live: any = { hasStarted: false, status: 'idle', error: '', captions: '', targetDeviceId: '',
  start: async (id: string, _name: string, run: typeof backend) => { live.hasStarted = true; live.status = 'listening'; live.targetDeviceId = id; backend = run; },
  pause: () => { live.status = 'paused'; }, resume: async () => { live.status = 'listening'; },
  stop: () => { live.status = 'idle'; }, reset: () => { live.hasStarted = false; live.status = 'idle'; }, toggleMute() {} };
const voice = {
  error: '',
  session: { kind: 'idle', status: 'idle', microphoneAvailable: true }, microphoneCoordinator: new MobileMicrophoneCoordinator(),
  stopRecordingForTranscript: async (_owner: string) => '',
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
mock.module('../src/local-assistant/use-mobile-companion-live', () => ({ useMobileCompanionLive: (_coordinator: unknown, _controller: unknown, callbacks: typeof headsetCallbacks) => { headsetCallbacks = callbacks; return live; } }));
mock.module('expo-crypto', () => ({ randomUUID: () => `id-${++nextId}` }));
// Keep the renderer on the app's React instance in this multi-version workspace.
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { MobileCompanionProvider, useMobileCompanion } = await import('../src/local-assistant/MobileCompanionContext');
const { useMobileCompanionLiveSettings } = await import('../src/local-assistant/use-mobile-companion-live-settings');

async function harness(settingsOnly = false, executeProposal: MobileCompanionWorkspaceTarget['executeProposal'] = async () => ({ ok: true, operations: [] }), savedAutoApprove = false) {
  autoApprove = savedAutoApprove; enabled = false; livePrompt = 'Speak calmly.'; rejectSettings = false; recorded = 0; backend = null; live.hasStarted = false; live.status = 'idle'; calls.length = 0;
  const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  let context!: ReturnType<typeof useMobileCompanion>;
  let settings!: ReturnType<typeof useMobileCompanionLiveSettings>;
  function Capture() { context = useMobileCompanion(); return null; }
  function Settings() { settings = useMobileCompanionLiveSettings('hub'); return null; }
  await act(async () => { root = create(settingsOnly ? <Settings /> : <MobileCompanionProvider><Capture /></MobileCompanionProvider>); });
  let workspace = 'first';
  let chat = 'default'; let pane = 'chat'; let openFile: { path: string } | null = null;
  let composerWrites = 0;
  const target: MobileCompanionWorkspaceTarget = {
    targetDeviceId: 'hub', targetName: 'Hub', reachable: true,
    getAppContext: () => ({ mainDroneId: workspace, selectedChat: chat, pane, openFile }),
    readComposer: () => ({ targetId: `composer:hub:${workspace}:${chat}`, path: '', content: '', revision: '0', mode: 'edit' }),
    applyComposer: (targetId, revision) => {
      if (targetId !== `composer:hub:${workspace}:${chat}`) throw new Error('STALE_COMPOSER_TARGET');
      if (revision !== '0') throw new Error('STALE_COMPOSER_REVISION');
      composerWrites++; return { ok: true, revision: '1' };
    }, executeProposal,
    openDroneChat: async (args) => {
      if (args.droneId === 'missing') throw new Error('unknown drone');
      workspace = String(args.droneId); chat = String(args.chatName ?? 'default'); pane = 'chat'; openFile = null;
      return { ok: true, droneId: workspace, chatName: chat };
    }, highlightDrones: () => ({}),
  };
  if (!settingsOnly) await act(async () => { context.registerWorkspaceTarget(target); });
  return { context: () => context, settings: () => settings, changeWorkspace: () => { workspace = 'second'; },
    changeView: (nextChat: string, nextPane: string, path: string | null) => { chat = nextChat; pane = nextPane; openFile = path ? { path } : null; },
    switchHub: () => { target.targetDeviceId = 'other-hub'; }, composerWrites: () => composerWrites,
    async refresh() { await act(async () => { root.update(<MobileCompanionProvider><Capture /></MobileCompanionProvider>); }); },
    async cleanup() {
      await act(async () => root.unmount());
      if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
      else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('finishing paused Companion dictation transcribes and submits the recording', async () => {
  const h = await harness();
  const previousSession = voice.session;
  const previousStop = voice.stopRecordingForTranscript;
  let stopped = 0;
  try {
    voice.session = { kind: 'companion', status: 'paused', microphoneAvailable: false };
    voice.stopRecordingForTranscript = async (owner) => {
      expect(owner).toBe('companion');
      stopped++;
      voice.session = previousSession;
      return 'Review this drone';
    };
    await act(async () => { h.context().reportOverlayInset(60); });
    await act(async () => { await h.context().toggle(); });
    expect(stopped).toBe(1);
    expect(recorded).toBe(0);
    expect(calls.find((call) => call.operation === 'run.start')?.payload.prompt).toBe('Review this drone');
  } finally {
    voice.session = previousSession;
    voice.stopRecordingForTranscript = previousStop;
    await h.cleanup();
  }
});

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
    let third!: Promise<string>;
    await act(async () => { third = backend!('new edit', abort.signal); await tick(); });
    const afterNavigation = calls.filter((call) => call.operation === 'run.start').at(-1)!.payload;
    expect(afterNavigation.prompt).toBe('new edit');
    await act(async () => {
      emitRun(afterNavigation, { type: 'reply', reply: 'Navigation did not stop Live' });
      emitRun(afterNavigation, { type: 'status', status: 'completed' });
    });
    expect(await third).toBe('Navigation did not stop Live');
    await act(async () => { await h.context().close(); });
    expect(live.status).toBe('idle');
  } finally { abort.abort(); await h.cleanup(); }
});

test('mobile toggles the Hub Live preference from the overlay menu and starts the matching microphone mode', async () => {
  const h = await harness();
  const abort = new AbortController();
  try {
    await act(async () => { await tick(); });
    expect(h.context().liveSettings.supported).toBe(true);
    expect(h.context().liveSettings.enabled).toBe(false);
    expect(h.context().currentWorkspaceSupported).toBe(true);
    await act(async () => { await h.context().toggleLiveVoice(); });
    expect(enabled).toBe(true);
    expect(h.context().liveSettings.enabled).toBe(true);
    expect(backend).not.toBeNull();
    expect(recorded).toBe(0);
    expect(live.status).toBe('listening');
    // Turning Live off while it is connected only ends the voice session.
    await act(async () => { await h.context().toggleLiveVoice(); });
    expect(enabled).toBe(false);
    expect(live.status).toBe('idle');
    expect(recorded).toBe(0);
    // Turning it off while idle starts plain dictation, like desktop.
    enabled = true;
    await act(async () => { await h.context().liveSettings.load(); });
    live.status = 'idle';
    await act(async () => { await h.context().toggleLiveVoice(); });
    expect(enabled).toBe(false);
    expect(recorded).toBe(1);
    expect(h.context().switchingVoice).toBe(false);
  } finally { abort.abort(); await h.cleanup(); }
});

test('closing Companion during a Live preference save does not reopen the microphone', async () => {
  const h = await harness();
  const originalRequest = mesh.request;
  const pending = Promise.withResolvers<void>();
  let switching!: Promise<void>;
  try {
    mesh.request = async (...args: Parameters<typeof originalRequest>) => {
      if (args[2] === 'live.settings.update') await pending.promise;
      return originalRequest(...args);
    };
    // Refresh the provider and settings hook with the deferred request.
    await act(async () => { h.context().reportOverlayInset(60); });
    await act(async () => { switching = h.context().toggleLiveVoice(); });
    expect(h.context().switchingVoice).toBe(true);
    await act(async () => { await h.context().close(); });
    await act(async () => { pending.resolve(); await switching; });
    expect(enabled).toBe(true);
    expect(live.status).toBe('idle');
    expect(backend).toBeNull();
    expect(recorded).toBe(0);
  } finally {
    pending.resolve();
    await switching;
    mesh.request = originalRequest;
    await h.cleanup();
  }
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
  test(`mobile auto-approval executes inline once, regardless of later turn status (${status})`, async () => {
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
      expect(executions).toBe(1);
      await act(async () => { emit({ type: 'status', status }); await tick(); });
      expect(executions).toBe(1);
      await act(async () => { emit({ type: 'status', status }); await tick(); });
      expect(executions).toBe(1);
      await act(async () => { await h.context().close(); });
      expect(h.context().autoApproveSettings.enabled).toBe(true);
    } finally { await h.cleanup(); }
  });
}


test('mobile edits a pending draft in place and returns the applied revision', async () => {
  const executed: any[] = [];
  const h = await harness(false, async (proposal) => {
    executed.push(proposal);
    return { ok: true, operations: proposal.operations.map((op) => ({ id: op.id, type: op.type, status: 'completed' })) };
  });
  try {
    await act(async () => { await h.context().submitText('Create a group'); });
    let request = calls.find((call) => call.operation === 'run.start')!.payload;
    await proposalTool(request, 'first', '0', 'Original');
    await act(async () => { emitRun(request, { type: 'status', status: 'completed' }); });
    await act(async () => { await h.context().submitText('Change the name'); });
    request = calls.filter((call) => call.operation === 'run.start').at(-1)!.payload;
    await proposalTool(request, 'edit', '1', 'Revised');
    expect(executed).toEqual([]);
    expect(h.context().proposal?.operations).toEqual([{ id: 'group', type: 'create_group', name: 'Revised' }]);
    await act(async () => { emitRun(request, { type: 'status', status: 'completed' }); });
    await act(async () => { await h.context().executeProposal(); });
    expect(executed).toHaveLength(1);
    expect(calls.find((call) => call.operation === 'proposal.result')!.payload.result).toMatchObject({
      revision: '2', autoApproved: false, execution: { ok: true },
      proposal: { operations: [{ id: 'group', type: 'create_group', name: 'Revised' }] },
    });
  } finally { await h.cleanup(); }
});

test('mobile uses current approval settings and permits successive inline proposals', async () => {
  let executions = 0;
  const h = await harness(false, async (proposal) => {
    executions++;
    return { ok: true, operations: proposal.operations.map((op) => ({ id: op.id, type: op.type, status: 'completed' })) };
  }, true);
  try {
    await act(async () => { await h.context().submitText('Create groups'); });
    const request = calls.find((call) => call.operation === 'run.start')!.payload;
    await act(async () => { await h.context().autoApproveSettings.save(false); });
    await proposalTool(request, 'draft', '0', 'First');
    expect(executions).toBe(0);
    await act(async () => { await h.context().autoApproveSettings.save(true); });
    await proposalTool(request, 'apply-first', '1', 'First revised');
    expect(executions).toBe(1);
    expect(h.context().proposal).toBeNull();
    await proposalTool(request, 'apply-second', '3', 'Second');
    expect(executions).toBe(2);
    expect(calls.filter((call) => call.operation === 'proposal.result')).toEqual([]);
    expect(calls.filter((call) => call.operation === 'tool.result').at(-1)!.payload.result)
      .toMatchObject({ applied: true, autoApproved: true, revision: '4', execution: { ok: true } });
  } finally { await h.cleanup(); }
});

function emitRun(request: any, payload: any) {
  for (const listener of listeners) listener({ sourceDeviceId: 'hub', payload: {
    runId: request.runId, messageId: request.messageId, ...payload,
  } });
}

async function proposalTool(request: any, callId: string, revision: string, name: string) {
  await act(async () => {
    emitRun(request, { type: 'tool_call', generation: 1, callId, tool: 'apply_companion_proposal_patch', args: {
      targetId: COMPANION_PROPOSAL_TARGET_ID, baseRevision: revision,
      content: JSON.stringify({ version: 1, title: 'Create group', operations: [{ id: 'group', type: 'create_group', name }] }),
    } });
    await tick();
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

test('Companion toggle stops only Live and keeps the overlay available for headset or button restart', async () => {
  const h = await harness();
  try {
    enabled = true;
    await act(async () => { await h.context().toggle(); });
    await h.refresh();
    expect(live.status).toBe('listening');
    await act(async () => { await h.context().toggle(); });
    await h.refresh();
    expect(live.status).toBe('paused');
    expect(h.context().overlayOpen).toBe(true);
    expect(calls.some((call) => call.operation === 'run.cancel')).toBe(false);
    await act(async () => { await h.context().toggle(); });
    await h.refresh();
    expect(live.status).toBe('listening');
    await act(async () => { await h.context().close(); });
    expect(live.hasStarted).toBe(false);
  } finally { await h.cleanup(); }
});


test('headset shortcut opens closed Companion directly in Live without switching the Hub preference', async () => {
  const h = await harness();
  try {
    expect(h.context().overlayOpen).toBe(false);
    calls.length = 0;
    await act(async () => { await headsetCallbacks.start(); });
    await h.refresh();
    expect(h.context().overlayOpen).toBe(true);
    expect(live.status).toBe('listening');
    expect(live.targetDeviceId).toBe('hub');
    expect(recorded).toBe(0);
    expect(calls.some((call) => call.operation.startsWith('live.settings'))).toBe(false);
    await act(async () => { await h.context().close(); });
    await h.refresh();
    expect(h.context().overlayOpen).toBe(false);
    await act(async () => { await headsetCallbacks.start(); });
    expect(live.status).toBe('listening');
  } finally { await h.cleanup(); }
});

test('headset shortcut refuses to take a microphone from another voice feature', async () => {
  const h = await harness();
  const previous = voice.session;
  try {
    voice.session = { kind: 'continuous', status: 'recording', microphoneAvailable: false };
    await h.refresh();
    await expect(headsetCallbacks.start()).rejects.toThrow('Another voice feature');
    expect(live.status).toBe('idle');
  } finally { voice.session = previous; await h.cleanup(); }
});


async function liveTool(request: any, callId: string, tool: string, args: Record<string, unknown> = {}) {
  await act(async () => {
    emitRun(request, { type: 'tool_call', generation: 1, callId, tool, args });
    await tick();
  });
  return calls.filter((call) => call.operation === 'tool.result' && call.payload.callId === callId).at(-1)!.payload;
}

test('Companion chat navigation and manual view changes never invalidate Live delegation', async () => {
  const h = await harness(); const abort = new AbortController();
  const logs: unknown[][] = []; const previousInfo = console.info;
  console.info = (...args) => { logs.push(args); };
  let reply!: Promise<string>;
  try {
    enabled = true;
    await act(async () => { await h.context().toggle(); reply = backend!('private spoken request', abort.signal); await tick(); });
    const first = calls.filter((call) => call.operation === 'run.start').at(-1)!.payload;
    expect((await liveTool(first, 'open', 'open_drone_chat', { droneId: 'second', chatName: 'review' })).ok).toBe(true);
    const context = await liveTool(first, 'context', 'get_app_context');
    expect(context).toMatchObject({ ok: true, result: { mainDroneId: 'second', selectedChat: 'review' } });
    h.changeView('different-chat', 'file', '/example/new-file.ts');
    expect(await liveTool(first, 'context-after-user-nav', 'get_app_context'))
      .toMatchObject({ ok: true, result: { selectedChat: 'different-chat', pane: 'file' } });
    await act(async () => { emitRun(first, { type: 'reply', reply: 'Done' }); emitRun(first, { type: 'status', status: 'completed' }); });
    expect(await reply).toBe('Done');
    h.changeView('default', 'other', null); // e.g. switching to Settings
    await act(async () => { reply = backend!('next private request', abort.signal); await tick(); });
    const second = calls.filter((call) => call.operation === 'run.start').at(-1)!.payload;
    expect(second.runId).toBe(first.runId); // Preserve the existing Companion backend.
    expect(live.status).toBe('listening');
    await act(async () => { emitRun(second, { type: 'reply', reply: 'Still working' }); emitRun(second, { type: 'status', status: 'completed' }); });
    expect(await reply).toBe('Still working');
    const changes = logs.filter((row) => row[0] === '[CompanionLive] Workspace context changed') as any[];
    expect(changes.some((row) => row[1].changes.droneId?.to === 'second')).toBe(true);
    expect(changes.some((row) => row[1].changes.openFile?.to === '/example/new-file.ts')).toBe(true);
    expect(logs.some((row) => row[0] === '[CompanionLive] Browser tool completed')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('private request');
    expect(JSON.stringify(logs)).not.toContain('private spoken request');
  } finally {
    const settled = reply?.catch(() => undefined); abort.abort(); await settled;
    console.info = previousInfo; await h.cleanup();
  }
});

test('navigation preserves individual edit target/revision checks and logs tool failures', async () => {
  const h = await harness(); const abort = new AbortController();
  const logs: unknown[][] = []; const previousWarn = console.warn;
  console.warn = (...args) => { logs.push(args); };
  let reply!: Promise<string>;
  try {
    enabled = true;
    await act(async () => { await h.context().toggle(); reply = backend!('test edit', abort.signal); await tick(); });
    const request = calls.filter((call) => call.operation === 'run.start').at(-1)!.payload;
    const before = await liveTool(request, 'read', 'read_active_composer');
    const oldTarget = before.result.targetId;
    h.changeWorkspace();
    expect(await liveTool(request, 'stale-target', 'apply_composer_patch', { targetId: oldTarget, baseRevision: '0', content: 'private edit' }))
      .toMatchObject({ ok: false, error: 'STALE_COMPOSER_TARGET' });
    expect(h.composerWrites()).toBe(0);
    const current = await liveTool(request, 'read-new', 'read_active_composer');
    expect(await liveTool(request, 'stale-revision', 'apply_composer_patch', { targetId: current.result.targetId, baseRevision: 'stale', content: 'private edit' }))
      .toMatchObject({ ok: false, error: 'STALE_COMPOSER_REVISION' });
    expect(h.composerWrites()).toBe(0);
    expect(await liveTool(request, 'valid-edit', 'apply_composer_patch', { targetId: current.result.targetId, baseRevision: '0', content: 'private edit' }))
      .toMatchObject({ ok: true });
    expect(h.composerWrites()).toBe(1);
    expect(await liveTool(request, 'failed-navigation', 'open_drone_chat', { droneId: 'missing' })).toMatchObject({ ok: false, error: 'unknown drone' });
    expect((await liveTool(request, 'read-after-failure', 'get_app_context')).ok).toBe(true);
    expect(logs).toContainEqual(['[CompanionLive] Browser tool failed', expect.objectContaining({ messageId: request.messageId, tool: 'apply_composer_patch', error: 'STALE_COMPOSER_TARGET' })]);
    expect(JSON.stringify(logs)).not.toContain('private edit');
  } finally {
    const settled = reply?.catch(() => undefined); abort.abort(); await settled;
    console.warn = previousWarn; await h.cleanup();
  }
});

test('Live remains bound to its Hub when a different Hub is selected', async () => {
  const h = await harness(); const abort = new AbortController();
  try {
    enabled = true;
    await act(async () => { await h.context().toggle(); });
    h.switchHub(); const count = calls.filter((call) => call.operation === 'run.start').length;
    await expect(backend!('wrong hub', abort.signal)).rejects.toThrow('different Hub');
    expect(calls.filter((call) => call.operation === 'run.start')).toHaveLength(count);
  } finally { abort.abort(); await h.cleanup(); }
});
