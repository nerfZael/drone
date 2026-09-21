import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeRepoEvents } from '../files/workspace-events';
import { changesQueryKeys } from './useChangesQueries';

/**
 * Reads the working tree and the branch's commits again whenever the Hub says
 * git status may have changed. Returns whether the Hub is watching the
 * repository; while it is not, the panel has only its own polling.
 *
 * Pull request data is left alone: it comes from GitHub, which a file being
 * saved does not change.
 */
export function useRepoLiveUpdates(droneId: string, repoPath: string, enabled: boolean): boolean {
  const queryClient = useQueryClient();
  const [live, setLive] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    const stop = subscribeRepoEvents(droneId, {
      onChanged: () => {
        for (const queryKey of [
          changesQueryKeys.workingTree(droneId, repoPath),
          changesQueryKeys.branchCommits(droneId, repoPath),
        ]) {
          void queryClient.invalidateQueries({ queryKey, refetchType: 'active' });
        }
      },
      onLive: setLive,
    });
    return () => {
      stop();
      setLive(false);
    };
  }, [droneId, enabled, queryClient, repoPath]);

  return live;
}
