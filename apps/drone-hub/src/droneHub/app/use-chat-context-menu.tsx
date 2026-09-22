import React from 'react';
import { SidebarContextMenu, type SidebarContextMenuItem } from './SidebarContextMenu';
import { ChatContextActionsContext, chatActionMenuItems, type ChatContextTarget } from './ChatContextActions';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { isShortcutMatch } from './shortcuts';
import { useOptionalActiveComposer } from '../chat/ActiveComposerContext';
import { markCurrentChatComposerEditorModeTarget, toggleCurrentChatComposerEditorMode } from '../chat/chat-composer-editor-mode-shortcut';
import { useContinuousDictation } from '../chat/ContinuousDictationContext';
import { useSideChatBusyStore } from './side-chat-busy-store';

const NATIVE_MENU_TARGETS =
  'a[href], input, textarea, select, [contenteditable="true"], img, video, canvas, .monaco-editor, [role="menu"]';

/**
 * Right-clicks that keep the browser's own menu: on selected text (copy), in
 * fields (paste, spelling), on links and media. Elements from a chat's desktop
 * window belong to that window, so this reads them without instanceof checks.
 */
export function keepsNativeContextMenu(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (typeof element?.closest !== 'function') return true;
  if (element.closest(NATIVE_MENU_TARGETS)) return true;
  // Only a click on the selection itself; a selection left elsewhere in the window does not count.
  const selection = element.ownerDocument.defaultView?.getSelection();
  return Boolean(selection && selection.toString().trim() && selection.containsNode(element, true));
}

/**
 * A right-click menu for a chat surface. Put `onContextMenu` on the chat's
 * root element and render `menu` anywhere; the menu opens in whichever window
 * the click came from. With no items, right-click is left alone.
 */
export function useChatContextMenu(label: string, getItems: () => SidebarContextMenuItem[], target?: ChatContextTarget) {
  const actions = React.useContext(ChatContextActionsContext);
  const composer = useOptionalActiveComposer();
  const dictation = useContinuousDictation();
  useSideChatBusyStore(state => Boolean(target && state.busy[target.droneId]));
  const actionScopeRef = React.useRef({ actions, target });
  actionScopeRef.current = { actions, target };
  const [open, setOpen] = React.useState<{ x: number; y: number; view: Window; scope: HTMLElement; target?: ChatContextTarget; items: SidebarContextMenuItem[] } | null>(null);
  const getItemsRef = React.useRef(getItems);
  getItemsRef.current = getItems;
  const onContextMenu = React.useCallback((event: React.MouseEvent) => {
    // React also bubbles events here from dialogs and popovers the chat opened; those are not the chat.
    if (!event.currentTarget.contains(event.target as Node | null)) return;
    if (event.defaultPrevented || keepsNativeContextMenu(event.target)) return;
    const extraItems = getItemsRef.current();
    const { actions, target } = actionScopeRef.current;
    const chatItems = actions && target
      ? chatActionMenuItems(target, event.currentTarget as HTMLElement, actions, useDroneHubUiStore.getState().shortcutBindings)
      : [];
    const items = [...chatItems, ...extraItems.map((item, index) =>
      index === 0 && chatItems.length ? { ...item, separatorBefore: true } : item)];
    const view = (event.target as Element).ownerDocument.defaultView;
    if (items.length === 0 || !view) return;
    event.preventDefault();
    setOpen({ x: event.clientX, y: event.clientY, view, items, scope: event.currentTarget as HTMLElement, target });
  }, []);
  const close = React.useCallback(() => setOpen(null), []);
  // Desktop portals have their own document, outside the Hub's key listener.
  const onDesktopKeyDown = (event: KeyboardEvent, scope: HTMLElement) => {
    const element = event.target as HTMLElement;
    if (event.defaultPrevented || event.repeat || event.isComposing || !actions || !target || !element?.closest) return;
    if ((!scope.contains(element) && element !== scope.ownerDocument.body) || element.closest('[role="menu"], [data-shortcut-capture="true"]')) return;
    if (element.ownerDocument.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey &&
      composer?.sendRecordingInClonedChat()) {
      event.preventDefault();
      return;
    }
    const bindings = useDroneHubUiStore.getState().shortcutBindings;
    const action = (['createDroneChat', 'cloneDroneChat', 'createSideChat', 'focusPrimaryChatInput',
      'sendActiveChatComposer', 'toggleChatComposerEditorMode', 'toggleChatVoiceRecording',
      'toggleChatVoiceRecordingPause', 'discardChatVoiceRecording', 'clearChatComposer', 'toggleContinuousDictation'] as const)
      .find(id => isShortcutMatch(bindings[id], event));
    const editable = Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
    if (editable && action !== 'toggleChatComposerEditorMode') return;
    if (event.key === 'Enter' && element.closest('button, a[href], [role="button"]')) return;
    const localComposer = scope.querySelector<HTMLElement>('[data-active-composer-id]');
    const composerId = localComposer?.dataset.activeComposerId;
    if (composerId) {
      composer?.focusComposer(composerId);
      markCurrentChatComposerEditorModeTarget(composerId);
    }
    const localComposerReady = Boolean(composerId && composer?.ensureTargetId() === composerId);
    let handled = false;
    if (!action && event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      handled = Boolean(localComposerReady && composer?.sendMessage('asap'));
    } else if (action === 'createDroneChat') { actions.createChat(target); handled = true; }
    else if (action === 'cloneDroneChat') { actions.cloneChat(target); handled = true; }
    else if (action === 'createSideChat') {
      const fork = chatActionMenuItems(target, scope, actions, bindings).find(item => item.id === 'fork-side-chat');
      if (fork && !fork.disabled) { fork.onSelect(); handled = true; }
    } else if (action === 'focusPrimaryChatInput') {
      const input = scope.querySelector<HTMLElement>('[data-chat-input-focus-id]');
      if (input) { input.focus(); handled = true; }
    } else if (localComposerReady && composer) {
      if (action === 'sendActiveChatComposer') handled = composer.sendMessage();
      else if (action === 'toggleChatComposerEditorMode') handled = toggleCurrentChatComposerEditorMode();
      else if (action === 'toggleChatVoiceRecording') handled = composer.toggleVoiceRecording();
      else if (action === 'toggleChatVoiceRecordingPause') handled = composer.toggleVoiceRecordingPause();
      else if (action === 'discardChatVoiceRecording') handled = composer.discardVoiceRecording();
      else if (action === 'clearChatComposer') handled = composer.clearComposer();
      else if (action === 'toggleContinuousDictation' && dictation) { void dictation.toggle(); handled = true; }
    }
    if (handled) event.preventDefault();
  };
  const currentChatItems = open?.target && actions
    ? chatActionMenuItems(open.target, open.scope, actions, useDroneHubUiStore.getState().shortcutBindings) : [];
  const menu = open
    ? <SidebarContextMenu x={open.x} y={open.y} view={open.view} label={label}
        items={open.items.map(item => currentChatItems.find(current => current.id === item.id) ?? item)} onClose={close} />
    : null;
  return { onContextMenu, onDesktopKeyDown, menu };
}
