export type ChangeRequestStatus = 'open' | 'merged' | 'closed';

export type ChangeRequestActor = {
  kind: 'user' | 'chat' | 'system';
  id: string | null;
  label: string;
};

export type ChangeRequestRecord = {
  id: string;
  number: number;
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
};

export type ChangeRequestAssessment = {
  stale: boolean;
  conflicted: boolean;
  destinationExists: boolean;
  destinationSha: string | null;
  conflictFiles: string[];
};

export type ChangeRequestView = ChangeRequestRecord & ChangeRequestAssessment;

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
