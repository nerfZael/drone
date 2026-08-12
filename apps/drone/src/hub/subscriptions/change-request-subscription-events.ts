import type {
  ChangeRequestDomainEvent,
  ChangeRequestDomainEventType,
} from '../change-requests/change-request-events';
import type { ChangeRequestView } from '../change-requests/change-request-types';
import type { ResourceEvent } from './resource-subscription-types';

export const CHANGE_REQUEST_SUBSCRIPTION_EVENTS = [
  'change_request.updated',
  'change_request.merged',
  'change_request.closed',
] as const;

export type ChangeRequestSubscriptionEventType =
  (typeof CHANGE_REQUEST_SUBSCRIPTION_EVENTS)[number];

export type ChangeRequestSubscriptionTarget = Pick<
  ChangeRequestView,
  'number' | 'stateVersion' | 'status' | 'droneId' | 'droneName' | 'title'
>;

export function normalizeChangeRequestSubscriptionId(raw: unknown): string {
  const value = String(raw ?? '')
    .trim()
    .replace(/^#/, '');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || String(number) !== value) {
    throw new Error('change request resource ID must be a positive integer');
  }
  return String(number);
}

export function changeRequestSubscriptionLabel(
  request: Pick<ChangeRequestSubscriptionTarget, 'number' | 'title'>,
): string {
  return `#${request.number} ${request.title}`.trim();
}

export function isChangeRequestSubscriptionEvent(
  eventType: ChangeRequestDomainEventType,
): eventType is ChangeRequestSubscriptionEventType {
  return CHANGE_REQUEST_SUBSCRIPTION_EVENTS.includes(
    eventType as ChangeRequestSubscriptionEventType,
  );
}

export function changeRequestSubscriptionEvent(event: ChangeRequestDomainEvent): ResourceEvent {
  if (!isChangeRequestSubscriptionEvent(event.eventType)) {
    throw new Error(`unsupported change request subscription event: ${event.eventType}`);
  }
  const request = event.request;
  return {
    id: event.id,
    providerEventId: `drone-hub:change-request:${event.requestNumber}:v${event.stateVersion}:${event.eventType}`,
    provider: 'drone-hub',
    resourceType: 'change_request',
    resourceId: String(event.requestNumber),
    parentResourceId: null,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    summary: changeRequestEventSummary(event.requestNumber, event.eventType),
    providerContent: {
      requestNumber: event.requestNumber,
      stateVersion: event.stateVersion,
      title: request.title,
      description: request.description,
      status: request.status,
      revision: request.revision,
      droneId: request.droneId,
      droneName: request.droneName,
      chatName: request.chatName,
      baseBranch: request.baseBranch,
      destinationBranch: request.destinationBranch,
      updatedAt: request.updatedAt,
      mergedAt: request.mergedAt,
      closedAt: request.closedAt,
      mergedBy: request.mergedBy,
      mergeCommitSha: request.mergeCommitSha,
      lastError: request.lastError,
      githubMirror: request.githubMirror,
      stale: request.stale,
      conflicted: request.conflicted,
      destinationExists: request.destinationExists,
      destinationSha: request.destinationSha,
      conflictFiles: request.conflictFiles,
      lineStats: request.lineStats ?? null,
    },
  };
}

function changeRequestEventSummary(
  requestNumber: number,
  eventType: ChangeRequestSubscriptionEventType,
): string {
  if (eventType === 'change_request.merged') return `Change request #${requestNumber} was merged.`;
  if (eventType === 'change_request.closed') return `Change request #${requestNumber} was closed.`;
  return `Change request #${requestNumber} was updated.`;
}
