import type { ServerResponse } from 'node:http';

import { getHubDatabase } from '../../host/hub-database';
import type { HubOutboxEvent } from '../../host/hub-outbox';
import type { HubRouter } from '../hub-router';
import { registerChangeRequestRoutes } from '../routes/change-request-routes';
import type { ChangeRequestDomainEvent } from './change-request-events';
import { changeRequestEventFromOutbox } from './change-request-outbox';
import { getChangeRequestRepository } from './change-request-repository';
import {
  createChangeRequestFeature,
  type ChangeRequestFeatureDependencies,
} from './create-change-request-feature';

export type RegisterChangeRequestFeatureDependencies = Omit<
  ChangeRequestFeatureDependencies,
  'repository'
> & {
  writeSseEvent: (res: ServerResponse, event: string, data: unknown) => void;
  nowIso: () => string;
  deliverEvent?: (event: ChangeRequestDomainEvent) => Promise<void>;
  log: (level: 'info' | 'warn', message: string, details?: Record<string, unknown>) => void;
};

export type RegisteredChangeRequestFeature = {
  handleOutboxEvent: (event: HubOutboxEvent) => Promise<boolean>;
  stop: () => Promise<void>;
};

export function registerChangeRequestFeature(
  apiRouter: HubRouter,
  dependencies: RegisterChangeRequestFeatureDependencies,
): RegisteredChangeRequestFeature {
  const database = getHubDatabase();
  if (!database) {
    registerChangeRequestRoutes(apiRouter, {
      service: null,
      githubMirrorService: null,
      writeSseEvent: dependencies.writeSseEvent,
      nowIso: dependencies.nowIso,
    });
    return {
      handleOutboxEvent: async () => false,
      stop: async () => {},
    };
  }

  const observers = new Set<(event: ChangeRequestDomainEvent) => void>();
  const repository = getChangeRequestRepository();
  const feature = createChangeRequestFeature({
    ...dependencies,
    repository,
  });
  const handleOutboxEvent = async (outboxEvent: HubOutboxEvent): Promise<boolean> => {
    const event = changeRequestEventFromOutbox(outboxEvent);
    if (!event) return false;
    let hydratedEvent = event;
    try {
      const view = await feature.service.get(event.requestNumber);
      if (view.stateVersion === event.stateVersion) {
        hydratedEvent = { ...event, request: { ...event.request, ...view } };
      }
    } catch (error) {
      dependencies.log('warn', 'change request event hydration failed', {
        eventId: event.id,
        requestNumber: event.requestNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await dependencies.deliverEvent?.(hydratedEvent);
    for (const observer of observers) {
      try {
        observer(hydratedEvent);
      } catch (error) {
        dependencies.log('warn', 'change request event observer failed', {
          eventId: event.id,
          requestNumber: event.requestNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return true;
  };
  registerChangeRequestRoutes(apiRouter, {
    service: feature.service,
    githubMirrorService: feature.githubMirrorService,
    writeSseEvent: dependencies.writeSseEvent,
    nowIso: dependencies.nowIso,
    subscribeToChanges: (observer) => {
      observers.add(observer);
      return () => observers.delete(observer);
    },
  });
  return {
    handleOutboxEvent,
    stop: async () => observers.clear(),
  };
}
