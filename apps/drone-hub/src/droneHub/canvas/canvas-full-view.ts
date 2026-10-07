import { create } from 'zustand';

/**
 * The canvas's full view: its pane takes the whole workspace, beside the sidebar and under the headers, and the
 * other panes and windows step aside until it is left. A double middle-click on the canvas asks for it, and asks
 * again to leave; Escape leaves too. In it, opening a card's chat shows that chat in a panel at the canvas's left,
 * to read; the canvas's own composer writes to it.
 *
 * It lasts for the session and is never saved, but it does outlive a workspace: opening another drone's card
 * brings up that drone's workspace, and the canvas keeps the full view there.
 */
type CanvasFullViewState = {
  fullView: boolean;
  chatPanelOpen: boolean;
};

export const useCanvasFullViewStore = create<CanvasFullViewState>(() => ({ fullView: false, chatPanelOpen: false }));

export function toggleCanvasFullView(): void {
  const { fullView } = useCanvasFullViewStore.getState();
  useCanvasFullViewStore.setState({ fullView: !fullView, chatPanelOpen: false });
}

export function leaveCanvasFullView(): void {
  useCanvasFullViewStore.setState({ fullView: false, chatPanelOpen: false });
}

/** A card's chat was opened: in the full view, it shows in the panel. */
export function showCanvasChatPanel(): void {
  if (useCanvasFullViewStore.getState().fullView) useCanvasFullViewStore.setState({ chatPanelOpen: true });
}

export function closeCanvasChatPanel(): void {
  useCanvasFullViewStore.setState({ chatPanelOpen: false });
}
