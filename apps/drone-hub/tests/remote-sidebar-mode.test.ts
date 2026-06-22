import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const remoteHubSidebarSource = readFileSync(
  new URL('../src/remote/RemoteHubSidebar.tsx', import.meta.url),
  'utf8',
);

describe('RemoteHubSidebar', () => {
  test('uses the read-only tree renderer so repo sections can show group folders', () => {
    expect(remoteHubSidebarSource).toContain(
      "const REMOTE_SIDEBAR_MODE: DroneSidebarReadOnlyMode = 'static-tree';",
    );
    expect(remoteHubSidebarSource).toContain("sidebarGroupingMode: 'repos'");
    expect(remoteHubSidebarSource).toContain('sidebarGroupingModeOverride="repos"');
  });
});
