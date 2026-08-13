import crypto from 'node:crypto';

import type {
  ChangeRequestAssessment,
  ChangeRequestLineStats,
  ChangeRequestRecord,
} from './change-request-types';

export const CHANGE_REQUEST_DOMAIN_EVENT_TYPES = [
  'change_request.created',
  'change_request.updated',
  'change_request.merged',
  'change_request.closed',
] as const;

export type ChangeRequestDomainEventType = (typeof CHANGE_REQUEST_DOMAIN_EVENT_TYPES)[number];

export type ChangeRequestDomainEvent = {
  id: string;
  requestNumber: number;
  stateVersion: number;
  eventType: ChangeRequestDomainEventType;
  occurredAt: string;
  request: ChangeRequestRecord &
    Partial<ChangeRequestAssessment> & { lineStats?: ChangeRequestLineStats | null };
};

export function createChangeRequestDomainEvent(
  request: ChangeRequestRecord,
  eventType: ChangeRequestDomainEventType,
  occurredAt: string,
): ChangeRequestDomainEvent {
  return {
    id: crypto.randomUUID(),
    requestNumber: request.number,
    stateVersion: request.stateVersion,
    eventType,
    occurredAt,
    request,
  };
}

export function changeRequestEventTypeForStatus(
  status: ChangeRequestRecord['status'],
): Exclude<ChangeRequestDomainEventType, 'change_request.created'> {
  if (status === 'merged') return 'change_request.merged';
  if (status === 'closed') return 'change_request.closed';
  return 'change_request.updated';
}
