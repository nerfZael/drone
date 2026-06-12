import React from 'react';
import type { DraftChatState } from './app-types';
import type { DroneSummary } from '../types';
import { newDraftChatFocusKey } from './helpers';

type UseWorkspaceNavigationActionsArgs = {
  creating: boolean;
  createMode: 'create' | 'clone';
  activeRepoPath: string;
  deletingDrones: Record<string, boolean>;
  renamingDrones: Record<string, boolean>;
  normalizeCreateRepoPath: (candidate: string) => string;
  suggestCloneName: (sourceName: string) => string;
  selectionAnchorRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneHoldUntilRef: React.MutableRefObject<number>;
  setAppView: React.Dispatch<React.SetStateAction<'workspace' | 'settings'>>;
  setDraftChat: React.Dispatch<React.SetStateAction<DraftChatState | null>>;
  setCreateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftCreateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftCreateMode: React.Dispatch<React.SetStateAction<'with-chat' | 'without-chat'>>;
  setDraftCreateName: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateGroup: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateParentDroneId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftCreateError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftAutoRenaming: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftNameSuggestionError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftNameSuggesting: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateMode: React.Dispatch<React.SetStateAction<'create' | 'clone'>>;
  setCreateRuntime: React.Dispatch<React.SetStateAction<'container' | 'host'>>;
  setCreatePersistVolume: React.Dispatch<React.SetStateAction<boolean>>;
  setCloneSourceId: React.Dispatch<React.SetStateAction<string | null>>;
  setCreateName: React.Dispatch<React.SetStateAction<string>>;
  setCreateGroup: React.Dispatch<React.SetStateAction<string>>;
  setCreateRepoPath: React.Dispatch<React.SetStateAction<string>>;
  setCreateInitialMessage: React.Dispatch<React.SetStateAction<string>>;
  setCreateMessageSuffixRows: React.Dispatch<React.SetStateAction<string[]>>;
  setCloneIncludeChats: React.Dispatch<React.SetStateAction<boolean>>;
  setChatHeaderRepoPath: React.Dispatch<React.SetStateAction<string>>;
  setFleetDashboardOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedDrone: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDroneIds: React.Dispatch<React.SetStateAction<string[]>>;
  setKanbanBoardOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPlaybookRunsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedChat: React.Dispatch<React.SetStateAction<string>>;
  resetDraftNameSuggestSeq: () => void;
};

type OpenDraftChatComposerOptions = {
  repoPath?: string | null;
  group?: string | null;
  parentDroneId?: string | null;
};

export function useWorkspaceNavigationActions({
  creating,
  createMode,
  activeRepoPath,
  deletingDrones,
  renamingDrones,
  normalizeCreateRepoPath,
  suggestCloneName,
  selectionAnchorRef,
  preferredSelectedDroneRef,
  preferredSelectedDroneHoldUntilRef,
  setAppView,
  setDraftChat,
  setCreateOpen,
  setCreateError,
  setDraftCreateOpen,
  setDraftCreateMode,
  setDraftCreateName,
  setDraftCreateGroup,
  setDraftCreateParentDroneId,
  setDraftCreateError,
  setDraftCreating,
  setDraftAutoRenaming,
  setDraftNameSuggestionError,
  setDraftNameSuggesting,
  setCreateMode,
  setCreateRuntime,
  setCreatePersistVolume,
  setCloneSourceId,
  setCreateName,
  setCreateGroup,
  setCreateRepoPath,
  setCreateInitialMessage,
  setCreateMessageSuffixRows,
  setCloneIncludeChats,
  setChatHeaderRepoPath,
  setFleetDashboardOpen,
  setSelectedDrone,
  setSelectedDroneIds,
  setKanbanBoardOpen,
  setPlaybookRunsOpen,
  setSelectedChat,
  resetDraftNameSuggestSeq,
}: UseWorkspaceNavigationActionsArgs) {
  const clearSidebarSelection = React.useCallback(() => {
    setSelectedDrone(null);
    setSelectedDroneIds([]);
    selectionAnchorRef.current = null;
    preferredSelectedDroneRef.current = null;
    preferredSelectedDroneHoldUntilRef.current = 0;
    setSelectedChat('default');
  }, [
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    selectionAnchorRef,
    setSelectedChat,
    setSelectedDrone,
    setSelectedDroneIds,
  ]);

  const resetDraftCreateState = React.useCallback(() => {
    setDraftCreateOpen(false);
    setDraftCreateParentDroneId(null);
    setDraftCreateError(null);
  }, [
    setDraftCreateError,
    setDraftCreateOpen,
    setDraftCreateParentDroneId,
  ]);

  const openCreateModal = React.useCallback(() => {
    if (creating) return;
    setAppView('workspace');
    setKanbanBoardOpen(false);
    setPlaybookRunsOpen(false);
    setDraftChat(null);
    resetDraftCreateState();
    setCreateError(null);
    if (createMode === 'clone') {
      setCreateName('');
      setCreateGroup('');
      setCreateRepoPath('');
      setCreateInitialMessage('');
      setCreateMessageSuffixRows(['']);
      setCloneIncludeChats(true);
    }
    setCreateMode('create');
    setCreateRuntime('container');
    setCreatePersistVolume(false);
    setCloneSourceId(null);
    setCreateRepoPath(normalizeCreateRepoPath(activeRepoPath || ''));
    setCreateInitialMessage('');
    setCreateMessageSuffixRows(['']);
    setCreateOpen(true);
  }, [
    activeRepoPath,
    createMode,
    creating,
    normalizeCreateRepoPath,
    resetDraftCreateState,
    setAppView,
    setKanbanBoardOpen,
    setPlaybookRunsOpen,
    setCloneIncludeChats,
    setCloneSourceId,
    setCreateError,
    setCreateGroup,
    setCreateInitialMessage,
    setCreateMessageSuffixRows,
    setCreateMode,
    setCreatePersistVolume,
    setCreateRuntime,
    setCreateName,
    setCreateOpen,
    setCreateRepoPath,
    setDraftChat,
  ]);

  const openDraftChatComposer = React.useCallback((opts?: OpenDraftChatComposerOptions) => {
    const hasRepoOverride = Boolean(opts) && Object.prototype.hasOwnProperty.call(opts, 'repoPath');
    const hasGroupOverride = Boolean(opts) && Object.prototype.hasOwnProperty.call(opts, 'group');
    const activeRepo = String(activeRepoPath ?? '').trim();
    const nextGroup = hasGroupOverride ? String(opts?.group ?? '').trim() : '';
    if (hasRepoOverride) {
      setChatHeaderRepoPath(normalizeCreateRepoPath(String(opts?.repoPath ?? '')));
    } else if (activeRepo) {
      setChatHeaderRepoPath(normalizeCreateRepoPath(activeRepo));
    } else {
      setChatHeaderRepoPath('');
    }
    setAppView('workspace');
    setKanbanBoardOpen(false);
    setPlaybookRunsOpen(false);
    setFleetDashboardOpen(false);
    setCreateOpen(false);
    setCreateError(null);
    resetDraftCreateState();
    setDraftCreateMode('with-chat');
    setDraftCreateName('');
    setDraftCreateGroup(nextGroup);
    setDraftCreateParentDroneId(String(opts?.parentDroneId ?? '').trim() || null);
    setDraftCreating(false);
    setDraftAutoRenaming(false);
    setDraftNameSuggestionError(null);
    setDraftNameSuggesting(false);
    setCreateRuntime('container');
    setCreatePersistVolume(false);
    resetDraftNameSuggestSeq();
    setDraftChat({ droneId: '', droneName: '', prompt: null, queuedPrompts: [], focusKey: newDraftChatFocusKey() });
    clearSidebarSelection();
  }, [
    activeRepoPath,
    clearSidebarSelection,
    normalizeCreateRepoPath,
    resetDraftNameSuggestSeq,
    resetDraftCreateState,
    setAppView,
    setChatHeaderRepoPath,
    setKanbanBoardOpen,
    setPlaybookRunsOpen,
    setFleetDashboardOpen,
    setCreateError,
    setCreateOpen,
    setCreatePersistVolume,
    setCreateRuntime,
    setDraftAutoRenaming,
    setDraftChat,
    setDraftCreateGroup,
    setDraftCreateParentDroneId,
    setDraftCreateName,
    setDraftCreating,
    setDraftCreateOpen,
    setDraftCreateMode,
    setDraftNameSuggestionError,
    setDraftNameSuggesting,
  ]);

  const openCloneModal = React.useCallback(
    (source: DroneSummary) => {
      if (creating || deletingDrones[source.id] || renamingDrones[source.id]) return;
      const sourceRuntime = String(source?.runtime ?? 'container').trim().toLowerCase();
      if (sourceRuntime === 'host') return;
      setAppView('workspace');
      setKanbanBoardOpen(false);
      setPlaybookRunsOpen(false);
      setDraftChat(null);
      setFleetDashboardOpen(false);
      resetDraftCreateState();
      setCreateError(null);
      setCreateMode('clone');
      setCreateRuntime('container');
      setCreatePersistVolume(source.persistVolume !== false);
      setCloneSourceId(source.id);
      setCreateName(suggestCloneName(source.name));
      setCreateGroup(source.group ?? '');
      setCreateRepoPath(
        normalizeCreateRepoPath(
          source && (source.repoAttached ?? Boolean(String(source.repoPath ?? '').trim()))
            ? source.repoPath
            : '',
        ),
      );
      setCreateInitialMessage('');
      setCreateMessageSuffixRows(['']);
      setCloneIncludeChats(true);
      setCreateOpen(true);
    },
    [
      creating,
      deletingDrones,
      normalizeCreateRepoPath,
      renamingDrones,
      resetDraftCreateState,
      setAppView,
      setKanbanBoardOpen,
      setPlaybookRunsOpen,
      setFleetDashboardOpen,
      setCloneIncludeChats,
      setCloneSourceId,
      setCreateError,
      setCreateGroup,
      setCreateInitialMessage,
      setCreateMessageSuffixRows,
      setCreateMode,
      setCreatePersistVolume,
      setCreateRuntime,
      setCreateName,
      setCreateOpen,
      setCreateRepoPath,
      setDraftChat,
      setFleetDashboardOpen,
      suggestCloneName,
    ],
  );

  return {
    openCreateModal,
    openDraftChatComposer,
    openCloneModal,
    openPlaybookRuns: () => {
      setAppView('workspace');
      setDraftChat(null);
      setCreateOpen(false);
      setCreateError(null);
      resetDraftCreateState();
      setKanbanBoardOpen(false);
      setFleetDashboardOpen(false);
      setPlaybookRunsOpen(true);
      clearSidebarSelection();
    },
  };
}
