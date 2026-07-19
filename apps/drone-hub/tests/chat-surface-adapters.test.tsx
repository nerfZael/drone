import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AgentChatTranscript,
  ChatLoadingState,
  ChatMessageBody,
  ChatSurface,
  ChatSurfaceComposer,
  adaptExternalAgentChatSurface,
  adaptNativeAgentChatSurface,
  type AgentChatSurfaceAdapter,
} from '../src/droneHub/chat';
import { AssistantMessageRow } from '../src/droneHub/assistant/AssistantTranscript';

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
    expect(html).toContain('>Stop<');
    expect(html).not.toContain('>Send<');
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
    expect(html).toContain('>Stop<');
    expect(html).toContain('>Send<');
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

  test('the shared composer renders structured model controls and menu actions', () => {
    const html = renderToStaticMarkup(
      <ChatSurface adapter={adaptExternalAgentChatSurface()}>
        <ChatSurfaceComposer
          resetKey="structured-controls"
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
    expect(html).toContain('Linked request');
    expect(html).toContain('#609');
    expect(html).not.toContain('&quot;type&quot;:&quot;drone-hub-task&quot;');
  });
});
