import React from 'react';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../types';
import type { DraftChatState, DroneErrorModalState, StartupSeedState } from './app-types';
import type { RightPanelTab } from './app-config';
import { isStartupSeedFresh } from './app-config';
import { isUngroupedGroupName } from '../../domain';
import type { ShortcutActionId, ShortcutBindingMap } from './shortcuts';
import { SHORTCUT_DEFINITIONS, isShortcutMatch } from './shortcuts';
import { isDroneStartingOrSeeding } from './helpers';
import {
  shouldDispatchEditableShortcutAction,
  shouldHandoffDraftChatWorkspace,
} from './lifecycle-effect-helpers';
import { useDropdownDismiss } from '../../ui/dropdown';
import { requestSidebarGroupDraft } from './sidebar-group-draft-events';

type Updater<T> = T | ((prev: T) => T);
type Setter<T> = (next: Updater<T>) => void;
type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type LlmSettingsLike =
  | {
      provider?: { selected?: string };
      openai?: { hasKey?: boolean };
      gemini?: { hasKey?: boolean };
      codex?: { hasKey?: boolean };
    }
  | null
  | undefined;

type UseDroneHubLifecycleEffectsArgs = {
  terminalMenuRef: React.RefObject<HTMLDivElement | null>;
  terminalMenuOpen: boolean;
  setTerminalMenuOpen: Setter<boolean>;
  headerOverflowRef: React.RefObject<HTMLDivElement | null>;
  headerOverflowOpen: boolean;
  setHeaderOverflowOpen: Setter<boolean>;
  droneErrorModal: DroneErrorModalState | null;
  setDroneErrorModal: Setter<DroneErrorModalState | null>;
  openHome: () => void;
  openDraftChatComposer: (opts?: { repoPath?: string | null; group?: string | null }) => void;
  openChildDraftChatComposer: () => boolean;
  createDroneChatFromShortcut: () => Promise<boolean>;
  toggleSelectedDronePinnedFromShortcut: () => boolean;
  moveSelectedDroneToTopFromShortcut: () => boolean;
  toggleSelectedDronesToDoFromShortcut: () => boolean;
  openGroupMultiChat: (group: string) => void;
  openSidebarVisibleMultiChat: () => void;
  toggleVoiceClipboardRecording: () => boolean;
  draftCreateOpen: boolean;
  draftCreateNameRef: React.RefObject<HTMLInputElement | null>;
  draftChat: DraftChatState | null;
  setDraftCreateOpen: Setter<boolean>;
  setDraftCreateError: Setter<string | null>;
  setDraftCreating: Setter<boolean>;
  setDraftCreateName: Setter<string>;
  setDraftCreateGroup: Setter<string>;
  setDraftCreateParentDroneId: Setter<string | null>;
  setDraftNameSuggesting: Setter<boolean>;
  setDraftSuggestedName: Setter<string>;
  setDraftNameSuggestionError: Setter<string | null>;
  draftNameSuggestSeqRef: React.MutableRefObject<number>;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  rightPanelSplit: boolean;
  rightPanelBottomTab: RightPanelTab;
  requestRightPanelTab: (tab: RightPanelTab) => void;
  setSidebarCollapsed: Setter<boolean>;
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
  sessionText: string;
  prevOutputLenRef: React.MutableRefObject<number>;
  pinnedToBottomRef: React.MutableRefObject<boolean>;
  outputScrollRef: React.RefObject<HTMLDivElement | null>;
  updatePinned: (el: HTMLDivElement | null) => void;
  currentDrone: DroneSummary | null;
  selectedDrone: string | null;
  selectedChat: string;
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  setDraftChat: Setter<DraftChatState | null>;
  onDeleteSelectedDroneFromInputShortcut: () => boolean;
  onMarkSelectedDronesUnreadShortcut: () => boolean;
};

export function useDroneHubLifecycleEffects({
  terminalMenuRef,
  terminalMenuOpen,
  setTerminalMenuOpen,
  headerOverflowRef,
  headerOverflowOpen,
  setHeaderOverflowOpen,
  droneErrorModal,
  setDroneErrorModal,
  openHome,
  openDraftChatComposer,
  openChildDraftChatComposer,
  createDroneChatFromShortcut,
  toggleSelectedDronePinnedFromShortcut,
  moveSelectedDroneToTopFromShortcut,
  toggleSelectedDronesToDoFromShortcut,
  openGroupMultiChat,
  openSidebarVisibleMultiChat,
  toggleVoiceClipboardRecording,
  draftCreateOpen,
  draftCreateNameRef,
  draftChat,
  setDraftCreateOpen,
  setDraftCreateError,
  setDraftCreating,
  setDraftCreateName,
  setDraftCreateGroup,
  setDraftCreateParentDroneId,
  setDraftNameSuggesting,
  setDraftSuggestedName,
  setDraftNameSuggestionError,
  draftNameSuggestSeqRef,
  rightPanelOpen,
  rightPanelTab,
  rightPanelSplit,
  rightPanelBottomTab,
  requestRightPanelTab,
  setSidebarCollapsed,
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
  sessionText,
  prevOutputLenRef,
  pinnedToBottomRef,
  outputScrollRef,
  updatePinned,
  currentDrone,
  selectedDrone,
  selectedChat,
  draftCreating,
  draftAutoRenaming,
  setDraftChat,
  onDeleteSelectedDroneFromInputShortcut,
  onMarkSelectedDronesUnreadShortcut,
}: UseDroneHubLifecycleEffectsArgs) {
  const outputScrollContextRef = React.useRef<string>('');
  useDropdownDismiss(terminalMenuRef, terminalMenuOpen, setTerminalMenuOpen);
  useDropdownDismiss(headerOverflowRef, headerOverflowOpen, setHeaderOverflowOpen);

  React.useEffect(() => {
    if (!droneErrorModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDroneErrorModal(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [droneErrorModal, setDroneErrorModal]);

  React.useEffect(() => {
    const focusPrimaryChatInput = (): boolean => {
      const modalOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      if (modalOpen) return false;
      const primaryInput = document.querySelector<HTMLTextAreaElement>(
        '[data-chat-input-focus-id="primary-chat"]',
      );
      if (!primaryInput) return false;
      if (primaryInput.getClientRects().length === 0) return false;
      primaryInput.focus();
      const end = primaryInput.value.length;
      primaryInput.setSelectionRange(end, end);
      return true;
    };

    const focusPrimaryChatInputWithRetry = (remainingAttempts: number = 10) => {
      if (focusPrimaryChatInput() || remainingAttempts <= 0) return;
      window.setTimeout(() => {
        window.requestAnimationFrame(() => {
          focusPrimaryChatInputWithRetry(remainingAttempts - 1);
        });
      }, 30);
    };

    const openRightPanelTabFromShortcut = (tab: RightPanelTab) => {
      if (!currentDrone) return;
      requestRightPanelTab(tab);
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

    const isCanvasOpen = (): boolean => {
      if (!rightPanelOpen) return false;
      if (rightPanelTab === 'canvas') return true;
      return rightPanelSplit && rightPanelBottomTab === 'canvas';
    };

    const focusCanvasAndCreateDraft = (event: KeyboardEvent): boolean => {
      if (!isCanvasOpen()) return false;
      const visibleViewports = Array.from(
        document.querySelectorAll<HTMLElement>('[data-drone-canvas-viewport="1"]'),
      ).filter((el) => el.getClientRects().length > 0);
      if (visibleViewports.length === 0) return false;
      const targetViewport = visibleViewports.find((el) => el.matches(':hover')) ?? visibleViewports[0];
      targetViewport.focus({ preventScroll: true });
      targetViewport.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    };

    const shortcutActionHandlers: Record<ShortcutActionId, (event: KeyboardEvent) => boolean> = {
      openHome: () => {
        openHome();
        return true;
      },
      createDraftDrone: (event) => {
        if (focusCanvasAndCreateDraft(event)) return true;
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
      createDraftGroup: () => requestSidebarGroupDraft(),
      createChildDraftDrone: () => openChildDraftChatComposer(),
      createDroneChat: () => {
        if (!currentDrone) return false;
        void (async () => {
          const created = await createDroneChatFromShortcut();
          if (!created) return;
          focusPrimaryChatInputWithRetry();
        })();
        return true;
      },
      toggleSelectedDronePinned: () => toggleSelectedDronePinnedFromShortcut(),
      moveSelectedDroneToTop: () => moveSelectedDroneToTopFromShortcut(),
      toggleSelectedDronesToDo: () => toggleSelectedDronesToDoFromShortcut(),
      focusPrimaryChatInput: () => focusPrimaryChatInput(),
      toggleVoiceClipboardRecording: () => toggleVoiceClipboardRecording(),
      markSelectedDronesUnread: () => onMarkSelectedDronesUnreadShortcut(),
      toggleSidebarCollapsed: () => {
        setSidebarCollapsed((prev) => !prev);
        return true;
      },
      toggleRightPanelWidth: () => {
        requestRightPanelTab(rightPanelTab);
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
      openCanvasTab: () => {
        openRightPanelTabFromShortcut('canvas');
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

    const runShortcutAction = (actionId: ShortcutActionId, event: KeyboardEvent): boolean =>
      shortcutActionHandlers[actionId](event);

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const isPrimaryChatInputTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest('[data-chat-input-focus-id="primary-chat"]'));
    };

    const isCanvasMessageInputTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest('[data-canvas-message-input="1"]'));
    };

    const isAssistantChatInputTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest('[data-chat-input-focus-id="assistant-chat"]'));
    };

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest('button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"]'));
    };

    const isSidebarDroneCardTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return target.matches('[data-onboarding-id="sidebar.droneCard"]');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const captureRoot =
        e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-shortcut-capture="true"]') : null;
      const deleteOnly =
        e.key === 'Delete' &&
        !e.repeat &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey;
      const modalOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      if (deleteOnly && !modalOpen && !captureRoot && !isEditableTarget(e.target)) {
        const handled = onDeleteSelectedDroneFromInputShortcut();
        if (handled) {
          e.preventDefault();
          return;
        }
      }
      if (e.repeat) return;
      const matched = SHORTCUT_DEFINITIONS.find((def) => isShortcutMatch(shortcutBindings[def.id], e)) ?? null;
      if (isEditableTarget(e.target)) {
        const allowEditableShortcut = shouldDispatchEditableShortcutAction({
          matchedActionId: matched?.id ?? null,
          matchedShortcutKey: matched ? shortcutBindings[matched.id]?.key ?? null : null,
          targetInPrimaryChatInput: isPrimaryChatInputTarget(e.target),
          targetInCanvasMessageInput: isCanvasMessageInputTarget(e.target),
          targetInAssistantChatInput: isAssistantChatInputTarget(e.target),
        });
        if (!allowEditableShortcut || !matched) return;
        const handled = runShortcutAction(matched.id, e);
        if (!handled) return;
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && isInteractiveTarget(e.target) && !isSidebarDroneCardTarget(e.target)) return;
      if (captureRoot) {
        const insideCanvasViewport = Boolean(captureRoot.closest('[data-drone-canvas-viewport="1"]'));
        if (!insideCanvasViewport) return;
      }

      if (!matched) return;
      const handled = runShortcutAction(matched.id, e);
      if (!handled) return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    currentDrone,
    openHome,
    openDraftChatComposer,
    openChildDraftChatComposer,
    createDroneChatFromShortcut,
    toggleSelectedDronePinnedFromShortcut,
    moveSelectedDroneToTopFromShortcut,
    toggleSelectedDronesToDoFromShortcut,
    openGroupMultiChat,
    openSidebarVisibleMultiChat,
    rightPanelBottomTab,
    rightPanelOpen,
    rightPanelSplit,
    rightPanelTab,
    requestRightPanelTab,
    setSidebarCollapsed,
    shortcutBindings,
    onDeleteSelectedDroneFromInputShortcut,
    onMarkSelectedDronesUnreadShortcut,
    toggleVoiceClipboardRecording,
  ]);

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
    setDraftCreateParentDroneId(null);
    setDraftNameSuggesting(false);
    setDraftSuggestedName('');
    setDraftNameSuggestionError(null);
    draftNameSuggestSeqRef.current = 0;
  }, [
    draftChat,
    draftNameSuggestSeqRef,
    setDraftCreateError,
    setDraftCreateGroup,
    setDraftCreateParentDroneId,
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
    const selectedSettings = selectedProvider === 'gemini' ? llmSettings?.gemini : selectedProvider === 'codex' ? llmSettings?.codex : llmSettings?.openai;
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
      body: JSON.stringify({ message: prompt, source: 'draft-create' }),
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
          const awaitingNativePromptReconciliation =
            seed.agent?.kind === 'native' &&
            Boolean(String(seed.prompt ?? '').trim()) &&
            isStartupSeedFresh(seed, nowMs);
          if (awaitingNativePromptReconciliation) continue;
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [drones, setStartupSeedByDrone]);

  React.useEffect(() => {
    if (chatUiMode !== 'cli') return;
    const contextKey = `${selectedDrone ?? ''}\u0000${selectedChat ?? ''}`;
    if (outputScrollContextRef.current !== contextKey) {
      // Ignore the first render after context switch to avoid sampling stale output length.
      outputScrollContextRef.current = contextKey;
      prevOutputLenRef.current = -1;
      return;
    }
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
  }, [chatUiMode, outputScrollRef, pinnedToBottomRef, prevOutputLenRef, selectedChat, selectedDrone, sessionText, updatePinned]);

  React.useEffect(() => {
    const pending = draftChat?.prompt ?? null;
    if (!pending || !currentDrone) return;
    // The synthetic startup prompt is visible immediately, but it is not proof
    // that the real chat surface is ready. Keep this workspace mounted so partial
    // status and relationship metadata cannot replace the optimistic conversation.
    if (
      !shouldHandoffDraftChatWorkspace({
        hubPhase: currentDrone.hubPhase,
        creating: draftCreating,
        autoRenaming: draftAutoRenaming,
        hasSelectedDrone: Boolean(selectedDrone),
      })
    ) return;
    setDraftChat(null);
  }, [
    currentDrone,
    draftAutoRenaming,
    draftChat?.prompt,
    draftCreating,
    selectedDrone,
    setDraftChat,
  ]);
}
