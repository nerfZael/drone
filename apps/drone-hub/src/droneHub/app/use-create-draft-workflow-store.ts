import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

type CreateRuntime = 'container' | 'host';
type DraftCreateMode = 'with-chat' | 'without-chat';

type Updater<T> = T | ((prev: T) => T);

type CreateDraftWorkflowState = {
  creating: boolean;
  createRuntime: CreateRuntime;
  createAsDraft: boolean;
  createPersistVolume: boolean;
  draftCreateOpen: boolean;
  draftCreateMode: DraftCreateMode;
  draftCreateName: string;
  draftCreateGroup: string;
  draftCreateParentDroneId: string | null;
  draftCreateError: string | null;
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  draftNameSuggesting: boolean;
  draftSuggestedName: string;
  draftNameSuggestionError: string | null;
  setCreating: (next: Updater<boolean>) => void;
  setCreateRuntime: (next: Updater<CreateRuntime>) => void;
  setCreateAsDraft: (next: Updater<boolean>) => void;
  setCreatePersistVolume: (next: Updater<boolean>) => void;
  setDraftCreateOpen: (next: Updater<boolean>) => void;
  setDraftCreateMode: (next: Updater<DraftCreateMode>) => void;
  setDraftCreateName: (next: Updater<string>) => void;
  setDraftCreateGroup: (next: Updater<string>) => void;
  setDraftCreateParentDroneId: (next: Updater<string | null>) => void;
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
  creating: false,
  createRuntime: 'container',
  createAsDraft: false,
  createPersistVolume: false,
  draftCreateOpen: false,
  draftCreateMode: 'with-chat',
  draftCreateName: '',
  draftCreateGroup: '',
  draftCreateParentDroneId: null,
  draftCreateError: null,
  draftCreating: false,
  draftAutoRenaming: false,
  draftNameSuggesting: false,
  draftSuggestedName: '',
  draftNameSuggestionError: null,
  setCreating: (next) => set((s) => ({ creating: resolveNext(s.creating, next) })),
  setCreateRuntime: (next) => set((s) => ({ createRuntime: resolveNext(s.createRuntime, next) })),
  setCreateAsDraft: (next) => set((s) => ({ createAsDraft: resolveNext(s.createAsDraft, next) })),
  setCreatePersistVolume: (next) => set((s) => ({ createPersistVolume: resolveNext(s.createPersistVolume, next) })),
  setDraftCreateOpen: (next) => set((s) => ({ draftCreateOpen: resolveNext(s.draftCreateOpen, next) })),
  setDraftCreateMode: (next) => set((s) => ({ draftCreateMode: resolveNext(s.draftCreateMode, next) })),
  setDraftCreateName: (next) => set((s) => ({ draftCreateName: resolveNext(s.draftCreateName, next) })),
  setDraftCreateGroup: (next) => set((s) => ({ draftCreateGroup: resolveNext(s.draftCreateGroup, next) })),
  setDraftCreateParentDroneId: (next) => set((s) => ({ draftCreateParentDroneId: resolveNext(s.draftCreateParentDroneId, next) })),
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
      creating: s.creating,
      createRuntime: s.createRuntime,
      createAsDraft: s.createAsDraft,
      createPersistVolume: s.createPersistVolume,
      draftCreateOpen: s.draftCreateOpen,
      draftCreateMode: s.draftCreateMode,
      draftCreateName: s.draftCreateName,
      draftCreateGroup: s.draftCreateGroup,
      draftCreateParentDroneId: s.draftCreateParentDroneId,
      draftCreateError: s.draftCreateError,
      draftCreating: s.draftCreating,
      draftAutoRenaming: s.draftAutoRenaming,
      draftNameSuggesting: s.draftNameSuggesting,
      draftSuggestedName: s.draftSuggestedName,
      draftNameSuggestionError: s.draftNameSuggestionError,
      setCreating: s.setCreating,
      setCreateRuntime: s.setCreateRuntime,
      setCreateAsDraft: s.setCreateAsDraft,
      setCreatePersistVolume: s.setCreatePersistVolume,
      setDraftCreateOpen: s.setDraftCreateOpen,
      setDraftCreateMode: s.setDraftCreateMode,
      setDraftCreateName: s.setDraftCreateName,
      setDraftCreateGroup: s.setDraftCreateGroup,
      setDraftCreateParentDroneId: s.setDraftCreateParentDroneId,
      setDraftCreateError: s.setDraftCreateError,
      setDraftCreating: s.setDraftCreating,
      setDraftAutoRenaming: s.setDraftAutoRenaming,
      setDraftNameSuggesting: s.setDraftNameSuggesting,
      setDraftSuggestedName: s.setDraftSuggestedName,
      setDraftNameSuggestionError: s.setDraftNameSuggestionError,
    })),
  );
}
