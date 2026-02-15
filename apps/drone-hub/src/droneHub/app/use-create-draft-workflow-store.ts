import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

type CreateMode = 'create' | 'clone';

type Updater<T> = T | ((prev: T) => T);

type CreateDraftWorkflowState = {
  createOpen: boolean;
  creating: boolean;
  createMode: CreateMode;
  cloneSourceId: string | null;
  cloneIncludeChats: boolean;
  createError: string | null;
  createGroup: string;
  createRepoPath: string;
  createInitialMessage: string;
  createRepoMenuOpen: boolean;
  draftCreateOpen: boolean;
  draftCreateName: string;
  draftCreateGroup: string;
  draftCreateError: string | null;
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  draftNameSuggesting: boolean;
  draftSuggestedName: string;
  draftNameSuggestionError: string | null;
  setCreateOpen: (next: Updater<boolean>) => void;
  setCreating: (next: Updater<boolean>) => void;
  setCreateMode: (next: Updater<CreateMode>) => void;
  setCloneSourceId: (next: Updater<string | null>) => void;
  setCloneIncludeChats: (next: Updater<boolean>) => void;
  setCreateError: (next: Updater<string | null>) => void;
  setCreateGroup: (next: Updater<string>) => void;
  setCreateRepoPath: (next: Updater<string>) => void;
  setCreateInitialMessage: (next: Updater<string>) => void;
  setCreateRepoMenuOpen: (next: Updater<boolean>) => void;
  setDraftCreateOpen: (next: Updater<boolean>) => void;
  setDraftCreateName: (next: Updater<string>) => void;
  setDraftCreateGroup: (next: Updater<string>) => void;
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
  cloneSourceId: null,
  cloneIncludeChats: true,
  createError: null,
  createGroup: '',
  createRepoPath: '',
  createInitialMessage: '',
  createRepoMenuOpen: false,
  draftCreateOpen: false,
  draftCreateName: '',
  draftCreateGroup: '',
  draftCreateError: null,
  draftCreating: false,
  draftAutoRenaming: false,
  draftNameSuggesting: false,
  draftSuggestedName: '',
  draftNameSuggestionError: null,
  setCreateOpen: (next) => set((s) => ({ createOpen: resolveNext(s.createOpen, next) })),
  setCreating: (next) => set((s) => ({ creating: resolveNext(s.creating, next) })),
  setCreateMode: (next) => set((s) => ({ createMode: resolveNext(s.createMode, next) })),
  setCloneSourceId: (next) => set((s) => ({ cloneSourceId: resolveNext(s.cloneSourceId, next) })),
  setCloneIncludeChats: (next) => set((s) => ({ cloneIncludeChats: resolveNext(s.cloneIncludeChats, next) })),
  setCreateError: (next) => set((s) => ({ createError: resolveNext(s.createError, next) })),
  setCreateGroup: (next) => set((s) => ({ createGroup: resolveNext(s.createGroup, next) })),
  setCreateRepoPath: (next) => set((s) => ({ createRepoPath: resolveNext(s.createRepoPath, next) })),
  setCreateInitialMessage: (next) => set((s) => ({ createInitialMessage: resolveNext(s.createInitialMessage, next) })),
  setCreateRepoMenuOpen: (next) => set((s) => ({ createRepoMenuOpen: resolveNext(s.createRepoMenuOpen, next) })),
  setDraftCreateOpen: (next) => set((s) => ({ draftCreateOpen: resolveNext(s.draftCreateOpen, next) })),
  setDraftCreateName: (next) => set((s) => ({ draftCreateName: resolveNext(s.draftCreateName, next) })),
  setDraftCreateGroup: (next) => set((s) => ({ draftCreateGroup: resolveNext(s.draftCreateGroup, next) })),
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
      cloneSourceId: s.cloneSourceId,
      cloneIncludeChats: s.cloneIncludeChats,
      createError: s.createError,
      createGroup: s.createGroup,
      createRepoPath: s.createRepoPath,
      createInitialMessage: s.createInitialMessage,
      createRepoMenuOpen: s.createRepoMenuOpen,
      draftCreateOpen: s.draftCreateOpen,
      draftCreateName: s.draftCreateName,
      draftCreateGroup: s.draftCreateGroup,
      draftCreateError: s.draftCreateError,
      draftCreating: s.draftCreating,
      draftAutoRenaming: s.draftAutoRenaming,
      draftNameSuggesting: s.draftNameSuggesting,
      draftSuggestedName: s.draftSuggestedName,
      draftNameSuggestionError: s.draftNameSuggestionError,
      setCreateOpen: s.setCreateOpen,
      setCreating: s.setCreating,
      setCreateMode: s.setCreateMode,
      setCloneSourceId: s.setCloneSourceId,
      setCloneIncludeChats: s.setCloneIncludeChats,
      setCreateError: s.setCreateError,
      setCreateGroup: s.setCreateGroup,
      setCreateRepoPath: s.setCreateRepoPath,
      setCreateInitialMessage: s.setCreateInitialMessage,
      setCreateRepoMenuOpen: s.setCreateRepoMenuOpen,
      setDraftCreateOpen: s.setDraftCreateOpen,
      setDraftCreateName: s.setDraftCreateName,
      setDraftCreateGroup: s.setDraftCreateGroup,
      setDraftCreateError: s.setDraftCreateError,
      setDraftCreating: s.setDraftCreating,
      setDraftAutoRenaming: s.setDraftAutoRenaming,
      setDraftNameSuggesting: s.setDraftNameSuggesting,
      setDraftSuggestedName: s.setDraftSuggestedName,
      setDraftNameSuggestionError: s.setDraftNameSuggestionError,
    })),
  );
}
