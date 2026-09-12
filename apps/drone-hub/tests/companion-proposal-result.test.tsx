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

for (const outcome of ['success', 'partial-failure', 'throw'] as const) {
test(`auto-approved proposals return the actual ${outcome} inside the original tool call`, async () => {
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
  const finishExecution = Promise.withResolvers<void>();

  function Harness() {
    companion = useCompanion()!;
    useCompanionWorkspace()!.registerWorkspaceTarget({
      getAppContext: () => ({ activeRepoPath: '/repo' }),
      resolveDroneName: () => null,
      resolveDroneCreationDefaults: () => null,
      executeProposal: async (proposal) => {
        executions += 1;
        await finishExecution.promise;
        if (outcome === 'throw') throw new Error('Apply failed');
        return {
          ok: outcome === 'success',
          operations: proposal.operations.map((operation, index) => ({
            id: operation.id,
            type: operation.type,
            ...(outcome === 'partial-failure' && index === 1
              ? { status: 'failed' as const, error: 'Second operation failed' }
              : { status: 'completed' as const, result: { chatName: 'new-chat' } }),
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
      operations: [
        { id: 'create', type: 'create_chat', droneId: 'd1', chatName: 'new-chat' },
        { id: 'second', type: 'create_chat', droneId: 'd1', chatName: 'another-chat' },
      ],
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
    await Promise.resolve();
    expect(executions).toBe(1);
    expect(toolResults).toEqual([]);
    finishExecution.resolve();
    for (let attempt = 0; attempt < 30 && toolResults.length === 0; attempt += 1) {
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
        revision: '1',
        proposal,
        execution: {
          ok: outcome === 'success',
          operations: outcome === 'throw'
            ? [{ id: 'create', type: 'create_chat', status: 'failed', error: 'Apply failed' },
               { id: 'second', type: 'create_chat', status: 'skipped' }]
            : [{ id: 'create', type: 'create_chat', status: 'completed', result: { chatName: 'new-chat' } },
               outcome === 'partial-failure'
                 ? { id: 'second', type: 'create_chat', status: 'failed', error: 'Second operation failed' }
                 : { id: 'second', type: 'create_chat', status: 'completed', result: { chatName: 'new-chat' } }],
        },
      },
    });
  } finally {
    finishExecution.resolve();
    await companion.close();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    transportSpy.mockRestore();
    voiceSpy.mockRestore();
    autoApproveSpy.mockRestore();
  }
});
}
