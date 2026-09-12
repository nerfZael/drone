import React from 'react';
import { expect, spyOn, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompanionClientTransport, CompanionServerMessage } from '@drone/assistant-chat';

import { ActiveComposerProvider } from '../src/droneHub/chat/ActiveComposerContext';
import * as voiceModule from '../src/droneHub/chat/use-chat-voice-recorder';
import * as autoApproveModule from '../src/droneHub/companion/use-companion-auto-approve';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';
import * as transportModule from '../src/droneHub/companion/companion-websocket-transport';
import {
  CompanionWorkspaceProvider,
  useCompanionWorkspace,
} from '../src/droneHub/companion/CompanionWorkspaceContext';

test('auto-approved proposals execute inside the original tool call and return the actual result', async () => {
  const autoApproveSpy = spyOn(autoApproveModule, 'useCompanionAutoApprove').mockReturnValue({
    enabled: true,
    loading: false,
    saving: false,
    error: '',
    toggle: async () => {},
  });
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue({
    status: 'idle',
    durationMillis: 0,
    startRecording: async () => true,
    discardRecording: async () => {},
    toggleRecordingPause: () => {},
  } as ReturnType<typeof voiceModule.useChatVoiceRecorder>);
  let receive!: (message: CompanionServerMessage) => void;
  const prompts: Parameters<CompanionClientTransport['sendPrompt']>[0][] = [];
  const toolResults: Parameters<CompanionClientTransport['sendToolResult']>[0][] = [];
  const proposalResults: Parameters<CompanionClientTransport['sendProposalResult']>[0][] = [];
  const transport: CompanionClientTransport = {
    open: async (input) => { receive = input.onMessage; return undefined; },
    sendPrompt: (input) => { prompts.push(input); },
    sendToolResult: (input) => { toolResults.push(input); },
    sendProposalResult: (input) => { proposalResults.push(input); },
    cancel: () => {},
    close: () => {},
  };
  const transportSpy = spyOn(
    transportModule,
    'createCompanionWebSocketTransport',
  ).mockReturnValue(transport);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'http://localhost' } },
  });
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  let executions = 0;

  function Harness() {
    companion = useCompanion()!;
    useCompanionWorkspace()!.registerWorkspaceTarget({
      getAppContext: () => ({ activeRepoPath: '/repo' }),
      resolveDroneName: () => null,
      resolveDroneCreationDefaults: () => null,
      executeProposal: async (proposal) => {
        executions += 1;
        return {
          ok: true,
          operations: proposal.operations.map((operation) => ({
            id: operation.id,
            type: operation.type,
            status: 'completed' as const,
            result: { chatName: 'new-chat' },
          })),
        };
      },
      openDroneChat: () => ({}),
      highlightDrones: () => ({}),
    });
    return null;
  }

  try {
    renderToStaticMarkup(
      <ActiveComposerProvider>
        <CompanionWorkspaceProvider>
          <CompanionProvider><Harness /></CompanionProvider>
        </CompanionWorkspaceProvider>
      </ActiveComposerProvider>,
    );
    expect(await companion.submitText('Create a chat')).toEqual({ ok: true });
    const proposal = {
      version: 1,
      title: 'Create chat',
      operations: [{ id: 'create', type: 'create_chat', droneId: 'd1', chatName: 'new-chat' }],
    };
    receive({
      type: 'tool_call',
      messageId: prompts[0]!.messageId,
      generation: 1,
      callId: 'proposal-tool',
      tool: 'apply_companion_proposal_patch',
      args: {
        targetId: 'companion-proposal',
        baseRevision: '0',
        content: JSON.stringify(proposal),
      },
    });
    for (let attempt = 0; attempt < 20 && toolResults.length === 0; attempt += 1) {
      await Promise.resolve();
    }

    expect(executions).toBe(1);
    expect(proposalResults).toEqual([]);
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({
      ok: true,
      result: {
        applied: true,
        autoApproved: true,
        proposal,
        execution: {
          ok: true,
          operations: [{
            id: 'create',
            type: 'create_chat',
            status: 'completed',
            result: { chatName: 'new-chat' },
          }],
        },
      },
    });
  } finally {
    await companion.close();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    transportSpy.mockRestore();
    voiceSpy.mockRestore();
    autoApproveSpy.mockRestore();
  }
});
