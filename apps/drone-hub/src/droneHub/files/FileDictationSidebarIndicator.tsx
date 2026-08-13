import { UiToolbarButton, UiToolbarIconButton } from '../../ui/components';
import { IconClock } from '../app/icons';
import { formatChatVoiceDuration } from '../chat/use-chat-voice-recorder';
import {
  fileDictationStatusLabel,
  useFileDictation,
} from './FileDictationContext';
import { FileDictationIcon } from './FileDictationIcon';

function PauseIcon({ resume }: { resume: boolean }) {
  return resume ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5-9-5.5Z" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="2.5" width="3.5" height="11" rx="0.75" />
      <rect x="9.5" y="2.5" width="3.5" height="11" rx="0.75" />
    </svg>
  );
}

function FinishIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    </svg>
  );
}

export function FileDictationSidebarIndicator() {
  const dictation = useFileDictation();
  const target = dictation?.target;
  if (!dictation || !target) return null;

  const resume =
    dictation.status === 'paused' ||
    dictation.status === 'error' ||
    dictation.status === 'idle';
  const controlsDisabled = dictation.status === 'starting' || dictation.status === 'stopping';
  const status = fileDictationStatusLabel(
    dictation.status,
    dictation.pendingCount,
    dictation.saving,
    dictation.saved,
  );
  const destination = `${target.droneName} / ${target.name}`;

  return (
    <div className="mx-2 mb-2 rounded-[var(--radius-medium)] border border-[var(--red-border)] bg-[var(--red-subtle)] px-2.5 py-2 text-[var(--fg-secondary)]">
      <div className="flex items-center gap-2">
        <FileDictationIcon active />
        <div className="min-w-0 flex-1">
          <div
            className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--red)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            File dictation
          </div>
          <button
            type="button"
            onClick={dictation.openTarget}
            className="block max-w-full truncate text-left text-[var(--text-11)] text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:underline"
            title={`${target.droneName} / ${target.path}`}
          >
            {destination}
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[var(--text-10)] text-[var(--muted)]">
        <span className="min-w-0 truncate" title={dictation.error || status}>
          {dictation.error || status}
        </span>
        <span className="shrink-0 tabular-nums">
          {formatChatVoiceDuration(dictation.durationMillis)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <UiToolbarButton
          size="xsmall"
          tone="accent"
          pressed={dictation.timestampsEnabled}
          onClick={dictation.toggleTimestamps}
          leadingIcon={<IconClock className="h-3.5 w-3.5" />}
          title="Include date and time at the beginning of each thought"
        >
          Timestamps
        </UiToolbarButton>
        <UiToolbarIconButton
          size="xsmall"
          tone={resume ? 'accent' : 'neutral'}
          label={resume ? 'Resume file dictation' : 'Pause file dictation'}
          icon={<PauseIcon resume={resume} />}
          onClick={() => {
            if (dictation.status === 'idle') {
              void dictation.toggle();
              return;
            }
            void dictation.togglePause();
          }}
          disabled={controlsDisabled || dictation.saving}
        />
        <UiToolbarIconButton
          size="xsmall"
          tone="danger"
          label="Finish file dictation"
          icon={<FinishIcon />}
          onClick={() => void dictation.finish()}
          disabled={dictation.status === 'starting' || dictation.saving}
        />
      </div>
    </div>
  );
}

export function FileDictationSidebarRailButton({
  disabled,
  tabIndex,
  onExpand,
}: {
  disabled: boolean;
  tabIndex: number;
  onExpand: () => void;
}) {
  const dictation = useFileDictation();
  if (!dictation?.target) return null;
  const target = dictation.target;
  const status = fileDictationStatusLabel(
    dictation.status,
    dictation.pendingCount,
    dictation.saving,
    dictation.saved,
  );
  const label = `File dictation · ${target.droneName} / ${target.name} · ${dictation.error || status}`;
  return (
    <UiToolbarIconButton
      onClick={onExpand}
      label={label}
      title={label}
      icon={<FileDictationIcon active />}
      tone="danger"
      pressed
      disabled={disabled}
      tabIndex={tabIndex}
    />
  );
}
