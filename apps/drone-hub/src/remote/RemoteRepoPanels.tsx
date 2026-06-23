import React from 'react';
import { repoUnavailableReasonForRuntime } from '../droneHub/app/app-config';
import { isDroneStartingOrSeeding } from '../droneHub/app/helpers';
import type { DroneSummary } from '../droneHub/types';
import type { RemoteRepoPanelKey } from './remote-repo-panel-config';

const LazyDroneChangesDock = React.lazy(async () => ({
  default: (await import('../droneHub/changes/DroneChangesDock')).DroneChangesDock,
}));
const LazyDronePullRequestsDock = React.lazy(async () => ({
  default: (await import('../droneHub/pullRequests/DronePullRequestsDock')).DronePullRequestsDock,
}));

type RemoteRepoPanelProps = {
  drone: DroneSummary;
  panel: RemoteRepoPanelKey;
  compactChanges?: boolean;
};

type RemoteRepoPanelsProps = {
  drone: DroneSummary;
};

function remoteRepoState(drone: DroneSummary) {
  const repoPath = String(drone.repoPath ?? '').trim();
  const repoAttached = Boolean(drone.repoAttached ?? Boolean(repoPath));
  return {
    repoPath,
    repoAttached,
    disabled: isDroneStartingOrSeeding(drone.hubPhase ?? null),
    repoUnavailableReason: !repoAttached
      ? 'Attach a repo to this drone to view changes and PRs.'
      : repoUnavailableReasonForRuntime(drone.runtime),
  };
}

export function RemoteRepoPanel({ drone, panel, compactChanges = false }: RemoteRepoPanelProps) {
  const { repoPath, repoAttached, disabled, repoUnavailableReason } = remoteRepoState(drone);

  if (panel === 'prs') {
    return (
      <LazyDronePullRequestsDock
        key={`${drone.id}-remote-prs`}
        droneId={drone.id}
        droneName={drone.name}
        repoAttached={repoAttached}
        repoPath={repoPath}
        repoUnavailableReason={repoUnavailableReason}
        disabled={disabled}
        hubPhase={drone.hubPhase}
        hubMessage={drone.hubMessage}
        onRevealFileInFiles={() => {}}
        onOpenFileInEditor={() => {}}
      />
    );
  }

  return (
    <LazyDroneChangesDock
      key={`${drone.id}-remote-changes`}
      droneId={drone.id}
      repoAttached={repoAttached}
      repoPath={repoPath}
      repoUnavailableReason={repoUnavailableReason}
      fixedContextMode="branch"
      initialViewMode={compactChanges ? 'stacked' : null}
      initialDiffViewType={compactChanges ? 'unified' : null}
      persistViewPreferences={!compactChanges}
      disabled={disabled}
      hubPhase={drone.hubPhase}
      hubMessage={drone.hubMessage}
      onRevealFileInFiles={() => {}}
      onOpenFileInEditor={() => {}}
    />
  );
}

export function RemoteRepoPanels({ drone }: RemoteRepoPanelsProps) {
  return (
    <div
      className="h-full min-h-0 min-w-0 bg-[var(--panel-alt)]"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}
    >
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-[var(--border)]">
        <RemoteRepoPanel drone={drone} panel="changes" />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden">
        <RemoteRepoPanel drone={drone} panel="prs" />
      </div>
    </div>
  );
}
