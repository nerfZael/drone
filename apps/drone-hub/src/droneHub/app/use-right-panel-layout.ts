import React from 'react';
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
import { readLocalStorageItem, usePersistedLocalStorageItem } from './hooks';

export function useRightPanelLayout() {
  const [rightPanelOpen, setRightPanelOpen] = React.useState(true);
  const [rightPanelWidth, setRightPanelWidth] = React.useState<number>(() => {
    const saved = Number(readLocalStorageItem(RIGHT_PANEL_WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) return clampRightPanelWidthPx(saved);
    return clampRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  });
  const [rightPanelResizing, setRightPanelResizing] = React.useState(false);
  const rightPanelResizeRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const [rightPanelTab, setRightPanelTab] = React.useState<RightPanelTab>(() =>
    parseRightPanelTab(readLocalStorageItem(RIGHT_PANEL_TOP_TAB_STORAGE_KEY), 'files'),
  );
  const [rightPanelSplit, setRightPanelSplit] = React.useState<boolean>(() => {
    const raw = readLocalStorageItem(RIGHT_PANEL_SPLIT_STORAGE_KEY);
    return raw === null ? true : raw === '1';
  });
  const [rightPanelBottomTab, setRightPanelBottomTab] = React.useState<RightPanelTab>(() =>
    parseRightPanelTab(readLocalStorageItem(RIGHT_PANEL_BOTTOM_TAB_STORAGE_KEY), 'terminal'),
  );

  usePersistedLocalStorageItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(rightPanelWidth));
  usePersistedLocalStorageItem(RIGHT_PANEL_SPLIT_STORAGE_KEY, rightPanelSplit ? '1' : '0');
  usePersistedLocalStorageItem(RIGHT_PANEL_TOP_TAB_STORAGE_KEY, rightPanelTab);
  usePersistedLocalStorageItem(RIGHT_PANEL_BOTTOM_TAB_STORAGE_KEY, rightPanelBottomTab);

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

  const setRightPanelSplitMode = React.useCallback(
    (next: boolean) => {
      setRightPanelSplit((prev) => {
        if (prev === next) return prev;
        if (next && rightPanelBottomTab === rightPanelTab) {
          const fallback = RIGHT_PANEL_TABS.find((tab) => tab !== rightPanelTab) ?? rightPanelTab;
          setRightPanelBottomTab(fallback);
        }
        return next;
      });
    },
    [rightPanelBottomTab, rightPanelTab],
  );

  const resetRightPanelWidth = React.useCallback(() => {
    setRightPanelWidth(clampRightPanelWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX));
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
