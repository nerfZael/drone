import React from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { profileStorageKey } from '../../profile-storage';
import { CHANGES_OPEN_AGENT_RUN_EVENT } from '../changes/navigation';
import {
  RIGHT_PANEL_DEFAULT_WIDTH_PX,
  RIGHT_PANEL_TABS,
  parseRightPanelTab,
  viewportWidthPx,
  type RightPanelTab,
} from './app-config';
import {
  clampCustomRightPanelWidthPx,
  resolveRightPanelWidthModeFromWidth,
  resolveRightPanelWidthPx,
  rightPanelMaxWidthPx,
  rightPanelVisibleMaxWidthPx,
  type RightPanelWidthMode,
} from './right-panel-width';

type Updater<T> = T | ((prev: T) => T);

type RightPanelLayoutState = {
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelWidthMode: RightPanelWidthMode;
  rightPanelTab: RightPanelTab;
  rightPanelSplit: boolean;
  rightPanelBottomTab: RightPanelTab;
  rightPanelOpenRequestSeq: number;
  setRightPanelOpen: (next: Updater<boolean>) => void;
  requestRightPanelTab: (tab: RightPanelTab) => void;
  setRightPanelWidth: (next: Updater<number>) => void;
  setRightPanelWidthMode: (next: Updater<RightPanelWidthMode>) => void;
  setRightPanelTab: (next: Updater<RightPanelTab>) => void;
  setRightPanelSplitMode: (next: boolean) => void;
  setRightPanelBottomTab: (next: Updater<RightPanelTab>) => void;
  resetRightPanelWidth: () => void;
};

type RightPanelLayoutPersistedState = Pick<
  RightPanelLayoutState,
  'rightPanelWidth' | 'rightPanelWidthMode' | 'rightPanelTab' | 'rightPanelSplit' | 'rightPanelBottomTab'
>;

function parseRightPanelWidthMode(raw: unknown): RightPanelWidthMode {
  return raw === 'full' || raw === 'two-thirds' || raw === 'one-third' || raw === 'custom' ? raw : 'custom';
}

function inferLegacyRightPanelWidthMode(width: number, availableWidth: number): RightPanelWidthMode {
  if (width > rightPanelVisibleMaxWidthPx(availableWidth) + 2) return 'full';
  return resolveRightPanelWidthModeFromWidth(width, availableWidth);
}

function resolveNext<T>(prev: T, next: Updater<T>): T {
  return typeof next === 'function' ? (next as (current: T) => T)(prev) : next;
}

function resolveDistinctBottomTab(top: RightPanelTab, bottom: RightPanelTab): RightPanelTab {
  if (top !== bottom) return bottom;
  return RIGHT_PANEL_TABS.find((tab) => tab !== top) ?? top;
}

const WORKSPACE_ROOT_SELECTOR = '[data-drone-workspace-root="1"]';

function readWorkspaceWidthPx(): number {
  if (typeof document !== 'undefined') {
    const workspaceRoot = document.querySelector<HTMLElement>(WORKSPACE_ROOT_SELECTOR);
    const measured = Math.floor(workspaceRoot?.getBoundingClientRect().width ?? 0);
    if (measured > 0) return measured;
  }
  return viewportWidthPx();
}

const useRightPanelLayoutStore = create<RightPanelLayoutState>()(
  persist(
    (set) => ({
      rightPanelOpen: true,
      rightPanelWidth: clampCustomRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX),
      rightPanelWidthMode: 'custom',
      rightPanelTab: 'editor',
      rightPanelSplit: true,
      rightPanelBottomTab: 'terminal',
      rightPanelOpenRequestSeq: 0,
      setRightPanelOpen: (next) =>
        set((s) => {
          const rightPanelOpen = resolveNext(s.rightPanelOpen, next);
          if (s.rightPanelOpen === rightPanelOpen) return s;
          return {
            rightPanelOpen,
            rightPanelOpenRequestSeq: rightPanelOpen ? s.rightPanelOpenRequestSeq + 1 : s.rightPanelOpenRequestSeq,
          };
        }),
      requestRightPanelTab: (tab) =>
        set((s) => {
          const rightPanelTab = parseRightPanelTab(tab, s.rightPanelTab);
          return {
            rightPanelOpen: true,
            rightPanelTab,
            rightPanelOpenRequestSeq: s.rightPanelOpenRequestSeq + 1,
          };
        }),
      setRightPanelWidth: (next) =>
        set((s) => ({
          rightPanelWidth: clampCustomRightPanelWidthPx(resolveNext(s.rightPanelWidth, next)),
        })),
      setRightPanelWidthMode: (next) => set((s) => ({ rightPanelWidthMode: resolveNext(s.rightPanelWidthMode, next) })),
      setRightPanelTab: (next) =>
        set((s) => {
          const rightPanelTab = parseRightPanelTab(resolveNext(s.rightPanelTab, next), s.rightPanelTab);
          if (s.rightPanelTab === rightPanelTab) return s;
          return { rightPanelTab };
        }),
      setRightPanelSplitMode: (next) =>
        set((s) => {
          if (s.rightPanelSplit === next) return s;
          return {
            rightPanelSplit: next,
            rightPanelBottomTab: next
              ? resolveDistinctBottomTab(s.rightPanelTab, s.rightPanelBottomTab)
              : s.rightPanelBottomTab,
          };
        }),
      setRightPanelBottomTab: (next) =>
        set((s) => {
          const rightPanelBottomTab = parseRightPanelTab(resolveNext(s.rightPanelBottomTab, next), s.rightPanelBottomTab);
          if (s.rightPanelBottomTab === rightPanelBottomTab) return s;
          return { rightPanelBottomTab };
        }),
      resetRightPanelWidth: () =>
        set({
          rightPanelWidth: clampCustomRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX),
          rightPanelWidthMode: 'custom',
        }),
    }),
    {
      name: profileStorageKey('droneHub.rightPanelLayout'),
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): RightPanelLayoutPersistedState => ({
        rightPanelWidth: state.rightPanelWidth,
        rightPanelWidthMode: state.rightPanelWidthMode,
        rightPanelTab: state.rightPanelTab,
        rightPanelSplit: state.rightPanelSplit,
        rightPanelBottomTab: state.rightPanelBottomTab,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<RightPanelLayoutPersistedState>) ?? {};
        const persistedWidth = clampCustomRightPanelWidthPx(Number(persisted.rightPanelWidth ?? currentState.rightPanelWidth));
        const inferredWidthMode =
          persisted.rightPanelWidthMode == null
            ? inferLegacyRightPanelWidthMode(
                Number(persisted.rightPanelWidth ?? currentState.rightPanelWidth),
                readWorkspaceWidthPx(),
              )
            : parseRightPanelWidthMode(persisted.rightPanelWidthMode);
        const rightPanelTab = parseRightPanelTab(persisted.rightPanelTab ?? currentState.rightPanelTab, currentState.rightPanelTab);
        const rightPanelSplit = Boolean(persisted.rightPanelSplit ?? currentState.rightPanelSplit);
        const rawBottomTab = parseRightPanelTab(
          persisted.rightPanelBottomTab ?? currentState.rightPanelBottomTab,
          currentState.rightPanelBottomTab,
        );
        const rightPanelBottomTab = rightPanelSplit
          ? resolveDistinctBottomTab(rightPanelTab, rawBottomTab)
          : rawBottomTab;
        return {
          ...currentState,
          ...persisted,
          rightPanelWidth: persistedWidth,
          rightPanelWidthMode: inferredWidthMode,
          rightPanelTab,
          rightPanelSplit,
          rightPanelBottomTab,
        };
      },
    },
  ),
);

export function useRightPanelLayout() {
  const {
    rightPanelOpen,
    rightPanelWidth: rightPanelCustomWidth,
    rightPanelWidthMode,
    rightPanelTab,
    rightPanelSplit,
    rightPanelBottomTab,
    rightPanelOpenRequestSeq,
    setRightPanelOpen,
    requestRightPanelTab,
    setRightPanelWidth: setRightPanelWidthStore,
    setRightPanelWidthMode: setRightPanelWidthModeStore,
    setRightPanelTab,
    setRightPanelSplitMode,
    setRightPanelBottomTab,
  } = useRightPanelLayoutStore(
    useShallow((s) => ({
      rightPanelOpen: s.rightPanelOpen,
      rightPanelWidth: s.rightPanelWidth,
      rightPanelWidthMode: s.rightPanelWidthMode,
      rightPanelTab: s.rightPanelTab,
      rightPanelSplit: s.rightPanelSplit,
      rightPanelBottomTab: s.rightPanelBottomTab,
      rightPanelOpenRequestSeq: s.rightPanelOpenRequestSeq,
      setRightPanelOpen: s.setRightPanelOpen,
      requestRightPanelTab: s.requestRightPanelTab,
      setRightPanelWidth: s.setRightPanelWidth,
      setRightPanelWidthMode: s.setRightPanelWidthMode,
      setRightPanelTab: s.setRightPanelTab,
      setRightPanelSplitMode: s.setRightPanelSplitMode,
      setRightPanelBottomTab: s.setRightPanelBottomTab,
    })),
  );
  const [workspaceWidth, setWorkspaceWidth] = React.useState<number>(() => rightPanelMaxWidthPx(readWorkspaceWidthPx()));
  const rightPanelWidth = React.useMemo(
    () => resolveRightPanelWidthPx(rightPanelWidthMode, rightPanelCustomWidth, workspaceWidth),
    [rightPanelCustomWidth, rightPanelWidthMode, workspaceWidth],
  );

  const setRightPanelWidth = React.useCallback(
    (next: Updater<number>) => {
      const requestedWidth = resolveNext(rightPanelWidth, next);
      const nextMode = resolveRightPanelWidthModeFromWidth(requestedWidth, workspaceWidth);
      setRightPanelWidthModeStore(nextMode);
      if (nextMode === 'custom') {
        setRightPanelWidthStore(clampCustomRightPanelWidthPx(requestedWidth, workspaceWidth));
      }
    },
    [rightPanelWidth, setRightPanelWidthModeStore, setRightPanelWidthStore, workspaceWidth],
  );

  const resetRightPanelWidth = React.useCallback(() => {
    setRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  }, [setRightPanelWidth]);

  React.useEffect(() => {
    const updateWorkspaceWidth = () => {
      const nextWidth = rightPanelMaxWidthPx(readWorkspaceWidthPx());
      setWorkspaceWidth((prevWidth) => (Math.abs(prevWidth - nextWidth) <= 1 ? prevWidth : nextWidth));
    };
    const raf = requestAnimationFrame(updateWorkspaceWidth);
    updateWorkspaceWidth();

    let observer: ResizeObserver | null = null;
    const workspaceRoot = document.querySelector<HTMLElement>(WORKSPACE_ROOT_SELECTOR);
    if (workspaceRoot && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        updateWorkspaceWidth();
      });
      observer.observe(workspaceRoot);
    }
    window.addEventListener('resize', updateWorkspaceWidth);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', updateWorkspaceWidth);
    };
  }, []);

  React.useEffect(() => {
    const openAgentRunChanges = () => {
      if (rightPanelSplit && rightPanelBottomTab === 'changes') {
        setRightPanelOpen(true);
        return;
      }
      requestRightPanelTab('changes');
    };
    window.addEventListener(CHANGES_OPEN_AGENT_RUN_EVENT, openAgentRunChanges);
    return () => window.removeEventListener(CHANGES_OPEN_AGENT_RUN_EVENT, openAgentRunChanges);
  }, [requestRightPanelTab, rightPanelBottomTab, rightPanelSplit, setRightPanelOpen]);

  React.useEffect(() => {
    setRightPanelWidthStore((prev) => clampCustomRightPanelWidthPx(prev, workspaceWidth));
  }, [setRightPanelWidthStore, workspaceWidth]);

  const rightPanelDefaultWidth = clampCustomRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX, workspaceWidth);
  const rightPanelWidthIsDefault = rightPanelWidthMode === 'custom' && Math.abs(rightPanelWidth - rightPanelDefaultWidth) <= 1;
  const rightPanelWidthMax = rightPanelMaxWidthPx(workspaceWidth);

  return {
    rightPanelOpen,
    setRightPanelOpen,
    requestRightPanelTab,
    rightPanelWidth,
    rightPanelWidthMode,
    setRightPanelWidth,
    rightPanelTab,
    setRightPanelTab,
    rightPanelSplit,
    setRightPanelSplitMode,
    rightPanelBottomTab,
    setRightPanelBottomTab,
    rightPanelOpenRequestSeq,
    resetRightPanelWidth,
    rightPanelWidthIsDefault,
    rightPanelWidthMax,
  };
}
