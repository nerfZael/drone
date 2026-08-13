import {
  fileDictationTargetKey,
  useFileDictation,
} from './FileDictationContext';
import { FileDictationIcon } from './FileDictationIcon';

type FileDictationEditorActionProps = {
  droneId: string;
  droneName: string;
  path: string;
  name: string;
  editable: boolean;
  loading: boolean;
  saving: boolean;
  externallyChanged: boolean;
  onAppendLine(input: { droneId: string; path: string; line: string }): Promise<boolean>;
  onOpenTarget(target: { droneId: string; path: string; name: string }): void;
};

export function FileDictationEditorAction({
  droneId,
  droneName,
  path,
  name,
  editable,
  loading,
  saving,
  externallyChanged,
  onAppendLine,
  onOpenTarget,
}: FileDictationEditorActionProps) {
  const dictation = useFileDictation();
  if (!dictation) return null;

  const targetMatches = Boolean(
    dictation.target &&
      fileDictationTargetKey(dictation.target) === fileDictationTargetKey({ droneId, path }),
  );
  const blocked = !targetMatches && (dictation.target !== null || dictation.microphoneOwner !== null);
  const disabled = !editable || !path || loading || saving || externallyChanged || blocked;
  const label = targetMatches
    ? 'Finish file dictation'
    : blocked
      ? 'Another voice session is using the microphone'
      : `Dictate to ${name || 'this file'}`;

  return (
    <button
      type="button"
      onClick={() => {
        if (targetMatches) {
          void dictation.finish();
          return;
        }
        if (disabled) return;
        const target = { droneId, droneName, path, name: name || path };
        void dictation.start({
          ...target,
          appendLine: (line) => onAppendLine({ droneId, path, line }),
          open: () => onOpenTarget(target),
        });
      }}
      disabled={disabled && !targetMatches}
      className={`flex h-5 w-5 items-center justify-center rounded-[var(--radius-small)] transition-colors ${
        targetMatches
          ? 'bg-[var(--red-subtle)] text-[var(--red)]'
          : 'bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
      } ${disabled && !targetMatches ? 'cursor-not-allowed opacity-50' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={targetMatches}
    >
      <FileDictationIcon active={targetMatches} />
    </button>
  );
}
