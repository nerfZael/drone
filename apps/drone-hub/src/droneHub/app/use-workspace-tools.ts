import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { profileStorageKey } from '../../profile-storage';
import { parseRightPanelTab, type RightPanelTab } from './app-config';

type Updater<T> = T | ((prev: T) => T);

type WorkspaceToolsState = {
  rightPanelTab: RightPanelTab;
  rightPanelOpenRequestSeq: number;
  visibleToolTabsByDrone: Record<string, RightPanelTab[]>;
  requestRightPanelTab: (tab: RightPanelTab) => void;
  setRightPanelTab: (next: Updater<RightPanelTab>) => void;
  setVisibleToolTabsForDrone: (droneId: string, tabs: RightPanelTab[]) => void;
};

type PersistedWorkspaceToolsState = Pick<WorkspaceToolsState, 'rightPanelTab'>;

export function useWorkspaceTools() {
  return useWorkspaceToolsStore(
    useShallow((state) => ({
      rightPanelTab: state.rightPanelTab,
      rightPanelOpenRequestSeq: state.rightPanelOpenRequestSeq,
      visibleToolTabsByDrone: state.visibleToolTabsByDrone,
      requestRightPanelTab: state.requestRightPanelTab,
      setRightPanelTab: state.setRightPanelTab,
      setVisibleToolTabsForDrone: state.setVisibleToolTabsForDrone,
    })),
  );
}

function resolveNext<T>(prev: T, next: Updater<T>): T {
  return typeof next === 'function' ? (next as (current: T) => T)(prev) : next;
}

function tabsEqual(a: readonly RightPanelTab[], b: readonly RightPanelTab[]): boolean {
  return a.length === b.length && a.every((tab, index) => tab === b[index]);
}

const useWorkspaceToolsStore = create<WorkspaceToolsState>()(
  persist(
    (set) => ({
      rightPanelTab: 'editor',
      rightPanelOpenRequestSeq: 0,
      visibleToolTabsByDrone: {},
      requestRightPanelTab: (tab) =>
        set((state) => ({
          rightPanelTab: parseRightPanelTab(tab, state.rightPanelTab),
          rightPanelOpenRequestSeq: state.rightPanelOpenRequestSeq + 1,
        })),
      setRightPanelTab: (next) =>
        set((state) => {
          const rightPanelTab = parseRightPanelTab(
            resolveNext(state.rightPanelTab, next),
            state.rightPanelTab,
          );
          return state.rightPanelTab === rightPanelTab ? state : { rightPanelTab };
        }),
      setVisibleToolTabsForDrone: (droneId, tabs) =>
        set((state) => {
          const previous = state.visibleToolTabsByDrone[droneId] ?? [];
          if (tabsEqual(previous, tabs)) return state;
          return {
            visibleToolTabsByDrone: {
              ...state.visibleToolTabsByDrone,
              [droneId]: tabs,
            },
          };
        }),
    }),
    {
      name: profileStorageKey('droneHub.rightPanelLayout'),
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedWorkspaceToolsState => ({
        rightPanelTab: state.rightPanelTab,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<PersistedWorkspaceToolsState>) ?? {};
        return {
          ...currentState,
          rightPanelTab: parseRightPanelTab(
            persisted.rightPanelTab,
            currentState.rightPanelTab,
          ),
        };
      },
    },
  ),
);
