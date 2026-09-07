import React from 'react';
import { markCurrentChatComposerEditorModeTarget } from './chat-composer-editor-mode-shortcut';
import type { CompanionTextSnapshot } from '@drone/assistant-chat';

export type ActiveComposer = {
  id: string;
  requiresExplicitFocus?: boolean;
  isEligible(): boolean;
  isReadable?(): boolean;
  appendTranscript(text: string): void;
  readSnapshot?(): CompanionTextSnapshot;
  applyContent?(baseRevision: string, content: string): { ok: true; revision: string };
  sendMessage?(): boolean;
  toggleVoiceRecording?(): boolean;
  toggleVoiceRecordingPause?(): boolean;
  discardVoiceRecording?(): boolean;
  clearComposer?(): boolean;
};

type ActiveComposerContextValue = {
  activeComposerId: string | null;
  registerComposer(composer: ActiveComposer): () => void;
  focusComposer(id: string): void;
  ensureTargetId(): string | null;
  appendTranscript(targetId: string, text: string): boolean;
  readActiveComposer(): CompanionTextSnapshot;
  applyComposer(
    targetId: string,
    baseRevision: string,
    content: string,
  ): { ok: true; revision: string };
  sendMessage(): boolean;
  toggleVoiceRecording(): boolean;
  toggleVoiceRecordingPause(): boolean;
  discardVoiceRecording(): boolean;
  clearComposer(): boolean;
};

const ActiveComposerContext = React.createContext<ActiveComposerContextValue | null>(null);

export class ActiveComposerRegistry {
  private readonly composers = new Map<string, ActiveComposer>();
  private activeId: string | null = null;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): string | null => this.activeId;

  register(composer: ActiveComposer): () => void {
    this.composers.set(composer.id, composer);
    this.ensureTargetId();
    return () => {
      if (this.composers.get(composer.id) !== composer) return;
      this.composers.delete(composer.id);
      if (this.activeId === composer.id) this.ensureTargetId();
    };
  }

  focus(id: string): void {
    if (this.composers.has(id)) this.setActiveId(id);
  }

  focusDefault(): void {
    this.setActiveId(null);
    this.ensureTargetId();
  }

  ensureTargetId(): string | null {
    const current = this.activeId ? this.composers.get(this.activeId) : null;
    if (current?.isEligible()) return current.id;
    const next = [...this.composers.values()].find((composer) => !composer.requiresExplicitFocus && composer.isEligible())?.id ?? null;
    this.setActiveId(next);
    return next;
  }

  appendTranscript(targetId: string, text: string): boolean {
    const composer = this.composers.get(targetId);
    if (!composer?.isEligible()) {
      this.ensureTargetId();
      return false;
    }
    composer.appendTranscript(text);
    return true;
  }

  readActiveComposer(): CompanionTextSnapshot {
    return this.resolveReadable().readSnapshot!();
  }

  applyComposer(
    targetId: string,
    baseRevision: string,
    content: string,
  ): { ok: true; revision: string } {
    const active = this.resolveReadable();
    if (active.id !== targetId) throw new Error('STALE_COMPOSER_TARGET');
    if (!active.applyContent) throw new Error('COMPOSER_NOT_AVAILABLE');
    return active.applyContent(baseRevision, content);
  }

  toggleVoiceRecording(): boolean {
    return this.runActiveAction('toggleVoiceRecording');
  }

  sendMessage(): boolean {
    return this.runActiveAction('sendMessage');
  }

  toggleVoiceRecordingPause(): boolean {
    return this.runActiveAction('toggleVoiceRecordingPause');
  }

  discardVoiceRecording(): boolean {
    return this.runActiveAction('discardVoiceRecording');
  }

  clearComposer(): boolean {
    return this.runActiveAction('clearComposer');
  }

  private resolveReadable(): ActiveComposer {
    const current = this.activeId ? this.composers.get(this.activeId) : null;
    if (current?.readSnapshot && (current.isReadable?.() ?? current.isEligible())) return current;
    const candidates = [...this.composers.values()].filter(
      (composer) => !composer.requiresExplicitFocus && composer.readSnapshot && (composer.isReadable?.() ?? composer.isEligible()),
    );
    const composer = candidates[candidates.length - 1];
    if (!composer) throw new Error('NO_ACTIVE_COMPOSER');
    return composer;
  }

  private runActiveAction(
    action: 'sendMessage' | 'toggleVoiceRecording' | 'toggleVoiceRecordingPause' | 'discardVoiceRecording' | 'clearComposer',
  ): boolean {
    const targetId = this.ensureTargetId();
    const composer = targetId ? this.composers.get(targetId) : null;
    return composer?.[action]?.() ?? false;
  }

  private setActiveId(next: string | null): void {
    if (this.activeId === next) return;
    this.activeId = next;
    for (const listener of this.listeners) listener();
  }
}

export function ActiveComposerProvider({ children }: { children: React.ReactNode }) {
  const registryRef = React.useRef<ActiveComposerRegistry | null>(null);
  if (!registryRef.current) registryRef.current = new ActiveComposerRegistry();
  const registry = registryRef.current;
  const activeComposerId = React.useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  const registerComposer = React.useCallback(
    (composer: ActiveComposer) => registry.register(composer),
    [registry],
  );
  const focusComposer = React.useCallback((id: string) => registry.focus(id), [registry]);
  React.useEffect(() => {
    const routeFocus = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const side = target?.closest<HTMLElement>('[data-side-chat-name]');
      const hadActiveSide = Boolean(document.querySelector('[data-side-chat-active]'));
      document.querySelectorAll('[data-side-chat-active]').forEach((element) => element.removeAttribute('data-side-chat-active'));
      if (side) side.setAttribute('data-side-chat-active', 'true');
      if (!side && !hadActiveSide) return;
      const scope = side
        ? [...document.querySelectorAll<HTMLElement>('[data-side-chat-name]')].find((element) =>
          element.dataset.sideChatName === side.dataset.sideChatName && element.querySelector('[data-active-composer-id]'))
        : document.querySelector('[data-main-workspace-chat]');
      const composer = scope?.querySelector<HTMLElement>('[data-active-composer-id]');
      if (composer?.dataset.activeComposerId) registry.focus(composer.dataset.activeComposerId);
      else if (!side) registry.focusDefault();
      markCurrentChatComposerEditorModeTarget(composer?.dataset.editorModeTargetId ?? '');
    };
    document.addEventListener('pointerdown', routeFocus, true);
    document.addEventListener('focusin', routeFocus, true);
    return () => {
      document.removeEventListener('pointerdown', routeFocus, true);
      document.removeEventListener('focusin', routeFocus, true);
    };
  }, [registry]);
  const ensureTargetId = React.useCallback(() => registry.ensureTargetId(), [registry]);
  const appendTranscript = React.useCallback(
    (targetId: string, text: string) => registry.appendTranscript(targetId, text),
    [registry],
  );
  const readActiveComposer = React.useCallback(() => registry.readActiveComposer(), [registry]);
  const applyComposer = React.useCallback(
    (targetId: string, baseRevision: string, content: string) =>
      registry.applyComposer(targetId, baseRevision, content),
    [registry],
  );
  const sendMessage = React.useCallback(() => registry.sendMessage(), [registry]);
  const toggleVoiceRecording = React.useCallback(() => registry.toggleVoiceRecording(), [registry]);
  const toggleVoiceRecordingPause = React.useCallback(
    () => registry.toggleVoiceRecordingPause(),
    [registry],
  );
  const discardVoiceRecording = React.useCallback(
    () => registry.discardVoiceRecording(),
    [registry],
  );
  const clearComposer = React.useCallback(() => registry.clearComposer(), [registry]);
  const value = React.useMemo<ActiveComposerContextValue>(
    () => ({
      activeComposerId,
      registerComposer,
      focusComposer,
      ensureTargetId,
      appendTranscript,
      readActiveComposer,
      applyComposer,
      sendMessage,
      toggleVoiceRecording,
      toggleVoiceRecordingPause,
      discardVoiceRecording,
      clearComposer,
    }),
    [
      activeComposerId,
      appendTranscript,
      applyComposer,
      clearComposer,
      discardVoiceRecording,
      ensureTargetId,
      focusComposer,
      readActiveComposer,
      registerComposer,
      sendMessage,
      toggleVoiceRecording,
      toggleVoiceRecordingPause,
    ],
  );
  return <ActiveComposerContext.Provider value={value}>{children}</ActiveComposerContext.Provider>;
}

export function useActiveComposer(): ActiveComposerContextValue {
  const value = React.useContext(ActiveComposerContext);
  if (!value) throw new Error('useActiveComposer must be used inside ActiveComposerProvider');
  return value;
}
