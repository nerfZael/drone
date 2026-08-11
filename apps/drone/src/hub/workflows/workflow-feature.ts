import type { ServerResponse } from 'node:http';

import { getHubDatabase } from '../../host/hub-database';
import type { HubRouter } from '../hub-router';
import { registerWorkflowRoutes } from '../routes/workflow-routes';
import {
  createDroneWorkflowRunnerGateway,
  type DroneWorkflowRunnerGatewayDependencies,
} from './drone-workflow-runner-gateway';
import { WorkflowService } from './workflow-service';
import { WorkflowStore } from './workflow-store';

export type WorkflowFeatureDependencies = DroneWorkflowRunnerGatewayDependencies & {
  droneExists: (droneId: string) => Promise<boolean>;
  writeSseEvent: (res: ServerResponse, event: string, data: unknown) => void;
};

export async function registerWorkflowFeature(
  router: HubRouter,
  dependencies: WorkflowFeatureDependencies,
): Promise<(() => Promise<void>) | null> {
  const database = getHubDatabase();
  // Bun cannot currently load better-sqlite3. Keep the Hub's Bun-based API
  // tests usable, matching the compatibility behavior of other SQLite-backed
  // Hub features. Production runs on Node and still fails fast if SQLite is
  // unavailable.
  if (!database && (globalThis as { Bun?: unknown }).Bun) return null;

  const workflowRunnerGateway = createDroneWorkflowRunnerGateway(dependencies);
  const workflowService = new WorkflowService(
    WorkflowStore.open(database ?? undefined),
    workflowRunnerGateway,
    {
      droneExists: dependencies.droneExists,
    },
  );
  await workflowService.initialize();
  registerWorkflowRoutes(router, {
    service: workflowService,
    writeSseEvent: dependencies.writeSseEvent,
    nowIso: dependencies.nowIso,
  });
  return async () => await workflowService.stop();
}
