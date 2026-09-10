export function focusedSideChatMainControl(doc: Document = document): HTMLButtonElement | null {
  const activeSide = doc.querySelector<HTMLElement>('[data-side-chat-active]');
  let button: HTMLButtonElement | null = null;
  if (activeSide) {
    // A detached chat has its own identity and no promotion control. Never
    // fall through to a different fork that happens to occupy the main pane.
    const group = activeSide.closest('.dv-groupview');
    button = [...(group?.querySelectorAll<HTMLButtonElement>('[data-side-chat-move]') ?? [])]
      .find((element) => element.dataset.sideChatMove === activeSide.dataset.sideChatName) ?? null;
  } else {
    button = doc.querySelector<HTMLButtonElement>('[data-main-workspace-chat] [data-side-chat-move]');
  }
  if (!button || button.disabled || button.closest('[aria-hidden="true"]') || button.getClientRects().length === 0) return null;
  return button;
}

/** Use the same control as the toolbar, preserving its busy guard and geometry handling. */
export function toggleFocusedSideChatMain(doc: Document = document): boolean {
  const button = focusedSideChatMainControl(doc);
  if (!button) return false;
  button.click();
  return true;
}
