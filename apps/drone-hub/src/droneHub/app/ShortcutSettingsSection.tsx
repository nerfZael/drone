import React from 'react';
import type {
  DroneHubGlobalShortcutBindings,
  DroneHubGlobalShortcutSettingsResponse,
} from '@drone/hub-model';
import { requestJson } from '../http';
import { applyGlobalShortcutSettings } from './global-shortcut-state';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import {
  SHORTCUT_DEFINITIONS,
  cloneDefaultShortcutBindings,
  formatShortcutBinding,
  shortcutBindingFromKeyboardEvent,
  shortcutBindingSignature,
  type ShortcutActionId,
  type ShortcutBinding,
} from './shortcuts';

export function ShortcutSettingsSection() {
  const shortcutBindings = useDroneHubUiStore((state) => state.shortcutBindings);
  const setShortcutBindings = useDroneHubUiStore((state) => state.setShortcutBindings);
  const setShortcutBinding = useDroneHubUiStore((state) => state.setShortcutBinding);
  const resetShortcutBindings = useDroneHubUiStore((state) => state.resetShortcutBindings);
  const [capturingActionId, setCapturingActionId] = React.useState<ShortcutActionId | null>(null);
  const [globalSettings, setGlobalSettings] =
    React.useState<DroneHubGlobalShortcutSettingsResponse | null>(null);
  const [globalError, setGlobalError] = React.useState('');
  const [pendingGlobalActionIds, setPendingGlobalActionIds] = React.useState<Set<ShortcutActionId>>(
    () => new Set(),
  );
  const globalBindingsRef = React.useRef<DroneHubGlobalShortcutBindings>({});
  const globalSaveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const globalSaveSequenceRef = React.useRef(0);
  const latestSaveByActionRef = React.useRef(new Map<ShortcutActionId, number>());
  const defaultShortcutBindings = React.useMemo(() => cloneDefaultShortcutBindings(), []);

  const applySettings = React.useCallback(
    (settings: DroneHubGlobalShortcutSettingsResponse, mergeBindings: boolean) => {
      globalBindingsRef.current = settings.bindings;
      setGlobalSettings(settings);
      applyGlobalShortcutSettings(settings);
      if (mergeBindings) {
        setShortcutBindings((current) => ({ ...current, ...settings.bindings }));
      }
    },
    [setShortcutBindings],
  );

  React.useEffect(() => {
    let cancelled = false;
    void requestJson<DroneHubGlobalShortcutSettingsResponse>('/api/settings/global-shortcuts')
      .then((settings) => {
        if (cancelled) return;
        setGlobalError('');
        applySettings(settings, true);
      })
      .catch((error) => {
        if (!cancelled) setGlobalError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [applySettings]);

  const saveGlobalBindings = React.useCallback(
    async (next: DroneHubGlobalShortcutBindings, actionIds: ShortcutActionId[]) => {
      const sequence = ++globalSaveSequenceRef.current;
      globalBindingsRef.current = next;
      for (const actionId of actionIds) latestSaveByActionRef.current.set(actionId, sequence);
      setPendingGlobalActionIds((current) => new Set([...current, ...actionIds]));
      setGlobalError('');
      const save = globalSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const settings = await requestJson<DroneHubGlobalShortcutSettingsResponse>(
            '/api/settings/global-shortcuts',
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ bindings: next }),
            },
          );
          if (sequence === globalSaveSequenceRef.current) {
            setGlobalError('');
            applySettings(settings, false);
          } else {
            setGlobalSettings(settings);
            applyGlobalShortcutSettings(settings);
          }
        });
      globalSaveQueueRef.current = save;
      try {
        await save;
      } catch (error) {
        if (sequence === globalSaveSequenceRef.current) {
          setGlobalError(error instanceof Error ? error.message : String(error));
          try {
            const settings = await requestJson<DroneHubGlobalShortcutSettingsResponse>(
              '/api/settings/global-shortcuts',
            );
            applySettings(settings, true);
          } catch {
            // Keep the original save error visible when recovery also fails.
          }
        }
      } finally {
        setPendingGlobalActionIds((current) => {
          const updated = new Set(current);
          for (const actionId of actionIds) {
            if (latestSaveByActionRef.current.get(actionId) !== sequence) continue;
            latestSaveByActionRef.current.delete(actionId);
            updated.delete(actionId);
          }
          return updated;
        });
      }
    },
    [applySettings],
  );

  const updateBinding = React.useCallback(
    (actionId: ShortcutActionId, binding: ShortcutBinding | null) => {
      setShortcutBinding(actionId, binding);
      if (!globalBindingsRef.current[actionId]) return;
      const next = { ...globalBindingsRef.current };
      if (binding) next[actionId] = binding;
      else delete next[actionId];
      void saveGlobalBindings(next, [actionId]);
    },
    [saveGlobalBindings, setShortcutBinding],
  );

  const toggleGlobal = React.useCallback(
    (actionId: ShortcutActionId) => {
      const next = { ...globalBindingsRef.current };
      if (next[actionId]) {
        delete next[actionId];
      } else {
        const binding = shortcutBindings[actionId];
        if (!binding) return;
        next[actionId] = binding;
      }
      void saveGlobalBindings(next, [actionId]);
    },
    [saveGlobalBindings, shortcutBindings],
  );

  const conflicts = React.useMemo(() => shortcutConflicts(shortcutBindings), [shortcutBindings]);

  const handleCaptureKeyDown = React.useCallback(
    (actionId: ShortcutActionId, event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (capturingActionId !== actionId) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setCapturingActionId(null);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        updateBinding(actionId, null);
        setCapturingActionId(null);
        return;
      }
      const next = shortcutBindingFromKeyboardEvent(event.nativeEvent, {
        preferPortablePrimaryModifier: true,
      });
      if (!next) return;
      updateBinding(actionId, next);
      setCapturingActionId(null);
    },
    [capturingActionId, updateBinding],
  );

  const resetAll = () => {
    setCapturingActionId(null);
    resetShortcutBindings();
    const next: DroneHubGlobalShortcutBindings = {};
    const changed: ShortcutActionId[] = [];
    for (const actionId of Object.keys(globalBindingsRef.current) as ShortcutActionId[]) {
      changed.push(actionId);
      const binding = defaultShortcutBindings[actionId];
      if (binding) next[actionId] = binding;
    }
    if (changed.length > 0) void saveGlobalBindings(next, changed);
  };

  return (
    <div className="dh-settings-section">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-10 font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Keyboard shortcuts
          </div>
          <div className="text-11 text-[var(--muted-dim)] mt-1 leading-relaxed">
            Numpad keys are kept separate from number-row keys. Enable Global for shortcuts that
            should run while Drone Hub is unfocused or minimized. Global keys are observed without
            blocking the foreground application.
          </div>
          <div className="text-11 text-[var(--muted-dim)] mt-1 leading-relaxed">
            For voice shortcuts, open Hub once and grant microphone permission before relying on a
            minimized window.
          </div>
          {globalSettings?.status.warning && (
            <div className="text-11 text-[var(--yellow)] mt-2">
              {globalSettings.status.warning}
            </div>
          )}
          {globalError && (
            <div className="text-11 text-[var(--red)] mt-2">
              Global shortcuts: {globalError}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="inline-flex items-center justify-center whitespace-nowrap shrink-0 h-8 px-3 rounded text-11 font-[var(--weight-semibold)] tracking-wide uppercase border transition-all bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
          style={{ fontFamily: 'var(--display)' }}
          title="Reset all shortcuts to defaults"
        >
          Reset defaults
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {SHORTCUT_DEFINITIONS.map((definition) => {
          const binding = shortcutBindings[definition.id];
          const isCapturing = capturingActionId === definition.id;
          const globalEnabled = Boolean(globalSettings?.bindings[definition.id]);
          const globalPending = pendingGlobalActionIds.has(definition.id);
          const globalStatus = globalSettings?.status.actions[definition.id];
          const conflictLabels = conflicts.get(definition.id) ?? [];
          return (
            <div key={definition.id} className="dh-settings-row flex flex-col gap-2 px-1 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-12 text-[var(--fg-secondary)] font-[var(--weight-semibold)]">
                    {definition.label}
                  </div>
                  <div className="text-11 text-[var(--muted-dim)] mt-1 leading-relaxed">
                    {definition.description}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    data-shortcut-capture="true"
                    onClick={() => setCapturingActionId(definition.id)}
                    onBlur={() => {
                      if (capturingActionId === definition.id) setCapturingActionId(null);
                    }}
                    onKeyDown={(event) => handleCaptureKeyDown(definition.id, event)}
                    className={`h-9 min-w-[180px] px-3 rounded text-11 font-[var(--weight-semibold)] border transition-all font-mono ${
                      isCapturing
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                    }`}
                    title={
                      isCapturing
                        ? 'Press your new shortcut. Esc to cancel, Backspace/Delete to clear.'
                        : 'Click and press keys to change this shortcut'
                    }
                  >
                    {isCapturing ? 'Press keys...' : formatShortcutBinding(binding)}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleGlobal(definition.id)}
                    disabled={!globalSettings || !binding || globalPending}
                    className={`h-9 px-3 rounded text-11 font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                      globalEnabled
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    } ${!globalSettings || !binding || globalPending ? 'opacity-40 cursor-not-allowed' : ''}`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Run this shortcut even when Drone Hub is not focused"
                  >
                    {globalPending ? 'Saving' : 'Global'}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateBinding(definition.id, null)}
                    disabled={!binding}
                    className={`h-9 px-3 rounded text-11 font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                      binding
                        ? 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                        : 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Remove this shortcut"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const defaultBinding = defaultShortcutBindings[definition.id];
                      updateBinding(definition.id, defaultBinding ? { ...defaultBinding } : null);
                    }}
                    className="h-9 px-3 rounded text-11 font-[var(--weight-semibold)] tracking-wide uppercase border transition-all bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                    style={{ fontFamily: 'var(--display)' }}
                    title="Reset this shortcut to its default value"
                  >
                    Reset
                  </button>
                </div>
              </div>
              {conflictLabels.length > 0 && (
                <div className="text-11 text-[var(--yellow)]">
                  Conflicts with: {conflictLabels.join(', ')}. The first local match runs, a global
                  action takes priority, and duplicate global actions are disabled.
                </div>
              )}
              {globalEnabled && globalStatus?.error && (
                <div className="text-11 text-[var(--red)]">
                  Global shortcut unavailable: {globalStatus.error}
                </div>
              )}
              {globalEnabled && globalStatus?.active && (
                <div className="text-11 text-[var(--muted-dim)]">
                  Active globally while the Hub process is running.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortcutConflicts(
  bindings: Record<ShortcutActionId, ShortcutBinding | null>,
): Map<ShortcutActionId, string[]> {
  const signatureToIds = new Map<string, ShortcutActionId[]>();
  for (const definition of SHORTCUT_DEFINITIONS) {
    const signature = shortcutBindingSignature(bindings[definition.id]);
    if (!signature) continue;
    const ids = signatureToIds.get(signature) ?? [];
    ids.push(definition.id);
    signatureToIds.set(signature, ids);
  }
  const labels = new Map(
    SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition.label]),
  );
  const conflicts = new Map<ShortcutActionId, string[]>();
  for (const ids of signatureToIds.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      conflicts.set(
        id,
        ids
          .filter((candidate) => candidate !== id)
          .map((candidate) => labels.get(candidate) ?? candidate),
      );
    }
  }
  return conflicts;
}
