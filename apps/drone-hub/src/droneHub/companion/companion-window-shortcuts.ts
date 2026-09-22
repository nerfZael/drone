import { isShortcutMatch, SHORTCUT_DEFINITIONS, type ShortcutBindingMap } from '../app/shortcuts';

export const COMPANION_WINDOW_SHORTCUT_CANCEL = 'companion-window-shortcut-cancel';

/** Keep the existing local tap/hold and proposal handlers usable after moving focus
 * to the floating window. Only Companion actions cross this document boundary. */
export function relayCompanionWindowShortcuts(view: Window, owner: Window, bindings: () => ShortcutBindingMap): () => void {
  let pressed: string | null = null;
  const cancel = () => {
    if (!pressed) return;
    pressed = null;
    owner.dispatchEvent(new (owner as Window & typeof globalThis).Event(COMPANION_WINDOW_SHORTCUT_CANCEL));
  };
  const relay = (event: KeyboardEvent) => {
    const releasing = event.type === 'keyup' && pressed === (event.code || event.key);
    if (!releasing) {
      if (event.defaultPrevented || event.isComposing || !view.document.hasFocus()) return;
      const target = event.target as Element | null;
      if (target?.closest?.('[data-shortcut-capture="true"]') ||
          view.document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const current = bindings();
      const action = SHORTCUT_DEFINITIONS.find(item => isShortcutMatch(current[item.id], event))?.id;
      if (action !== 'toggleCompanion' && action !== 'applyCompanionProposal') return;
    }
    const forwarded = new (owner as Window & typeof globalThis).KeyboardEvent(event.type, {
      key: event.key, code: event.code, repeat: event.repeat, isComposing: event.isComposing,
      ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey,
      bubbles: true, cancelable: true, view: owner,
    });
    // The owner retains global-shortcut deduplication and proposal double-tap logic.
    owner.document.dispatchEvent(forwarded);
    if (releasing) pressed = null;
    if (!forwarded.defaultPrevented) return;
    if (event.type === 'keydown') pressed = event.code || event.key;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  view.document.addEventListener('keydown', relay, true);
  view.document.addEventListener('keyup', relay, true);
  view.addEventListener('blur', cancel);
  return () => {
    cancel();
    view.document.removeEventListener('keydown', relay, true);
    view.document.removeEventListener('keyup', relay, true);
    view.removeEventListener('blur', cancel);
  };
}
