import { focusedChatWindow } from './focused-chat-window';
const SIDE_CHAT_SELECTOR = '[data-side-chat-name]';
const COMPOSER_SELECTOR = '[data-active-composer-id]';
/** Marks a surface whose composer takes keyboard shortcuts whenever the user works anywhere in it. */
export const COMPOSER_SCOPE_SELECTOR = '[data-composer-scope]';
const ACTIVE_COMPOSER_SCOPE_SELECTOR = '[data-composer-scope-active]';

/** Fired after focus routing: which floating chat is active now, and what the user pressed. */
export const ACTIVE_SIDE_CHAT_EVENT = 'drone-hub:active-side-chat-change';
export type ActiveSideChatEventDetail = { name: string | null; target: Element };

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
  // Like a floating chat, a composer scope remembers being the target, so leaving it returns the shortcuts to the chat.
  const hadActiveScope = Boolean(doc.querySelector(ACTIVE_COMPOSER_SCOPE_SELECTOR));
  doc.querySelectorAll(ACTIVE_COMPOSER_SCOPE_SELECTOR).forEach((element) =>
    element.removeAttribute('data-composer-scope-active'),
  );
  doc.defaultView?.dispatchEvent(new CustomEvent<ActiveSideChatEventDetail>(ACTIVE_SIDE_CHAT_EVENT, {
    detail: { name: side?.dataset.sideChatName ?? null, target },
  }));

  // The chat in the canvas's full-view panel is read there and written to from the canvas's composer, the only
  // one in sight: shortcuts pressed in the panel (Q records, S sends) act on that composer.
  if (target.closest('[data-canvas-chat-panel]')) {
    const canvasComposer = doc.querySelector<HTMLElement>(`[data-canvas-message-bar] ${COMPOSER_SELECTOR}`);
    if (canvasComposer?.dataset.activeComposerId) {
      registry.focus(canvasComposer.dataset.activeComposerId);
      markEditorTarget(canvasComposer.dataset.editorModeTargetId ?? '');
    }
    return;
  }

  // A surface with one composer of its own (a channel): clicking anywhere in it makes that composer the target,
  // so Q records and S sends there rather than in the drone's chat.
  const composerScope = target.closest<HTMLElement>(COMPOSER_SCOPE_SELECTOR);
  if (composerScope) composerScope.setAttribute('data-composer-scope-active', 'true');
  if (composerScope && !target.closest(COMPOSER_SELECTOR)) {
    const scoped = composerScope.querySelector<HTMLElement>(COMPOSER_SELECTOR);
    if (scoped?.dataset.activeComposerId) {
      registry.focus(scoped.dataset.activeComposerId);
      markEditorTarget(scoped.dataset.editorModeTargetId ?? '');
      return;
    }
  }

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
  const leftScope = hadActiveScope && !composerScope;
  if (!composer && !side && (hadActiveSide || leftScope)) {
    composer = doc.querySelector<HTMLElement>(`[data-main-workspace-chat] ${COMPOSER_SELECTOR}`);
  }
  if (!side && !hadActiveSide && !leftScope && !composer) return;
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
