import type { ChatAgentConfig } from '../domain';
import type { AgentRunFileChanges } from '@blip/protocol';
import type {
  AgentPlan,
  AgentRunActivity,
  ChatQueueAction,
  PendingPromptState,
} from '@drone/assistant-chat';

export type { AgentPlan } from '@drone/assistant-chat';

export type DroneSummary = {
  id: string;
  name: string;
  group: string | null;
  groupId?: string | null;
  createdAt: string;
  lastActivityAt?: string | null;
  lastMessageAt?: string | null;
  lastActivityChat?: string | null;
  fleetParentId?: string | null;
  fleetAssignedIds?: string[] | null;
  workflowChild?: {
    ownerDroneId: string;
    workflowId: string;
    runId: string;
    invocationId: string;
  };
  runtime?: 'container' | 'host';
  persistVolume?: boolean;
  repoAttached?: boolean;
  repoPath: string;
  repoBranch?: string | null;
  repoSeedSource?: 'host' | 'remote';
  repoSeedRemoteBranch?: string | null;
  cwd?: string;
  containerPort: number;
  hostPort: number | null;
  statusOk: boolean;
  statusError: string | null;
  statusChecking?: boolean;
  chats: string[];
  workflowChats?: string[];
  unreadChats?: string[];
  chatReadStates?: Record<
    string,
    {
      unread: boolean;
      latestAgentTurnId: string | null;
      latestAgentRevision: number;
    }
  >;
  draftChats?: Record<string, boolean>;
  busyChats?: string[];
  approvalChats?: string[];
  approvalRequired?: boolean;
  dockerSize?: {
    totalBytes: number;
    containerWritableBytes: number | null;
    snapshotBytes: number;
    snapshotVirtualBytes?: number | null;
    snapshotCount: number;
  };
  hubPhase?: 'draft' | 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
  busy?: boolean;
  draft?: boolean;
};

export type RepoSummary = {
  path: string;
  addedAt: string | null;
  remoteUrl: string | null;
  github: { owner: string; repo: string } | null;
};

export type GroupSummary = {
  id: string;
  repoPath: string;
  name: string;
  label: string;
  parentId: string | null;
  createdAt: string | null;
};

export type RepoRemoteBranchOption = {
  name: string;
  remote: string;
  branch: string;
  headSha: string | null;
};

export type RepoBranchesPayload =
  | {
      ok: true;
      repoRoot: string;
      hostBranch: string | null;
      remoteBranches: RepoRemoteBranchOption[];
    }
  | {
      ok: false;
      error: string;
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
  isVideo: boolean;
};

export type DroneFsListPayload =
  | { ok: true; id: string; name: string; path: string; entries: DroneFsEntry[] }
  | { ok: false; error: string; id?: string; name?: string; path?: string };

export type DroneFsSearchEntry = {
  name: string;
  path: string;
  relativePath: string | null;
  size: number | null;
  mtimeMs: number | null;
};

export type DroneFsSearchPayload =
  | { ok: true; id: string; name: string; root: string; entries: DroneFsSearchEntry[] }
  | { ok: false; error: string; id?: string; name?: string; root?: string };

export type DroneFsReadPayload =
  | {
      ok: true;
      id: string;
      name: string;
      path: string;
      kind: 'text';
      mime: string | null;
      content: string;
      size: number;
      mtimeMs: number | null;
      revision?: string | null;
    }
  | {
      ok: true;
      id: string;
      name: string;
      path: string;
      kind: 'image' | 'video' | 'binary';
      mime: string | null;
      size: number;
      mtimeMs: number | null;
      revision?: string | null;
    }
  | { ok: false; error: string; id?: string; name?: string; path?: string };

export type DroneFsTextChunkPayload =
  | {
      ok: true;
      id: string;
      name: string;
      path: string;
      kind: 'text-chunk';
      mime: string | null;
      content: string;
      size: number;
      mtimeMs: number | null;
      offset: number;
      nextOffset: number;
      eof: boolean;
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
      revision?: string | null;
    }
  | { ok: false; error: string; id?: string; name?: string; path?: string };

export type DroneFsUploadPayload =
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
  reviewKey?: string;
  reviewToken?: string;
};

export type RepoChangesPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      reviewScopeId: string;
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

export type RepoSourcePayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      path: string;
      source: string;
      exists: boolean;
      truncated: boolean;
    }
  | { ok: false; error: string; code?: string };

export type RepoPullChangeEntry = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: RepoChangeType;
  reviewKey?: string;
  reviewToken?: string;
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
      reviewScopeId: string;
      baseSha: string;
      headSha: string;
      branchContext: RepoPullBranchContext;
      counts: {
        changed: number;
      };
      entries: RepoPullChangeEntry[];
      applyPreview?: {
        mode: 'host-merge' | 'drone-range';
        counts: {
          changed: number;
        };
        entries: RepoPullChangeEntry[];
      };
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

export type RepoCommitSummary = {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string | null;
  authoredAt: string;
  subject: string;
  isMerge: boolean;
};

export type RepoCommitChangeEntry = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: RepoChangeType;
  additions: number;
  deletions: number;
  changes: number;
};

export type RepoCommitListPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      branch: RepoBranchSummary;
      baseRef: string | null;
      commits: RepoCommitSummary[];
    }
  | { ok: false; error: string; code?: string };

export type RepoCommitChangesPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      commit: RepoCommitSummary & {
        body: string;
        committerName: string;
        committerEmail: string | null;
        committedAt: string;
      };
      counts: {
        changed: number;
        additions: number;
        deletions: number;
      };
      entries: RepoCommitChangeEntry[];
    }
  | { ok: false; error: string; code?: string };

export type RepoCommitDiffPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      sha: string;
      path: string;
      diff: string;
      truncated: boolean;
      isBinary: boolean;
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
  reviewKey?: string;
  reviewToken?: string;
};

export type RepoPullRequestChangesPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      reviewScopeId: string;
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

export type RepoPullRequestCommitListPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      github: { owner: string; repo: string };
      pullNumber: number;
      commits: RepoCommitSummary[];
    }
  | { ok: false; error: string; code?: string };

export type RepoPullRequestCommitChangesPayload =
  | {
      ok: true;
      id: string;
      name: string;
      repoRoot: string;
      github: { owner: string; repo: string };
      commit: RepoCommitSummary & {
        body: string;
        committerName: string;
        committerEmail: string | null;
        committedAt: string;
      };
      counts: {
        changed: number;
        additions: number;
        deletions: number;
      };
      entries: RepoCommitChangeEntry[];
    }
  | { ok: false; error: string; code?: string };

export type RepoPullRequestState = 'open' | 'merged' | 'closed' | string;
export type RepoPullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

export type RepoPullRequestSummary = {
  number: number;
  title: string;
  state: RepoPullRequestState;
  draft: boolean;
  diffStats: {
    changed: number;
    additions: number;
    deletions: number;
  } | null;
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
  startedAt?: string;
  completedAt?: string;
  id?: string;
  prompt: string;
  model?: string;
  reasoning?: string;
  activity?: AgentRunActivity;
  attachments?: ChatImageAttachmentRef[];
  inheritedFromClone?: boolean;
  session: string;
  logPath: string;
  ok: boolean;
  silentCompletion?: boolean;
  error?: string;
  output: string;
  agentPlan?: AgentPlan;
  fileChanges?: AgentRunFileChanges;
  dockerSnapshot?: {
    id: string;
    status: 'creating' | 'ready' | 'failed' | 'restoring';
    createdAt: string;
    readyAt?: string;
    restoredAt?: string;
    error?: string;
    sizeBytes?: number;
  };
};

export type ChatImageAttachmentRef = {
  name: string;
  mime: string;
  size: number;
  fileName?: string;
  path?: string;
  relativePath?: string;
  previewDataUrl?: string;
};

export type PendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  attachments?: ChatImageAttachmentRef[];
  attachmentPayloads?: Array<{
    name: string;
    mime: string;
    size: number;
    dataBase64: string;
  }>;
  deliveryMode?: 'queue' | 'asap';
  action?: ChatQueueAction;
  // `queued` is waiting for earlier work or for a provisioning drone to become ready.
  state: PendingPromptState;
  error?: string;
  observability?: {
    state: 'status-unavailable';
    message: string;
    lastCheckedAt: string;
    lastError?: string;
  };
  activity?: AgentRunActivity;
  agentPlan?: AgentPlan;
  fileChanges?: AgentRunFileChanges;
  startedAt?: string;
  updatedAt?: string;
};

export type CustomAgentProfile = { id: string; label: string; command: string };
