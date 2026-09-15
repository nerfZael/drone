import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import type { CompanionClientTransport, CompanionServerMessage } from '@drone/assistant-chat';
import { ActiveComposerProvider } from '../src/droneHub/chat/ActiveComposerContext';
import * as voiceModule from '../src/droneHub/chat/use-chat-voice-recorder';
import * as autoApproveModule from '../src/droneHub/companion/use-companion-auto-approve';
import * as transportModule from '../src/droneHub/companion/companion-websocket-transport';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';
import { CompanionOverlay } from '../src/droneHub/companion/CompanionOverlay';
import { CompanionWorkspaceProvider, useCompanionWorkspace } from '../src/droneHub/companion/CompanionWorkspaceContext';

for (const mode of ['auto', 'auto-failure', 'loading-auto', 'manual', 'loading-manual', 'load-error'] as const) {
  test(`proposal review visibility across draft, execution and completion (${mode})`, async () => {
    const dom = new Window({ url: 'http://localhost' });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    const set = (key: string, value: unknown) => {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    };
    set('window', dom); set('document', dom.document); set('IS_REACT_ACT_ENVIRONMENT', true);
    set('fetch', async () => Response.json({ enabled: false, systemPrompt: '', defaultSystemPrompt: '', maxSystemPromptChars: 8000 }));
    let settings = { enabled: mode.startsWith('auto'), loading: mode.startsWith('loading') || mode === 'load-error', saving: false, error: '', toggle: async () => {} };
    const settingsSpy = spyOn(autoApproveModule, 'useCompanionAutoApprove').mockImplementation(() => settings);
    const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue({
      status: 'idle', durationMillis: 0, startRecording: async () => true,
      discardRecording: async () => {}, toggleRecordingPause: () => {},
    } as ReturnType<typeof voiceModule.useChatVoiceRecorder>);
    let receive!: (message: CompanionServerMessage) => void;
    let messageId = '';
    const results: Parameters<CompanionClientTransport['sendToolResult']>[0][] = [];
    const transportSpy = spyOn(transportModule, 'createCompanionWebSocketTransport').mockReturnValue({
      open: async (input) => { receive = input.onMessage; },
      sendPrompt: (input) => { messageId = input.messageId; },
      sendToolResult: (input) => { results.push(input); },
      sendProposalResult: () => {}, cancel: () => {}, close: () => {},
    });
    const finish = Promise.withResolvers<void>();
    let executions = 0;
    let companion!: NonNullable<ReturnType<typeof useCompanion>>;
    const element = dom.document.createElement('div');
    dom.document.body.append(element);
    const root = createRoot(element as unknown as HTMLElement);
    const hiddenCommits: string[] = [];
    function Harness() {
      companion = useCompanion()!;
      useCompanionWorkspace()!.registerWorkspaceTarget({
        getAppContext: () => ({ activeRepoPath: '/repo' }),
        resolveDroneName: () => null, resolveDroneCreationDefaults: () => null,
        executeProposal: async (proposal) => {
          executions++;
          await finish.promise;
          return { ok: mode !== 'auto-failure', operations: proposal.operations.map(op => ({ id: op.id, type: op.type,
            ...(mode === 'auto-failure' ? { status: 'failed' as const, error: 'Execution failed' } : { status: 'completed' as const }),
          })) };
        },
        openDroneChat: () => ({}), highlightDrones: () => ({}),
      });
      // Inspect every committed frame, not just the DOM after async execution finishes.
      React.useLayoutEffect(() => {
        if (settings.enabled || settings.loading) hiddenCommits.push(element.innerHTML);
      });
      return <CompanionOverlay />;
    }
    const render = () => root.render(<ActiveComposerProvider><CompanionWorkspaceProvider><CompanionProvider><Harness /></CompanionProvider></CompanionWorkspaceProvider></ActiveComposerProvider>);
    let call = 0;
    const tool = async (name: string, args: Record<string, unknown>) => {
      await act(async () => {
        receive({ type: 'tool_call', messageId, generation: 1, callId: `call-${++call}`, tool: name, args } as CompanionServerMessage);
        for (let i = 0; i < 30; i++) await Promise.resolve();
      });
    };
    const expectReview = (visible: boolean) => {
      expect(Boolean(element.querySelector('[aria-label="Pending proposals"]'))).toBe(visible);
      expect(element.textContent!.includes('Apply proposal')).toBe(visible);
    };
    try {
      await act(async () => { render(); });
      await act(async () => { expect(await companion.submitText('Create a group')).toEqual({ ok: true }); });
      await tool('create_proposal', { title: 'Create group' });
      const targetId = (results.at(-1)!.result as { targetId: string }).targetId;
      expectReview(false);
      await tool('apply_proposal_patch', {
        targetId, baseRevision: '0',
        content: JSON.stringify({ version: 1, title: 'Create group', operations: [{ id: 'group', type: 'create_group', name: 'Reviewers' }] }),
      });
      // Force a committed draft frame before the separate execute tool arrives.
      expectReview(!settings.enabled && !settings.loading);
      expect(executions).toBe(0);
      if (settings.loading) {
        settings = { ...settings, loading: false, enabled: mode === 'loading-auto', error: mode === 'load-error' ? 'Could not load auto-approve setting' : '' };
        await act(async () => { render(); });
        expectReview(!settings.enabled);
        if (mode === 'load-error') expect(element.textContent).toContain(settings.error);
      }
      const autoApproved = settings.enabled;
      if (!autoApproved) {
        // Toggling the setting hides an existing selection immediately, then restores it.
        settings = { ...settings, enabled: true };
        await act(async () => { render(); });
        expectReview(false);
        settings = { ...settings, enabled: false };
        await act(async () => { render(); });
        expectReview(true);
      }
      if (!autoApproved) {
        await tool('create_proposal', { title: 'Discard group' });
        const discardId = (results.at(-1)!.result as { targetId: string }).targetId;
        await tool('apply_proposal_patch', { targetId: discardId, baseRevision: '0',
          content: JSON.stringify({ version: 1, title: 'Discard group', operations: [{ id: 'group', type: 'create_group', name: 'Later' }] }),
        });
        expectReview(true);
        await act(async () => { companion.selectProposal(discardId); });
        await act(async () => {
          [...element.querySelectorAll('button')].find(button => button.textContent === 'Discard')!.click();
        });
        expectReview(true);
        expect(companion.selectedProposalId).toBe(targetId);
        expect(executions).toBe(0);
      }
      await tool('execute_proposal', { targetId, baseRevision: '1' });
      if (!autoApproved) {
        expect(results.at(-1)).toMatchObject({ result: { status: 'pending_review' } });
        expect(executions).toBe(0);
        expectReview(true);
        await act(async () => { receive({ type: 'status', messageId, status: 'completed' }); });
        await act(async () => {
          const apply = [...element.querySelectorAll('button')].find(button => button.textContent?.includes('Apply proposal'))!;
          apply.click();
        });
      } else {
        expectReview(false);
      }
      expect(executions).toBe(1);
      expect(companion.proposalExecuting).toBe(true);
      if (!autoApproved) expect(element.textContent).toContain('Applying');
      await act(async () => { finish.resolve(); });
      expectReview(false);
      expect(companion.proposalHistory).toHaveLength(1);
      expect(companion.proposalHistory[0]!.autoApproved).toBe(autoApproved);
      expect(companion.proposalHistory[0]!.execution.ok).toBe(mode !== 'auto-failure');
      expect(hiddenCommits.length).toBeGreaterThan(0);
      for (const html of hiddenCommits) {
        expect(html).not.toContain('aria-label="Pending proposals"');
        expect(html).not.toContain('Apply proposal');
        expect(html).not.toContain('aria-label="Companion proposal');
      }
    } finally {
      await act(async () => { finish.resolve(); await companion?.close(); root.unmount(); });
      settingsSpy.mockRestore(); voiceSpy.mockRestore(); transportSpy.mockRestore();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      await dom.happyDOM.abort();
    }
  });
}
