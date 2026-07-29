import React from 'react';
import type { DraftChatState } from './app-types';
import { newDraftChatFocusKey } from './helpers';

type UseWorkspaceNavigationActionsArgs = {
  activeRepoPath: string;
  normalizeCreateRepoPath: (candidate: string) => string;
  selectionAnchorRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneHoldUntilRef: React.MutableRefObject<number>;
  setAppView: React.Dispatch<React.SetStateAction<'workspace' | 'settings'>>;
  setDraftChat: React.Dispatch<React.SetStateAction<DraftChatState | null>>;
  setDraftCreateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftCreateMode: React.Dispatch<React.SetStateAction<'with-chat' | 'without-chat'>>;
  setDraftCreateName: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateGroup: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateParentDroneId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftAgentsMdLibraryFileId: React.Dispatch<React.SetStateAction<string>>;
  setDraftAgentsMdOverrideEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftAgentsMdOverride: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftAutoRenaming: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftNameSuggestionError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftNameSuggesting: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateRuntime: React.Dispatch<React.SetStateAction<'container' | 'host'>>;
  setCreatePersistVolume: React.Dispatch<React.SetStateAction<boolean>>;
  setChatHeaderRepoPath: React.Dispatch<React.SetStateAction<string>>;
  setHomeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedDrone: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDroneIds: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedChat: React.Dispatch<React.SetStateAction<string>>;
  resetDraftNameSuggestSeq: () => void;
};

type OpenDraftChatComposerOptions = {
  repoPath?: string | null;
  group?: string | null;
  parentDroneId?: string | null;
};

export function useWorkspaceNavigationActions({
  activeRepoPath,
  normalizeCreateRepoPath,
  selectionAnchorRef,
  preferredSelectedDroneRef,
  preferredSelectedDroneHoldUntilRef,
  setAppView,
  setDraftChat,
  setDraftCreateOpen,
  setDraftCreateMode,
  setDraftCreateName,
  setDraftCreateGroup,
  setDraftCreateParentDroneId,
  setDraftAgentsMdLibraryFileId,
  setDraftAgentsMdOverrideEnabled,
  setDraftAgentsMdOverride,
  setDraftCreateError,
  setDraftCreating,
  setDraftAutoRenaming,
  setDraftNameSuggestionError,
  setDraftNameSuggesting,
  setCreateRuntime,
  setCreatePersistVolume,
  setChatHeaderRepoPath,
  setHomeOpen,
  setSelectedDrone,
  setSelectedDroneIds,
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
    setDraftAgentsMdLibraryFileId('');
    setDraftAgentsMdOverrideEnabled(false);
    setDraftAgentsMdOverride('');
    setDraftCreateError(null);
  }, [
    setDraftAgentsMdOverride,
    setDraftAgentsMdOverrideEnabled,
    setDraftAgentsMdLibraryFileId,
    setDraftCreateError,
    setDraftCreateOpen,
    setDraftCreateParentDroneId,
  ]);

  const openDraftChatComposer = React.useCallback(
    (opts?: OpenDraftChatComposerOptions) => {
      const hasRepoOverride =
        Boolean(opts) && Object.prototype.hasOwnProperty.call(opts, 'repoPath');
      const hasGroupOverride =
        Boolean(opts) && Object.prototype.hasOwnProperty.call(opts, 'group');
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
      setHomeOpen(false);
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
      setDraftChat({
        droneId: '',
        droneName: '',
        prompt: null,
        queuedPrompts: [],
        focusKey: newDraftChatFocusKey(),
      });
      clearSidebarSelection();
    },
    [
      activeRepoPath,
      clearSidebarSelection,
      normalizeCreateRepoPath,
      resetDraftCreateState,
      resetDraftNameSuggestSeq,
      setAppView,
      setChatHeaderRepoPath,
      setCreatePersistVolume,
      setCreateRuntime,
      setDraftAutoRenaming,
      setDraftChat,
      setDraftCreateGroup,
      setDraftCreateMode,
      setDraftCreateName,
      setDraftCreateParentDroneId,
      setDraftCreating,
      setDraftNameSuggestionError,
      setDraftNameSuggesting,
      setHomeOpen,
    ],
  );

  return { openDraftChatComposer };
}
