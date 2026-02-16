import React from 'react';

type UseGlobalShortcutsArgs = {
  droneErrorModalOpen: boolean;
  onCloseDroneErrorModal: () => void;
  onOpenCreateModal: () => void;
  onOpenDraftChatComposer: () => void;
  onToggleTldrFromShortcut: () => void;
};

export function useGlobalShortcuts({
  droneErrorModalOpen,
  onCloseDroneErrorModal,
  onOpenCreateModal,
  onOpenDraftChatComposer,
  onToggleTldrFromShortcut,
}: UseGlobalShortcutsArgs) {
  React.useEffect(() => {
    if (!droneErrorModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseDroneErrorModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [droneErrorModalOpen, onCloseDroneErrorModal]);

  React.useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        target.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (isEditableTarget(e.target)) return;

      // Keep existing power-user shortcut for opening the bulk create modal.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'n') {
        e.preventDefault();
        onOpenCreateModal();
        return;
      }

      // Letter shortcuts only apply for plain key presses.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (key === 'w') {
        e.preventDefault();
        onToggleTldrFromShortcut();
        return;
      }
      if (key === 'a') {
        e.preventDefault();
        onOpenDraftChatComposer();
        return;
      }
      if (key === 's') {
        e.preventDefault();
        onOpenCreateModal();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onOpenCreateModal, onOpenDraftChatComposer, onToggleTldrFromShortcut]);
}

