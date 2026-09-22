import { isShortcutMatch, type ShortcutBindingMap } from '../app/shortcuts';
import { APP_SHORTCUT_BOUNDARY_SELECTOR } from '../app/AppShortcutBoundary';

/** Focus-local only. Editors, menus, dialogs and user bindings keep their keys. */
export function companionSessionShortcut(event: KeyboardEvent, bindings: ShortcutBindingMap): number | null {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey ||
      event.altKey || event.shiftKey || !/^[0-9]$/.test(event.key)) return null;
  const target = event.target as Element | null;
  const page = target?.ownerDocument ?? (event.currentTarget as Window | null)?.document ?? event.view?.document;
  if (!page?.hasFocus()) return null;
  // The canvas captures its own shortcuts but lets unhandled number keys reach
  // Companion. Editors and nested shortcut-binding capture still keep their keys.
  if (target?.closest?.(`input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-portable-editor], .monaco-editor, [data-shortcut-capture="true"]:not([data-drone-canvas-viewport="1"]), ${APP_SHORTCUT_BOUNDARY_SELECTOR}`) ||
      page?.querySelector('[data-quick-action-menu], [role="dialog"][aria-modal="true"], [role="menu"]')) return null;
  if (Object.values(bindings).some(binding => isShortcutMatch(binding, event))) return null;
  return Number(event.key);
}
