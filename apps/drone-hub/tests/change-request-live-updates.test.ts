import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

function source(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dir, relativePath), 'utf8');
}

describe('change request live updates', () => {
  test('subscribes to the native change request event stream without a refresh button', () => {
    const dock = source('../src/droneHub/changeRequests/DroneChangeRequestsDock.tsx');

    expect(dock).toContain('new window.EventSource(changeRequestEventsUrl(droneId))');
    expect(dock).toContain("events.addEventListener('change_request_changed', refresh)");
    expect(dock).not.toContain('Refresh change requests');
  });

  test('publishes change request mutations over SSE', () => {
    const routes = source('../../drone/src/hub/routes/change-request-routes.ts');

    expect(routes).toContain("'/api/change-requests/events'");
    expect(routes).toContain("'change_request_changed'");
    expect(routes).toContain('publishChange(request)');
  });

  test('keys lazy native diffs by revision and does not refresh the remote assessment on open', () => {
    const detail = source('../src/droneHub/changeRequests/ChangeRequestDetail.tsx');
    const changes = source('../src/droneHub/changes/DroneChangesDock.tsx');

    expect(detail).toContain('revisionKey: `${request.revision}:${request.snapshotSha ?? request.sourceHeadSha}`');
    expect(detail).not.toContain('refreshChangeRequestAssessment');
    expect(changes).toContain('reviewOverride.revisionKey');
    expect(changes).toContain('reviewDiffStateKey(selectedEntry.path');
  });
});
