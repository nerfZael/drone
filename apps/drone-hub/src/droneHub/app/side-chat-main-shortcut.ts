/** Use the same control as the toolbar, preserving its busy guard and geometry handling. */
export function toggleFocusedSideChatMain(doc: Document = document): boolean {
  const activeSide = doc.querySelector<HTMLElement>('[data-side-chat-active]');
  let button: HTMLButtonElement | null = null;
  if (activeSide) {
    // A detached chat has its own identity and no promotion control. Never
    // fall through to a different fork that happens to occupy the main pane.
    const scope = [...doc.querySelectorAll<HTMLElement>('[data-side-chat-name]')].find((element) =>
      element.dataset.sideChatName === activeSide.dataset.sideChatName && element.querySelector('[data-side-chat-move]'),
    );
    button = scope?.querySelector<HTMLButtonElement>('[data-side-chat-move]') ?? null;
  } else {
    button = doc.querySelector<HTMLButtonElement>('[data-main-workspace-chat] [data-side-chat-move]');
  }
  if (!button || button.disabled || button.closest('[aria-hidden="true"]') || button.getClientRects().length === 0) return false;
  button.click();
  return true;
}
