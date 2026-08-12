export type ChangeRequestStatus = 'open' | 'merged' | 'closed';

export type ChangeRequestActor = {
  kind: 'user' | 'chat' | 'system';
  id: string | null;
  label: string;
};

export type ChangeRequestGithubMirrorState = 'open' | 'closed' | 'merged';

export type ChangeRequestGithubMirrorRecord = {
  owner: string;
  repo: string;
  pullNumber: number;
  htmlUrl: string;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  state: ChangeRequestGithubMirrorState;
  autoUpdate: boolean;
  branchOwnedByDroneHub: boolean;
  syncedRevision: number;
  syncedNativeUpdatedAt: string;
  mergeCommitSha: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChangeRequestGithubMirrorView = ChangeRequestGithubMirrorRecord & {
  outOfDate: boolean;
};

export type ChangeRequestRecord = {
  id: string;
  number: number;
  stateVersion: number;
  status: ChangeRequestStatus;
  droneId: string;
  droneName: string;
  chatId: string | null;
  chatName: string;
  repoRoot: string;
  baseBranch: string;
  baseSha: string;
  destinationBranch: string;
  snapshotRef: string | null;
  snapshotSha: string | null;
  sourceHeadSha: string;
  revision: number;
  title: string;
  description: string;
  createdBy: ChangeRequestActor;
  mergedBy: ChangeRequestActor | null;
  mergeCommitSha: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  githubMirror: ChangeRequestGithubMirrorRecord | null;
};

export type ChangeRequestAssessment = {
  stale: boolean;
  conflicted: boolean;
  destinationExists: boolean;
  destinationSha: string | null;
  conflictFiles: string[];
};

export type ChangeRequestLineStats = {
  files: number;
  additions: number;
  modifications: number;
  deletions: number;
  total: number;
};

export type ChangeRequestView = Omit<ChangeRequestRecord, 'id' | 'githubMirror'> &
  ChangeRequestAssessment & {
    githubMirror: ChangeRequestGithubMirrorView | null;
    lineStats?: ChangeRequestLineStats | null;
  };

export type ChangeRequestFileChange = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'unknown';
  additions: number;
  deletions: number;
  changes: number;
};

export type ChangeRequestChanges = {
  request: ChangeRequestView;
  counts: {
    changed: number;
    additions: number;
    deletions: number;
    modified: number;
  };
  entries: ChangeRequestFileChange[];
};

export type ChangeRequestCreateInput = {
  droneRef: string;
  chatName?: string;
  chatId?: string | null;
  title: string;
  description?: string;
  destinationBranch?: string;
  actor: ChangeRequestActor;
};

export type ChangeRequestUpdateInput = {
  title?: string;
  description?: string;
  destinationBranch?: string;
  refreshSnapshot?: boolean;
};
