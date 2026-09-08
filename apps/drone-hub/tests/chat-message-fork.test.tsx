import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMessageActions } from '../src/droneHub/chat/ChatMessageActions';
import { SideChatForkContext } from '../src/droneHub/chat/SideChatForkContext';
import { TranscriptTurn } from '../src/droneHub/chat/TranscriptTurn';
import { AssistantMessageRow } from '../src/droneHub/assistant/AssistantTranscript';
import { latestNativeCheckpointId } from '../src/droneHub/app/side-chat-checkpoint-model';
import { OPEN_SIDE_CHAT_EVENT, requestSideChat } from '../src/droneHub/app/side-chat-events';
import type { TranscriptItem } from '../src/droneHub/types';

describe('message fork actions', () => {
  test('places an accessible fork button after copy, pinned to the supplied earlier answer', () => {
    const html = renderScoped(
      <ChatMessageActions text="An earlier answer" checkpointId="earlier" />,
    );
    expect(html).toContain('aria-label="Fork into a side chat through this answer"');
    expect(html).toContain('data-fork-checkpoint-id="earlier"');
    expect(html.indexOf('aria-label="Copy message"')).toBeLessThan(
      html.indexOf('data-fork-checkpoint-id'),
    );
  });

  test('is copy-only for partial answers and outside a floating-chat workspace', () => {
    expect(renderScoped(<ChatMessageActions text="Streaming" />)).not.toContain(
      'data-fork-checkpoint-id',
    );
    expect(
      renderToStaticMarkup(<ChatMessageActions text="Answer" checkpointId="answer" />),
    ).not.toContain('data-fork-checkpoint-id');
  });

  test('disables forks with loading feedback during another side-chat operation', () => {
    const html = renderScoped(<ChatMessageActions text="Answer" checkpointId="answer" />, {
      busy: true,
    });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('animate-spin');
  });

  test('explains unsupported providers without disabling copy', () => {
    const html = renderScoped(<ChatMessageActions text="Answer" checkpointId="answer" />, {
      supported: false,
    });
    expect(html).toContain('Message forks are not supported for this agent');
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  test('the nested side-chat scope wins over the main chat scope', () => {
    const html = renderScoped(
      <SideChatForkContext.Provider
        value={{ droneId: 'drone', chatName: 'side-2', busy: false, supported: true }}
      >
        <ChatMessageActions text="Side answer" checkpointId="side-answer" />
      </SideChatForkContext.Provider>,
    );
    expect(html).toContain('data-fork-source-chat="side-2"');
    expect(html).not.toContain('data-fork-source-chat="main"');
  });

  test('external final responses use Hub turn IDs, including the detailed-activity renderer', () => {
    for (const detailed of [false, true]) {
      const item: TranscriptItem = {
        id: 'hub-checkpoint',
        turn: 1,
        at: '2026-09-07T10:00:00Z',
        prompt: 'Hello',
        session: 'external',
        logPath: '',
        ok: true,
        output: 'Final answer',
        ...(detailed
          ? {
              activity: {
                version: 1 as const,
                source: 'opencode' as const,
                updatedAt: '2026-09-07T10:00:00Z',
                messages: [
                  {
                    id: 'intermediate',
                    role: 'assistant' as const,
                    content: [{ type: 'text' as const, text: 'Working on it' }],
                  },
                  {
                    id: 'provider-final',
                    role: 'assistant' as const,
                    content: [{ type: 'text' as const, text: 'Final answer' }],
                  },
                ],
              },
            }
          : {}),
      };
      const html = renderScoped(<TranscriptTurn item={item} messageId="display-id" />);
      expect(html).toContain('data-fork-checkpoint-id="hub-checkpoint"');
      expect(html.match(/data-fork-checkpoint-id=/g)).toHaveLength(1);
      expect(html).not.toContain('data-fork-checkpoint-id="provider-final"');
    }
  });

  test('failed and user-only external turns cannot be forked', () => {
    for (const flags of [{ ok: false, error: 'Failed' }, { userOnly: true }]) {
      const html = renderScoped(
        <TranscriptTurn
          item={{
            id: 'invalid',
            turn: 1,
            at: '2026-09-07T10:00:00Z',
            prompt: 'Hello',
            session: 'external',
            logPath: '',
            ok: true,
            output: 'Not a checkpoint',
            ...flags,
          }}
          messageId="display-id"
        />,
      );
      expect(html).not.toContain('data-fork-checkpoint-id');
    }
  });

  test('native completed answers use their real message ID, not the display ID', () => {
    const message = {
      id: 'native-checkpoint',
      role: 'assistant' as const,
      stopReason: 'stop' as const,
      content: [{ type: 'text' as const, text: 'Native answer' }],
    };
    const html = renderScoped(
      <AssistantMessageRow
        message={message}
        forkCheckpointId={latestNativeCheckpointId([message])}
        messageExtras={{ messageId: 'display-id' }}
      />,
    );
    expect(html).toContain('data-fork-checkpoint-id="native-checkpoint"');
  });
});

describe('message fork event routing', () => {
  test('carries explicit chat and checkpoint IDs while leaving shortcut requests unchanged', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const received: CustomEvent[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent(event: CustomEvent) {
          received.push(event);
          event.preventDefault();
          return false;
        },
      },
    });
    try {
      expect(
        requestSideChat('drone', { sourceChatName: 'clicked-chat', checkpointId: 'old-answer' }),
      ).toBe(true);
      expect(received[0].type).toBe(OPEN_SIDE_CHAT_EVENT);
      expect(received[0].detail).toEqual({
        droneId: 'drone',
        target: { sourceChatName: 'clicked-chat', checkpointId: 'old-answer' },
      });
      expect(requestSideChat('drone')).toBe(true);
      expect(received[1].detail).toEqual({ droneId: 'drone' });
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
});

function renderScoped(
  children: React.ReactNode,
  overrides: { busy?: boolean; supported?: boolean } = {},
) {
  return renderToStaticMarkup(
    <SideChatForkContext.Provider
      value={{ droneId: 'drone', chatName: 'main', busy: false, supported: true, ...overrides }}
    >
      {children}
    </SideChatForkContext.Provider>,
  );
}
