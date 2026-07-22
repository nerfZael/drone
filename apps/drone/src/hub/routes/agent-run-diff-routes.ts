import { agentRunDiffArtifactStatus, readAgentRunFileDiff } from '../agent-run-diff-artifacts';
import type { HubRouter } from '../hub-router';

export function registerAgentRunDiffRoutes(apiRouter: HubRouter): void {
  apiRouter.get('/api/agent-run-diffs/:artifactId/file', async ({ params, url, json: respond }) => {
    try {
      respond(200, {
        ok: true,
        diff: await readAgentRunFileDiff({
          artifactId: params.artifactId,
          path: url.searchParams.get('path') ?? '',
        }),
      });
    } catch (error: any) {
      respond(agentRunDiffArtifactStatus(error), {
        ok: false,
        error: String(error?.message ?? error ?? 'Unable to read historical diff.'),
      });
    }
  });
}
