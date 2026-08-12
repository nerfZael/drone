import type { ServerResponse } from 'node:http';

import { getHubDatabase } from '../../host/hub-database';
import type { HubRouter } from '../hub-router';
import { registerChangeRequestRoutes } from '../routes/change-request-routes';
import { ChangeRequestEventDispatcher } from './change-request-event-dispatcher';
import type { ChangeRequestDomainEvent } from './change-request-events';
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

export function registerChangeRequestFeature(
  apiRouter: HubRouter,
  dependencies: RegisterChangeRequestFeatureDependencies,
): () => Promise<void> {
  const database = getHubDatabase();
  if (!database) {
    registerChangeRequestRoutes(apiRouter, {
      service: null,
      githubMirrorService: null,
      writeSseEvent: dependencies.writeSseEvent,
      nowIso: dependencies.nowIso,
    });
    return async () => {};
  }

  const repository = getChangeRequestRepository();
  const feature = createChangeRequestFeature({
    ...dependencies,
    repository,
  });
  const dispatcher = new ChangeRequestEventDispatcher({
    repository,
    hydrate: async (event) => {
      const view = await feature.service.get(event.requestNumber);
      return view.stateVersion === event.stateVersion
        ? { ...event, request: { ...event.request, ...view } }
        : event;
    },
    deliver: dependencies.deliverEvent ?? (async () => {}),
    now: dependencies.nowIso,
    log: dependencies.log,
  });
  registerChangeRequestRoutes(apiRouter, {
    service: feature.service,
    githubMirrorService: feature.githubMirrorService,
    writeSseEvent: dependencies.writeSseEvent,
    nowIso: dependencies.nowIso,
    subscribeToChanges: (observer) => dispatcher.subscribe(observer),
  });
  dispatcher.start();
  return async () => await dispatcher.stop();
}
