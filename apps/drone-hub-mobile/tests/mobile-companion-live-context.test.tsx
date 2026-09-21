import React, { act } from 'react';
import { createRequire } from 'node:module';
import type { ReactTestRenderer } from 'react-test-renderer';
import { expect, mock, test } from 'bun:test';
import { COMPANION_PROPOSAL_TARGET_ID, LIVE_COMPANION_PROMPT_PREFIX } from '@drone/assistant-chat';
import { COMPANION_CAPABILITY, COMPANION_RUN_OPERATIONS } from '@drone/device-protocol';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';
import type { MobileCompanionWorkspaceTarget } from '../src/local-assistant/MobileCompanionContext';

let headsetCallbacks: { start(): Promise<void>; ended(): void; recordingAction(action: import('../src/local-assistant/mobile-live-controls').RecordingHeadsetAction): Promise<void> };
mock.module('../src/local-assistant/use-mobile-companion-headset-shortcut', () => ({ useMobileCompanionHeadsetShortcut: () => ({ enabled: false, ended() {} }) }));
let enabled = false;
let voiceMode = 'live';
let livePrompt = 'Speak calmly.';
let autoApprove = false;
let rejectSettings = false;
let recorded = 0;
let nextId = 0;
let notifyLive = () => {};
let backend: ((prompt: string, signal: AbortSignal) => Promise<string>) | null = null;
const calls: { operation: string; payload: any }[] = [];
const listeners = new Set<(event: any) => void>();
const live: any = { hasStarted: false, status: 'idle', error: '', captions: '', targetDeviceId: '',
  start: async (id: string, _name: string, run: typeof backend) => { live.hasStarted = true; live.status = 'listening'; live.targetDeviceId = id; backend = run; notifyLive(); },
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
      if (operation === 'live.settings.update') { enabled = payload.enabled; voiceMode = payload.mode ?? voiceMode; }
      return { enabled, mode: voiceMode };
    }
    if (operation.startsWith('live.prompt')) {
      if (rejectSettings) throw new Error('Hub unavailable');
      if (operation === 'live.prompt.update') livePrompt = payload.systemPrompt;
      return { enabled, systemPrompt: livePrompt, defaultSystemPrompt: 'Speak calmly.', maxSystemPromptChars: 8000 };
    }
    return {};
  },
  subscribe: (_capability: string, _event: string, listener: (event: any) => void) => {
    const filtered = (event: any) => { if (!event.event || event.event === _event) listener(event); };
    listeners.add(filtered); return () => listeners.delete(filtered);
  },
};
mock.module('../src/mesh/MeshContext', () => ({ useMesh: () => mesh }));
mock.module('../src/local-assistant/MobileChatVoiceRecorderContext', () => ({ useSharedMobileChatVoiceRecorder: () => voice }));
mock.module('../src/local-assistant/use-mobile-companion-live', () => ({ useMobileCompanionLive: (_coordinator: unknown, _controller: unknown, callbacks: typeof headsetCallbacks) => { const [, refresh] = React.useReducer((value: number) => value + 1, 0); notifyLive = refresh; headsetCallbacks = callbacks; return live; } }));
mock.module('expo-crypto', () => ({ randomUUID: () => `id-${++nextId}` }));
// Keep the renderer on the app's React instance in this multi-version workspace.
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { MobileCompanionProvider, useMobileCompanion } = await import('../src/local-assistant/MobileCompanionContext');
const { useMobileCompanionLiveSettings } = await import('../src/local-assistant/use-mobile-companion-live-settings');

async function harness(settingsOnly = false, executeProposal: MobileCompanionWorkspaceTarget['executeProposal'] = async () => ({ ok: true, operations: [] }), savedAutoApprove = false) {
  autoApprove = savedAutoApprove; enabled = false; voiceMode = 'live'; livePrompt = 'Speak calmly.'; rejectSettings = false; recorded = 0; backend = null; live.hasStarted = false; live.status = 'idle'; calls.length = 0;
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
      emit({ type: 'tool_call', generation: 1, callId: 'proposal', tool: 'apply_proposal_patch', args: {
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
        emit({ type: 'tool_call', generation: 1, callId: 'proposal', tool: 'apply_proposal_patch', args: {
          targetId: COMPANION_PROPOSAL_TARGET_ID, baseRevision: '0',
          content: JSON.stringify({ version: 1, title: 'Create review group', operations: [{ id: 'group', type: 'create_group', name: 'Review' }] }),
        } });
        await tick();
      });
      expect(executions).toBe(0);
      await executeProposalTool(request, 'execute', '1');
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
    expect(executions).toBe(0);
    await executeProposalTool(request, 'execute-first', '2');
    expect(executions).toBe(1);
    expect(h.context().proposal).toBeNull();
    await proposalTool(request, 'apply-second', '3', 'Second');
    await executeProposalTool(request, 'execute-second', '4');
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
    emitRun(request, { type: 'tool_call', generation: 1, callId, tool: 'apply_proposal_patch', args: {
      targetId: COMPANION_PROPOSAL_TARGET_ID, baseRevision: revision,
      content: JSON.stringify({ version: 1, title: 'Create group', operations: [{ id: 'group', type: 'create_group', name }] }),
    } });
    await tick();
  });
}

for (const mode of ['live', 'normal'] as const) test(`${mode} desktop mirror approvals validate the current phone revision and execute only once`, async () => {
  let executions = 0;
  const executedTitles: string[] = [];
  let finish!: () => void;
  const originalRequest = mesh.request;
  mesh.request = async (...args: Parameters<typeof originalRequest>) => {
    const value = await originalRequest(...args);
    return args[2] === 'mirror.settings.get' || args[2] === 'mirror.publish' ? { enabled: true } : value;
  };
  const h = await harness(false, async (proposal) => {
    executions++; executedTitles.push(proposal.title);
    await new Promise<void>((resolve) => { finish = resolve; });
    return { ok: true, operations: [] };
  });
  try {
    if (mode === 'live') {
      enabled = true;
      await act(async () => { await h.context().toggle(); });
      await h.refresh();
    }
    const abort = new AbortController();
    let reply: Promise<string> | undefined;
    await act(async () => {
      if (mode === 'live') reply = backend!('Create a group', abort.signal);
      else await h.context().submitText('Create a group');
      await tick();
    });
    const request = calls.find((call) => call.operation === 'run.start')!.payload;
    await proposalTool(request, 'mirror-draft', '0', 'Review');
    const second = (await liveTool(request, 'mirror-second', 'create_proposal', { title: 'Second' })).result;
    await liveTool(request, 'mirror-second-patch', 'apply_proposal_patch', {
      targetId: second.targetId, baseRevision: '0',
      content: JSON.stringify({ version: 1, title: 'Second', operations: [{ id: 'second', type: 'create_group', name: 'Second' }] }),
    });
    await act(async () => { emitRun(request, { type: 'reply', reply: 'Ready' }); emitRun(request, { type: 'status', status: 'completed' }); });
    await reply;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    let publication = calls.filter((call) => call.operation === 'mirror.publish').at(-1)!.payload;
    expect(publication.snapshot.proposal.operations[0].name).toBe('Review');
    if (mode === 'normal') expect(publication.snapshot.captions).toBe('Create a group');
    const click = (commandId: string, proposalRevision: number, sourceDeviceId = 'hub', action = 'approve', targetId?: string) => {
      for (const listener of listeners) listener({ sourceDeviceId, event: 'mirror.command', payload: {
        sessionId: publication.sessionId, commandId, proposalRevision, action, targetId, expiresAt: Date.now() + 10_000,
      } });
    };
    await act(async () => { click('foreign', 1, 'another-hub'); click('stale', 0); await tick(); });
    expect(executions).toBe(0);
    expect(calls.find((call) => call.operation === 'mirror.result' && call.payload.commandId === 'stale')!.payload)
      .toMatchObject({ ok: false, error: 'The proposal changed. Review the latest version.' });
    await act(async () => { click('select', publication.snapshot.proposalRevision, 'hub', 'select_proposal', second.targetId); await tick(); });
    expect(h.context().selectedProposalId).toBe(second.targetId);
    // Both documents have revision 1: switching documents must invalidate the old mirror approval too.
    await act(async () => { click('selection-stale', publication.snapshot.proposalRevision); await tick(); });
    expect(executions).toBe(0);
    expect(calls.find((call) => call.operation === 'mirror.result' && call.payload.commandId === 'selection-stale')!.payload.ok).toBe(false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    publication = calls.filter((call) => call.operation === 'mirror.publish').at(-1)!.payload;
    const revision = publication.snapshot.proposalRevision;
    await act(async () => { click('valid', revision); click('duplicate', revision); click('valid', revision); await tick(); });
    expect(executions).toBe(1);
    expect(h.context().proposalExecuting).toBe(true);
    await act(async () => { finish(); await tick(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    const completed = calls.filter((call) => call.operation === 'mirror.publish').at(-1)!.payload.snapshot;
    expect(executedTitles).toEqual(['Second']);
    expect(completed.proposal.title).toBe('Create group');
    expect(completed.lastExecution.execution.ok).toBe(true);
    expect(completed.history).toHaveLength(1);
    expect(completed.proposals).toHaveLength(1);
    expect(live.status).toBe(mode === 'live' ? 'listening' : 'idle');
    expect(completed.voiceControls).toBe(mode === 'live');
    await act(async () => { click('late', 1); await tick(); });
    expect(executions).toBe(1);
    await act(async () => { await h.context().close(); });
    expect(calls.filter(call => call.operation === 'mirror.close').at(-1)?.payload.sessionId).toBe(publication.sessionId);
  } finally { finish?.(); await h.cleanup(); mesh.request = originalRequest; }
});

test('phone auto-approve immediately follows a host setting event without restarting Live', async () => {
  const h = await harness();
  try {
    enabled = true;
    await act(async () => { await h.context().toggle(); });
    const sendSetting = (value: boolean, sourceDeviceId = 'hub') => {
      for (const listener of listeners) listener({ sourceDeviceId, event: 'auto-approve.settings.changed', payload: { enabled: value } });
    };
    await act(async () => { sendSetting(true, 'other-hub'); });
    expect(h.context().autoApproveSettings.enabled).toBe(false);
    await act(async () => { sendSetting(true); });
    expect(h.context().autoApproveSettings.enabled).toBe(true);
    await act(async () => { sendSetting(false); });
    expect(h.context().autoApproveSettings.enabled).toBe(false);
    expect(live.status).toBe('listening');
  } finally { await h.cleanup(); }
});

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


test('headset shortcut honors Live preference without changing it', async () => {
  const h = await harness();
  try {
    expect(h.context().overlayOpen).toBe(false);
    enabled = true;
    calls.length = 0;
    await act(async () => { await headsetCallbacks.start(); });
    await h.refresh();
    expect(h.context().overlayOpen).toBe(true);
    expect(live.status).toBe('listening');
    expect(live.targetDeviceId).toBe('hub');
    expect(recorded).toBe(0);
    expect(calls.some((call) => call.operation === 'live.settings.update')).toBe(false);
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
    await act(async () => { await headsetCallbacks.start(); });
    expect(h.context().error).toContain('Continuous voice is already using');
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


test('phone assistant requires Live preference and never falls back to dictation', async () => {
  const h = await harness();
  try {
    enabled = false;
    await act(async () => {
      await expect(h.context().startAssistantVoice(new AbortController().signal)).rejects.toThrow('Enable Companion Live');
    });
    expect(recorded).toBe(0);
    expect(live.status).toBe('idle');
    enabled = true;
    await act(async () => { await h.context().startAssistantVoice(new AbortController().signal); });
    expect(live.status).toBe('listening');
    expect(backend).not.toBeNull();
    live.pause();
    await h.refresh();
    await act(async () => { await h.context().startAssistantVoice(new AbortController().signal); });
    expect(live.status).toBe('listening');
    expect(recorded).toBe(0);
  } finally { await h.cleanup(); }
});

test('cancelled phone assistant invocation never opens Live', async () => {
  const h = await harness();
  try {
    enabled = true;
    const abort = new AbortController();
    abort.abort();
    await act(async () => { await h.context().startAssistantVoice(abort.signal); });
    expect(live.status).toBe('idle');
    expect(recorded).toBe(0);
    const pendingAbort = new AbortController();
    await act(async () => {
      const pending = h.context().startAssistantVoice(pendingAbort.signal);
      pendingAbort.abort();
      await pending;
    });
    expect(live.status).toBe('idle');
    expect(recorded).toBe(0);
  } finally { await h.cleanup(); }
});

test('cancelling an assistant invocation attached to established Live does not stop it', async () => {
  const h = await harness();
  try {
    enabled = true;
    await act(async () => { await h.context().startAssistantVoice(new AbortController().signal); });
    await h.refresh();
    const abort = new AbortController();
    await act(async () => {
      const pending = h.context().startAssistantVoice(abort.signal);
      await Promise.resolve();
      abort.abort();
      await pending;
    });
    expect(live.status).toBe('listening');
  } finally { await h.cleanup(); }
});

test('a repeated assistant press waits for cancelled audio startup to settle', async () => {
  const h = await harness();
  const originalStart = live.start;
  const originalStop = live.stop;
  let finish!: () => void;
  let starts = 0;
  let stops = 0;
  let first!: Promise<void>;
  let second!: Promise<void>;
  try {
    enabled = true;
    live.stop = () => { stops++; originalStop(); };
    live.start = async () => {
      starts++;
      if (starts === 1) await new Promise<void>((resolve) => { finish = resolve; });
    };
    const abort = new AbortController();
    await act(async () => { first = h.context().startAssistantVoice(abort.signal); });
    expect(starts).toBe(1);
    await act(async () => {
      abort.abort();
      second = h.context().startAssistantVoice(new AbortController().signal);
    });
    expect(stops).toBe(1);
    expect(starts).toBe(1);
    await act(async () => { finish(); await first; await second; });
    expect(starts).toBe(2);
  } finally { live.start = originalStart; live.stop = originalStop; await h.cleanup(); }
});

test('cancelling while the Hub preference response is pending cannot start audio later', async () => {
  const h = await harness();
  const originalRequest = mesh.request;
  let resolve!: (value: any) => void;
  let pending!: Promise<void>;
  let delayed = false;
  try {
    mesh.request = async (...args: Parameters<typeof originalRequest>) => {
      if (args[2] === 'live.settings.get' && !delayed) {
        delayed = true;
        return await new Promise((done) => { resolve = done; });
      }
      return await originalRequest(...args);
    };
    const abort = new AbortController();
    await act(async () => { pending = h.context().startAssistantVoice(abort.signal); });
    expect(resolve).toBeDefined();
    await act(async () => { abort.abort(); resolve({ enabled: true }); await pending; });
    expect(live.status).toBe('idle');
    expect(recorded).toBe(0);
  } finally { mesh.request = originalRequest; await h.cleanup(); }
});

async function executeProposalTool(request: any, callId: string, revision: string, targetId = COMPANION_PROPOSAL_TARGET_ID) {
  await act(async () => {
    emitRun(request, { type: 'tool_call', generation: 1, callId, tool: 'execute_proposal', args: {
      targetId, baseRevision: revision,
    } });
    await tick();
  });
}

test('mobile keeps drafts inert across completed turns and approval toggles, and checks execution revisions', async () => {
  let executions = 0;
  const h = await harness(false, async () => { executions++; return { ok: true, operations: [] }; });
  try {
    await act(async () => { await h.context().submitText('Draft a group'); });
    const request = calls.find((call) => call.operation === 'run.start')!.payload;
    await proposalTool(request, 'draft', '0', 'First');
    await executeProposalTool(request, 'review', '1');
    expect(calls.filter((call) => call.operation === 'tool.result').at(-1)!.payload.result)
      .toMatchObject({ applied: false, status: 'pending_review', revision: '1' });
    expect(executions).toBe(0);
    await act(async () => { emitRun(request, { type: 'status', status: 'completed' }); await tick(); });
    await act(async () => { await h.context().autoApproveSettings.save(true); await tick(); });
    expect(executions).toBe(0);
    await act(async () => { await h.context().submitText('Finish the group'); });
    const next = calls.filter((call) => call.operation === 'run.start').at(-1)!.payload;
    await proposalTool(next, 'revise', '1', 'Final');
    await executeProposalTool(next, 'stale', '1');
    expect(calls.filter((call) => call.operation === 'tool.result').at(-1)!.payload)
      .toMatchObject({ ok: false, error: 'STALE_PROPOSAL_REVISION' });
    await executeProposalTool(next, 'wrong-target', '2', 'wrong');
    expect(executions).toBe(0);
    await executeProposalTool(next, 'execute', '2');
    expect(executions).toBe(1);
  } finally { await h.cleanup(); }
});

test('mobile manages independent proposals and discards a failure without blocking another draft', async () => {
  const executed: any[] = [];
  const h = await harness(false, async proposal => {
    executed.push(proposal);
    return { ok: executed.length > 1, operations: proposal.operations.map(op => ({
      id: op.id, type: op.type, status: executed.length > 1 ? 'completed' : 'failed',
      ...(executed.length === 1 ? { error: 'Group already exists' } : {}),
    })) };
  }, true);
  try {
    await act(async () => { await h.context().submitText('Create two groups'); });
    const request = calls.find(call => call.operation === 'run.start')!.payload;
    let nextCall = 0;
    const tool = async (name: string, args: any) => {
      const callId = `multi-${++nextCall}`;
      await act(async () => {
        emitRun(request, { type: 'tool_call', generation: 1, callId, tool: name, args });
        await tick();
      });
      return calls.filter(call => call.operation === 'tool.result').at(-1)!.payload;
    };
    const a = (await tool('create_proposal', { title: 'First' })).result;
    const b = (await tool('create_proposal', { title: 'Second' })).result;
    expect(a.targetId).not.toBe(b.targetId);
    for (const [item, name] of [[a, 'First'], [b, 'Second']] as const) {
      expect((await tool('apply_proposal_patch', { targetId: item.targetId, baseRevision: '0',
        content: JSON.stringify({ version: 1, title: name, operations: [{ id: 'group', type: 'create_group', name }] }),
      })).ok).toBe(true);
    }
    expect(h.context().proposals).toHaveLength(2);
    expect(executed).toHaveLength(0);
    const failed = await tool('execute_proposal', { targetId: a.targetId, baseRevision: '1' });
    expect(failed.result).toMatchObject({ targetId: a.targetId, applied: true, execution: { ok: false } });
    expect((await tool('discard_proposal', { targetId: a.targetId, baseRevision: '1' })).result.discarded).toBe(true);
    expect(h.context().proposals.map(item => item.targetId)).toEqual([b.targetId]);
    const applied = await tool('execute_proposal', { targetId: b.targetId, baseRevision: '1' });
    expect(applied.result).toMatchObject({ targetId: b.targetId, applied: true, execution: { ok: true } });
    expect(executed.map(proposal => proposal.title)).toEqual(['First', 'Second']);
    expect(h.context().proposalHistory.map(item => item.execution.ok)).toEqual([false, true]);
    expect(h.context().proposals).toEqual([]);
  } finally { await h.cleanup(); }
});

test('manual review selects one proposal and agent discard needs no approval', async () => {
  const executed: any[] = [];
  const h = await harness(false, async proposal => {
    executed.push(proposal);
    return { ok: true, operations: proposal.operations.map(op => ({ id: op.id, type: op.type, status: 'completed' })) };
  });
  try {
    await act(async () => { await h.context().submitText('Prepare two choices'); });
    const request = calls.find(call => call.operation === 'run.start')!.payload;
    let nextCall = 0;
    const tool = async (name: string, args: any) => {
      await act(async () => {
        emitRun(request, { type: 'tool_call', generation: 1, callId: `choice-${++nextCall}`, tool: name, args });
        await tick();
      });
      return calls.filter(call => call.operation === 'tool.result').at(-1)!.payload.result;
    };
    const drafts = [];
    for (const title of ['Old request', 'New request']) {
      const draft = await tool('create_proposal', { title });
      await tool('apply_proposal_patch', { targetId: draft.targetId, baseRevision: '0',
        content: JSON.stringify({ version: 1, title, operations: [{ id: 'group', type: 'create_group', name: title }] }),
      });
      drafts.push(draft);
    }
    expect(await tool('execute_proposal', { targetId: drafts[1].targetId, baseRevision: '1' }))
      .toMatchObject({ applied: false, status: 'pending_review', targetId: drafts[1].targetId });
    expect(await tool('discard_proposal', { targetId: drafts[0].targetId, baseRevision: '1' }))
      .toMatchObject({ discarded: true });
    expect(executed).toEqual([]);
    expect(h.context().proposals).toHaveLength(1);
    await act(async () => { emitRun(request, { type: 'status', status: 'completed' }); });
    await act(async () => { await h.context().executeProposal(drafts[1].targetId, '1'); });
    expect(executed.map(proposal => proposal.title)).toEqual(['New request']);
    expect(calls.find(call => call.operation === 'proposal.result')!.payload.result)
      .toMatchObject({ targetId: drafts[1].targetId, revision: '1', autoApproved: false });
  } finally { await h.cleanup(); }
});


test('mobile reports unsupported JEV and explicitly selecting Live updates the shared mode', async () => {
  const h = await harness();
  try {
    enabled = true; voiceMode = 'jev';
    await act(async () => { await h.context().toggle(); });
    expect(h.context().error).toContain('JEV');
    expect(recorded).toBe(0); expect(live.hasStarted).toBe(false);
    await act(async () => { await h.context().liveSettings.load(); });
    expect(h.context().liveSettings.mode).toBe('jev');
    await act(async () => { await h.context().liveSettings.save(true); });
    expect(voiceMode).toBe('live');
    await act(async () => { await h.context().toggle(); });
    expect(live.hasStarted).toBe(true);
  } finally { await h.cleanup(); }
});

test('mirror voice commands control the phone without proposals and reject stale or foreign sessions', async () => {
  const originalRequest = mesh.request;
  const originalMute = live.toggleMute;
  mesh.request = async (...args: Parameters<typeof originalRequest>) => {
    const value = await originalRequest(...args);
    return args[2] === 'mirror.settings.get' || args[2] === 'mirror.publish' ? { enabled: true } : value;
  };
  live.muted = false;
  live.toggleMute = () => { live.muted = !live.muted; notifyLive(); };
  const h = await harness();
  try {
    enabled = true;
    await act(async () => { await h.context().toggle(); });
    await h.refresh();
    const publication = calls.filter(call => call.operation === 'mirror.publish').at(-1)!.payload;
    const command = async (action: string, sessionId = publication.sessionId, sourceDeviceId = 'hub') => {
      await act(async () => {
        for (const listener of listeners) listener({ sourceDeviceId, event: 'mirror.command', payload: {
          action, commandId: `voice-${++nextId}`, sessionId, proposalRevision: 0, expiresAt: Date.now() + 10_000,
        } });
        await tick();
      });
      await h.refresh();
    };
    await command('mute', 'stale'); expect(live.muted).toBe(false);
    await command('mute', publication.sessionId, 'other-hub'); expect(live.muted).toBe(false);
    await command('mute'); expect(live.muted).toBe(true);
    await command('mute'); expect(live.muted).toBe(true); // Explicit commands never toggle by accident.
    await command('unmute'); expect(live.muted).toBe(false);
    await command('pause'); expect(live.status).toBe('paused');
    await command('resume'); expect(live.status).toBe('listening');
    await command('end_voice'); expect(live.status).toBe('idle');
    expect(calls.some(call => call.operation === 'run.cancel')).toBe(false);
    await command('resume');
    expect(calls.filter(call => call.operation === 'mirror.result').at(-1)!.payload).toMatchObject({ ok: false, error: 'Voice is no longer paused.' });
  } finally { await h.cleanup(); mesh.request = originalRequest; live.toggleMute = originalMute; }
});


test('mobile voice settings follow changes from desktop without restarting the provider', async () => {
  const h = await harness();
  try {
    await act(async () => {
      for (const listener of listeners) listener({ sourceDeviceId: 'hub', event: 'live.settings.changed', payload: { enabled: true, mode: 'jev' } });
    });
    expect(h.context().liveSettings.enabled).toBe(true);
    expect(h.context().liveSettings.mode).toBe('jev');
    await act(async () => {
      for (const listener of listeners) listener({ sourceDeviceId: 'other-hub', event: 'live.settings.changed', payload: { enabled: false, mode: 'live' } });
    });
    expect(h.context().liveSettings.mode).toBe('jev');
  } finally { await h.cleanup(); }
});


test('large mirror snapshots disclose omissions and never send a truncated approval document', async () => {
  const { boundedSnapshot } = await import('../src/local-assistant/use-mobile-companion-mirror');
  const proposal = { version: 1 as const, title: 'Large proposal', operations: [{ id: 'send', type: 'send_message' as const, droneId: 'drone', message: 'X'.repeat(80_000) }] };
  const snapshot = { status: 'completed' as const, liveStatus: 'listening' as const,
    captions: '👋'.repeat(40_000), reply: 'Ready', error: '', proposal, proposalRevision: 1,
    proposalExecuting: false, proposalExecution: null, proposalDefaultRepoPath: '/repo', lastExecution: null,
    history: [{ proposal, execution: { ok: true, operations: [] }, defaultRepoPath: '/repo' }],
  };
  const bounded = boundedSnapshot(snapshot);
  expect(bounded.proposal).toBeNull();
  expect(bounded.reviewNotice).toContain('Review and approve it on the phone');
  expect(bounded.reviewNotice).toContain('Older executions');
  expect(new TextEncoder().encode(JSON.stringify(bounded)).length).toBeLessThan(240 * 1024);
  expect(snapshot.history).toHaveLength(1);
  expect(snapshot.proposal.operations[0].message).toHaveLength(80_000);
  const small = { ...snapshot, captions: 'Hi', history: [], proposal: { ...proposal, operations: [{ ...proposal.operations[0], message: 'Hello' }] } };
  expect(boundedSnapshot(small)).toEqual(small);
});


test('normal headset taps record/send, holds pause/resume, cancel discards, and reset closes context', async () => {
  const h = await harness();
  const previous = { ...voice };
  let sent = 0;
  let discarded = 0;
  try {
    live.shortcutArmed = true;
    live.updateRecordingControls = async () => {};
    voice.startRecording = async (_owner?: string, options?: { backgroundServiceArmed: boolean }) => {
      expect(options?.backgroundServiceArmed).toBe(true);
      recorded++;
      voice.session = { kind: 'companion', status: 'recording', microphoneAvailable: false };
      return true;
    };
    Object.assign(voice, { toggleRecordingPause: () => {
      voice.session = { ...voice.session, status: voice.session.status === 'paused' ? 'recording' : 'paused' };
    } });
    voice.stopRecordingForTranscript = async () => { sent++; voice.session = previous.session; return ''; };
    voice.discardRecording = async () => { discarded++; voice.session = previous.session; };
    const gesture = async (action: Parameters<typeof headsetCallbacks.recordingAction>[0]) => {
      await act(async () => { await headsetCallbacks.recordingAction(action); });
      await h.refresh();
    };
    await gesture('recording-tap');
    expect(recorded).toBe(1); expect(h.context().recordingPaused).toBe(false);
    await gesture('recording-hold');
    expect(h.context().recordingPaused).toBe(true);
    await gesture('recording-pause'); // A route-loss pause must not resume a paused recorder.
    expect(h.context().recordingPaused).toBe(true);
    await gesture('recording-resume');
    expect(h.context().recordingPaused).toBe(false);
    await gesture('recording-resume');
    expect(h.context().recordingPaused).toBe(false);
    await gesture('recording-hold');
    await gesture('recording-tap'); // Send also works while paused.
    expect(sent).toBe(1); expect(recorded).toBe(1);
    await gesture('recording-tap');
    await gesture('recording-cancel');
    expect(discarded).toBe(1); expect(sent).toBe(1);
    expect(h.context().overlayOpen).toBe(true);
    await gesture('recording-tap');
    await gesture('recording-reset');
    expect(h.context().overlayOpen).toBe(false);
    expect(h.context().reply).toBe(''); expect(h.context().transcript).toBe('');
    expect(sent).toBe(1);
  } finally {
    Object.assign(voice, previous); live.shortcutArmed = false;
    await h.cleanup();
  }
});


for (const source of ['headset', 'toolbar'] as const) test(`${source} discard rejects a late transcript and does not submit it`, async () => {
  const h = await harness();
  const previous = { ...voice };
  let resolve!: (text: string) => void;
  let pending!: Promise<void>;
  try {
    live.shortcutArmed = true;
    live.updateRecordingControls = async () => {};
    voice.session = { kind: 'companion', status: 'recording', microphoneAvailable: false };
    voice.stopRecordingForTranscript = async () => new Promise<string>(done => { resolve = done; });
    voice.discardRecording = async () => { voice.session = previous.session; };
    await h.refresh();
    voice.session = { kind: 'companion', status: 'recording', microphoneAvailable: false };
    await h.refresh();
    calls.length = 0;
    await act(async () => { pending = source === 'headset' ? headsetCallbacks.recordingAction('recording-tap') : h.context().toggle(); });
    await act(async () => {
      if (source === 'headset') await headsetCallbacks.recordingAction('recording-cancel');
      else await h.context().discardRecording();
    });
    await act(async () => { resolve('Do not submit this'); await pending; });
    expect(calls.some(call => call.operation === 'run.start' || call.operation === 'run.message')).toBe(false);
    expect(h.context().transcript).toBe('');
  } finally {
    Object.assign(voice, previous); live.shortcutArmed = false;
    await h.cleanup();
  }
});

test('ending headset controls during preference lookup prevents late recording startup', async () => {
  const h = await harness();
  const originalRequest = mesh.request;
  let resolve!: (value: any) => void;
  let pending!: Promise<void>;
  let delayed = false;
  try {
    live.shortcutArmed = true;
    live.updateRecordingControls = async () => {};
    await h.refresh();
    mesh.request = async (...args: Parameters<typeof originalRequest>) => {
      if (args[2] === 'live.settings.get' && !delayed) {
        delayed = true;
        return await new Promise(done => { resolve = done; });
      }
      return originalRequest(...args);
    };
    await act(async () => { pending = headsetCallbacks.recordingAction('recording-tap'); });
    expect(resolve).toBeDefined();
    await act(async () => { headsetCallbacks.ended(); resolve({ enabled: false }); await pending; });
    expect(recorded).toBe(0); expect(live.status).toBe('idle');
  } finally {
    mesh.request = originalRequest; live.shortcutArmed = false;
    await h.cleanup();
  }
});


test('normal recordings publish a mirror before any Live session has started', async () => {
  const originalRequest = mesh.request;
  mesh.request = async (...args: Parameters<typeof originalRequest>) => {
    const value = await originalRequest(...args);
    return args[2] === 'mirror.settings.get' || args[2] === 'mirror.publish' ? { enabled: true } : value;
  };
  const h = await harness();
  const previous = voice.session;
  try {
    voice.session = { kind: 'companion', status: 'recording', microphoneAvailable: false };
    await h.refresh();
    expect(live.hasStarted).toBe(false);
    let publication = calls.filter(call => call.operation === 'mirror.publish').at(-1)?.payload;
    expect(publication?.snapshot).toMatchObject({ status: 'recording', liveStatus: 'idle', voiceControls: false, recordingPaused: false });
    voice.session = { ...voice.session, status: 'paused' };
    await h.refresh();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    publication = calls.filter(call => call.operation === 'mirror.publish').at(-1)?.payload;
    expect(publication?.snapshot.recordingPaused).toBe(true);
  } finally {
    voice.session = previous;
    await h.cleanup(); mesh.request = originalRequest;
  }
});


test('switching from Live to normal text replaces stale Live mirror captions and controls', async () => {
  const originalRequest = mesh.request;
  mesh.request = async (...args: Parameters<typeof originalRequest>) => {
    const value = await originalRequest(...args);
    return args[2] === 'mirror.settings.get' || args[2] === 'mirror.publish' ? { enabled: true } : value;
  };
  const h = await harness();
  try {
    enabled = true;
    await act(async () => { await h.context().toggle(); });
    live.captions = 'Old Live transcript';
    await h.refresh();
    expect(live.hasStarted).toBe(true);
    await act(async () => { await h.context().submitText('New normal message'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    const published = calls.filter(call => call.operation === 'mirror.publish').at(-1)?.payload.snapshot;
    expect(published).toMatchObject({ voiceControls: false, liveStatus: 'idle', captions: 'New normal message' });
  } finally {
    live.captions = ''; await h.cleanup(); mesh.request = originalRequest;
  }
});

test('closing Companion stops the microphone before waiting for Hub cancellation', async () => {
  const originalRequest = mesh.request;
  const originalDiscard = voice.discardRecording;
  let release!: () => void;
  let discarded = false;
  let closing: Promise<void> | undefined;
  mesh.request = async (...args: Parameters<typeof originalRequest>) => {
    if (args[2] === 'run.cancel') await new Promise<void>(resolve => { release = resolve; });
    return originalRequest(...args);
  };
  voice.discardRecording = async () => { discarded = true; };
  const h = await harness();
  try {
    await act(async () => { await h.context().submitText('Start work'); });
    discarded = false;
    await act(async () => { closing = h.context().close(); });
    expect(release).toBeDefined();
    expect(discarded).toBe(true);
    await act(async () => { release(); await closing; });
  } finally {
    release?.(); await closing;
    await h.cleanup();
    mesh.request = originalRequest; voice.discardRecording = originalDiscard;
  }
});

test('cancelled normal conversation is not mirrored to a different Hub when switching targets', async () => {
  const originalRequest = mesh.request;
  const originalCapabilities = mesh.profile.capabilitiesByDevice;
  const published: { deviceId: string; snapshot: any }[] = [];
  mesh.request = async (...args: Parameters<typeof originalRequest>) => {
    const result = await originalRequest(...args);
    if (args[2] === 'mirror.publish') published.push({ deviceId: args[0], snapshot: args[3].snapshot });
    return args[2] === 'mirror.settings.get' || args[2] === 'mirror.publish' ? { enabled: true } : result;
  };
  const h = await harness();
  try {
    await act(async () => { await h.context().submitText('Private to first Hub'); });
    await act(async () => { await h.context().cancel(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    expect(published.some(item => item.deviceId === 'hub' && item.snapshot.captions === 'Private to first Hub')).toBe(true);
    mesh.profile.capabilitiesByDevice = { ...originalCapabilities, 'other-hub': [COMPANION_CAPABILITY] } as typeof originalCapabilities;
    h.switchHub();
    await h.refresh();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    expect(published.filter(item => item.deviceId === 'other-hub')).toEqual([]);
    expect(h.context().overlayOpen).toBe(false);
  } finally {
    await h.cleanup(); mesh.request = originalRequest; mesh.profile.capabilitiesByDevice = originalCapabilities;
  }
});
