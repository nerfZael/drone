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

test('Live delegates through the existing backend with a fixed workspace and rejects an unresolved preference', async () => {
  const useLive = liveModule.useCompanionLive;
  let backend!: (prompt: string, signal: AbortSignal) => Promise<string>;
  let resolved = false;
  let started = 0;
  let recorded = 0;
  let reset = 0;
  let label = '';
  const liveSpy = spyOn(liveModule, 'useCompanionLive').mockImplementation(() => ({
    ...useLive(), loading: false, resolved, enabled: true,
    start: async (run, workspaceLabel) => { backend = run; label = workspaceLabel; started++; },
    reset: () => { reset++; },
  }));
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue({
    status: 'idle', durationMillis: 0, startRecording: async () => { recorded++; return true; },
    discardRecording: async () => {}, toggleRecordingPause: () => {},
  } as ReturnType<typeof voiceModule.useChatVoiceRecorder>);
  let receive!: (message: CompanionServerMessage) => void;
  const prompts: Parameters<CompanionClientTransport['sendPrompt']>[0][] = [];
  const results: Parameters<CompanionClientTransport['sendToolResult']>[0][] = [];
  const transportSpy = spyOn(transportModule, 'createCompanionWebSocketTransport').mockReturnValue({
    open: async (input) => { receive = input.onMessage; return undefined; },
    sendPrompt: (input) => { prompts.push(input); }, sendToolResult: (input) => { results.push(input); },
    cancel: () => {}, close: () => {},
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost' } } });
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  let repo = '/a';
  function Harness() {
    companion = useCompanion()!;
    useCompanionWorkspace()!.registerWorkspaceTarget({
      getAppContext: () => ({ activeRepoPath: repo, selectedChat: 'chat' }),
      resolveDroneName: () => null, resolveDroneCreationDefaults: () => null,
      executeProposal: async () => ({ ok: true, operations: [] }),
      openDroneChat: () => ({}), highlightDrones: () => ({}),
    });
    return null;
  }
  const render = () => renderToStaticMarkup(<ActiveComposerProvider><CompanionWorkspaceProvider><CompanionProvider><Harness /></CompanionProvider></CompanionWorkspaceProvider></ActiveComposerProvider>);
  try {
    render();
    await companion.toggle();
    expect(started).toBe(0);
    expect(recorded).toBe(0);
    await companion.close();
    resolved = true;
    render();
    await companion.toggle();
    expect(started).toBe(1);
    expect(label).toContain('/a');
    repo = '/b';
    const reply = backend('Find a chat.', new AbortController().signal);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(prompts[0].prompt).toBe('Find a chat.');
    receive({ type: 'tool_call', messageId: prompts[0].messageId, generation: 1,
      callId: 'context', tool: 'get_app_context', args: {} });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(results[0]).toMatchObject({ ok: true, result: { activeRepoPath: '/a' } });
    const followUp = backend('Actually, find a different chat.', new AbortController().signal);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(prompts).toHaveLength(2);
    expect(prompts[1].prompt).toBe('Actually, find a different chat.');
    receive({ type: 'reply', messageId: prompts[1].messageId, reply: 'Found the chat.' });
    receive({ type: 'status', messageId: prompts[1].messageId, status: 'completed' });
    expect(await followUp).toBe('Found the chat.');
    expect(await reply).toBe('Found the chat.');
    expect(recorded).toBe(0);
    await companion.close();
    expect(reset).toBe(2);
  } finally {
    await companion?.close();
    liveSpy.mockRestore(); voiceSpy.mockRestore(); transportSpy.mockRestore();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
