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

  test('observes committed change request domain events over SSE', () => {
    const routes = source('../../drone/src/hub/routes/change-request-routes.ts');
    const service = source('../../drone/src/hub/change-requests/change-request-service.ts');
    const repository = source('../../drone/src/hub/change-requests/change-request-repository.ts');
    const events = source('../../drone/src/hub/change-requests/change-request-events.ts');

    expect(routes).toContain("'/api/change-requests/events'");
    expect(routes).toContain("'change_request_changed'");
    expect(routes).toContain('deps.subscribeToChanges?.((event) =>');
    expect(routes).not.toContain('publishChange');
    expect(service).toContain("'change_request.updated'");
    expect(repository).toContain('change_request_event_outbox');
    expect(repository).toContain('changeRequestEventTypeForStatus(changed.status)');
    expect(events).toContain("if (status === 'merged') return 'change_request.merged'");
    expect(events).toContain("if (status === 'closed') return 'change_request.closed'");
  });

  test('keys lazy native diffs by revision and does not refresh the remote assessment on open', () => {
    const detail = source('../src/droneHub/changeRequests/ChangeRequestDetail.tsx');
    const changes = source('../src/droneHub/changes/DroneChangesDock.tsx');

    expect(detail).toContain(
      'revisionKey: `${selectedRevisionNumber}:${changes?.revision.snapshotSha ?? request.snapshotSha ?? request.sourceHeadSha}`',
    );
    expect(detail).not.toContain('refreshChangeRequestAssessment');
    expect(changes).toContain('reviewOverride.revisionKey');
    expect(changes).toContain('reviewDiffStateKey(selectedEntry.path');
  });
});
