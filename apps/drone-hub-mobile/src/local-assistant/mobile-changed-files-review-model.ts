import type {
  AgentRunFileChangeEntry,
  AgentRunFileChanges,
  AgentRunFileChangeWorkspace,
} from '@blip/protocol';
import { agentRunWorkspacePreviewEntries } from '@drone/assistant-chat';
import type { MobileDiffLoadError, MobileDiffRenderModel } from './mobile-diff-review-model';

export const MOBILE_REVIEW_FILE_PAGE_SIZE = 100;

export type MobileChangedFilesReviewSelection = {
  workspaceTargetId: string;
  path: string;
};

export type MobileChangedFilesReviewWorkspaceState = {
  entries: AgentRunFileChangeEntry[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  nextOffset: number | null;
  metadataTruncated: boolean;
  error: string;
  operation: 'refresh' | 'load-more' | null;
};

export type MobileChangedFilesReviewDiffState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'loaded'; key: string; model: MobileDiffRenderModel }
  | ({ status: 'error'; key: string } & MobileDiffLoadError);

export type MobileChangedFilesReviewState = {
  workspaces: Record<string, MobileChangedFilesReviewWorkspaceState>;
  selection: MobileChangedFilesReviewSelection | null;
  diff: MobileChangedFilesReviewDiffState;
};

export type MobileChangedFilesReviewAction =
  | { type: 'select'; selection: MobileChangedFilesReviewSelection }
  | { type: 'files-loading'; workspaceTargetId: string; append: boolean }
  | {
      type: 'files-loaded';
      workspaceTargetId: string;
      entries: AgentRunFileChangeEntry[];
      nextOffset: number | null;
      metadataTruncated: boolean;
      append: boolean;
    }
  | { type: 'files-error'; workspaceTargetId: string; message: string }
  | { type: 'diff-loading'; key: string }
  | { type: 'diff-loaded'; key: string; model: MobileDiffRenderModel }
  | { type: 'diff-error'; key: string; error: MobileDiffLoadError };

export function createMobileChangedFilesReviewState(
  fileChanges: AgentRunFileChanges,
  initialSelection?: {
    workspaceTargetId: string;
    entry: AgentRunFileChangeEntry;
  } | null,
): MobileChangedFilesReviewState {
  const workspaces = Object.fromEntries(
    fileChanges.workspaces.map((workspace) => {
      const entries = agentRunWorkspacePreviewEntries(workspace);
      const initialEntry =
        initialSelection?.workspaceTargetId === workspace.targetId ? initialSelection.entry : null;
      return [
        workspace.targetId,
        {
          entries: initialEntry ? appendMissingEntries(entries, [initialEntry]) : entries,
          status: 'entries' in workspace || !workspace.diffArtifactId ? 'loaded' : 'idle',
          nextOffset: null,
          metadataTruncated:
            ('metadataTruncated' in workspace && workspace.metadataTruncated === true) ||
            ('truncated' in workspace && workspace.truncated === true),
          error: '',
          operation: null,
        } satisfies MobileChangedFilesReviewWorkspaceState,
      ];
    }),
  );
  const firstWorkspace = fileChanges.workspaces.find(
    (workspace) => agentRunWorkspacePreviewEntries(workspace).length > 0,
  );
  const firstEntry = firstWorkspace
    ? agentRunWorkspacePreviewEntries(firstWorkspace)[0]
    : undefined;
  return {
    workspaces,
    selection: initialSelection
      ? {
          workspaceTargetId: initialSelection.workspaceTargetId,
          path: initialSelection.entry.path,
        }
      : firstWorkspace && firstEntry
        ? { workspaceTargetId: firstWorkspace.targetId, path: firstEntry.path }
        : null,
    diff: { status: 'idle' },
  };
}

export function mobileChangedFilesReviewReducer(
  state: MobileChangedFilesReviewState,
  action: MobileChangedFilesReviewAction,
): MobileChangedFilesReviewState {
  if (action.type === 'select') {
    return { ...state, selection: action.selection, diff: { status: 'idle' } };
  }
  if (action.type === 'files-loading') {
    return updateWorkspace(state, action.workspaceTargetId, (workspace) => ({
      ...workspace,
      status: 'loading',
      error: '',
      operation: action.append ? 'load-more' : 'refresh',
    }));
  }
  if (action.type === 'files-loaded') {
    return updateWorkspace(state, action.workspaceTargetId, (workspace) => {
      const selectedEntry =
        state.selection?.workspaceTargetId === action.workspaceTargetId
          ? workspace.entries.find((entry) => entry.path === state.selection?.path)
          : undefined;
      return {
        ...workspace,
        status: 'loaded',
        entries: action.append
          ? appendPageEntries(workspace.entries, action.entries)
          : appendMissingEntries(action.entries, selectedEntry ? [selectedEntry] : []),
        nextOffset: action.nextOffset,
        metadataTruncated: action.metadataTruncated,
        error: '',
        operation: null,
      };
    });
  }
  if (action.type === 'files-error') {
    return updateWorkspace(state, action.workspaceTargetId, (workspace) => ({
      ...workspace,
      status: 'error',
      error: action.message,
    }));
  }
  if (action.type === 'diff-loading') {
    return { ...state, diff: { status: 'loading', key: action.key } };
  }
  if (action.type === 'diff-loaded') {
    if (state.diff.status !== 'loading' || state.diff.key !== action.key) return state;
    return { ...state, diff: { status: 'loaded', key: action.key, model: action.model } };
  }
  if (state.diff.status !== 'loading' || state.diff.key !== action.key) return state;
  return { ...state, diff: { status: 'error', key: action.key, ...action.error } };
}

export function mobileChangedFilesReviewEntries(
  fileChanges: AgentRunFileChanges,
  state: MobileChangedFilesReviewState,
): Array<{ workspaceTargetId: string; entry: AgentRunFileChangeEntry }> {
  return fileChanges.workspaces.flatMap((workspace) =>
    (state.workspaces[workspace.targetId]?.entries ?? []).map((entry) => ({
      workspaceTargetId: workspace.targetId,
      entry,
    })),
  );
}

export function mobileChangedFilesReviewSelectedEntry(
  fileChanges: AgentRunFileChanges,
  state: MobileChangedFilesReviewState,
): { workspace: AgentRunFileChangeWorkspace; entry: AgentRunFileChangeEntry } | null {
  if (!state.selection) return null;
  const workspace = fileChanges.workspaces.find(
    (candidate) => candidate.targetId === state.selection?.workspaceTargetId,
  );
  const entry = state.workspaces[state.selection.workspaceTargetId]?.entries.find(
    (candidate) => candidate.path === state.selection?.path,
  );
  return workspace && entry ? { workspace, entry } : null;
}

export function mobileChangedFilesReviewNeighbor(
  fileChanges: AgentRunFileChanges,
  state: MobileChangedFilesReviewState,
  direction: -1 | 1,
): MobileChangedFilesReviewSelection | null {
  const entries = mobileChangedFilesReviewEntries(fileChanges, state);
  if (entries.length === 0) return null;
  const index = entries.findIndex(
    ({ workspaceTargetId, entry }) =>
      workspaceTargetId === state.selection?.workspaceTargetId &&
      entry.path === state.selection?.path,
  );
  const nextIndex = index < 0 ? (direction > 0 ? 0 : entries.length - 1) : index + direction;
  const next = entries[nextIndex];
  return next ? { workspaceTargetId: next.workspaceTargetId, path: next.entry.path } : null;
}

export function mobileChangedFilesReviewSelectionIndex(
  fileChanges: AgentRunFileChanges,
  state: MobileChangedFilesReviewState,
): { current: number; total: number } {
  const entries = mobileChangedFilesReviewEntries(fileChanges, state);
  const index = entries.findIndex(
    ({ workspaceTargetId, entry }) =>
      workspaceTargetId === state.selection?.workspaceTargetId &&
      entry.path === state.selection?.path,
  );
  return { current: index < 0 ? 0 : index + 1, total: entries.length };
}

function updateWorkspace(
  state: MobileChangedFilesReviewState,
  targetId: string,
  update: (
    workspace: MobileChangedFilesReviewWorkspaceState,
  ) => MobileChangedFilesReviewWorkspaceState,
): MobileChangedFilesReviewState {
  const current = state.workspaces[targetId];
  if (!current) return state;
  return {
    ...state,
    workspaces: { ...state.workspaces, [targetId]: update(current) },
  };
}

function appendMissingEntries(
  current: AgentRunFileChangeEntry[],
  incoming: AgentRunFileChangeEntry[],
): AgentRunFileChangeEntry[] {
  const paths = new Set(current.map((entry) => entry.path));
  return [
    ...current,
    ...incoming.filter((entry) => {
      if (paths.has(entry.path)) return false;
      paths.add(entry.path);
      return true;
    }),
  ];
}

function appendPageEntries(
  current: AgentRunFileChangeEntry[],
  incoming: AgentRunFileChangeEntry[],
): AgentRunFileChangeEntry[] {
  const incomingPaths = new Set(incoming.map((entry) => entry.path));
  return appendMissingEntries(
    current.filter((entry) => !incomingPaths.has(entry.path)),
    incoming,
  );
}
