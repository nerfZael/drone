import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary } from '../types';
import type { SidebarMoveIntent } from '@drone/hub-model/sidebar';
import { joinSidebarGroupPath, isSameOrDescendantSidebarGroupPath, sidebarGroupBaseName, sidebarGroupParentPath } from './sidebar-group-paths';
import {
  observeSidebarSelectionForExpansion,
  sidebarInlineSectionKey,
  type SidebarInlineSectionKind,
} from './sidebar-inline-sections';
import {
  placeCreatedSidebarFolderBeforeNode,
  sidebarChatSidebarNodeId,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
} from './sidebar-node-order';
import type { SidebarNodeTreeModel } from './sidebar-node-tree';
import type { DroneSelectionClickOptions } from './drone-selection-helpers';
import { isSidebarGroupCollapsed } from './is-sidebar-group-collapsed';
import { normalizedDroneChats } from './chat-node-helpers';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

export type FolderEditorState = {
  mode: 'create' | 'rename';
  parentPath: string | null;
  anchorPath: string | null;
  beforeNodeId: string | null;
  targetPath: string | null;
  repoGroupPath: string | null;
  value: string;
  error: string | null;
  pending: boolean;
  dismissOnBlur?: boolean;
};

export type ChatEditorState = {
  mode: 'create' | 'rename';
  droneId: string;
  targetChatName: string | null;
  value: string;
  createAsDraft?: boolean;
  error: string | null;
  pending: boolean;
};

type CreateGroupResult = {
  ok: boolean;
  error: string | null;
};

type UseSidebarInteractionsArgs = {
  activeChatName: string;
  collapsedGroups: Record<string, boolean>;
  draftSidebarPlaceholderNodeId: string | null;
  draftSidebarPlaceholderDroneId: string;
  isRepoGroupingMode: boolean;
  onCreateDroneChat: (
    drone: DroneSummary,
    chatName: string,
    opts?: { draft?: boolean },
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onRenameDroneChat: (
    droneId: string,
    chatName: string,
    newName: string,
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onMoveSidebar?: (intent: SidebarMoveIntent) => Promise<boolean>;
  onSelectDroneCard: (droneId: string, opts?: DroneSelectionClickOptions) => void;
  onSelectDroneChat: (droneId: string, chatName: string) => void;
  onToggleGroupCollapsed: (group: string) => void;
  optimisticSidebarDronesFilteredByRepo: DroneSummary[];
  runOptimisticCreateGroup: (
    group: string,
    opts?: { placement?: 'start' | 'end' },
  ) => Promise<CreateGroupResult>;
  runOptimisticRenameGroup: (group: string, nextName?: string) => Promise<boolean>;
  selectedDrone: string | null;
  setSidebarNodeOrderByParent: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  getRenderedSidebarNodeTree: () => SidebarNodeTreeModel | null;
  sidebarDroneById: Record<string, DroneSummary>;
  visibleSidebarFolderPathSet: Set<string>;
};

export function useSidebarInteractions({
  activeChatName,
  collapsedGroups,
  draftSidebarPlaceholderNodeId,
  draftSidebarPlaceholderDroneId,
  isRepoGroupingMode,
  onCreateDroneChat,
  onRenameDroneChat,
  onMoveSidebar,
  onSelectDroneCard,
  onSelectDroneChat,
  onToggleGroupCollapsed,
  optimisticSidebarDronesFilteredByRepo,
  runOptimisticCreateGroup,
  runOptimisticRenameGroup,
  selectedDrone,
  setSidebarNodeOrderByParent,
  getRenderedSidebarNodeTree,
  sidebarDroneById,
  visibleSidebarFolderPathSet,
}: UseSidebarInteractionsArgs) {
  const [selectedSidebarNodeId, setSelectedSidebarNodeId] = React.useState<string | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = React.useState<string | null>(null);
  const [folderEditor, setFolderEditor] = React.useState<FolderEditorState | null>(null);
  const [chatEditor, setChatEditor] = React.useState<ChatEditorState | null>(null);
  const collapsedDroneSections = useDroneHubUiStore((state) => state.collapsedDroneSections);
  const setCollapsedDroneSections = useDroneHubUiStore(
    (state) => state.setCollapsedDroneSections,
  );
  const selectionExpansionRef = React.useRef({ initialized: false, key: '' });
  const folderEditorInputRef = React.useRef<HTMLInputElement>(null);
  const chatEditorInputRef = React.useRef<HTMLInputElement>(null);
  const selectedDroneChatCount = normalizedDroneChats(
    sidebarDroneById[String(selectedDrone ?? '').trim()],
    { includeDefaultWhenEmpty: true },
  ).length;

  const folderEditorFocusKey = React.useMemo(
    () =>
      folderEditor
        ? `${folderEditor.mode}:${folderEditor.parentPath ?? ''}:${folderEditor.anchorPath ?? ''}:${folderEditor.beforeNodeId ?? ''}:${folderEditor.targetPath ?? ''}:${folderEditor.repoGroupPath ?? ''}`
        : null,
    [folderEditor],
  );

  React.useEffect(() => {
    if (!folderEditorFocusKey) return;
    const id = window.requestAnimationFrame(() => {
      folderEditorInputRef.current?.focus();
      folderEditorInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [folderEditorFocusKey]);

  const chatEditorFocusKey = React.useMemo(
    () => (chatEditor ? `${chatEditor.mode}:${chatEditor.droneId}:${chatEditor.targetChatName ?? ''}` : null),
    [chatEditor],
  );

  React.useEffect(() => {
    if (!chatEditorFocusKey) return;
    const id = window.requestAnimationFrame(() => {
      chatEditorInputRef.current?.focus();
      chatEditorInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [chatEditorFocusKey]);

  const closeFolderEditor = React.useCallback(() => {
    setFolderEditor(null);
  }, []);

  const updateFolderEditorValue = React.useCallback((next: string) => {
    setFolderEditor((prev: FolderEditorState | null) => (prev ? { ...prev, value: next, error: null } : prev));
  }, []);

  const closeChatEditor = React.useCallback(() => {
    setChatEditor(null);
  }, []);

  const updateChatEditorValue = React.useCallback((next: string) => {
    setChatEditor((prev: ChatEditorState | null) => (prev ? { ...prev, value: next, error: null } : prev));
  }, []);

  const updateChatEditorCreateAsDraft = React.useCallback((next: boolean) => {
    setChatEditor((prev: ChatEditorState | null) =>
      prev && prev.mode === 'create' ? { ...prev, createAsDraft: next, error: null } : prev,
    );
  }, []);

  const openDroneChatCreate = React.useCallback((drone: DroneSummary) => {
    const droneId = String(drone?.id ?? '').trim();
    if (!droneId) return;
    const existingChats = Array.isArray(drone?.chats) && drone.chats.length > 0 ? drone.chats : ['default'];
    const seedName = `chat-${Math.max(1, existingChats.length + 1)}`;
    setSelectedSidebarNodeId(sidebarDroneNodeId(droneId));
    setFolderEditor(null);
    setChatEditor({
      mode: 'create',
      droneId,
      targetChatName: null,
      value: seedName,
      createAsDraft: false,
      error: null,
      pending: false,
    });
  }, []);

  const startRenameDroneChat = React.useCallback((droneIdRaw: string, chatNameRaw: string) => {
    const droneId = String(droneIdRaw ?? '').trim();
    const chatName = String(chatNameRaw ?? '').trim() || 'default';
    if (!droneId || !chatName || chatName === 'default') return;
    const chatSectionKey = sidebarInlineSectionKey(droneId, 'chats');
    setCollapsedDroneSections((prev: Record<string, boolean>) =>
      prev[chatSectionKey] ? { ...prev, [chatSectionKey]: false } : prev,
    );
    setSelectedSidebarNodeId(sidebarChatSidebarNodeId(droneId, chatName));
    setFolderEditor(null);
    setChatEditor({
      mode: 'rename',
      droneId,
      targetChatName: chatName,
      value: chatName,
      error: null,
      pending: false,
    });
  }, [setCollapsedDroneSections]);

  const openFolderCreate = React.useCallback(
    (
      parentPathRaw: string | null,
      opts?: {
        anchorPath?: string | null;
        beforeNodeId?: string | null;
        repoGroupPath?: string | null;
        initialValue?: string;
        dismissOnBlur?: boolean;
      },
    ) => {
      const parentPath = String(parentPathRaw ?? '').trim() || null;
      const anchorPath = String(opts?.anchorPath ?? '').trim() || parentPath;
      const beforeNodeId = String(opts?.beforeNodeId ?? '').trim() || null;
      const repoGroupPath = String(opts?.repoGroupPath ?? '').trim() || null;
      if (parentPath && isSidebarGroupCollapsed(collapsedGroups, parentPath)) {
        onToggleGroupCollapsed(parentPath);
      }
      if (!beforeNodeId) setSelectedFolderPath(anchorPath);
      setChatEditor(null);
      setFolderEditor({
        mode: 'create',
        parentPath,
        anchorPath,
        beforeNodeId,
        targetPath: null,
        repoGroupPath,
        value: String(opts?.initialValue ?? ''),
        error: null,
        pending: false,
        dismissOnBlur: opts?.dismissOnBlur === true,
      });
    },
    [collapsedGroups, onToggleGroupCollapsed],
  );

  const startRenameFolder = React.useCallback((groupRaw: string) => {
    const group = String(groupRaw ?? '').trim();
    if (!group || isUngroupedGroupName(group)) return;
    setSelectedFolderPath(group);
    setChatEditor(null);
    setFolderEditor({
      mode: 'rename',
      parentPath: sidebarGroupParentPath(group),
      anchorPath: group,
      beforeNodeId: null,
      targetPath: group,
      repoGroupPath: null,
      value: sidebarGroupBaseName(group),
      error: null,
      pending: false,
    });
  }, []);

  const submitFolderEditor = React.useCallback(async () => {
    const draft = folderEditor;
    if (!draft || draft.pending) return;
    const segment = String(draft.value ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (!segment) {
      setFolderEditor((prev: FolderEditorState | null) => (prev ? { ...prev, error: 'Folder name is required.' } : prev));
      return;
    }
    if (segment.includes('/')) {
      setFolderEditor((prev: FolderEditorState | null) => (prev ? { ...prev, error: 'Use one folder segment here.' } : prev));
      return;
    }
    const nextPath = joinSidebarGroupPath([draft.parentPath, segment]);
    if (!nextPath) {
      setFolderEditor((prev: FolderEditorState | null) => (prev ? { ...prev, error: 'Folder name is required.' } : prev));
      return;
    }

    setFolderEditor((prev: FolderEditorState | null) => (prev ? { ...prev, pending: true, error: null } : prev));
    if (draft.mode === 'create') {
      const result = await runOptimisticCreateGroup(nextPath, {
        placement: 'start',
      });
      if (!result.ok) {
        setFolderEditor((prev: FolderEditorState | null) => (prev ? { ...prev, pending: false, error: result.error || 'Create folder failed.' } : prev));
        return;
      }
      const repoGroupPath = draft.repoGroupPath;
      setSidebarNodeOrderByParent((prev) =>
        placeCreatedSidebarFolderBeforeNode(
          prev,
          getRenderedSidebarNodeTree(),
          nextPath,
          repoGroupPath,
          draft.beforeNodeId,
        ),
      );
      setSelectedFolderPath(nextPath);
      setSelectedSidebarNodeId(isRepoGroupingMode ? null : sidebarFolderNodeId(nextPath));
      setFolderEditor(null);
      return;
    }

    try {
      const ok = await runOptimisticRenameGroup(draft.targetPath ?? '', nextPath);
      if (!ok) {
        setFolderEditor((prev: FolderEditorState | null) => (prev ? { ...prev, pending: false } : prev));
        return;
      }
      setSelectedFolderPath(nextPath);
      setSelectedSidebarNodeId(isRepoGroupingMode ? null : sidebarFolderNodeId(nextPath));
      setFolderEditor(null);
    } catch (error: any) {
      const message = String(error?.message ?? error ?? '').trim();
      setFolderEditor((prev: FolderEditorState | null) => (prev ? { ...prev, pending: false, error: message || 'Rename folder failed.' } : prev));
    }
  }, [
    folderEditor,
    getRenderedSidebarNodeTree,
    isRepoGroupingMode,
    runOptimisticCreateGroup,
    runOptimisticRenameGroup,
    setSidebarNodeOrderByParent,
  ]);

  const blurFolderEditor = React.useCallback(() => {
    const draft = folderEditor;
    if (!draft || draft.pending) return;
    if (draft.mode === 'rename' || draft.dismissOnBlur) {
      setFolderEditor(null);
      return;
    }
    const segment = String(draft.value ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (!segment) {
      setFolderEditor(null);
      return;
    }
    void submitFolderEditor();
  }, [folderEditor, submitFolderEditor]);

  const submitChatEditor = React.useCallback(async () => {
    const draft = chatEditor;
    if (!draft || draft.pending) return;
    const chatName = String(draft.value ?? '').trim();
    if (!chatName) {
      setChatEditor((prev: ChatEditorState | null) => (prev ? { ...prev, error: 'Chat name is required.' } : prev));
      return;
    }

    setChatEditor((prev: ChatEditorState | null) => (prev ? { ...prev, pending: true, error: null } : prev));
    if (draft.mode === 'create') {
      const drone =
        optimisticSidebarDronesFilteredByRepo.find((candidate) => {
          const droneId = String(candidate?.id ?? '').trim();
          return droneId === draft.droneId;
        }) ?? null;
      if (!drone) {
        setChatEditor((prev: ChatEditorState | null) => (prev ? { ...prev, pending: false, error: 'Drone is unavailable.' } : prev));
        return;
      }
      const result = await onCreateDroneChat(drone, chatName, { draft: draft.createAsDraft === true });
      if (!result.ok) {
        setChatEditor((prev: ChatEditorState | null) => (prev ? { ...prev, pending: false, error: result.error || 'Create chat failed.' } : prev));
        return;
      }
      const nextChatName = String(result.chatName ?? chatName).trim() || chatName;
      setSelectedFolderPath(null);
      setSelectedSidebarNodeId(sidebarChatSidebarNodeId(draft.droneId, nextChatName));
      onSelectDroneChat(draft.droneId, nextChatName);
      setChatEditor(null);
      return;
    }

    const targetChatName = String(draft.targetChatName ?? '').trim();
    const result = await onRenameDroneChat(draft.droneId, targetChatName, chatName);
    if (!result.ok) {
      setChatEditor((prev: ChatEditorState | null) => (prev ? { ...prev, pending: false, error: result.error || 'Rename chat failed.' } : prev));
      return;
    }
    const nextChatName = String(result.chatName ?? chatName).trim() || chatName;
    const previousMuteId = sidebarChatSidebarNodeId(draft.droneId, targetChatName);
    const nextMuteId = sidebarChatSidebarNodeId(draft.droneId, nextChatName);
    if (
      previousMuteId !== nextMuteId &&
      useDroneHubUiStore.getState().mutedChatIds.includes(previousMuteId) &&
      onMoveSidebar
    ) {
      const migrated = await onMoveSidebar({
        kind: 'set-muted',
        targetKind: 'chat',
        targetId: nextMuteId,
        muted: true,
      });
      if (migrated) {
        await onMoveSidebar({
          kind: 'set-muted',
          targetKind: 'chat',
          targetId: previousMuteId,
          muted: false,
        });
      }
    }
    setSelectedFolderPath(null);
    setSelectedSidebarNodeId(sidebarChatSidebarNodeId(draft.droneId, nextChatName));
    onSelectDroneChat(draft.droneId, nextChatName);
    setChatEditor(null);
  }, [chatEditor, onCreateDroneChat, onMoveSidebar, onRenameDroneChat, onSelectDroneChat, optimisticSidebarDronesFilteredByRepo]);

  const blurChatEditor = React.useCallback(() => {
    const draft = chatEditor;
    if (!draft || draft.pending) return;
    if (draft.mode === 'rename') {
      setChatEditor(null);
      return;
    }
    const chatName = String(draft.value ?? '').trim();
    if (!chatName) {
      setChatEditor(null);
      return;
    }
    void submitChatEditor();
  }, [chatEditor, submitChatEditor]);

  const moveFolderIntoGroup = React.useCallback(
    async (sourceGroupRaw: string, targetGroupRaw: string) => {
      const sourceGroup = String(sourceGroupRaw ?? '').trim();
      const targetGroup = String(targetGroupRaw ?? '').trim();
      if (!sourceGroup || !targetGroup) return false;
      if (isUngroupedGroupName(sourceGroup) || isUngroupedGroupName(targetGroup)) return false;
      if (sourceGroup === targetGroup) return false;
      if (isSameOrDescendantSidebarGroupPath(targetGroup, sourceGroup)) return false;
      const nextGroup = joinSidebarGroupPath([targetGroup, sidebarGroupBaseName(sourceGroup)]);
      if (!nextGroup || nextGroup === sourceGroup) return false;
      const ok = await runOptimisticRenameGroup(sourceGroup, nextGroup);
      if (ok) {
        setSelectedFolderPath(nextGroup);
        setSelectedSidebarNodeId(sidebarFolderNodeId(nextGroup));
      }
      return ok;
    },
    [runOptimisticRenameGroup],
  );

  const handleGroupedSelectFolder = React.useCallback((path: string, folderNodeId?: string) => {
    setSelectedFolderPath(path);
    setSelectedSidebarNodeId(folderNodeId || sidebarFolderNodeId(path));
  }, []);

  const clearGroupedFolderSelection = React.useCallback((pathRaw?: string, folderNodeIdRaw?: string) => {
    const path = String(pathRaw ?? '').trim();
    const folderNodeId = String(folderNodeIdRaw ?? '').trim();
    setSelectedFolderPath((prev) => (!path || prev === path ? null : prev));
    setSelectedSidebarNodeId((prev) =>
      !path || prev === (folderNodeId || sidebarFolderNodeId(path)) ? null : prev,
    );
  }, []);

  const handleGroupedSelectDroneCard = React.useCallback(
    (droneId: string, opts?: DroneSelectionClickOptions) => {
      setSelectedFolderPath(null);
      setSelectedSidebarNodeId(sidebarDroneNodeId(droneId));
      onSelectDroneCard(droneId, opts);
    },
    [onSelectDroneCard],
  );

  const handleGroupedSelectDroneContainer = React.useCallback((droneIdRaw: string) => {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    setSelectedFolderPath(null);
    setSelectedSidebarNodeId(sidebarDroneNodeId(droneId));
  }, []);

  const handleGroupedSelectDroneChat = React.useCallback(
    (droneId: string, chatName: string) => {
      setSelectedFolderPath(null);
      setSelectedSidebarNodeId(sidebarChatSidebarNodeId(droneId, chatName));
      onSelectDroneChat(droneId, chatName);
    },
    [onSelectDroneChat],
  );

  const toggleDroneSection = React.useCallback((droneIdRaw: string, kind: SidebarInlineSectionKind) => {
    const key = sidebarInlineSectionKey(droneIdRaw, kind);
    setCollapsedDroneSections((prev: Record<string, boolean>) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  React.useEffect(() => {
    if (!selectedFolderPath) return;
    if (visibleSidebarFolderPathSet.has(selectedFolderPath)) return;
    setSelectedFolderPath(null);
    setSelectedSidebarNodeId((prev: string | null) => (prev === sidebarFolderNodeId(selectedFolderPath) ? null : prev));
    setFolderEditor((prev: FolderEditorState | null) =>
      prev?.targetPath === selectedFolderPath || prev?.parentPath === selectedFolderPath || prev?.anchorPath === selectedFolderPath
        ? null
        : prev,
    );
  }, [selectedFolderPath, visibleSidebarFolderPathSet]);

  React.useEffect(() => {
    const droneId = String(chatEditor?.droneId ?? '').trim();
    if (!droneId) return;
    if (sidebarDroneById[droneId]) return;
    setChatEditor(null);
  }, [chatEditor, sidebarDroneById]);

  React.useEffect(() => {
    if (draftSidebarPlaceholderNodeId) {
      setSelectedFolderPath(null);
      setSelectedSidebarNodeId(draftSidebarPlaceholderNodeId);
      return;
    }
    setSelectedSidebarNodeId((prev: string | null) => (prev === sidebarDroneNodeId(draftSidebarPlaceholderDroneId) ? null : prev));
  }, [draftSidebarPlaceholderDroneId, draftSidebarPlaceholderNodeId]);

  React.useEffect(() => {
    const droneId = String(selectedDrone ?? '').trim();
    if (!droneId) return;
    const selectedChatName = String(activeChatName ?? '').trim() || 'default';
    const selectedDroneHasMultipleChats = selectedDroneChatCount > 1;
    const nextNodeId =
      selectedDroneHasMultipleChats || selectedChatName !== 'default'
        ? sidebarChatSidebarNodeId(droneId, selectedChatName)
        : sidebarDroneNodeId(droneId);
    setSelectedSidebarNodeId((prev: string | null) => (prev && prev.startsWith('folder:') ? prev : nextNodeId));
  }, [activeChatName, selectedDrone, selectedDroneChatCount]);

  React.useEffect(() => {
    const selectedDroneId = String(selectedDrone ?? '').trim();
    const selectedChatName = String(activeChatName ?? '').trim() || 'default';
    if (
      !observeSidebarSelectionForExpansion(
        selectionExpansionRef.current,
        selectedDroneId,
        selectedChatName,
        Boolean(sidebarDroneById[selectedDroneId]),
      )
    ) {
      return;
    }
    setCollapsedDroneSections((prev: Record<string, boolean>) => {
      const next = { ...prev };
      let changed = false;

      if (selectedChatName !== 'default') {
        const chatKey = sidebarInlineSectionKey(selectedDroneId, 'chats');
        if (next[chatKey]) {
          next[chatKey] = false;
          changed = true;
        }
      }

      const visited = new Set<string>();
      let currentDroneId = selectedDroneId;
      while (currentDroneId && !visited.has(currentDroneId)) {
        visited.add(currentDroneId);
        const parentId = String(sidebarDroneById[currentDroneId]?.fleetParentId ?? '').trim();
        if (!parentId || !sidebarDroneById[parentId]) break;
        const childrenKey = sidebarInlineSectionKey(parentId, 'children');
        if (next[childrenKey]) {
          next[childrenKey] = false;
          changed = true;
        }
        currentDroneId = parentId;
      }

      return changed ? next : prev;
    });
  }, [activeChatName, selectedDrone, sidebarDroneById]);

  return {
    blurChatEditor,
    blurFolderEditor,
    chatEditor,
    chatEditorInputRef,
    closeChatEditor,
    closeFolderEditor,
    collapsedDroneSections,
    folderEditor,
    folderEditorInputRef,
    clearGroupedFolderSelection,
    handleGroupedSelectDroneCard,
    handleGroupedSelectDroneContainer,
    handleGroupedSelectDroneChat,
    handleGroupedSelectFolder,
    moveFolderIntoGroup,
    openDroneChatCreate,
    openFolderCreate,
    selectedFolderPath,
    selectedSidebarNodeId,
    setCollapsedDroneSections,
    setSelectedSidebarNodeId,
    startRenameDroneChat,
    startRenameFolder,
    submitChatEditor,
    submitFolderEditor,
    toggleDroneSection,
    updateChatEditorValue,
    updateChatEditorCreateAsDraft,
    updateFolderEditorValue,
  };
}
