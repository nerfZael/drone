export type RemoteRepoPanelKey = 'files' | 'changes' | 'prs';

export const REMOTE_REPO_PANEL_ENTRIES: Array<{ value: RemoteRepoPanelKey; label: string }> = [
  { value: 'files', label: 'Files' },
  { value: 'changes', label: 'Changes' },
  { value: 'prs', label: 'PRs' },
];
