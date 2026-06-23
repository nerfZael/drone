export type RemoteRepoPanelKey = 'changes' | 'prs';

export const REMOTE_REPO_PANEL_ENTRIES: Array<{ value: RemoteRepoPanelKey; label: string }> = [
  { value: 'changes', label: 'Changes' },
  { value: 'prs', label: 'PRs' },
];
