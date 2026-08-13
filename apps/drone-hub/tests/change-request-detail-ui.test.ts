import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('change request presentation', () => {
  test('defaults the list to open requests', () => {
    const dock = source('../src/droneHub/changeRequests/DroneChangeRequestsDock.tsx');

    expect(dock).toContain("React.useState<ChangeRequestFilter>('open')");
    expect(dock).toContain("setStatusFilter('open')");
  });

  test('opens linked requests from their title and uses pull-request-style state pills', () => {
    const cards = source('../src/droneHub/chat/LinkedChangeRequestCards.tsx');

    expect(cards).toContain('data-change-request-state="merged"');
    expect(cards).toContain('<MergedChangeRequestIcon />');
    expect(cards).toContain('changeRequestStatePillClassName(status)');
    expect(cards).toContain('title={`Open ${title}`}');
    expect(cards).not.toContain('Open in change requests');
  });

  test('keeps native review selection isolated from pull-request navigation state', () => {
    const changes = source('../src/droneHub/changes/DroneChangesDock.tsx');

    expect(changes).toContain(
      "React.useEffect(() => {\n    if (reviewOverride) return;\n    if (fixedContextMode === 'branch')",
    );
  });

  test('offers overview and files-changed tabs for native and GitHub requests', () => {
    const detail = source('../src/droneHub/changeRequests/ChangeRequestDetail.tsx');
    const changes = source('../src/droneHub/changes/DroneChangesDock.tsx');
    const github = source('../../drone/src/hub/github-pull-requests.ts');

    expect(detail).toContain('label="Change request sections"');
    expect(detail).toContain("label: 'Overview'");
    expect(detail).toContain("label: 'Files changed'");
    expect(detail).toContain('<ChangeRequestOverview');
    expect(changes).toContain('label="Pull request sections"');
    expect(changes).toContain('<PullRequestOverview payload={activePullRequestChanges} />');
    expect(github).toContain("body: String(pull?.body ?? '')");
  });
});
