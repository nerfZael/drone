import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const remoteHubSidebarSource = readFileSync(
  new URL('../src/remote/RemoteHubSidebar.tsx', import.meta.url),
  'utf8',
);
const remoteHubModelSource = readFileSync(
  new URL('../src/remote/useRemoteHubModel.ts', import.meta.url),
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

  test('marks host runtime drones as local-only in the remote sidebar', () => {
    expect(remoteHubSidebarSource).toContain("if (drone.runtime !== 'host') continue;");
    expect(remoteHubSidebarSource).toContain("statusHintById[drone.id] = 'Host · local';");
    expect(remoteHubSidebarSource).toContain('readOnlyDisabledDroneReasonById=');
    expect(remoteHubModelSource).toContain("drone.runtime !== 'host'");
    expect(remoteHubModelSource).toContain('nextDrones.find(isRemoteSelectableDrone)?.id ?? null');
  });

  test('uses registry SSE with polling fallback for remote drone summaries', () => {
    expect(remoteHubModelSource).toContain('useDroneRegistryEvents(authenticated)');
    expect(remoteHubModelSource).toContain('droneEvents.connected ? 60_000 : 2_000');
    expect(remoteHubModelSource).toContain('polledDronesResponse?.drones ?? droneEvents.value?.drones');
  });
});
