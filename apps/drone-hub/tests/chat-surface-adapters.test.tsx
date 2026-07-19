import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ChatSurface,
  ChatSurfaceComposer,
  adaptExternalAgentChatSurface,
  adaptNativeAgentChatSurface,
  type AgentChatSurfaceAdapter,
} from '../src/droneHub/chat';

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
});
