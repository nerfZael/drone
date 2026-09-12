import React from 'react';
import { expect, spyOn, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompanionClientTransport, CompanionServerMessage } from '@drone/assistant-chat';
import * as voiceModule from '../src/droneHub/chat/use-chat-voice-recorder';
import * as transportModule from '../src/droneHub/companion/companion-websocket-transport';
import * as liveModule from '../src/droneHub/companion/use-companion-live';
import { ActiveComposerProvider } from '../src/droneHub/chat/ActiveComposerContext';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';
import { CompanionWorkspaceProvider, useCompanionWorkspace } from '../src/droneHub/companion/CompanionWorkspaceContext';

test('recording origin survives pause, navigation, transcription, proposal creation, and a new recording', async () => {
  // SSR does not run the effect that loads the persisted mode. Simulate a loaded, disabled setting.
  const useLive = liveModule.useCompanionLive;
  const liveSpy = spyOn(liveModule, 'useCompanionLive').mockImplementation(() => ({ ...useLive(), loading: false, resolved: true }));
  let finishTranscript!: (text: string) => void;
  const voice = {
    status: 'idle' as ReturnType<typeof voiceModule.useChatVoiceRecorder>['status'],
    durationMillis: 1000,
    startRecording: async () => { voice.status = 'recording'; return true; },
    toggleRecordingPause: () => { voice.status = voice.status === 'paused' ? 'recording' : 'paused'; },
    discardRecording: async () => { voice.status = 'idle'; },
    stopRecordingForTranscript: async () => {
      voice.status = 'transcribing';
      const text = await new Promise<string>((resolve) => { finishTranscript = resolve; });
      voice.status = 'idle';
      return text;
    },
  };
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue(voice);
  let receive!: (message: CompanionServerMessage) => void;
  const prompts: Parameters<CompanionClientTransport['sendPrompt']>[0][] = [];
  const results: Parameters<CompanionClientTransport['sendToolResult']>[0][] = [];
  const proposalResults: Parameters<CompanionClientTransport['sendProposalResult']>[0][] = [];
  const transport: CompanionClientTransport = {
    open: async (input) => { receive = input.onMessage; return undefined; },
    sendPrompt: (input) => { prompts.push(input); },
    sendToolResult: (input) => { results.push(input); },
    sendProposalResult: (input) => { proposalResults.push(input); },
    cancel: () => {}, close: () => {},
  };
  const transportSpy = spyOn(transportModule, 'createCompanionWebSocketTransport').mockReturnValue(transport);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost' } } });
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  try {
    let workspace!: NonNullable<ReturnType<typeof useCompanionWorkspace>>;
    let repo = '/a';
    let executedRepo: string | undefined;
    function Harness() {
      companion = useCompanion()!;
      workspace = useCompanionWorkspace()!;
      workspace.registerWorkspaceTarget({
        getAppContext: () => ({ activeRepoPath: repo, selectedDrone: { id: repo }, selectedChat: repo + '-chat' }),
        resolveDroneName: () => null,
        resolveDroneCreationDefaults: () => null,
        executeProposal: async (_proposal, context) => {
          executedRepo = context.defaultRepoPath;
          return { ok: true, operations: [] };
        },
        openDroneChat: () => ({}), highlightDrones: () => ({}),
      });
      return null;
    }
    renderToStaticMarkup(<ActiveComposerProvider><CompanionWorkspaceProvider><CompanionProvider><Harness /></CompanionProvider></CompanionWorkspaceProvider></ActiveComposerProvider>);
    const tool = async (name: 'get_app_context' | 'apply_companion_proposal_patch', args = {}) => {
      receive({ type: 'tool_call', messageId: prompts.at(-1)!.messageId,
        generation: 1, callId: String(results.length), tool: name, args });
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(results.at(-1)).toMatchObject({ ok: true });
      return results.at(-1)?.result;
    };
    await companion.toggle(); // Record in A.
    repo = '/b';
    companion.toggleRecordingPause();
    companion.toggleRecordingPause();
    const sending = companion.toggle();
    repo = '/c'; // Navigate again while transcription is pending.
    finishTranscript('create a drone in this repo');
    await sending;
    expect(await tool('get_app_context')).toEqual({ activeRepoPath: '/a', selectedDrone: { id: '/a' }, selectedChat: '/a-chat' });
    await tool('apply_companion_proposal_patch', {
      targetId: 'companion-proposal', baseRevision: '0',
      content: JSON.stringify({ version: 1, title: 'Create drone', operations: [{ id: 'create', type: 'create_drone', prompt: 'hello' }] }),
    });
    await companion.executeProposal();
    expect(executedRepo).toBe('/a');
    expect(proposalResults).toHaveLength(1);
    expect(proposalResults[0]).toMatchObject({
      result: {
        applied: true,
        autoApproved: false,
        proposal: { title: 'Create drone' },
        execution: { ok: true },
      },
    });
    // A new transcription is submitted while the first backend request is still active.
    await companion.toggle(); // A fresh recording now captures C.
    repo = '/d';
    const next = companion.toggle();
    finishTranscript('which repo?');
    await next;
    expect(prompts).toHaveLength(2);
    expect(await tool('get_app_context')).toMatchObject({ activeRepoPath: '/c' });
    await companion.close();
    await companion.toggle();
    await companion.discardRecording();
    repo = '/e';
    await companion.toggle();
    const afterDiscard = companion.toggle();
    finishTranscript('which repo now?');
    await afterDiscard;
    expect(await tool('get_app_context')).toMatchObject({ activeRepoPath: '/e' });
    receive({ type: 'status', messageId: prompts.at(-1)!.messageId, status: 'completed' });
    const sendText = companion.prepareTextSubmission();
    repo = '/f';
    expect(await sendText('a dictated request')).toEqual({ ok: true });
    expect(await tool('get_app_context')).toMatchObject({ activeRepoPath: '/e' });
    receive({ type: 'status', messageId: prompts.at(-1)!.messageId, status: 'completed' });
    await companion.toggle();
    const cancelledTranscription = companion.toggle();
    const promptCount = prompts.length;
    await companion.close();
    finishTranscript('must not be submitted');
    await cancelledTranscription;
    expect(prompts).toHaveLength(promptCount);

    // A discarded microphone request can finish after a replacement recording starts.
    const immediateStart = voice.startRecording;
    let finishOldStart!: (started: boolean) => void;
    voice.startRecording = async () => {
      voice.status = 'starting';
      return await new Promise<boolean>((resolve) => { finishOldStart = resolve; });
    };
    const oldStart = companion.toggle();
    await companion.discardRecording();
    voice.startRecording = immediateStart;
    repo = '/replacement';
    await companion.toggle();
    finishOldStart(false);
    await oldStart;
    const replacement = companion.toggle();
    finishTranscript('use the replacement context');
    await replacement;
    expect(await tool('get_app_context')).toMatchObject({ activeRepoPath: '/replacement' });

    receive({ type: 'status', messageId: prompts.at(-1)!.messageId, status: 'completed' });
    const lateSend = companion.prepareTextSubmission();
    await companion.close();
    const beforeLateSend = prompts.length;
    expect(await lateSend('finished transcribing after close')).toMatchObject({ ok: false });
    expect(prompts).toHaveLength(beforeLateSend);

  } finally {
    await companion?.close();
    voiceSpy.mockRestore();
    transportSpy.mockRestore();
    liveSpy.mockRestore();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
