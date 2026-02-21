export type DroneSummary = {
  id: string;
  name: string;
  group: string | null;
  createdAt: string;
  repoAttached?: boolean;
  repoPath: string;
  containerPort: number;
  hostPort: number | null;
  statusOk: boolean;
  statusError: string | null;
  chats: string[];
  hubPhase?: 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
  busy?: boolean;
};

export type RepoSummary = {
  path: string;
  addedAt: string | null;
  remoteUrl: string | null;
  github: { owner: string; repo: string } | null;
};

export type DronePortMapping = { hostPort: number; containerPort: number };
export type DroneTerminalMode = 'shell' | 'agent';
export type PortPreviewSelection = { containerPort: number };
export type PortPreviewByDrone = Record<string, PortPreviewSelection>;
export type PreviewUrlByDrone = Record<string, string>;
export type PortReachability = 'checking' | 'up' | 'down';
export type PortReachabilityByHostPort = Record<string, PortReachability>;
export type PortReachabilityByDrone = Record<string, PortReachabilityByHostPort>;

export type DronePortsPayload =
  | { ok: true; id: string; name: string; ports: DronePortMapping[] }
  | { ok: false; error: string; id?: string; name?: string };

export type DroneFsEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'other';
  size: number | null;
  mtimeMs: number | null;
  ext: string | null;
  isImage: boolean;
};

export type DroneFsListPayload =
  | { ok: true; id: string; name: string; path: string; entries: DroneFsEntry[] }
  | { ok: false; error: string; id?: string; name?: string; path?: string };

export type DroneFsReadPayload =
  | {
      ok: true;
      id: string;
      name: string;
      path: string;
      content: string;
      size: number;
      mtimeMs: number | null;
    }
  | { ok: false; error: string; id?: string; name?: string; path?: string };

export type DroneFsWritePayload =
  | {
      ok: true;
      id: string;
      name: string;
      path: string;
      size: number;
      mtimeMs: number | null;
    }
  | { ok: false; error: string; id?: string; name?: string; path?: string };

export type RepoChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'untracked'
  | 'ignored'
  | 'unknown'
  | null;

export type RepoBranchSummary = {
  head: string | null;
  upstream: string | null;
  oid: string | null;
  ahead: number;
  behind: number;
};

export type RepoChangeEntry = {
  path: string;
  originalPath: string | null;
  code: string;
  stagedChar: string;
  unstagedChar: string;
  stagedType: RepoChangeType;
  unstagedType: RepoChangeType;
  isUntracked: boolean;
  isIgnored: boolean;
  isConflicted: boolean;
};

export type RepoChangesPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      branch: RepoBranchSummary;
      counts: {
        changed: number;
        staged: number;
        unstaged: number;
        untracked: number;
        conflicted: number;
      };
      entries: RepoChangeEntry[];
    }
  | { ok: false; error: string };

export type RepoDiffPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      path: string;
      kind: 'staged' | 'unstaged';
      diff: string;
      truncated: boolean;
      fromUntracked: boolean;
    }
  | { ok: false; error: string };

export type RepoPullChangeEntry = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: RepoChangeType;
};

export type RepoPullBranchContext = {
  hostCurrent: string | null;
  droneCurrent: string | null;
  droneConfigured: string | null;
  droneFromRef: string | null;
};

export type RepoPullChangesPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      baseSha: string;
      headSha: string;
      branchContext: RepoPullBranchContext;
      counts: {
        changed: number;
      };
      entries: RepoPullChangeEntry[];
    }
  | { ok: false; error: string; code?: string };

export type RepoPullDiffPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      baseSha: string;
      headSha: string;
      path: string;
      diff: string;
      truncated: boolean;
    }
  | { ok: false; error: string; code?: string };

export type RepoPullRequestChangeEntry = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: RepoChangeType;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  truncated: boolean;
  isBinary: boolean;
};

export type RepoPullRequestChangesPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      github: { owner: string; repo: string };
      pullRequest: {
        number: number;
        title: string;
        state: RepoPullRequestState;
        htmlUrl: string | null;
        baseRefName: string;
        headRefName: string;
        baseSha: string;
        headSha: string;
      };
      counts: {
        changed: number;
        additions: number;
        deletions: number;
      };
      entries: RepoPullRequestChangeEntry[];
    }
  | { ok: false; error: string; code?: string };

export type RepoPullRequestState = 'open' | 'merged' | 'closed' | string;
export type RepoPullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

export type RepoPullRequestSummary = {
  number: number;
  title: string;
  state: RepoPullRequestState;
  draft: boolean;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  headRefName: string;
  headLabel: string;
  baseRefName: string;
  isCrossRepository: boolean;
  checksState: 'success' | 'failing' | 'pending' | 'unknown';
  reviewState: 'approved' | 'changes_requested' | 'review_required' | 'unknown';
  hasMergeConflicts: boolean;
};

export type RepoPullRequestsPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      state: 'open' | 'closed' | 'all';
      github: { owner: string; repo: string };
      count: number;
      pullRequests: RepoPullRequestSummary[];
    }
  | { ok: false; error: string; code?: string };

export type RepoPullRequestMergePayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      github: { owner: string; repo: string };
      number: number;
      merged: boolean;
      message: string;
      sha: string | null;
      method: RepoPullRequestMergeMethod;
    }
  | { ok: false; error: string; code?: string };

export type RepoPullRequestClosePayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      github: { owner: string; repo: string };
      number: number;
      state: RepoPullRequestState;
      title: string;
      htmlUrl: string | null;
    }
  | { ok: false; error: string; code?: string };

export type TranscriptItem = {
  turn: number;
  at: string;
  promptAt?: string;
  completedAt?: string;
  id?: string;
  prompt: string;
  session: string;
  logPath: string;
  ok: boolean;
  error?: string;
  output: string;
};

export type JobSpec = {
  // Display name for the drone (mutable; ids are the stable identifier).
  name: string;
  title: string;
  details: string;
};

export type EditableJob = JobSpec & { id: string };

export type PendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  // `queued` is a local-only UI state used when a drone is still provisioning.
  state: 'queued' | 'sending' | 'sent' | 'failed';
  error?: string;
  updatedAt?: string;
};

export type CustomAgentProfile = { id: string; label: string; command: string };
