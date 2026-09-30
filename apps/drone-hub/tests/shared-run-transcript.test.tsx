import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderEventNotificationPrompt } from '@drone/assistant-chat';
import { buildChatTimelineItems, groupChatTimelineItems, groupedPendingPresentationItem } from '../src/droneHub/app/chat-timeline-items';
import { chatExecutionOrder } from '../src/droneHub/app/chat-execution-order';
import { timelineUserFollowUps } from '../src/droneHub/app/chat-timeline-follow-ups';
import { TranscriptTurn } from '../src/droneHub/chat/TranscriptTurn';
import { sameTranscriptItem } from '../src/droneHub/app/chat-api';
import type { PendingPrompt, TranscriptItem } from '../src/droneHub/types';

const original: PendingPrompt = {
  id: 'original', prompt: 'Unlock planning chat', at: '2026-09-28T18:45:11.049Z',
  state: 'sent', executionState: 'running', deliveryMode: 'queue',
  runId: 'original', runStartedAt: '2026-09-28T18:45:12.042Z', startedAt: '2026-09-28T18:45:12.042Z',
};
const queued: PendingPrompt = {
  id: 'clarification', prompt: 'Also change storyboard navigation', at: '2026-09-28T18:47:21.826Z',
  state: 'queued', deliveryMode: 'queue',
};
const answer: PendingPrompt = {
  ...original, id: 'answer', prompt: 'Review a second storyboard proposal', deliveryMode: 'asap',
  at: '2026-09-28T18:47:36.791Z', startedAt: '2026-09-28T18:47:37.910Z',
};
function completed(prompt: PendingPrompt, userOnly = false): TranscriptItem {
  return { ...prompt, turn: prompt.id === 'original' ? 1 : 2, session: '', logPath: '',
    promptAt: prompt.at, completedAt: '2026-09-28T18:54:39.117Z',
    ok: true, userOnly, output: userOnly ? '' : 'Implemented, uncommitted.' };
}

test('keeps accepted ASAP messages together before completion, after completion and after reload', () => {
  const active = groupChatTimelineItems(buildChatTimelineItems([], [original, queued, answer]));
  expect(active).toHaveLength(2);
  expect(active[0]!.followUps.map((entry) => entry.item.id)).toEqual(['answer']);
  expect(groupedPendingPresentationItem(active[0]!)!.startedAt).toBe(original.startedAt);

  const turns = [completed(original, true), completed(answer)];
  const followUp: PendingPrompt = { ...queued, state: 'sent', executionState: 'running',
    startedAt: '2026-09-28T18:54:43.685Z', runId: 'clarification' };
  for (const history of [turns, JSON.parse(JSON.stringify(turns))]) {
    const groups = groupChatTimelineItems(buildChatTimelineItems(history, [followUp]));
    expect(groups).toHaveLength(2);
    const group = groups[0]!;
    expect(group.primary.kind).toBe('turn');
    expect(group.primary.item).toMatchObject({ id: 'answer', prompt: original.prompt,
      at: original.at, startedAt: original.startedAt, userOnly: false, output: 'Implemented, uncommitted.' });
    expect(group.followUps.map((entry) => entry.item.id)).toEqual(['answer']);
    expect(groups[1]!.primary.item.id).toBe('clarification');
    expect(chatExecutionOrder(groups).activeEarlier).toBeNull();
    expect(chatExecutionOrder(groups).notes.size).toBe(0);
    if (group.primary.kind !== 'turn') throw new Error('missing completed response');
    const html = renderToStaticMarkup(<TranscriptTurn item={group.primary.item} messageId="answer"
      followUps={timelineUserFollowUps(group.followUps, { droneId: 'drone' })} />);
    expect(html).toContain(original.prompt);
    expect(html).toContain(answer.prompt);
    expect(html).toContain('Added to this run');
    expect(html).toContain('Worked for 9m 27s');
    expect(html).not.toContain('Worked for 7m 1s');
    expect(html.match(/Implemented, uncommitted\./g)).toHaveLength(1);
  }
  expect(turns[1]!.prompt).toBe(answer.prompt);
  expect(turns[1]!.startedAt).toBe(answer.startedAt);
});

test('does not merge a separate ASAP run, failed delivery, or delivered-but-queued work', () => {
  const independent = { ...answer, runId: 'other-run' };
  expect(groupChatTimelineItems(buildChatTimelineItems([], [original, independent]))).toHaveLength(2);
  for (const extra of [
    { ...answer, state: 'failed' as const, runId: undefined },
    { ...answer, state: 'sent' as const, executionState: 'queued' as const },
  ]) expect(groupChatTimelineItems(buildChatTimelineItems([], [original, extra]))).toHaveLength(2);
  const unknownQueued = { ...queued, state: 'sent' as const, executionState: 'queued' as const };
  const legacyOriginal = { ...original, runId: undefined };
  const legacyAnswer = { ...answer, runId: undefined };
  const groups = groupChatTimelineItems(buildChatTimelineItems([], [legacyOriginal, unknownQueued, legacyAnswer]));
  expect(groups[0]!.followUps.map((entry) => entry.item.id)).toEqual(['answer']);
  expect(groups[1]!.followUps).toHaveLength(0);
});

test('keeps multiple steering inputs and handles completion arriving in separate snapshots', () => {
  const last = { ...answer, id: 'last', prompt: 'Include staging', at: '2026-09-28T18:48:00Z' };
  const finishing = groupChatTimelineItems(buildChatTimelineItems([completed(original, true)], [queued, answer, last]));
  expect(finishing[0]!.primary.kind).toBe('pending');
  expect(finishing[0]!.primary.item.prompt).toBe(original.prompt);
  expect(finishing[0]!.followUps.map((entry) => entry.item.id)).toEqual(['answer', 'last']);
  const done = groupChatTimelineItems(buildChatTimelineItems([
    completed(original, true), completed(answer, true), completed(last),
  ], [queued]));
  expect(done[0]!.primary.item.id).toBe('last');
  expect(done[0]!.followUps.map((entry) => entry.item.id)).toEqual(['answer', 'last']);
});

test('retains response identity when the original is outside the loaded history page', () => {
  const groups = groupChatTimelineItems(buildChatTimelineItems([completed(answer)], []));
  expect(groups[0]!.primary.item.id).toBe('answer');
  expect(groups[0]!.primary.item.startedAt).toBe(original.startedAt);
  expect(groups[0]!.followUps).toHaveLength(0);
});

test('cache comparison notices shared run metadata arriving', () => {
  const turn = completed(answer);
  expect(sameTranscriptItem(turn, { ...turn, runId: undefined })).toBe(false);
  expect(sameTranscriptItem(turn, { ...turn, runStartedAt: undefined })).toBe(false);
});


test('keeps a failed shared run connected while retaining its error and recovery identity', () => {
  const failed: PendingPrompt = { ...answer, state: 'failed', error: 'stopped by user' };
  const groups = groupChatTimelineItems(buildChatTimelineItems([completed(original, true)], [failed]));
  expect(groups).toHaveLength(1);
  expect(groups[0]!.primary).toMatchObject({ kind: 'pending', item: {
    id: 'answer', state: 'failed', prompt: original.prompt, error: 'stopped by user',
  } });
  expect(groups[0]!.followUps.map((entry) => entry.item.id)).toEqual(['answer']);
});


test('keeps the completed question notification inside its original task with one final reply', () => {
  const notification = { ...answer, prompt: renderEventNotificationPrompt({ events: [{
    provider: 'drone-hub', resourceType: 'question_request', resourceId: 'storyboard',
    eventType: 'question_request.resolved', summary: 'The user submitted answers to your questions.',
    providerContent: { choice: 'Review a second storyboard proposal' },
  }] }) };
  const [group] = groupChatTimelineItems(buildChatTimelineItems([
    completed(original, true), completed(notification),
  ], [queued]));
  if (group!.primary.kind !== 'turn') throw new Error('missing final answer');
  const html = renderToStaticMarkup(<TranscriptTurn item={group!.primary.item} messageId="answer"
    followUps={timelineUserFollowUps(group!.followUps, { droneId: 'drone' })} />);
  expect(html).toContain(original.prompt);
  expect(html.match(/aria-label="Show event details"/g)).toHaveLength(1);
  expect(html.match(/Implemented, uncommitted\./g)).toHaveLength(1);
  expect(html.match(/Worked for/g)).toHaveLength(1);
  expect(html).not.toContain('&lt;dronehub_event_notification');
});
