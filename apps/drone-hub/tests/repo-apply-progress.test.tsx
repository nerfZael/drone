import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepoApplyProgressToast } from '../src/droneHub/app/HubTransientToasts';
import {
  beginRepoApplyProgress,
  useDroneHubRuntimeStore,
} from '../src/droneHub/app/use-drone-hub-runtime-store';

describe('apply-to-host progress', () => {
  test('shows a durable, accessible progress toast without a dismiss action', () => {
    const endProgress = beginRepoApplyProgress({
      droneId: 'drone-1',
      droneLabel: 'quiet-sun',
    });
    const progress = Object.values(
      useDroneHubRuntimeStore.getState().repoApplyProgressByToken,
    );
    const html = renderToStaticMarkup(<RepoApplyProgressToast progress={progress} />);
    endProgress();

    expect(html).toContain('role="status"');
    expect(html).toContain('Applying changes to host');
    expect(html).toContain('Syncing from quiet-sun. You can keep chatting.');
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain('Dismiss');
  });

  test('summarizes concurrent applies and clears each operation independently', () => {
    const endFirst = beginRepoApplyProgress({
      droneId: 'drone-1',
      droneLabel: 'quiet-sun',
    });
    const endSecond = beginRepoApplyProgress({
      droneId: 'drone-2',
      droneLabel: 'blue-pond',
    });

    const concurrent = Object.values(
      useDroneHubRuntimeStore.getState().repoApplyProgressByToken,
    );
    const concurrentHtml = renderToStaticMarkup(
      <RepoApplyProgressToast progress={concurrent} />,
    );
    expect(concurrentHtml).toContain('Syncing from 2 drones. You can keep chatting.');

    endFirst();
    const remaining = Object.values(
      useDroneHubRuntimeStore.getState().repoApplyProgressByToken,
    );
    const remainingHtml = renderToStaticMarkup(
      <RepoApplyProgressToast progress={remaining} />,
    );
    expect(remainingHtml).toContain('Syncing from blue-pond. You can keep chatting.');
    endSecond();
  });

  test('does not show apply-to-host progress while no apply is active', () => {
    useDroneHubRuntimeStore.setState({ repoApplyProgressByToken: {} });
    const html = renderToStaticMarkup(<RepoApplyProgressToast progress={[]} />);

    expect(html).not.toContain('Applying changes to host');
    expect(html).not.toContain('role="progressbar"');
  });

  test('keeps the apply route out of drone provisioning and error lifecycle state', () => {
    const source = readFileSync(
      new URL('../../drone/src/hub/repository-operation-route-service.ts', import.meta.url),
      'utf8',
    );
    const applyRoute = source.slice(
      source.indexOf('// POST /api/drones/:id/repo/pull\n'),
      source.indexOf('// POST /api/drones/:id/repo/pull-from-drone\n'),
    );

    expect(applyRoute).toContain("parts[4] === 'pull'");
    expect(applyRoute).not.toContain('setDroneHubMetaByIdentity');
    expect(applyRoute).not.toContain("phase: 'seeding'");
    expect(applyRoute).not.toContain("phase: 'error'");
  });
});
