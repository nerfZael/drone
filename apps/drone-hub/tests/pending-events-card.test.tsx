import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { PendingEventsCard } from '../src/droneHub/chat/PendingEventsCard';
import {
  pendingEventStatus,
  questionPendingDeliveryStatus,
  type PendingEvent,
  type PendingEventsState,
} from '../src/droneHub/chat/use-pending-events';

const at = '2026-09-10T10:00:00.000Z';
const event: PendingEvent = {
  id: 'answer',
  resourceId: 'questions-1',
  resourceType: 'question_request',
  eventType: 'question_request.resolved',
  summary: 'The user submitted answers to your questions.',
  deliveryMode: 'queue',
  status: 'batching',
  releaseAt: '2026-09-10T10:00:08.000Z',
  canRelease: true,
  error: null,
};
const state: PendingEventsState = {
  deliveries: [event],
  serverNow: at,
  receivedAt: Date.now(),
  error: null,
  stale: false,
  busy: false,
  release: () => {},
};

describe('pending events', () => {
  test('groups queued and ASAP events with summaries and distinct send actions', () => {
    const html = renderToStaticMarkup(
      <PendingEventsCard
        state={{ ...state, deliveries: [event, { ...event, id: 'asap', deliveryMode: 'asap' }] }}
      />,
    );
    expect(html).toContain('2 pending events');
    expect(html).toContain('Queued delivery');
    expect(html).toContain('ASAP delivery');
    expect(html).toContain('Send queued events now');
    expect(html).toContain('Send ASAP events now');
    expect(html).toContain('<details');
    expect(html).toContain(event.summary);
    expect(html).toContain('Next release in ~8s');
  });

  test('countdown ends with waiting for release, never a promise of an agent response', () => {
    expect(pendingEventStatus(event, Date.parse(at))).toBe('Next release in ~8s');
    expect(pendingEventStatus(event, Date.parse(at) + 9_000)).toBe('Waiting for release');
    expect(pendingEventStatus({ ...event, status: 'paused' }, Date.parse(at))).toBe(
      'Delivery paused',
    );
    expect(pendingEventStatus({ ...event, status: 'rate-limited' }, Date.parse(at))).toBe(
      'Waiting for run limit',
    );
    expect(pendingEventStatus({ ...event, status: 'retrying' }, Date.parse(at))).toBe(
      'Retry in ~8s',
    );
  });

  test('unavailable status disables release and hides stale countdowns', () => {
    const html = renderToStaticMarkup(
      <PendingEventsCard state={{ ...state, stale: true, error: 'Offline' }} />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('Status unavailable');
    expect(html).not.toContain('Next release');
    expect(html).toContain('Offline');
  });

  test('question result status tracks its own event and clears after handoff', () => {
    expect(questionPendingDeliveryStatus(state, 'questions-1')).toBe('Pending delivery');
    expect(questionPendingDeliveryStatus(state, 'another-question')).toBeUndefined();
    expect(
      questionPendingDeliveryStatus({ ...state, deliveries: [] }, 'questions-1'),
    ).toBeUndefined();
    expect(
      questionPendingDeliveryStatus(
        { ...state, deliveries: [{ ...event, status: 'failed' }] },
        'questions-1',
      ),
    ).toBe('Delivery failed');
  });

  test('empty pending state does not add a transcript card', () => {
    expect(renderToStaticMarkup(<PendingEventsCard state={{ ...state, deliveries: [] }} />)).toBe(
      '',
    );
  });
});
