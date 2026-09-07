import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderEventNotificationPrompt } from '@drone/assistant-chat';
import { PendingTranscriptTurn } from '../src/droneHub/chat/PendingTranscriptTurn';
import { AssistantQueuedPromptRow } from '../src/droneHub/assistant/AssistantTranscript';

const prompt = renderEventNotificationPrompt({
  userMessage: 'Please review both changes.',
  events: ['1', '2'].map((id) => ({
    provider: 'github',
    resourceType: 'pull_request',
    resourceId: `org/repo#${id}`,
    eventType: 'pull_request.merged',
    summary: `Merged ${id}`,
  })),
});

test('pending bundles show human text, event count, and a message-only removal action', () => {
  const markup = renderToStaticMarkup(
    <PendingTranscriptTurn
      item={{ id: 'e1', at: new Date().toISOString(), prompt, state: 'queued' }}
      onCancelQueued={() => {}}
      cancelBusy
    />,
  );
  expect(markup).toContain('Please review both changes.');
  expect(markup).toContain('1 message + 2 events');
  expect(markup).toContain('Remove message; keep events');
  expect(markup).toContain('disabled');
  expect(markup).not.toContain('dronehub_event_notification');
});

test('native queued bundles show the same content and events cannot be removed by the message button', () => {
  const row = {
    id: 'e1',
    prompt,
    createdAt: new Date().toISOString(),
    status: 'queued' as const,
    imageCount: 0,
    promptImages: [],
  };
  const markup = renderToStaticMarkup(
    <AssistantQueuedPromptRow prompt={row} cancelling={false} onCancel={() => {}} />,
  );
  expect(markup).toContain('1 message + 2 events');
  expect(markup).toContain('Remove message; keep events');
  const eventOnly = renderEventNotificationPrompt({
    events: [
      {
        provider: 'github',
        resourceType: 'pull_request',
        resourceId: '1',
        eventType: 'pull_request.merged',
        summary: 'Merged',
      },
    ],
  });
  const noHuman = renderToStaticMarkup(
    <AssistantQueuedPromptRow
      prompt={{ ...row, prompt: eventOnly }}
      cancelling={false}
      onCancel={() => {}}
    />,
  );
  expect(noHuman).not.toContain('Cancel queued prompt');
});
