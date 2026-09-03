import { TrailingDirectoryRequestTracker } from './trailing-directory-request-tracker';

export function deferDirectoryLoadWhileActive(
  tracker: TrailingDirectoryRequestTracker,
  directoryPath: string,
  force: boolean,
): boolean {
  const activeSequence = tracker.activeSequence(directoryPath);
  if (activeSequence == null) return false;
  if (force || tracker.isInvalidated(directoryPath, activeSequence)) {
    tracker.requestTrailing(directoryPath, activeSequence);
  }
  return true;
}
