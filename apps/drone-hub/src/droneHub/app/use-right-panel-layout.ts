import React from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import {
  RIGHT_PANEL_BOTTOM_TAB_STORAGE_KEY,
  RIGHT_PANEL_DEFAULT_WIDTH_PX,
  RIGHT_PANEL_SPLIT_STORAGE_KEY,
  RIGHT_PANEL_TABS,
  RIGHT_PANEL_TOP_TAB_STORAGE_KEY,
  RIGHT_PANEL_WIDTH_STORAGE_KEY,
  clampRightPanelWidthPx,
  parseRightPanelTab,
  rightPanelMaxWidthPx,
  viewportWidthPx,
  type RightPanelTab,
} from './app-config';
import { readLocalStorageItem } from './hooks';

type Updater<T> = T | ((prev: T) => T);

type RightPanelLayoutState = {
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelResizing: boolean;
  rightPanelTab: RightPanelTab;
  rightPanelSplit: boolean;
  rightPanelBottomTab: RightPanelTab;
  setRightPanelOpen: (next: Updater<boolean>) => void;
  setRightPanelWidth: (next: Updater<number>) => void;
  setRightPanelResizing: (next: Updater<boolean>) => void;
  setRightPanelTab: (next: Updater<RightPanelTab>) => void;
  setRightPanelSplitMode: (next: boolean) => void;
  setRightPanelBottomTab: (next: Updater<RightPanelTab>) => void;
  resetRightPanelWidth: () => void;
};

type RightPanelLayoutPersistedState = Pick<
  RightPanelLayoutState,
  'rightPanelWidth' | 'rightPanelTab' | 'rightPanelSplit' | 'rightPanelBottomTab'
>;

function resolveNext<T>(prev: T, next: Updater<T>): T {
  return typeof next === 'function' ? (next as (current: T) => T)(prev) : next;
}

function resolveDistinctBottomTab(top: RightPanelTab, bottom: RightPanelTab): RightPanelTab {
  if (top !== bottom) return bottom;
  return RIGHT_PANEL_TABS.find((tab) => tab !== top) ?? top;
}

function readLegacyPersistedDefaults(): RightPanelLayoutPersistedState {
  const savedWidth = Number(readLocalStorageItem(RIGHT_PANEL_WIDTH_STORAGE_KEY));
  const width =
    Number.isFinite(savedWidth) && savedWidth > 0
      ? clampRightPanelWidthPx(savedWidth)
      : clampRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  const topTab = parseRightPanelTab(readLocalStorageItem(RIGHT_PANEL_TOP_TAB_STORAGE_KEY), 'files');
  const splitRaw = readLocalStorageItem(RIGHT_PANEL_SPLIT_STORAGE_KEY);
  const split = splitRaw === null ? true : splitRaw === '1';
  const bottomTab = parseRightPanelTab(readLocalStorageItem(RIGHT_PANEL_BOTTOM_TAB_STORAGE_KEY), 'terminal');

  return {
    rightPanelWidth: width,
    rightPanelTab: topTab,
    rightPanelSplit: split,
    rightPanelBottomTab: split ? resolveDistinctBottomTab(topTab, bottomTab) : bottomTab,
  };
}

const legacyDefaults = readLegacyPersistedDefaults();

const useRightPanelLayoutStore = create<RightPanelLayoutState>()(
  persist(
    (set) => ({
      rightPanelOpen: true,
      rightPanelWidth: legacyDefaults.rightPanelWidth,
      rightPanelResizing: false,
      rightPanelTab: legacyDefaults.rightPanelTab,
      rightPanelSplit: legacyDefaults.rightPanelSplit,
      rightPanelBottomTab: legacyDefaults.rightPanelBottomTab,
      setRightPanelOpen: (next) => set((s) => ({ rightPanelOpen: resolveNext(s.rightPanelOpen, next) })),
      setRightPanelWidth: (next) =>
        set((s) => ({
          rightPanelWidth: clampRightPanelWidthPx(resolveNext(s.rightPanelWidth, next)),
        })),
      setRightPanelResizing: (next) => set((s) => ({ rightPanelResizing: resolveNext(s.rightPanelResizing, next) })),
      setRightPanelTab: (next) =>
        set((s) => ({
          rightPanelTab: parseRightPanelTab(resolveNext(s.rightPanelTab, next), s.rightPanelTab),
        })),
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
        set((s) => ({
          rightPanelBottomTab: parseRightPanelTab(resolveNext(s.rightPanelBottomTab, next), s.rightPanelBottomTab),
        })),
      resetRightPanelWidth: () =>
        set({
          rightPanelWidth: clampRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX),
        }),
    }),
    {
      name: 'droneHub.rightPanelLayout',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): RightPanelLayoutPersistedState => ({
        rightPanelWidth: state.rightPanelWidth,
        rightPanelTab: state.rightPanelTab,
        rightPanelSplit: state.rightPanelSplit,
        rightPanelBottomTab: state.rightPanelBottomTab,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<RightPanelLayoutPersistedState>) ?? {};
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
          rightPanelWidth: clampRightPanelWidthPx(Number(persisted.rightPanelWidth ?? currentState.rightPanelWidth)),
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
    rightPanelWidth,
    rightPanelResizing,
    rightPanelTab,
    rightPanelSplit,
    rightPanelBottomTab,
    setRightPanelOpen,
    setRightPanelWidth,
    setRightPanelResizing,
    setRightPanelTab,
    setRightPanelSplitMode,
    setRightPanelBottomTab,
    resetRightPanelWidth,
  } = useRightPanelLayoutStore(
    useShallow((s) => ({
      rightPanelOpen: s.rightPanelOpen,
      rightPanelWidth: s.rightPanelWidth,
      rightPanelResizing: s.rightPanelResizing,
      rightPanelTab: s.rightPanelTab,
      rightPanelSplit: s.rightPanelSplit,
      rightPanelBottomTab: s.rightPanelBottomTab,
      setRightPanelOpen: s.setRightPanelOpen,
      setRightPanelWidth: s.setRightPanelWidth,
      setRightPanelResizing: s.setRightPanelResizing,
      setRightPanelTab: s.setRightPanelTab,
      setRightPanelSplitMode: s.setRightPanelSplitMode,
      setRightPanelBottomTab: s.setRightPanelBottomTab,
      resetRightPanelWidth: s.resetRightPanelWidth,
    })),
  );
  const rightPanelResizeRef = React.useRef<{ startX: number; startWidth: number } | null>(null);

  React.useEffect(() => {
    const onResize = () => {
      setRightPanelWidth((prev) => clampRightPanelWidthPx(prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  React.useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const startRightPanelResize = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!rightPanelOpen) return;
      event.preventDefault();
      event.stopPropagation();
      rightPanelResizeRef.current = { startX: event.clientX, startWidth: rightPanelWidth };
      setRightPanelResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (moveEvent: MouseEvent) => {
        const state = rightPanelResizeRef.current;
        if (!state) return;
        const delta = state.startX - moveEvent.clientX;
        setRightPanelWidth(clampRightPanelWidthPx(state.startWidth + delta));
      };

      const onMouseUp = () => {
        rightPanelResizeRef.current = null;
        setRightPanelResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [rightPanelOpen, rightPanelWidth],
  );

  const rightPanelDefaultWidth = clampRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  const rightPanelWidthIsDefault = Math.abs(rightPanelWidth - rightPanelDefaultWidth) <= 1;
  const rightPanelWidthMax = rightPanelMaxWidthPx(viewportWidthPx());

  return {
    rightPanelOpen,
    setRightPanelOpen,
    rightPanelWidth,
    rightPanelResizing,
    rightPanelTab,
    setRightPanelTab,
    rightPanelSplit,
    setRightPanelSplitMode,
    rightPanelBottomTab,
    setRightPanelBottomTab,
    resetRightPanelWidth,
    startRightPanelResize,
    rightPanelWidthIsDefault,
    rightPanelWidthMax,
  };
}
