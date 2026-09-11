import { focusedChatWindow } from './focused-chat-window';
const SIDE_CHAT_SELECTOR = '[data-side-chat-name]';
const COMPOSER_SELECTOR = '[data-active-composer-id]';

type ComposerFocusRegistry = {
  focus(id: string): void;
  focusWithin(resolve: () => string | null | undefined): void;
  focusDefault(): void;
};

/** Dockview focuses its content container, which is a parent of our chat root. */
export function sideChatScopeForFocus(target: Element): HTMLElement | null {
  const side = target.closest<HTMLElement>(SIDE_CHAT_SELECTOR);
  if (side) return side;
  if (target.closest('[data-main-workspace-chat]') || target.closest(COMPOSER_SELECTOR)) return null;
  return [...(target.closest('.dv-groupview')?.querySelectorAll<HTMLElement>(
    `.dv-content-container ${SIDE_CHAT_SELECTOR}`,
  ) ?? [])].find((element) => !element.closest('[aria-hidden="true"]') && !element.closest('[style*="display: none"]'))
    ?? null;
}

export function routeComposerFocus(
  target: Element,
  registry: ComposerFocusRegistry,
  markEditorTarget: (id: string) => void,
): void {
  // Quick actions operate on the chat that was active before the menu opened.
  if (target.closest('[data-quick-action-menu]') || target.closest('[data-companion-surface]')) return;
  const doc = target.ownerDocument;
  const side = sideChatScopeForFocus(target);
  const hadActiveSide = Boolean(doc.querySelector('[data-side-chat-active]'));
  doc.querySelectorAll('[data-side-chat-active]').forEach((element) =>
    element.removeAttribute('data-side-chat-active'),
  );
  if (side) side.setAttribute('data-side-chat-active', 'true');

  // Prefer the actual composer when its controls or editor receive focus.
  let composer = target.closest<HTMLElement>(COMPOSER_SELECTOR);
  if (!composer && side) {
    // The title tab and content root share the chat name; the composer lives
    // under the content root, including when the window is docked or moved.
    const scope = [...doc.querySelectorAll<HTMLElement>(SIDE_CHAT_SELECTOR)].find((element) =>
      element.dataset.sideChatName === side.dataset.sideChatName
        && element.querySelector(COMPOSER_SELECTOR),
    );
    composer = scope?.querySelector<HTMLElement>(COMPOSER_SELECTOR) ?? null;
  }
  if (!composer && !side && hadActiveSide) {
    composer = doc.querySelector<HTMLElement>(`[data-main-workspace-chat] ${COMPOSER_SELECTOR}`);
  }
  if (!side && !hadActiveSide && !composer) return;
  if (side) {
    const name = side.dataset.sideChatName;
    registry.focusWithin(() => {
      const active = focusedChatWindow(doc);
      if (!active || active.dataset.sideChatName !== name || active.closest('[aria-hidden="true"]')) {
        markEditorTarget('');
        return undefined;
      }
      const scope = [...doc.querySelectorAll<HTMLElement>(SIDE_CHAT_SELECTOR)].find((element) =>
        element.dataset.sideChatName === name && element.querySelector(COMPOSER_SELECTOR),
      );
      const current = scope?.querySelector<HTMLElement>(COMPOSER_SELECTOR);
      markEditorTarget(current?.dataset.editorModeTargetId ?? '');
      return current?.dataset.activeComposerId ?? null;
    });
  } else if (composer?.dataset.activeComposerId) registry.focus(composer.dataset.activeComposerId);
  else registry.focusDefault();
  markEditorTarget(composer?.dataset.editorModeTargetId ?? '');
}
