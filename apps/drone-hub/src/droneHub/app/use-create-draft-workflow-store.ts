import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

type CreateMode = 'create' | 'clone';
type CreateRuntime = 'container' | 'host';
type DraftCreateMode = 'with-chat' | 'without-chat';

type Updater<T> = T | ((prev: T) => T);

type CreateDraftWorkflowState = {
  createOpen: boolean;
  creating: boolean;
  createMode: CreateMode;
  createRuntime: CreateRuntime;
  createAsDraft: boolean;
  createPersistVolume: boolean;
  cloneSourceId: string | null;
  cloneIncludeChats: boolean;
  createError: string | null;
  createGroup: string;
  createRepoPath: string;
  createAgentsMdLibraryFileId: string;
  createAgentsMdOverrideEnabled: boolean;
  createAgentsMdOverride: string;
  createInitialMessage: string;
  createRepoMenuOpen: boolean;
  draftCreateOpen: boolean;
  draftCreateMode: DraftCreateMode;
  draftCreateName: string;
  draftCreateGroup: string;
  draftCreateParentDroneId: string | null;
  draftAgentsMdLibraryFileId: string;
  draftAgentsMdOverrideEnabled: boolean;
  draftAgentsMdOverride: string;
  draftCreateError: string | null;
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  draftNameSuggesting: boolean;
  draftSuggestedName: string;
  draftNameSuggestionError: string | null;
  setCreateOpen: (next: Updater<boolean>) => void;
  setCreating: (next: Updater<boolean>) => void;
  setCreateMode: (next: Updater<CreateMode>) => void;
  setCreateRuntime: (next: Updater<CreateRuntime>) => void;
  setCreateAsDraft: (next: Updater<boolean>) => void;
  setCreatePersistVolume: (next: Updater<boolean>) => void;
  setCloneSourceId: (next: Updater<string | null>) => void;
  setCloneIncludeChats: (next: Updater<boolean>) => void;
  setCreateError: (next: Updater<string | null>) => void;
  setCreateGroup: (next: Updater<string>) => void;
  setCreateRepoPath: (next: Updater<string>) => void;
  setCreateAgentsMdLibraryFileId: (next: Updater<string>) => void;
  setCreateAgentsMdOverrideEnabled: (next: Updater<boolean>) => void;
  setCreateAgentsMdOverride: (next: Updater<string>) => void;
  setCreateInitialMessage: (next: Updater<string>) => void;
  setCreateRepoMenuOpen: (next: Updater<boolean>) => void;
  setDraftCreateOpen: (next: Updater<boolean>) => void;
  setDraftCreateMode: (next: Updater<DraftCreateMode>) => void;
  setDraftCreateName: (next: Updater<string>) => void;
  setDraftCreateGroup: (next: Updater<string>) => void;
  setDraftCreateParentDroneId: (next: Updater<string | null>) => void;
  setDraftAgentsMdLibraryFileId: (next: Updater<string>) => void;
  setDraftAgentsMdOverrideEnabled: (next: Updater<boolean>) => void;
  setDraftAgentsMdOverride: (next: Updater<string>) => void;
  setDraftCreateError: (next: Updater<string | null>) => void;
  setDraftCreating: (next: Updater<boolean>) => void;
  setDraftAutoRenaming: (next: Updater<boolean>) => void;
  setDraftNameSuggesting: (next: Updater<boolean>) => void;
  setDraftSuggestedName: (next: Updater<string>) => void;
  setDraftNameSuggestionError: (next: Updater<string | null>) => void;
};

function resolveNext<T>(prev: T, next: Updater<T>): T {
  return typeof next === 'function' ? (next as (current: T) => T)(prev) : next;
}

const useCreateDraftWorkflowStore = create<CreateDraftWorkflowState>((set) => ({
  createOpen: false,
  creating: false,
  createMode: 'create',
  createRuntime: 'container',
  createAsDraft: false,
  createPersistVolume: false,
  cloneSourceId: null,
  cloneIncludeChats: true,
  createError: null,
  createGroup: '',
  createRepoPath: '',
  createAgentsMdLibraryFileId: '',
  createAgentsMdOverrideEnabled: false,
  createAgentsMdOverride: '',
  createInitialMessage: '',
  createRepoMenuOpen: false,
  draftCreateOpen: false,
  draftCreateMode: 'with-chat',
  draftCreateName: '',
  draftCreateGroup: '',
  draftCreateParentDroneId: null,
  draftAgentsMdLibraryFileId: '',
  draftAgentsMdOverrideEnabled: false,
  draftAgentsMdOverride: '',
  draftCreateError: null,
  draftCreating: false,
  draftAutoRenaming: false,
  draftNameSuggesting: false,
  draftSuggestedName: '',
  draftNameSuggestionError: null,
  setCreateOpen: (next) => set((s) => ({ createOpen: resolveNext(s.createOpen, next) })),
  setCreating: (next) => set((s) => ({ creating: resolveNext(s.creating, next) })),
  setCreateMode: (next) => set((s) => ({ createMode: resolveNext(s.createMode, next) })),
  setCreateRuntime: (next) => set((s) => ({ createRuntime: resolveNext(s.createRuntime, next) })),
  setCreateAsDraft: (next) => set((s) => ({ createAsDraft: resolveNext(s.createAsDraft, next) })),
  setCreatePersistVolume: (next) => set((s) => ({ createPersistVolume: resolveNext(s.createPersistVolume, next) })),
  setCloneSourceId: (next) => set((s) => ({ cloneSourceId: resolveNext(s.cloneSourceId, next) })),
  setCloneIncludeChats: (next) => set((s) => ({ cloneIncludeChats: resolveNext(s.cloneIncludeChats, next) })),
  setCreateError: (next) => set((s) => ({ createError: resolveNext(s.createError, next) })),
  setCreateGroup: (next) => set((s) => ({ createGroup: resolveNext(s.createGroup, next) })),
  setCreateRepoPath: (next) => set((s) => ({ createRepoPath: resolveNext(s.createRepoPath, next) })),
  setCreateAgentsMdLibraryFileId: (next) =>
    set((s) => ({
      createAgentsMdLibraryFileId: resolveNext(s.createAgentsMdLibraryFileId, next),
    })),
  setCreateAgentsMdOverrideEnabled: (next) =>
    set((s) => ({
      createAgentsMdOverrideEnabled: resolveNext(s.createAgentsMdOverrideEnabled, next),
    })),
  setCreateAgentsMdOverride: (next) =>
    set((s) => ({ createAgentsMdOverride: resolveNext(s.createAgentsMdOverride, next) })),
  setCreateInitialMessage: (next) => set((s) => ({ createInitialMessage: resolveNext(s.createInitialMessage, next) })),
  setCreateRepoMenuOpen: (next) => set((s) => ({ createRepoMenuOpen: resolveNext(s.createRepoMenuOpen, next) })),
  setDraftCreateOpen: (next) => set((s) => ({ draftCreateOpen: resolveNext(s.draftCreateOpen, next) })),
  setDraftCreateMode: (next) => set((s) => ({ draftCreateMode: resolveNext(s.draftCreateMode, next) })),
  setDraftCreateName: (next) => set((s) => ({ draftCreateName: resolveNext(s.draftCreateName, next) })),
  setDraftCreateGroup: (next) => set((s) => ({ draftCreateGroup: resolveNext(s.draftCreateGroup, next) })),
  setDraftCreateParentDroneId: (next) => set((s) => ({ draftCreateParentDroneId: resolveNext(s.draftCreateParentDroneId, next) })),
  setDraftAgentsMdLibraryFileId: (next) =>
    set((s) => ({
      draftAgentsMdLibraryFileId: resolveNext(s.draftAgentsMdLibraryFileId, next),
    })),
  setDraftAgentsMdOverrideEnabled: (next) =>
    set((s) => ({
      draftAgentsMdOverrideEnabled: resolveNext(s.draftAgentsMdOverrideEnabled, next),
    })),
  setDraftAgentsMdOverride: (next) =>
    set((s) => ({ draftAgentsMdOverride: resolveNext(s.draftAgentsMdOverride, next) })),
  setDraftCreateError: (next) => set((s) => ({ draftCreateError: resolveNext(s.draftCreateError, next) })),
  setDraftCreating: (next) => set((s) => ({ draftCreating: resolveNext(s.draftCreating, next) })),
  setDraftAutoRenaming: (next) => set((s) => ({ draftAutoRenaming: resolveNext(s.draftAutoRenaming, next) })),
  setDraftNameSuggesting: (next) => set((s) => ({ draftNameSuggesting: resolveNext(s.draftNameSuggesting, next) })),
  setDraftSuggestedName: (next) => set((s) => ({ draftSuggestedName: resolveNext(s.draftSuggestedName, next) })),
  setDraftNameSuggestionError: (next) =>
    set((s) => ({ draftNameSuggestionError: resolveNext(s.draftNameSuggestionError, next) })),
}));

export function useCreateDraftWorkflowState() {
  return useCreateDraftWorkflowStore(
    useShallow((s) => ({
      createOpen: s.createOpen,
      creating: s.creating,
      createMode: s.createMode,
      createRuntime: s.createRuntime,
      createAsDraft: s.createAsDraft,
      createPersistVolume: s.createPersistVolume,
      cloneSourceId: s.cloneSourceId,
      cloneIncludeChats: s.cloneIncludeChats,
      createError: s.createError,
      createGroup: s.createGroup,
      createRepoPath: s.createRepoPath,
      createAgentsMdLibraryFileId: s.createAgentsMdLibraryFileId,
      createAgentsMdOverrideEnabled: s.createAgentsMdOverrideEnabled,
      createAgentsMdOverride: s.createAgentsMdOverride,
      createInitialMessage: s.createInitialMessage,
      createRepoMenuOpen: s.createRepoMenuOpen,
      draftCreateOpen: s.draftCreateOpen,
      draftCreateMode: s.draftCreateMode,
      draftCreateName: s.draftCreateName,
      draftCreateGroup: s.draftCreateGroup,
      draftCreateParentDroneId: s.draftCreateParentDroneId,
      draftAgentsMdLibraryFileId: s.draftAgentsMdLibraryFileId,
      draftAgentsMdOverrideEnabled: s.draftAgentsMdOverrideEnabled,
      draftAgentsMdOverride: s.draftAgentsMdOverride,
      draftCreateError: s.draftCreateError,
      draftCreating: s.draftCreating,
      draftAutoRenaming: s.draftAutoRenaming,
      draftNameSuggesting: s.draftNameSuggesting,
      draftSuggestedName: s.draftSuggestedName,
      draftNameSuggestionError: s.draftNameSuggestionError,
      setCreateOpen: s.setCreateOpen,
      setCreating: s.setCreating,
      setCreateMode: s.setCreateMode,
      setCreateRuntime: s.setCreateRuntime,
      setCreateAsDraft: s.setCreateAsDraft,
      setCreatePersistVolume: s.setCreatePersistVolume,
      setCloneSourceId: s.setCloneSourceId,
      setCloneIncludeChats: s.setCloneIncludeChats,
      setCreateError: s.setCreateError,
      setCreateGroup: s.setCreateGroup,
      setCreateRepoPath: s.setCreateRepoPath,
      setCreateAgentsMdLibraryFileId: s.setCreateAgentsMdLibraryFileId,
      setCreateAgentsMdOverrideEnabled: s.setCreateAgentsMdOverrideEnabled,
      setCreateAgentsMdOverride: s.setCreateAgentsMdOverride,
      setCreateInitialMessage: s.setCreateInitialMessage,
      setCreateRepoMenuOpen: s.setCreateRepoMenuOpen,
      setDraftCreateOpen: s.setDraftCreateOpen,
      setDraftCreateMode: s.setDraftCreateMode,
      setDraftCreateName: s.setDraftCreateName,
      setDraftCreateGroup: s.setDraftCreateGroup,
      setDraftCreateParentDroneId: s.setDraftCreateParentDroneId,
      setDraftAgentsMdLibraryFileId: s.setDraftAgentsMdLibraryFileId,
      setDraftAgentsMdOverrideEnabled: s.setDraftAgentsMdOverrideEnabled,
      setDraftAgentsMdOverride: s.setDraftAgentsMdOverride,
      setDraftCreateError: s.setDraftCreateError,
      setDraftCreating: s.setDraftCreating,
      setDraftAutoRenaming: s.setDraftAutoRenaming,
      setDraftNameSuggesting: s.setDraftNameSuggesting,
      setDraftSuggestedName: s.setDraftSuggestedName,
      setDraftNameSuggestionError: s.setDraftNameSuggestionError,
    })),
  );
}
