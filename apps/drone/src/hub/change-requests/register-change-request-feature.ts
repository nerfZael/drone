import { getHubDatabase } from '../../host/hub-database';
import type { HubRouter } from '../hub-router';
import { registerChangeRequestRoutes } from '../routes/change-request-routes';
import { getChangeRequestRepository } from './change-request-repository';
import {
  createChangeRequestFeature,
  type ChangeRequestFeatureDependencies,
} from './create-change-request-feature';

export type RegisterChangeRequestFeatureDependencies = Omit<
  ChangeRequestFeatureDependencies,
  'repository'
>;

export function registerChangeRequestFeature(
  apiRouter: HubRouter,
  dependencies: RegisterChangeRequestFeatureDependencies,
): void {
  const database = getHubDatabase();
  if (!database) {
    registerChangeRequestRoutes(apiRouter, { service: null, githubMirrorService: null });
    return;
  }

  const feature = createChangeRequestFeature({
    ...dependencies,
    repository: getChangeRequestRepository(),
  });
  registerChangeRequestRoutes(apiRouter, {
    service: feature.service,
    githubMirrorService: feature.githubMirrorService,
  });
}
