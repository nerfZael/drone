import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AgentChatTranscript,
  ChatLoadingState,
  ChatMessageBody,
  ChatSurface,
  ChatSurfaceComposer,
  ChatSurfaceLoadingView,
  adaptExternalAgentChatSurface,
  adaptNativeAgentChatSurface,
  stripRenderedMarkdownImages,
  type AgentChatSurfaceAdapter,
} from '../src/droneHub/chat';
import {
  AssistantMessageRow,
  AssistantQueuedPromptRow,
  AssistantWorkingRow,
  AssistantRunActivity,
  ToolRunActivity,
  formatAssistantRunDuration,
} from '../src/droneHub/assistant/AssistantTranscript';
import { buildNativeAgentComposerControls } from '../src/droneHub/assistant/native-agent-composer-controls';
import { resolveInlineMediaToggleState } from '../src/droneHub/chat/AgentMessageExtras';

const TRANSCRIPT_ITEMS = [
  { key: 'message', kind: 'message' as const, content: <div>Visible message</div> },
  { key: 'tool', kind: 'tool' as const, content: <div>Visible tool call</div> },
];

function renderComposer(adapter: AgentChatSurfaceAdapter) {
  return renderToStaticMarkup(
    <ChatSurface adapter={adapter}>
      <ChatSurfaceComposer
        resetKey="test-chat"
        droneName="Test agent"
        promptError={null}
        sending={false}
        waiting
        draftValue="Follow up"
        onDraftValueChange={() => {}}
        onStop={() => {}}
        onSend={async () => true}
      />
    </ChatSurface>,
  );
}

describe('agent chat surface adapters', () => {
  test('both agent types use the same centered conversation loader', () => {
    const loaderHtml = renderToStaticMarkup(<ChatLoadingState />);

    expect(loaderHtml).toContain('role="status"');
    expect(loaderHtml).toContain('Loading conversation…');
    expect(loaderHtml).toContain('animate-spin');
    expect(loaderHtml).toContain('h-11 w-11');
    expect(loaderHtml).toContain('!text-[.875rem]');
    expect(loaderHtml).toContain('!text-[var(--fg-secondary)]');
    expect(loaderHtml).toContain('font-medium');
    expect(loaderHtml).toContain('dh-type-status');
    expect(loaderHtml).not.toContain('uppercase');
    expect(loaderHtml).not.toContain('animate-pulse');

    for (const adapter of [adaptExternalAgentChatSurface(), adaptNativeAgentChatSurface()]) {
      const html = renderToStaticMarkup(
        <ChatSurface adapter={adapter}>
          <AgentChatTranscript
            loading
            hasContent={false}
            emptyState={null}
            items={TRANSCRIPT_ITEMS}
          />
        </ChatSurface>,
      );

      expect(html).toContain('Loading conversation…');
      expect(html).toContain('animate-spin');
      expect(html).not.toContain('Visible message');
    }
  });

  test('the loading view reserves the message bar while chat configuration resolves', () => {
    const html = renderToStaticMarkup(
      <ChatSurface adapter={adaptExternalAgentChatSurface()}>
        <ChatSurfaceLoadingView
          resetKey="loading-chat"
          droneName="Test agent"
          draftValue="Preserved draft"
          onDraftValueChange={() => {}}
          focusTargetId="loading-chat-input"
        />
      </ChatSurface>,
    );

    expect(html).toContain('Loading conversation…');
    expect(html).toContain('aria-label="Message Test agent"');
    expect(html).toContain('data-chat-input-focus-id="loading-chat-input"');
    expect(html).toContain('Preserved draft');
    expect(html).toContain('<textarea');
    expect(html).toContain('disabled=""');
  });

  test('external agents use image attachments without native tool activity', () => {
    const adapter = adaptExternalAgentChatSurface();
    const html = renderComposer(adapter);

    expect(adapter.capabilities).toEqual({
      attachments: 'images',
      sendWhileWaiting: true,
      toolActivity: 'hidden',
    });
    expect(html).toContain('data-agent-type="external"');
    expect(html).toContain('data-tool-activity="hidden"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('data-chat-composer-expanded="true"');
    expect(html).toContain('aria-label="Record voice message"');
    const microphoneButton = html.match(/<button[^>]*aria-label="Record voice message"[^>]*>/)?.[0];
    expect(microphoneButton).toBeDefined();
    expect(microphoneButton).not.toContain('disabled=""');
    expect(html).toContain('>Stop</button>');
    expect(html).toContain('aria-label="Send"');
  });

  test('native agents use files, send while running, and expose tool activity', () => {
    const adapter = adaptNativeAgentChatSurface();
    const html = renderComposer(adapter);

    expect(adapter.capabilities).toEqual({
      attachments: 'files',
      sendWhileWaiting: true,
      toolActivity: 'visible',
    });
    expect(html).toContain('data-agent-type="native"');
    expect(html).toContain('data-tool-activity="visible"');
    expect(html).not.toContain('accept="image/*"');
    expect(html).toContain('data-chat-composer-expanded="true"');
    expect(html).toContain('aria-label="Record voice message"');
    expect(html).toContain('>Stop</button>');
    expect(html).toContain('aria-label="Send"');
  });

  test('capabilities can be extended without adding agent checks to the surface', () => {
    const adapter = adaptExternalAgentChatSurface({
      attachments: 'files',
      sendWhileWaiting: true,
      toolActivity: 'visible',
    });

    expect(adapter.capabilities).toEqual({
      attachments: 'files',
      sendWhileWaiting: true,
      toolActivity: 'visible',
    });
  });

  test('the shared transcript hides tool items for external agents', () => {
    const html = renderToStaticMarkup(
      <ChatSurface adapter={adaptExternalAgentChatSurface()}>
        <AgentChatTranscript
          loading={false}
          hasContent
          emptyState={null}
          items={TRANSCRIPT_ITEMS}
        />
      </ChatSurface>,
    );

    expect(html).toContain('Visible message');
    expect(html).not.toContain('Visible tool call');
  });

  test('the shared transcript includes tool items for native agents', () => {
    const html = renderToStaticMarkup(
      <ChatSurface adapter={adaptNativeAgentChatSurface()}>
        <AgentChatTranscript
          loading={false}
          hasContent
          emptyState={null}
          items={TRANSCRIPT_ITEMS}
        />
      </ChatSurface>,
    );

    expect(html).toContain('Visible message');
    expect(html).toContain('Visible tool call');
  });

  test('the shared transcript compacts adjacent native tool activity', () => {
    const html = renderToStaticMarkup(
      <ChatSurface adapter={adaptNativeAgentChatSurface()}>
        <AgentChatTranscript
          loading={false}
          hasContent
          emptyState={null}
          items={[
            { key: 'message', kind: 'message', content: <div>Message</div> },
            { key: 'tool-a', kind: 'tool', content: <div>First tool</div> },
            { key: 'tool-b', kind: 'tool', content: <div>Second tool</div> },
          ]}
        />
      </ChatSurface>,
    );

    expect(html).toContain('data-transcript-item-kind="tool"');
    expect(html).toContain('class="-mt-5"');
  });

  test('the shared transcript identifies the latest visible activity', () => {
    const renderItems = () => [
      {
        key: 'message',
        kind: 'message' as const,
        content: ({ isLatestActivity }: { isLatestActivity: boolean }) => (
          <div data-message-latest={String(isLatestActivity)}>Message</div>
        ),
      },
      {
        key: 'tool',
        kind: 'tool' as const,
        content: ({ isLatestActivity }: { isLatestActivity: boolean }) => (
          <div data-tool-latest={String(isLatestActivity)}>Tool</div>
        ),
      },
      {
        key: 'invisible-message',
        kind: 'message' as const,
        latestActivityEligible: false,
        content: ({ isLatestActivity }: { isLatestActivity: boolean }) => (
          <div data-invisible-latest={String(isLatestActivity)}>Invisible</div>
        ),
      },
      { key: 'working', kind: 'status' as const, content: <div>Working</div> },
      { key: 'end', kind: 'sentinel' as const, content: <div>End</div> },
    ];
    const nativeHtml = renderToStaticMarkup(
      <ChatSurface adapter={adaptNativeAgentChatSurface()}>
        <AgentChatTranscript
          loading={false}
          hasContent
          emptyState={null}
          items={renderItems()}
        />
      </ChatSurface>,
    );
    const externalHtml = renderToStaticMarkup(
      <ChatSurface adapter={adaptExternalAgentChatSurface()}>
        <AgentChatTranscript
          loading={false}
          hasContent
          emptyState={null}
          items={renderItems()}
        />
      </ChatSurface>,
    );

    expect(nativeHtml).toContain('data-message-latest="false"');
    expect(nativeHtml).toContain('data-tool-latest="true"');
    expect(nativeHtml).toContain('data-invisible-latest="false"');
    expect(externalHtml).toContain('data-message-latest="true"');
    expect(externalHtml).not.toContain('data-tool-latest');
  });

  test('the shared composer renders structured model controls and menu actions', () => {
    const html = renderToStaticMarkup(
      <ChatSurface adapter={adaptExternalAgentChatSurface()}>
        <ChatSurfaceComposer
          resetKey="structured-controls"
          droneName="Test agent"
          promptError={null}
          sending={false}
          waiting={false}
          draftValue="Open controls"
          onDraftValueChange={() => {}}
          composerControls={{
            controls: [
              {
                kind: 'label',
                id: 'agent',
                value: 'Codex',
              },
              {
                kind: 'select',
                id: 'model',
                value: 'model-a',
                label: 'Model A',
                title: 'Choose model',
                entries: [{ value: 'model-a', label: 'Model A' }],
                onValueChange: () => {},
              },
            ],
            menuActions: [{ id: 'files', label: 'Thread files', onSelect: () => {} }],
          }}
          onSend={async () => true}
        />
      </ChatSurface>,
    );

    expect(html).toContain('Model A');
    expect(html).toContain('aria-label="Codex"');
    expect(html).toContain('Chat options');
    expect(html).not.toContain('Thread files');
  });

  test('the shared mobile-style model picker combines model and reasoning in one trigger', () => {
    const html = renderToStaticMarkup(
      <ChatSurface adapter={adaptNativeAgentChatSurface()}>
        <ChatSurfaceComposer
          resetKey="combined-model-picker"
          droneName="Test agent"
          promptError={null}
          sending={false}
          waiting={false}
          draftValue="Open controls"
          onDraftValueChange={() => {}}
          composerControls={{
            controls: [
              {
                kind: 'choice-picker',
                id: 'delivery',
                value: 'queue',
                title: 'Choose message delivery',
                sectionTitle: 'Delivery',
                options: [
                  { value: 'queue', label: 'Queue' },
                  { value: 'asap', label: 'ASAP' },
                ],
                onValueChange: () => {},
              },
              {
                kind: 'model-picker',
                id: 'model',
                currentProvider: 'codex',
                currentModel: 'gpt-5',
                currentThinkingLevel: 'medium',
                options: [
                  { provider: 'codex', id: 'gpt-5', name: 'GPT-5', thinkingLevel: 'medium' },
                ],
                onSelect: () => {},
              },
            ],
          }}
          onSend={async () => true}
        />
      </ChatSurface>,
    );

    expect(html).toContain('aria-label="Choose model and reasoning"');
    expect(html).toContain('aria-label="Choose message delivery"');
    expect(html).toContain('Queue');
    expect(html).toContain('5 Medium');
    expect(html).not.toContain('Built-in agent model');
  });

  test('the empty composer collapses to add, message, and microphone controls', () => {
    const html = renderToStaticMarkup(
      <ChatSurface adapter={adaptExternalAgentChatSurface()}>
        <ChatSurfaceComposer
          resetKey="collapsed-composer"
          droneName="Test agent"
          promptError={null}
          sending={false}
          waiting={false}
          composerControls={{
            controls: [
              {
                kind: 'select',
                id: 'model',
                value: 'model-a',
                label: 'Model A',
                title: 'Choose model',
                entries: [{ value: 'model-a', label: 'Model A' }],
                onValueChange: () => {},
              },
            ],
          }}
          onSend={async () => true}
        />
      </ChatSurface>,
    );

    expect(html).toContain('data-chat-composer-expanded="false"');
    expect(html).toContain('data-chat-composer-collapsed-action="true"');
    expect(html).toContain('aria-label="Attach images"');
    expect(html).toContain('aria-label="Record voice message"');
    expect(html).not.toContain('Model A');
    expect(html).not.toContain('aria-label="Send"');
  });

  test('native controls use shortcuts instead of a delivery picker', () => {
    const updates: Array<Record<string, unknown>> = [];
    const config = buildNativeAgentComposerControls({
      thread: {
        provider: 'codex',
        model: 'gpt-5',
        thinkingLevel: 'medium',
      } as any,
      models: [
        { provider: 'codex', id: 'gpt-5', name: 'GPT-5', reasoning: true, thinkingLevel: 'medium' },
        { provider: 'openai', id: 'o3', name: 'o3', reasoning: true, thinkingLevel: 'high' },
      ],
      defaultModel: undefined,
      busy: false,
      onUpdate: (patch) => updates.push(patch),
      onSetDefault: () => {},
    });

    expect(config.controls.map((control) => control.id)).toEqual([
      'native-model',
      'native-default-model',
    ]);
    const modelControl = config.controls.find((control) => control.id === 'native-model');
    expect(config.controls.some((control) => control.id === 'native-delivery')).toBe(false);
    expect(modelControl?.kind).toBe('model-picker');
    if (modelControl?.kind !== 'model-picker') throw new Error('Expected native model picker');
    expect(modelControl.options.map((option) => `${option.provider}:${option.id}`)).toContain('openai:o3');
    modelControl.onSelect(
      { provider: 'openai', id: 'o3', name: 'o3', thinkingLevel: 'high' },
      'model',
    );
    expect(updates.at(-1)).toEqual({ provider: 'openai', model: 'o3', thinkingLevel: 'high' });
    modelControl.onSelect(
      { provider: 'openai', id: 'o3', name: 'o3', thinkingLevel: 'medium' },
      'reasoning',
    );
    expect(updates.at(-1)).toEqual({ thinkingLevel: 'medium' });
  });

  test('native queued prompts identify ASAP priority', () => {
    const html = renderToStaticMarkup(
      <AssistantQueuedPromptRow
        prompt={{
          id: 'asap-prompt',
          prompt: 'Urgent follow-up',
          promptImages: [],
          imageCount: 0,
          createdAt: '2026-07-23T00:00:00.000Z',
          deliveryMode: 'asap',
          status: 'queued',
          error: null,
        }}
        cancelling={false}
        onCancel={() => {}}
      />,
    );

    expect(html).toContain('ASAP');
    expect(html).not.toContain('>Queued<');
  });

  test('the shared message body renders the same markdown and images for either controller', () => {
    const html = renderToStaticMarkup(
      <ChatMessageBody
        role="assistant"
        text="**Shared response**"
        images={[{ key: 'image', src: 'data:image/png;base64,AA==', alt: 'Attached image' }]}
      />,
    );

    expect(html).toContain('<strong>Shared response</strong>');
    expect(html).toContain('Attached image');
  });

  test('assistant message bodies leave inline media rendering to the media rail', () => {
    const text = [
      'Implemented the change.',
      '![Queued message footer inside the bubble](artifacts/queued-footer.png)',
      'Typecheck passes.',
    ].join('\n\n');
    const html = renderToStaticMarkup(
      <ChatMessageBody
        role="assistant"
        text={text}
        renderedInlineMediaHrefs={['artifacts/queued-footer.png']}
      />,
    );

    expect(stripRenderedMarkdownImages(text)).toBe('Implemented the change.\n\nTypecheck passes.');
    expect(html).toContain('Implemented the change.');
    expect(html).toContain('Typecheck passes.');
    expect(html).not.toContain('Queued message footer inside the bubble');
    expect(html).not.toContain('<img');
  });

  test('assistant message bodies keep images that are not represented by the media rail', () => {
    const text = [
      '![Rail image](artifacts/queued-footer.png)',
      '![Standalone image](https://example.com/render?id=standalone)',
    ].join('\n\n');
    const html = renderToStaticMarkup(
      <ChatMessageBody
        role="assistant"
        text={text}
        renderedInlineMediaHrefs={['artifacts/queued-footer.png']}
      />,
    );

    expect(html).not.toContain('Rail image');
    expect(html).toContain('alt="Standalone image"');
    expect(html).toContain('src="https://example.com/render?id=standalone"');
  });

  test('keeps image-looking Markdown examples inside code fences', () => {
    const text = ['```md', '![Screenshot](screenshot.png)', '```'].join('\n');
    expect(stripRenderedMarkdownImages(text)).toBe(text);
  });

  test('quoted chat blocks expose their own hover copy action', () => {
    const html = renderToStaticMarkup(
      <ChatMessageBody role="assistant" text="> Create a multi-shot prompt." />,
    );

    expect(html).toContain('dh-markdown-copyable-block group/markdown-block');
    expect(html).toContain('aria-label="Copy block"');
    expect(html).toContain('group-hover/markdown-block:opacity-100');
  });

  test('native assistant messages use shared tasks, linked requests, and inline media', () => {
    const html = renderToStaticMarkup(
      <AssistantMessageRow
        message={{
          id: 'native-message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: [
                'Implemented the change.',
                '![Screenshot](https://example.com/screenshot.png)',
                'PR: https://github.com/nerfZael/drone/pull/609',
                '{"type":"drone-hub-task","name":"Follow up","description":"Finish the remaining work."}',
              ].join('\n\n'),
            },
          ],
        }}
        messageExtras={{
          messageId: 'native-message',
          onCreateJobs: () => {},
          onSpawnTask: async () => ({ ok: true }),
          linkedPullRequestContext: {
            droneId: 'drone-a',
            repoPath: '/work/repo',
            repoAttached: true,
            disabled: true,
            openPullRequestsData: null,
            openPullRequestsLoading: false,
            openPullRequestsError: null,
          },
        }}
      />,
    );

    expect(html).toContain('Drone tasks');
    expect(html).toContain('Follow up');
    expect(html).toContain('screenshot.png');
    expect(html).toContain('aria-label="Hide inline media"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('pointer-events-none inline-flex');
    expect(html).toContain('group-hover:pointer-events-auto group-hover:opacity-100');
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain('Pull request');
    expect(html).toContain('#609');
    expect(html).not.toContain('&quot;type&quot;:&quot;drone-hub-task&quot;');
  });

  test('marks the inline media control active only while media is hidden', () => {
    expect(resolveInlineMediaToggleState(true)).toEqual({
      active: false,
      label: 'Hide inline media',
    });
    expect(resolveInlineMediaToggleState(false)).toEqual({
      active: true,
      label: 'Show inline media',
    });
  });

  test('native assistant messages make file references openable', () => {
    const html = renderToStaticMarkup(
      <AssistantMessageRow
        message={{
          id: 'native-file-reference',
          role: 'assistant',
          content: [{ type: 'text', text: 'See `README.md` for details.' }],
        }}
        messageExtras={{
          messageId: 'native-file-reference',
          onOpenFileReference: () => {},
        }}
      />,
    );

    expect(html).toContain('class="dh-inline-code-file-link"');
    expect(html).toContain('aria-label="Open file README.md"');
  });

  test('native chat uses unlabeled plain agent messages and compact user bubbles', () => {
    const assistantHtml = renderToStaticMarkup(
      <AssistantMessageRow
        message={{ id: 'plain-agent', role: 'assistant', content: 'A plain response.' }}
        messageExtras={{ messageId: 'plain-agent' }}
      />,
    );
    const userHtml = renderToStaticMarkup(
      <AssistantMessageRow message={{ id: 'plain-user', role: 'user', content: 'A prompt.' }} />,
    );
    const workingHtml = renderToStaticMarkup(<AssistantWorkingRow startedAt={Date.now() - 4_000} />);

    expect(assistantHtml).toContain('A plain response.');
    expect(assistantHtml).not.toContain('>Agent<');
    expect(assistantHtml).not.toContain('bg-[var(--accent-subtle)]');
    expect(assistantHtml).not.toContain('rounded-lg border px-4 py-3');
    expect(userHtml).toContain('bg-[var(--user-bubble)]');
    expect(userHtml).toContain('text-[var(--user-bubble-fg)]');
    expect(userHtml).not.toContain('>You<');
    expect(workingHtml).toContain('Working for 4s');
    expect(workingHtml).not.toContain('animate-pulse');
    expect(workingHtml).not.toContain('>Agent<');
  });

  test('user messages show remote file attachment metadata', () => {
    const html = renderToStaticMarkup(
      <AssistantMessageRow
        message={{
          id: 'remote-file',
          role: 'user',
          content: 'Review this file.',
          details: {
            attachments: [{ name: 'report.pdf', mime: 'application/pdf', size: 4096 }],
          },
        }}
      />,
    );

    expect(html).toContain('Review this file.');
    expect(html).toContain('report.pdf');
    expect(html).toContain('4.00 KB');
    expect(html).toContain('>File<');
  });

  test('active tool runs automatically show only their five latest calls', () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      type: 'tool' as const,
      key: `tool-${index + 1}`,
      call: { id: `call-${index + 1}`, name: `tool_${index + 1}`, args: {} },
    }));
    const html = renderToStaticMarkup(
      <ToolRunActivity items={items} active startedAt={Date.now() - 5_000} />,
    );

    expect(html).toContain('Working for');
    expect(html).toContain('7 tool calls');
    expect(html).toContain('text-[var(--muted)]');
    expect(html).not.toContain('bg-[var(--accent)]');
    expect(html).not.toContain('Tool 1');
    expect(html).not.toContain('Tool 2');
    expect(html).toContain('Tool 3');
    expect(html).toContain('Tool 7');
    expect(html.match(/data-tool-status="pending"/g)).toHaveLength(5);
    expect(html.match(/animate-spin/g)).toHaveLength(5);
    expect(html).not.toContain('data-tool-status="ok"');
    expect(html).not.toContain('overflow-y-auto');
    expect(html).not.toContain('uppercase');
    expect(html).not.toContain('bg-[var(--surface-soft)]');
    expect(html).not.toContain('rounded border');
    expect(html.match(/data-tool-activity-row/g)).toHaveLength(5);
    expect(html).not.toContain('data-agent-thinking');
  });

  test('active runs show thinking after their visible tools have settled', () => {
    const settledHtml = renderToStaticMarkup(
      <ToolRunActivity
        items={[
          {
            type: 'tool',
            key: 'settled-tool',
            call: { id: 'settled-call', name: 'read_file', args: {} },
            result: { role: 'toolResult', toolCallId: 'settled-call', content: 'Done' },
          },
        ]}
        active
        initiallyExpanded
      />,
    );
    const transferringHtml = renderToStaticMarkup(
      <ToolRunActivity
        items={[
          {
            type: 'tool',
            key: 'transfer-tool',
            call: { id: 'transfer-call', name: 'transfer_files', args: {} },
            result: {
              role: 'toolResult',
              toolCallId: 'transfer-call',
              content: 'Transferring',
              details: { type: 'workspace_transfer', phase: 'transferring' },
            },
          },
        ]}
        active
        initiallyExpanded
      />,
    );
    const groupedTransferringHtml = renderToStaticMarkup(
      <ToolRunActivity
        items={[1, 2].map((index) => ({
          type: 'tool' as const,
          key: `transfer-tool-${index}`,
          call: { id: `transfer-call-${index}`, name: 'transfer_files', args: {} },
          result: {
            role: 'toolResult' as const,
            toolCallId: `transfer-call-${index}`,
            content: 'Transferring',
            details: { type: 'workspace_transfer', phase: 'transferring' },
          },
        }))}
        active
        initiallyExpanded
      />,
    );
    const completedTransferHtml = renderToStaticMarkup(
      <ToolRunActivity
        items={[
          {
            type: 'tool',
            key: 'completed-transfer',
            call: { id: 'completed-transfer', name: 'transfer_files', args: {} },
            result: {
              role: 'toolResult',
              toolCallId: 'completed-transfer',
              content: 'Done',
            },
          },
        ]}
        active
        initiallyExpanded
      />,
    );
    const pendingApplyPatchHtml = renderToStaticMarkup(
      <ToolRunActivity
        items={[
          {
            type: 'tool',
            key: 'settled-read',
            call: { id: 'settled-read', name: 'read_file', args: {} },
            result: { role: 'toolResult', toolCallId: 'settled-read', content: 'Done' },
          },
          {
            type: 'tool',
            key: 'pending-apply-patch',
            call: { id: 'pending-apply-patch', name: 'apply_patch', args: {} },
          },
        ]}
        active
        initiallyExpanded
      />,
    );

    expect(settledHtml).toContain('data-agent-thinking');
    expect(settledHtml).toContain('role="status"');
    expect(settledHtml).toContain('Thinking…');
    expect(settledHtml).not.toContain('uppercase');
    expect(settledHtml).not.toContain('bg-[var(--surface-soft)]');
    expect(transferringHtml).not.toContain('data-agent-thinking');
    expect(groupedTransferringHtml).toContain('data-tool-status="pending"');
    expect(groupedTransferringHtml).not.toContain('data-tool-status="ok"');
    expect(groupedTransferringHtml).not.toContain('data-agent-thinking');
    expect(completedTransferHtml).toContain('data-tool-status="ok"');
    expect(completedTransferHtml).toContain('Complete');
    expect(completedTransferHtml).toContain('Transfer complete');
    expect(completedTransferHtml).not.toContain('Show details');
    expect(pendingApplyPatchHtml).toContain('Apply Patch');
    expect(pendingApplyPatchHtml).toContain('data-tool-status="pending"');
    expect(pendingApplyPatchHtml).not.toContain('data-agent-thinking');
  });

  test('active tool runs identify when approval is required', () => {
    const approvalStartedAt = Date.now() - 2_000;
    const html = renderToStaticMarkup(
      <ToolRunActivity
        items={[
          {
            type: 'tool',
            key: 'approval-tool',
            call: { id: 'approval-call', name: 'bash', args: {} },
          },
        ]}
        active
        awaitingApproval
        startedAt={approvalStartedAt - 3_000}
        approvalStartedAt={approvalStartedAt}
      />,
    );

    expect(html).toContain('Approval required');
    expect(html).toContain('Worked 3s · 1 tool call');
    expect(html).toContain('text-[var(--yellow)]');
    expect(html).toContain('data-tool-status="blocked"');
    expect(html).not.toContain('>Blocked</span>');
    expect(html).not.toContain('data-tool-status="pending"');
    expect(html).not.toContain('animate-spin');
    expect(html).not.toContain('Working for');
  });

  test('the latest native user message is expanded by default', () => {
    const html = renderToStaticMarkup(
      <AssistantMessageRow
        message={{
          id: 'latest-user',
          role: 'user',
          content: Array.from({ length: 45 }, (_, index) => `User line ${index + 1}`).join('\n'),
        }}
        autoExpandMessage
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('User line 45');
  });

  test('completed tool runs collapse to a precise duration summary', () => {
    const html = renderToStaticMarkup(
      <ToolRunActivity
        items={[
          {
            type: 'tool',
            key: 'completed-tool',
            call: { id: 'completed-call', name: 'read_file', args: {} },
          },
        ]}
        active={false}
        startedAt={1_000}
        endedAt={3_724_000}
      />,
    );

    expect(formatAssistantRunDuration(3_723_000)).toBe('1h 2m 3s');
    expect(formatAssistantRunDuration(62_992)).toBe('1m 2s');
    expect(html).toContain('Worked for 1h 2m 3s');
    expect(html).toContain('1 tool call');
    expect(html).toContain('class="flex min-h-9 w-full items-center gap-2');
    expect(html).toContain('text-sm font-[var(--weight-semibold)]');
    expect(html).toContain('text-xs text-[var(--muted-dim)]');
    expect(html).not.toContain('uppercase');
    expect(html).not.toContain('ml-auto');
    expect(html).not.toContain('Read file');
  });

  test('completed runs without tool calls still show their duration', () => {
    const html = renderToStaticMarkup(
      <AssistantRunActivity
        active={false}
        startedAt={1_000}
        endedAt={66_000}
      />,
    );

    expect(html).toContain('Worked for 1m 5s');
    expect(html).not.toContain('tool call');
  });

  test('auto-expanded tool runs retain counts inside the five-call window', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, index) => ({
        type: 'tool' as const,
        key: `read-${index}`,
        call: { id: `read-call-${index}`, name: 'read_file', args: {} },
      })),
      {
        type: 'tool' as const,
        key: 'search',
        call: { id: 'search-call', name: 'search_files', args: {} },
      },
      ...Array.from({ length: 2 }, (_, index) => ({
        type: 'tool' as const,
        key: `list-${index}`,
        call: { id: `list-call-${index}`, name: 'list_files', args: {} },
      })),
    ];
    const html = renderToStaticMarkup(
      <ToolRunActivity items={items} active initiallyExpanded />,
    );

    expect(html).toContain('8 tool calls');
    expect(html).toContain('Read file');
    expect(html).toContain('×2');
    expect(html).toContain('List files');
    expect(html).toContain('×2');
    expect(html.indexOf('Read file')).toBeLessThan(html.indexOf('×2'));
    expect(html.indexOf('List files')).toBeLessThan(html.lastIndexOf('×2'));
    expect(html).not.toContain('Complete');
    expect(html).not.toContain('>Details<');
    expect(html).not.toContain('uppercase');
    expect(html).not.toContain('bg-[var(--surface-soft)]');
  });
});
