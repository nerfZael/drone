import React from 'react';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import {
  SHORTCUT_DEFINITIONS,
  cloneDefaultShortcutBindings,
  formatShortcutBinding,
  shortcutBindingFromKeyboardEvent,
  shortcutBindingSignature,
  type ShortcutActionId,
} from './shortcuts';

export function ShortcutSettingsSection() {
  const shortcutBindings = useDroneHubUiStore((s) => s.shortcutBindings);
  const setShortcutBinding = useDroneHubUiStore((s) => s.setShortcutBinding);
  const resetShortcutBindings = useDroneHubUiStore((s) => s.resetShortcutBindings);
  const [capturingActionId, setCapturingActionId] = React.useState<ShortcutActionId | null>(null);

  const defaultShortcutBindings = React.useMemo(() => cloneDefaultShortcutBindings(), []);

  const conflictingActionIds = React.useMemo(() => {
    const sigToActionIds = new Map<string, ShortcutActionId[]>();
    for (const def of SHORTCUT_DEFINITIONS) {
      const sig = shortcutBindingSignature(shortcutBindings[def.id]);
      if (!sig) continue;
      const list = sigToActionIds.get(sig) ?? [];
      list.push(def.id);
      sigToActionIds.set(sig, list);
    }
    const out = new Set<ShortcutActionId>();
    for (const ids of sigToActionIds.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) out.add(id);
    }
    return out;
  }, [shortcutBindings]);

  const conflictByActionId = React.useMemo(() => {
    const sigToActionIds = new Map<string, ShortcutActionId[]>();
    for (const def of SHORTCUT_DEFINITIONS) {
      const sig = shortcutBindingSignature(shortcutBindings[def.id]);
      if (!sig) continue;
      const list = sigToActionIds.get(sig) ?? [];
      list.push(def.id);
      sigToActionIds.set(sig, list);
    }

    const labelByAction = new Map<ShortcutActionId, string>(SHORTCUT_DEFINITIONS.map((def) => [def.id, def.label]));
    const out = new Map<ShortcutActionId, string[]>();
    for (const ids of sigToActionIds.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        const others = ids.filter((candidate) => candidate !== id);
        out.set(
          id,
          others
            .map((candidate) => labelByAction.get(candidate) ?? candidate)
            .filter(Boolean),
        );
      }
    }
    return out;
  }, [shortcutBindings]);

  const handleCaptureKeyDown = React.useCallback(
    (actionId: ShortcutActionId, e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (capturingActionId !== actionId) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setCapturingActionId(null);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setShortcutBinding(actionId, null);
        setCapturingActionId(null);
        return;
      }

      const next = shortcutBindingFromKeyboardEvent(e.nativeEvent, {
        preferPortablePrimaryModifier: true,
      });
      if (!next) return;
      setShortcutBinding(actionId, next);
      setCapturingActionId(null);
    },
    [capturingActionId, setShortcutBinding],
  );

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Keyboard shortcuts
          </div>
          <div className="text-[11px] text-[var(--muted-dim)] mt-1 leading-relaxed">
            Click a shortcut, then press any key combo (letters, function keys, and modifiers). Ctrl and Cmd are captured as a portable Ctrl/Cmd modifier.
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setCapturingActionId(null);
            resetShortcutBindings();
          }}
          className="h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
          style={{ fontFamily: 'var(--display)' }}
          title="Reset all shortcuts to defaults"
        >
          Reset defaults
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {SHORTCUT_DEFINITIONS.map((def) => {
          const binding = shortcutBindings[def.id];
          const isCapturing = capturingActionId === def.id;
          const hasConflict = conflictingActionIds.has(def.id);
          return (
            <div key={def.id} className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] text-[var(--fg-secondary)] font-semibold">{def.label}</div>
                  <div className="text-[11px] text-[var(--muted-dim)] mt-1 leading-relaxed">{def.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-shortcut-capture="true"
                    onClick={() => setCapturingActionId(def.id)}
                    onBlur={() => {
                      if (capturingActionId === def.id) setCapturingActionId(null);
                    }}
                    onKeyDown={(e) => handleCaptureKeyDown(def.id, e)}
                    className={`h-9 min-w-[180px] px-3 rounded text-[11px] font-semibold border transition-all font-mono ${
                      isCapturing
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                    }`}
                    title={isCapturing ? 'Press your new shortcut. Esc to cancel, Backspace/Delete to clear.' : 'Click and press keys to change this shortcut'}
                  >
                    {isCapturing ? 'Press keys...' : formatShortcutBinding(binding)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShortcutBinding(def.id, null)}
                    disabled={!binding}
                    className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                      binding
                        ? 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                        : 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Remove this shortcut"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const defaultBinding = defaultShortcutBindings[def.id];
                      setShortcutBinding(def.id, defaultBinding ? { ...defaultBinding } : null);
                    }}
                    className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                    style={{ fontFamily: 'var(--display)' }}
                    title="Reset this shortcut to its default value"
                  >
                    Reset
                  </button>
                </div>
              </div>
              {hasConflict && (
                <div className="text-[11px] text-[var(--yellow)]">
                  Conflicts with: {(conflictByActionId.get(def.id) ?? []).join(', ')}. The first matching action in the list will run.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
