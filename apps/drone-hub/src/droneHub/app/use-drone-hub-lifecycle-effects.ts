import React from 'react';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../types';
import type { DraftChatState, DroneErrorModalState, StartupSeedState } from './app-types';
import type { RightPanelTab } from './app-config';
import { isStartupSeedFresh } from './app-config';
import { isUngroupedGroupName } from '../../domain';
import type { ShortcutActionId, ShortcutBindingMap } from './shortcuts';
import { SHORTCUT_DEFINITIONS, isShortcutMatch } from './shortcuts';
import { isDroneStartingOrSeeding } from './helpers';
import { useDropdownDismiss } from '../../ui/dropdown';

type Updater<T> = T | ((prev: T) => T);
type Setter<T> = (next: Updater<T>) => void;
type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type LlmSettingsLike =
  | {
      provider?: { selected?: string };
      openai?: { hasKey?: boolean };
      gemini?: { hasKey?: boolean };
    }
  | null
  | undefined;

type UseDroneHubLifecycleEffectsArgs = {
  normalizeCreateRepoPath: (candidate: string) => string;
  setCreateRepoPath: Setter<string>;
  terminalMenuRef: React.RefObject<HTMLDivElement | null>;
  terminalMenuOpen: boolean;
  setTerminalMenuOpen: Setter<boolean>;
  headerOverflowRef: React.RefObject<HTMLDivElement | null>;
  headerOverflowOpen: boolean;
  setHeaderOverflowOpen: Setter<boolean>;
  droneErrorModal: DroneErrorModalState | null;
  setDroneErrorModal: Setter<DroneErrorModalState | null>;
  openCreateModal: () => void;
  openDraftChatComposer: (opts?: { repoPath?: string | null; group?: string | null }) => void;
  openGroupMultiChat: (group: string) => void;
  openSidebarVisibleMultiChat: () => void;
  toggleTldrFromShortcut: () => void;
  createOpen: boolean;
  setCreateRepoMenuOpen: Setter<boolean>;
  createNameRef: React.RefObject<HTMLInputElement | null>;
  draftCreateOpen: boolean;
  draftCreateNameRef: React.RefObject<HTMLInputElement | null>;
  draftChat: DraftChatState | null;
  setDraftCreateOpen: Setter<boolean>;
  setDraftCreateError: Setter<string | null>;
  setDraftCreating: Setter<boolean>;
  setDraftCreateName: Setter<string>;
  setDraftCreateGroup: Setter<string>;
  setDraftNameSuggesting: Setter<boolean>;
  setDraftSuggestedName: Setter<string>;
  setDraftNameSuggestionError: Setter<string | null>;
  draftNameSuggestSeqRef: React.MutableRefObject<number>;
  rightPanelSplit: boolean;
  setRightPanelOpen: Setter<boolean>;
  setRightPanelTab: Setter<RightPanelTab>;
  setRightPanelBottomTab: Setter<RightPanelTab>;
  shortcutBindings: ShortcutBindingMap;
  llmSettings: LlmSettingsLike;
  requestJson: RequestJson;
  showNameSuggestionFailureToast: (error: unknown) => void;
  chatUiMode: 'transcript' | 'cli';
  chatUiModeRef: React.MutableRefObject<'transcript' | 'cli'>;
  setStartupSeedByDrone: Setter<Record<string, StartupSeedState>>;
  drones: DroneSummary[];
  transcripts: TranscriptItem[] | null;
  visiblePendingPromptsWithStartup: PendingPrompt[];
  prevChatItemsLenRef: React.MutableRefObject<number>;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  sessionText: string;
  prevOutputLenRef: React.MutableRefObject<number>;
  pinnedToBottomRef: React.MutableRefObject<boolean>;
  outputScrollRef: React.RefObject<HTMLDivElement | null>;
  updatePinned: (el: HTMLDivElement | null) => void;
  currentDrone: DroneSummary | null;
  selectedDrone: string | null;
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  setDraftChat: Setter<DraftChatState | null>;
};

export function useDroneHubLifecycleEffects({
  normalizeCreateRepoPath,
  setCreateRepoPath,
  terminalMenuRef,
  terminalMenuOpen,
  setTerminalMenuOpen,
  headerOverflowRef,
  headerOverflowOpen,
  setHeaderOverflowOpen,
  droneErrorModal,
  setDroneErrorModal,
  openCreateModal,
  openDraftChatComposer,
  openGroupMultiChat,
  openSidebarVisibleMultiChat,
  toggleTldrFromShortcut,
  createOpen,
  setCreateRepoMenuOpen,
  createNameRef,
  draftCreateOpen,
  draftCreateNameRef,
  draftChat,
  setDraftCreateOpen,
  setDraftCreateError,
  setDraftCreating,
  setDraftCreateName,
  setDraftCreateGroup,
  setDraftNameSuggesting,
  setDraftSuggestedName,
  setDraftNameSuggestionError,
  draftNameSuggestSeqRef,
  rightPanelSplit,
  setRightPanelOpen,
  setRightPanelTab,
  setRightPanelBottomTab,
  shortcutBindings,
  llmSettings,
  requestJson,
  showNameSuggestionFailureToast,
  chatUiMode,
  chatUiModeRef,
  setStartupSeedByDrone,
  drones,
  transcripts,
  visiblePendingPromptsWithStartup,
  prevChatItemsLenRef,
  chatEndRef,
  sessionText,
  prevOutputLenRef,
  pinnedToBottomRef,
  outputScrollRef,
  updatePinned,
  currentDrone,
  selectedDrone,
  draftCreating,
  draftAutoRenaming,
  setDraftChat,
}: UseDroneHubLifecycleEffectsArgs) {
  useDropdownDismiss(terminalMenuRef, terminalMenuOpen, setTerminalMenuOpen);
  useDropdownDismiss(headerOverflowRef, headerOverflowOpen, setHeaderOverflowOpen);

  React.useEffect(() => {
    setCreateRepoPath((prev) => {
      const next = normalizeCreateRepoPath(prev);
      return next === prev ? prev : next;
    });
  }, [normalizeCreateRepoPath, setCreateRepoPath]);

  React.useEffect(() => {
    if (!droneErrorModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDroneErrorModal(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [droneErrorModal, setDroneErrorModal]);

  React.useEffect(() => {
    const openRightPanelTabFromShortcut = (tab: RightPanelTab) => {
      if (!currentDrone) return;
      setRightPanelOpen(true);
      if (rightPanelSplit) {
        const bottomPaneHovered = Boolean(document.querySelector('[data-right-panel-pane="bottom"]:hover'));
        if (bottomPaneHovered) {
          setRightPanelBottomTab(tab);
          return;
        }
      }
      setRightPanelTab(tab);
    };

    const getHoveredSidebarGroup = (): string | null => {
      const hovered = document.querySelector<HTMLElement>('[data-drone-sidebar-group]:hover');
      const group = String(hovered?.dataset.droneSidebarGroup ?? '').trim();
      return group || null;
    };

    const isSidebarHovered = (): boolean => Boolean(document.querySelector('[data-drone-sidebar-root]:hover'));

    const getHoveredSidebarCreateContext = (): {
      kind: 'repo' | 'group';
      repoPath: string;
      groupName: string;
    } | null => {
      const hovered = document.querySelector<HTMLElement>('[data-drone-sidebar-group]:hover');
      if (!hovered) return null;
      const kindRaw = String(hovered.dataset.droneSidebarGroupKind ?? '').trim().toLowerCase();
      const kind: 'repo' | 'group' = kindRaw === 'repo' ? 'repo' : 'group';
      return {
        kind,
        repoPath: String(hovered.dataset.droneSidebarRepoPath ?? '').trim(),
        groupName: String(hovered.dataset.droneSidebarGroupName ?? '').trim(),
      };
    };

    const shortcutActionHandlers: Record<ShortcutActionId, () => boolean> = {
      toggleTldr: () => {
        toggleTldrFromShortcut();
        return true;
      },
      createDraftDrone: () => {
        const hovered = getHoveredSidebarCreateContext();
        if (!hovered) {
          openDraftChatComposer();
          return true;
        }
        if (hovered.kind === 'repo') {
          // Explicitly pass empty path for the virtual "ungrouped repo" bucket.
          openDraftChatComposer({ repoPath: hovered.repoPath, group: '' });
          return true;
        }
        const group = isUngroupedGroupName(hovered.groupName) ? '' : hovered.groupName;
        if (hovered.repoPath) {
          openDraftChatComposer({ repoPath: hovered.repoPath, group });
        } else {
          openDraftChatComposer({ group });
        }
        return true;
      },
      openCreateModal: () => {
        openCreateModal();
        return true;
      },
      openCreateModalAlt: () => {
        openCreateModal();
        return true;
      },
      openHoveredGroupMultiChat: () => {
        const group = getHoveredSidebarGroup();
        if (group) {
          openGroupMultiChat(group);
          return true;
        }
        if (!isSidebarHovered()) return false;
        openSidebarVisibleMultiChat();
        return true;
      },
      openPullRequestsTab: () => {
        openRightPanelTabFromShortcut('prs');
        return true;
      },
      openChangesTab: () => {
        openRightPanelTabFromShortcut('changes');
        return true;
      },
      openBrowserTab: () => {
        openRightPanelTabFromShortcut('preview');
        return true;
      },
      openFilesTab: () => {
        openRightPanelTabFromShortcut('files');
        return true;
      },
      openTerminalTab: () => {
        openRightPanelTabFromShortcut('terminal');
        return true;
      },
    };

    const runShortcutAction = (actionId: ShortcutActionId): boolean => shortcutActionHandlers[actionId]();

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      if (e.repeat) return;
      if (e.target instanceof HTMLElement && e.target.closest('[data-shortcut-capture="true"]')) return;

      const matched = SHORTCUT_DEFINITIONS.find((def) => isShortcutMatch(shortcutBindings[def.id], e)) ?? null;
      if (!matched) return;
      const handled = runShortcutAction(matched.id);
      if (!handled) return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    currentDrone,
    openCreateModal,
    openDraftChatComposer,
    openGroupMultiChat,
    openSidebarVisibleMultiChat,
    rightPanelSplit,
    setRightPanelBottomTab,
    setRightPanelOpen,
    setRightPanelTab,
    shortcutBindings,
    toggleTldrFromShortcut,
  ]);

  React.useEffect(() => {
    if (!createOpen) {
      setCreateRepoMenuOpen(false);
      return;
    }
    setCreateRepoMenuOpen(false);
    const id = requestAnimationFrame(() => {
      const el = createNameRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [createOpen, createNameRef, setCreateRepoMenuOpen]);

  React.useEffect(() => {
    if (!draftCreateOpen) return;
    const id = requestAnimationFrame(() => {
      const el = draftCreateNameRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [draftCreateNameRef, draftCreateOpen]);

  React.useEffect(() => {
    if (draftChat) return;
    setDraftCreateOpen(false);
    setDraftCreateError(null);
    setDraftCreating(false);
    setDraftCreateName('');
    setDraftCreateGroup('');
    setDraftNameSuggesting(false);
    setDraftSuggestedName('');
    setDraftNameSuggestionError(null);
    draftNameSuggestSeqRef.current = 0;
  }, [
    draftChat,
    draftNameSuggestSeqRef,
    setDraftCreateError,
    setDraftCreateGroup,
    setDraftCreateName,
    setDraftCreateOpen,
    setDraftCreating,
    setDraftNameSuggestionError,
    setDraftNameSuggesting,
    setDraftSuggestedName,
  ]);

  React.useEffect(() => {
    if (!draftCreateOpen) return;
    const prompt = String(draftChat?.prompt?.prompt ?? '').trim();
    if (!prompt) return;
    const selectedProvider = llmSettings?.provider?.selected ?? 'openai';
    const selectedSettings = selectedProvider === 'gemini' ? llmSettings?.gemini : llmSettings?.openai;
    if (!selectedSettings?.hasKey) return;
    let mounted = true;
    const seq = draftNameSuggestSeqRef.current + 1;
    draftNameSuggestSeqRef.current = seq;
    setDraftNameSuggesting(true);
    setDraftSuggestedName('');
    setDraftNameSuggestionError(null);
    void requestJson<{ ok: true; name: string }>('/api/drones/name-from-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: prompt }),
    })
      .then((data) => {
        if (!mounted) return;
        if (draftNameSuggestSeqRef.current !== seq) return;
        const suggested = String(data?.name ?? '').trim();
        if (!suggested) return;
        setDraftSuggestedName(suggested);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!mounted) return;
        if (draftNameSuggestSeqRef.current !== seq) return;
        console.error('[DroneHub] draft name suggestion failed', {
          provider: llmSettings?.provider?.selected ?? 'openai',
          error: message,
        });
        setDraftNameSuggestionError(message);
        showNameSuggestionFailureToast(error);
      })
      .finally(() => {
        if (!mounted) return;
        if (draftNameSuggestSeqRef.current !== seq) return;
        setDraftNameSuggesting(false);
      });
    return () => {
      mounted = false;
    };
  }, [
    draftChat?.prompt?.prompt,
    draftCreateOpen,
    draftNameSuggestSeqRef,
    llmSettings,
    requestJson,
    setDraftNameSuggestionError,
    setDraftNameSuggesting,
    setDraftSuggestedName,
    showNameSuggestionFailureToast,
  ]);

  React.useEffect(() => {
    chatUiModeRef.current = chatUiMode;
  }, [chatUiMode, chatUiModeRef]);

  React.useEffect(() => {
    setStartupSeedByDrone((prev) => {
      const next = { ...prev };
      let changed = false;
      const byId = new Map(drones.map((d) => [d.id, d]));
      const nowMs = Date.now();
      for (const [id, seed] of Object.entries(next)) {
        const summary = byId.get(id);
        if (!summary) {
          if (!isStartupSeedFresh(seed, nowMs)) {
            delete next[id];
            changed = true;
          }
          continue;
        }
        const isStarting = isDroneStartingOrSeeding(summary.hubPhase);
        if (!isStarting && !summary.busy) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [drones, setStartupSeedByDrone]);

  React.useEffect(() => {
    if (chatUiMode !== 'transcript') return;
    const len = (transcripts?.length ?? 0) + visiblePendingPromptsWithStartup.length;
    if (len > 0 && len !== prevChatItemsLenRef.current) {
      prevChatItemsLenRef.current = len;
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
      });
    }
  }, [chatUiMode, chatEndRef, prevChatItemsLenRef, transcripts, visiblePendingPromptsWithStartup.length]);

  React.useEffect(() => {
    if (chatUiMode !== 'cli') return;
    const len = sessionText.length;
    if (len > 0 && len !== prevOutputLenRef.current) {
      prevOutputLenRef.current = len;
      if (pinnedToBottomRef.current) {
        requestAnimationFrame(() => {
          const el = outputScrollRef.current;
          if (!el) return;
          el.scrollTop = el.scrollHeight;
          updatePinned(el);
        });
      }
    }
  }, [chatUiMode, outputScrollRef, pinnedToBottomRef, prevOutputLenRef, sessionText, updatePinned]);

  React.useEffect(() => {
    const pending = draftChat?.prompt ?? null;
    const prompt = String(pending?.prompt ?? '').trim();
    if (!pending || !prompt || draftCreating || draftAutoRenaming) return;
    if (!selectedDrone || !currentDrone) return;
    if (chatUiMode === 'cli') {
      setDraftChat(null);
      return;
    }
    const promptInTranscript = Boolean(transcripts?.some((item) => String(item?.prompt ?? '').trim() === prompt));
    const promptInPending = visiblePendingPromptsWithStartup.some((item) => String(item?.prompt ?? '').trim() === prompt);
    if (!promptInTranscript && !promptInPending) return;
    setDraftChat(null);
  }, [
    chatUiMode,
    currentDrone,
    draftAutoRenaming,
    draftChat?.prompt,
    draftCreating,
    selectedDrone,
    setDraftChat,
    transcripts,
    visiblePendingPromptsWithStartup,
  ]);
}
