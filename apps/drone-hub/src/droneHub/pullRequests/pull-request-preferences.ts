import { profileStorageKey } from '../../profile-storage';
import type { RepoPullRequestMergeMethod } from '../types';

const PR_MERGE_METHOD_STORAGE_KEY = profileStorageKey('droneHub.prMergeMethod');

export function readPullRequestMergeMethod(): RepoPullRequestMergeMethod {
  try {
    const value = String(localStorage.getItem(PR_MERGE_METHOD_STORAGE_KEY) ?? '').trim().toLowerCase();
    if (value === 'squash' || value === 'rebase' || value === 'merge') return value;
  } catch {
    // Use the default when browser storage is unavailable.
  }
  return 'merge';
}

export function writePullRequestMergeMethod(method: RepoPullRequestMergeMethod): void {
  try {
    localStorage.setItem(PR_MERGE_METHOD_STORAGE_KEY, method);
  } catch {
    // Keep the in-memory selection when browser storage is unavailable.
  }
}
