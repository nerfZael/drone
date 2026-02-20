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
  setDraftCreateName: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateGroup: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftAutoRenaming: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftNameSuggestionError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftNameSuggesting: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateMode: React.Dispatch<React.SetStateAction<'create' | 'clone'>>;
  setCloneSourceId: React.Dispatch<React.SetStateAction<string | null>>;
  setCreateName: React.Dispatch<React.SetStateAction<string>>;
  setCreateGroup: React.Dispatch<React.SetStateAction<string>>;
  setCreateRepoPath: React.Dispatch<React.SetStateAction<string>>;
  setCreateInitialMessage: React.Dispatch<React.SetStateAction<string>>;
  setCreateMessageSuffixRows: React.Dispatch<React.SetStateAction<string[]>>;
  setCloneIncludeChats: React.Dispatch<React.SetStateAction<boolean>>;
  setChatHeaderRepoPath: React.Dispatch<React.SetStateAction<string>>;
  setSelectedDrone: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDroneIds: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedChat: React.Dispatch<React.SetStateAction<string>>;
  resetDraftNameSuggestSeq: () => void;
};

type OpenDraftChatComposerOptions = {
  repoPath?: string | null;
  group?: string | null;
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
  setDraftCreateName,
  setDraftCreateGroup,
  setDraftCreateError,
  setDraftCreating,
  setDraftAutoRenaming,
  setDraftNameSuggestionError,
  setDraftNameSuggesting,
  setCreateMode,
  setCloneSourceId,
  setCreateName,
  setCreateGroup,
  setCreateRepoPath,
  setCreateInitialMessage,
  setCreateMessageSuffixRows,
  setCloneIncludeChats,
  setChatHeaderRepoPath,
  setSelectedDrone,
  setSelectedDroneIds,
  setSelectedChat,
  resetDraftNameSuggestSeq,
}: UseWorkspaceNavigationActionsArgs) {
  const openCreateModal = React.useCallback(() => {
    if (creating) return;
    setAppView('workspace');
    setDraftChat(null);
    setDraftCreateOpen(false);
    setDraftCreateError(null);
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
    setAppView,
    setCloneIncludeChats,
    setCloneSourceId,
    setCreateError,
    setCreateGroup,
    setCreateInitialMessage,
    setCreateMessageSuffixRows,
    setCreateMode,
    setCreateName,
    setCreateOpen,
    setCreateRepoPath,
    setDraftChat,
    setDraftCreateError,
    setDraftCreateOpen,
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
    }
    setAppView('workspace');
    setCreateOpen(false);
    setCreateError(null);
    setDraftCreateOpen(false);
    setDraftCreateName('');
    setDraftCreateGroup(nextGroup);
    setDraftCreateError(null);
    setDraftCreating(false);
    setDraftAutoRenaming(false);
    setDraftNameSuggestionError(null);
    setDraftNameSuggesting(false);
    resetDraftNameSuggestSeq();
    setDraftChat({ droneId: '', droneName: '', prompt: null, focusKey: newDraftChatFocusKey() });
    setSelectedDrone(null);
    setSelectedDroneIds([]);
    selectionAnchorRef.current = null;
    preferredSelectedDroneRef.current = null;
    preferredSelectedDroneHoldUntilRef.current = 0;
    setSelectedChat('default');
  }, [
    activeRepoPath,
    normalizeCreateRepoPath,
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    resetDraftNameSuggestSeq,
    selectionAnchorRef,
    setAppView,
    setChatHeaderRepoPath,
    setCreateError,
    setCreateOpen,
    setDraftAutoRenaming,
    setDraftChat,
    setDraftCreateError,
    setDraftCreateGroup,
    setDraftCreateName,
    setDraftCreating,
    setDraftCreateOpen,
    setDraftNameSuggestionError,
    setDraftNameSuggesting,
    setSelectedChat,
    setSelectedDrone,
    setSelectedDroneIds,
  ]);

  const openCloneModal = React.useCallback(
    (source: DroneSummary) => {
      if (creating || deletingDrones[source.id] || renamingDrones[source.id]) return;
      setAppView('workspace');
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      setCreateError(null);
      setCreateMode('clone');
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
      setAppView,
      setCloneIncludeChats,
      setCloneSourceId,
      setCreateError,
      setCreateGroup,
      setCreateInitialMessage,
      setCreateMessageSuffixRows,
      setCreateMode,
      setCreateName,
      setCreateOpen,
      setCreateRepoPath,
      setDraftChat,
      setDraftCreateError,
      setDraftCreateOpen,
      suggestCloneName,
    ],
  );

  return {
    openCreateModal,
    openDraftChatComposer,
    openCloneModal,
  };
}
