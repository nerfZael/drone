import React from 'react';
import { alertDialog } from '../../ui/AppConfirmDialog';
import { APP_SHORTCUT_BOUNDARY_SELECTOR } from './AppShortcutBoundary';

const chatScopeSelector = '[data-chat-drone-id][data-chat-name]';
const ignoredSelector = `input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="menu"], [data-shortcut-capture="true"], ${APP_SHORTCUT_BOUNDARY_SELECTOR}`;

/** Bind before window-level sidebar shortcuts, while leaving editor Delete untouched. */
export function useChatDeleteShortcut(onDelete: (
  droneId: string, chatName: string,
) => Promise<{ ok: boolean; error?: string | null }>) {
  const action = React.useRef(onDelete);
  action.current = onDelete;
  React.useEffect(() => {
    let lastScope: HTMLElement | null = null;
    let deleting = false;
    const rememberScope = (event: Event) => {
      lastScope = event.target instanceof Element
        ? event.target.closest<HTMLElement>(chatScopeSelector) : null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.key !== 'Delete' ||
        event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(ignoredSelector) || document.activeElement?.closest(ignoredSelector) ||
        document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const scope = target?.closest<HTMLElement>(chatScopeSelector) ??
        (target === document.body && lastScope?.isConnected ? lastScope : null);
      const droneId = scope?.dataset.chatDroneId;
      const chatName = scope?.dataset.chatName;
      if (!droneId || !chatName) return;
      // A stale sidebar selection must not also process this Delete.
      event.preventDefault();
      event.stopPropagation();
      if (deleting) return;
      deleting = true;
      void (async () => {
        try {
          const result = await action.current(droneId, chatName);
          if (!result.ok && result.error) await alertDialog({ title: 'Could not delete the chat', message: result.error });
        } catch (error) {
          await alertDialog({ title: 'Could not delete the chat', message: error instanceof Error ? error.message : String(error) });
        } finally {
          deleting = false;
        }
      })();
    };
    document.addEventListener('pointerdown', rememberScope, true);
    document.addEventListener('focusin', rememberScope, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', rememberScope, true);
      document.removeEventListener('focusin', rememberScope, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
