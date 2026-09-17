import React from 'react';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { DEFAULT_COMPANION_SHORTCUT_DURATIONS, validCompanionShortcutDurations, type CompanionShortcutDurations } from './companion-shortcut';

const fields = [
  ['pauseMs', 'Pause / resume'],
  ['cancelMs', 'Cancel recording / close panel'],
  ['resetMs', 'Stop and reset context'],
] as const;

const secondsDraft = (value: CompanionShortcutDurations) => ({
  pauseMs: String(value.pauseMs / 1000), cancelMs: String(value.cancelMs / 1000), resetMs: String(value.resetMs / 1000),
});

export function CompanionShortcutSettings() {
  const durations = useDroneHubUiStore(state => state.companionShortcutDurations);
  const save = useDroneHubUiStore(state => state.setCompanionShortcutDurations);
  const [draft, setDraft] = React.useState(() => secondsDraft(durations));
  React.useEffect(() => { setDraft(secondsDraft(durations)); }, [durations]);
  const next = Object.fromEntries(fields.map(([key]) => [key, draft[key].trim() ? Math.round(Number(draft[key]) * 1000) : NaN])) as CompanionShortcutDurations;
  const valid = validCompanionShortcutDurations(next);
  const dirty = fields.some(([key]) => next[key] !== durations[key]);
  return (
    <section aria-label="Companion shortcut hold durations" className="rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4">
      <h3 className="text-sm font-semibold text-[var(--fg)]">Shortcut hold durations</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        With Live voice off, tap to start recording or send the current clip, including a paused clip.
        Short hold: pause or resume. Middle hold: discard an active recording and keep the panel open;
        if recording was already stopped when you pressed the key, close the panel and stop the Companion agent without forgetting the conversation.
        Long hold: stop recording and the agent, discard pending audio, and clear context.
        Release to act; holding longer never performs the shorter actions first.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {fields.map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 text-xs text-[var(--fg)]">
            {label} (seconds)
            <input type="number" min="0.2" max="10" step="0.1" value={draft[key]}
              onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, [key]: value })); }}
              className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5" />
          </label>
        ))}
      </div>
      {!valid ? <p role="alert" className="mt-2 text-xs text-[var(--red)]">
        Use durations from 0.2 to 10 seconds, in ascending order with at least 0.2 seconds between each action.
      </p> : null}
      <div className="mt-3 flex items-center gap-3">
        <span className="mr-auto text-xs text-[var(--muted)]">{dirty ? 'Unsaved shortcut changes' : 'Saved on this desktop'} · applies to the next key press.</span>
        <button type="button" onClick={() => save({ ...DEFAULT_COMPANION_SHORTCUT_DURATIONS })}
          className="rounded border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--muted)]">Restore default durations</button>
        <button type="button" disabled={!valid || !dirty} onClick={() => save(next)}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-[var(--accent-contrast)] disabled:opacity-40">Save hold durations</button>
      </div>
    </section>
  );
}
