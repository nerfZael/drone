import { create } from 'zustand';

/** The entity test bench window: global, not tied to a drone. */
export const useEntityWindow = create<{
  open: boolean;
  /** Bumped to focus an already open window; see DesktopChatWindow. */
  request: number;
  show(): void;
  close(): void;
}>((set) => ({
  open: false,
  request: 0,
  show: () => set((state) => ({ open: true, request: state.request + 1 })),
  close: () => set({ open: false }),
}));
