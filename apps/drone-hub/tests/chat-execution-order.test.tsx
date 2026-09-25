import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { chatExecutionOrder } from '../src/droneHub/app/chat-execution-order';
import type { ChatTimelineGroup } from '../src/droneHub/app/chat-timeline-items';
import { EarlierRequestWorkingNotice } from '../src/droneHub/chat/ChatExecutionNotice';
import { SidebarItemStateIndicator, sidebarChatDisplayState, sidebarDroneStateLabel } from '../src/droneHub/overview/DroneCard';
import { pendingPromptShowsWorkingState } from '../src/droneHub/app/optimistic-pending-prompts';
import type { DroneSummary } from '../src/droneHub/types';

const groups: ChatTimelineGroup[] = [
  { primary: { kind: 'pending', item: {
    id: 'fps', prompt: 'Investigate FPS', at: '2026-09-25T00:00:00Z',
    state: 'sent', executionState: 'running', startedAt: '2026-09-25T00:26:19Z',
  } }, followUps: [] },
  { primary: { kind: 'turn', item: {
    id: 'crash', turn: 1, prompt: 'Create crash chat', at: '2026-09-25T00:14:00Z',
    startedAt: '2026-09-25T00:25:34Z', completedAt: '2026-09-25T00:26:18Z',
    deliveryMode: 'asap', output: 'Created', ok: true, session: '', logPath: '',
  } }, followUps: [] },
];

test('explains priority execution without reordering messages and locates the earlier active request', () => {
  const result = chatExecutionOrder(groups);
  expect(result.notes.get(1)).toContain('ASAP: started before an earlier queued request');
  expect(result.activeEarlier).toEqual({ id: 'fps', prompt: 'Investigate FPS' });
  expect(groups.map((group) => group.primary.item.id)).toEqual(['fps', 'crash']);
  const html = renderToStaticMarkup(<EarlierRequestWorkingNotice {...result.activeEarlier!} />);
  expect(html).toContain('Still working on an earlier request');
  expect(html).toContain('Investigate FPS');
});

test('does not claim queued work is currently running or invent an inversion in normal order', () => {
  const queued = structuredClone(groups);
  if (queued[0]!.primary.kind === 'pending') {
    queued[0]!.primary.item.executionState = 'queued';
    queued[0]!.primary.item.startedAt = undefined;
  }
  expect(chatExecutionOrder(queued).activeEarlier).toBeNull();
  const ordered = structuredClone(groups);
  ordered[0]!.primary.item.startedAt = '2026-09-25T00:01:00Z';
  expect(chatExecutionOrder(ordered).notes.size).toBe(0);
});

test('queued execution has a clock instead of a working spinner, with running taking precedence', () => {
  const drone = { statusOk: true } as DroneSummary;
  const state = sidebarChatDisplayState(drone, false, false, true);
  expect(state).toBe('queued');
  expect(sidebarDroneStateLabel(state, false)).toBe('Queued');
  const html = renderToStaticMarkup(<SidebarItemStateIndicator state={state} />);
  expect(html).toContain('data-sidebar-queued-indicator');
  expect(html).not.toContain('animate-spin');
  expect(sidebarChatDisplayState(drone, true, false, true)).toBe('working');
  expect(pendingPromptShowsWorkingState({ state: 'sent', executionState: 'queued' })).toBe(false);
  expect(pendingPromptShowsWorkingState({ state: 'sent', executionState: 'running' })).toBe(true);
});
