import React from 'react';
import { formatShortcutBinding } from '../app/shortcuts';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import type { DroneFsEntry } from '../types';
import { fileDictationTargetKey, useFileDictation } from './FileDictationContext';
import { FileDictationIcon } from './FileDictationIcon';

/** What dictation needs from the editor that shows the explorer's files. */
export type ExplorerFileDictationActions = {
  appendLine(input: { droneId: string; path: string; line: string }): Promise<boolean>;
  open(target: { droneId: string; path: string; name: string }): void;
};

export type ExplorerFileDictationState = 'recording' | 'last';

export type ExplorerFileDictation = {
  /** 'recording' while dictation goes into the file, 'last' while idle when the toggle shortcut would resume into it. */
  stateOf(path: string): ExplorerFileDictationState | null;
  /** The context menu's dictation item for an entry, or null when the entry takes no dictation. */
  menuItem(entry: DroneFsEntry): { label: string; disabled: boolean; title?: string } | null;
  /** Starts dictation into the file, or finishes it when it is already going there. */
  toggle(entry: Pick<DroneFsEntry, 'path' | 'name'>): void;
};

export function useExplorerFileDictation({
  droneId,
  droneName,
  actions,
  readOnly,
}: {
  droneId: string;
  droneName: string;
  actions: ExplorerFileDictationActions | undefined;
  readOnly: boolean;
}): ExplorerFileDictation | null {
  const dictation = useFileDictation();
  if (!dictation || !actions || readOnly) return null;
  const { target, lastTarget, microphoneOwner } = dictation;
  const keyOf = (path: string) => fileDictationTargetKey({ droneId, path });
  const recordingKey = target ? fileDictationTargetKey(target) : null;
  const lastKey = !target && lastTarget ? fileDictationTargetKey(lastTarget) : null;
  const blocked = target !== null || microphoneOwner !== null;
  return {
    stateOf: (path) => {
      const key = keyOf(path);
      if (key === recordingKey) return 'recording';
      if (key === lastKey) return 'last';
      return null;
    },
    menuItem: (entry) => {
      if (entry.kind !== 'file' || entry.isImage || entry.isVideo) return null;
      if (keyOf(entry.path) === recordingKey) return { label: 'Stop Dictation', disabled: false };
      return blocked
        ? { label: 'Dictate to File', disabled: true, title: 'Another voice session is using the microphone' }
        : { label: 'Dictate to File', disabled: false };
    },
    toggle: (entry) => {
      if (keyOf(entry.path) === recordingKey) {
        void dictation.finish();
        return;
      }
      if (blocked) return;
      void dictation.start({
        droneId,
        droneName,
        path: entry.path,
        name: entry.name || entry.path,
        appendLine: actions.appendLine,
        open: actions.open,
      });
    },
  };
}

/** The mic at the end of an explorer row: red while dictating into the file, muted on the file dictated last. */
export function FileDictationExplorerMark({
  state,
  name,
  zoom,
  onToggle,
}: {
  state: ExplorerFileDictationState;
  name: string;
  zoom: number;
  onToggle(): void;
}) {
  const binding = useDroneHubUiStore((ui) => ui.shortcutBindings.toggleFileDictation);
  const shortcut = binding ? ` (${formatShortcutBinding(binding)})` : '';
  const label = state === 'recording' ? `Stop dictation to ${name}${shortcut}` : `Dictate to ${name} again${shortcut}`;
  const size = Math.round(18 * zoom);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`absolute top-1/2 right-1 flex -translate-y-1/2 items-center justify-center rounded-[var(--radius-small)] transition-colors ${
        state === 'recording'
          ? 'bg-[var(--red-subtle)] text-[var(--red)]'
          : 'text-[var(--muted)] opacity-60 hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] hover:opacity-100'
      }`}
      style={{ width: size, height: size }}
      title={label}
      aria-label={label}
      aria-pressed={state === 'recording'}
    >
      <FileDictationIcon active={state === 'recording'} />
    </button>
  );
}
