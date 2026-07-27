import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChatMessageFrame } from '../src/droneHub/chat/ChatMessageFrame';

describe('ChatMessageFrame hover rail', () => {
  test('keeps an assistant timestamp and copy action together below the message', () => {
    const html = renderToStaticMarkup(
      <ChatMessageFrame
        role="assistant"
        at="2026-07-27T10:00:00.000Z"
        showRoleLabel={false}
        plainAssistant
        hoverActions={<button type="button">Copy</button>}
      >
        Finished.
      </ChatMessageFrame>,
    );

    expect(html).toContain('left-0 top-full z-10 mt-1 flex min-h-7 w-full');
    expect(html).toContain('justify-between');
    expect(html).toContain('text-[var(--chat-message-time)]');
    expect(html.indexOf('text-[var(--chat-message-time)]')).toBeLessThan(
      html.indexOf('>Copy</button>'),
    );
    expect(html).not.toContain('bottom-full right-0');
  });

  test('keeps the existing user timestamp and copy action rail above the bubble', () => {
    const html = renderToStaticMarkup(
      <ChatMessageFrame
        role="user"
        at="2026-07-27T10:00:00.000Z"
        showRoleLabel={false}
        hoverActions={<button type="button">Copy</button>}
      >
        Please continue.
      </ChatMessageFrame>,
    );

    expect(html).toContain('bottom-full right-0 z-10 mb-1 flex min-h-7');
    expect(html).toContain('text-[var(--chat-user-message-time)]');
    expect(html).not.toContain('left-0 top-full z-10');
  });
});
