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
  type AgentChatSurfaceAdapter,
} from '../src/droneHub/chat';
import {
  AssistantMessageRow,
  AssistantThinkingRow,
  ToolRunActivity,
  formatAssistantRunDuration,
} from '../src/droneHub/assistant/AssistantTranscript';
import { buildNativeAgentComposerControls } from '../src/droneHub/assistant/native-agent-composer-controls';

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
    expect(loaderHtml).toContain('!text-[.8125rem]');
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
      sendWhileWaiting: false,
      toolActivity: 'hidden',
    });
    expect(html).toContain('data-agent-type="external"');
    expect(html).toContain('data-tool-activity="hidden"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('data-chat-composer-expanded="false"');
    expect(html).toContain('aria-label="Record voice message"');
    expect(html).toContain('aria-label="Stop response"');
    expect(html).not.toContain('aria-label="Send"');
  });

  test('native agents use files, queue while running, and expose tool activity', () => {
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
    expect(html).toContain('data-chat-composer-expanded="false"');
    expect(html).toContain('aria-label="Record voice message"');
    expect(html).toContain('aria-label="Stop response"');
    expect(html).not.toContain('aria-label="Send"');
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

  test('the shared composer exposes the same automation controls for both agent types', () => {
    for (const adapter of [adaptExternalAgentChatSurface(), adaptNativeAgentChatSurface()]) {
      const html = renderToStaticMarkup(
        <ChatSurface adapter={adapter}>
          <ChatSurfaceComposer
            resetKey={`automations-${adapter.agentType}`}
            droneName="Test agent"
            promptError={null}
            sending={false}
            waiting={false}
            draftValue="Open controls"
            onDraftValueChange={() => {}}
            automationActions={[
              {
                id: 'automation-review',
                label: 'Run review',
                onSelect: () => {},
              },
            ]}
            onSend={async () => true}
            onSendAutomation={async () => true}
          />
        </ChatSurface>,
      );

      expect(html).toContain('Repeat');
      expect(html).toContain('Automations');
    }
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

  test('native delivery precedes one cross-provider model picker', () => {
    const updates: Array<Record<string, unknown>> = [];
    const config = buildNativeAgentComposerControls({
      thread: {
        provider: 'codex',
        model: 'gpt-5',
        thinkingLevel: 'medium',
        promptDeliveryMode: 'queue',
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
      'native-delivery',
      'native-model',
      'native-default-model',
    ]);
    const modelControl = config.controls.find((control) => control.id === 'native-model');
    const deliveryControl = config.controls.find((control) => control.id === 'native-delivery');
    expect(deliveryControl?.kind).toBe('choice-picker');
    if (deliveryControl?.kind !== 'choice-picker') throw new Error('Expected delivery picker');
    deliveryControl.onValueChange('asap');
    expect(updates.at(-1)).toEqual({ promptDeliveryMode: 'asap' });
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
    expect(html).toContain('Pull request');
    expect(html).toContain('#609');
    expect(html).not.toContain('&quot;type&quot;:&quot;drone-hub-task&quot;');
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
    const thinkingHtml = renderToStaticMarkup(<AssistantThinkingRow />);

    expect(assistantHtml).toContain('A plain response.');
    expect(assistantHtml).not.toContain('>Agent<');
    expect(assistantHtml).not.toContain('bg-[var(--accent-subtle)]');
    expect(assistantHtml).not.toContain('rounded-lg border px-4 py-3');
    expect(userHtml).toContain('bg-[var(--user-bubble)]');
    expect(userHtml).toContain('text-[var(--user-bubble-fg)]');
    expect(userHtml).not.toContain('>You<');
    expect(thinkingHtml).not.toContain('>Agent<');
  });

  test('active tool runs stay collapsed as one live summary by default', () => {
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
    expect(html).not.toContain('text-[var(--accent)]');
    expect(html).not.toContain('Tool 1');
    expect(html).not.toContain('Tool 2');
    expect(html).not.toContain('Tool 3');
    expect(html).not.toContain('Tool 7');
    expect(html).not.toContain('overflow-y-auto');
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

  test('expanded tool runs retain consecutive same-tool counts', () => {
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
    expect(html).toContain('x5');
    expect(html).toContain('List files');
    expect(html).toContain('x2');
    expect(html.indexOf('Read file')).toBeLessThan(html.indexOf('x5'));
    expect(html.indexOf('List files')).toBeLessThan(html.indexOf('x2'));
    expect(html).not.toContain('Complete');
    expect(html).not.toContain('>Details<');
  });
});
