import {
  ChangeRequestGithubMirrorService,
  type ChangeRequestGithubMirrorServiceDependencies,
} from './change-request-github-mirror-service';
import { ChangeRequestLifecycle } from './change-request-lifecycle';
import { ChangeRequestOperationLock } from './change-request-operation-lock';
import {
  ChangeRequestService,
  type ChangeRequestServiceDependencies,
} from './change-request-service';

export type ChangeRequestFeatureDependencies = Omit<
  ChangeRequestServiceDependencies,
  'githubMirrorLifecycle' | 'lifecycle' | 'operationLock'
> &
  Pick<ChangeRequestGithubMirrorServiceDependencies, 'github' | 'onGithubChanged'>;

export type ChangeRequestFeature = {
  service: ChangeRequestService;
  githubMirrorService: ChangeRequestGithubMirrorService;
};

export function createChangeRequestFeature(
  deps: ChangeRequestFeatureDependencies,
): ChangeRequestFeature {
  const { github, onGithubChanged, ...serviceDeps } = deps;
  const operationLock = new ChangeRequestOperationLock();
  const lifecycle = new ChangeRequestLifecycle({
    repository: serviceDeps.repository,
    deleteHostRefBestEffort: serviceDeps.deleteHostRefBestEffort,
    now: serviceDeps.now,
  });
  const githubMirrorService = new ChangeRequestGithubMirrorService({
    repository: serviceDeps.repository,
    runHostCommand: serviceDeps.runHostCommand,
    deleteHostRefBestEffort: serviceDeps.deleteHostRefBestEffort,
    now: serviceDeps.now,
    operationLock,
    lifecycle,
    github,
    onGithubChanged,
  });
  const service = new ChangeRequestService({
    ...serviceDeps,
    operationLock,
    lifecycle,
    githubMirrorLifecycle: githubMirrorService,
  });
  return { service, githubMirrorService };
}
