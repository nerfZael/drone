import React from 'react';
import { profileStorageKey } from '../../profile-storage';

export const EDITOR_ZOOM_MIN_LEVEL = -4;
export const EDITOR_ZOOM_DEFAULT_LEVEL = 0;
export const EDITOR_ZOOM_MAX_LEVEL = 8;
// The scope suffix intentionally resets the earlier setting, which also applied
// to the compact chat input. This preference belongs only to full editor surfaces.
export const EDITOR_ZOOM_STORAGE_KEY = profileStorageKey(
  'droneHub.editorZoomLevel.fullEditor',
);

const LEGACY_DIFF_ZOOM_STORAGE_KEY = profileStorageKey('droneHub.changesDiffZoom');
const EDITOR_ZOOM_FACTOR = 1.1;
const listeners = new Set<() => void>();

function readStoredValue(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredLevel(level: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(EDITOR_ZOOM_STORAGE_KEY, String(level));
  } catch {
    // A working editor should not depend on storage being available.
  }
}

export function clampEditorZoomLevel(value: number): number {
  const finiteValue = Number.isFinite(value) ? value : EDITOR_ZOOM_DEFAULT_LEVEL;
  return Math.min(
    EDITOR_ZOOM_MAX_LEVEL,
    Math.max(EDITOR_ZOOM_MIN_LEVEL, Math.round(finiteValue)),
  );
}

export function editorZoomLevelFromLegacyDiffZoom(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return EDITOR_ZOOM_DEFAULT_LEVEL;
  return clampEditorZoomLevel(Math.log(value / 1.1) / Math.log(EDITOR_ZOOM_FACTOR));
}

function readInitialEditorZoomLevel(): number {
  const storedValue = readStoredValue(EDITOR_ZOOM_STORAGE_KEY);
  if (storedValue !== null) {
    const stored = Number(storedValue);
    if (Number.isFinite(stored)) return clampEditorZoomLevel(stored);
  }

  const legacyDiffZoom = Number(readStoredValue(LEGACY_DIFF_ZOOM_STORAGE_KEY));
  return editorZoomLevelFromLegacyDiffZoom(legacyDiffZoom);
}

let editorZoomLevel = readInitialEditorZoomLevel();

export function editorZoomScale(level: number): number {
  return EDITOR_ZOOM_FACTOR ** clampEditorZoomLevel(level);
}

export function editorZoomedPixels(basePixels: number, level: number): number {
  return Math.round(basePixels * editorZoomScale(level) * 10) / 10;
}

export function setEditorZoomLevel(level: number): void {
  const next = clampEditorZoomLevel(level);
  if (next === editorZoomLevel) return;
  editorZoomLevel = next;
  writeStoredLevel(next);
  for (const listener of listeners) listener();
}

export function adjustEditorZoomLevel(direction: -1 | 1): void {
  setEditorZoomLevel(editorZoomLevel + direction);
}

export function resetEditorZoomLevel(): void {
  setEditorZoomLevel(EDITOR_ZOOM_DEFAULT_LEVEL);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getEditorZoomLevel(): number {
  return editorZoomLevel;
}

export function useEditorZoomLevel(): number {
  return React.useSyncExternalStore(subscribe, getEditorZoomLevel, getEditorZoomLevel);
}

function editorZoomSurfaceForTarget(target: EventTarget | null): Element | null {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  return element?.closest('[data-editor-zoom-surface]') ?? null;
}

export function EditorZoomController(): null {
  React.useEffect(() => {
    let accumulatedPixelDelta = 0;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (!editorZoomSurfaceForTarget(event.target) || event.deltaY === 0) return;

      if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
        accumulatedPixelDelta = 0;
        adjustEditorZoomLevel(event.deltaY < 0 ? 1 : -1);
        return;
      }

      if (
        accumulatedPixelDelta !== 0 &&
        Math.sign(accumulatedPixelDelta) !== Math.sign(event.deltaY)
      ) {
        accumulatedPixelDelta = 0;
      }
      accumulatedPixelDelta += event.deltaY;
      if (Math.abs(accumulatedPixelDelta) < 40) return;
      adjustEditorZoomLevel(accumulatedPixelDelta < 0 ? 1 : -1);
      accumulatedPixelDelta = 0;
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== EDITOR_ZOOM_STORAGE_KEY) return;
      const next = clampEditorZoomLevel(Number(event.newValue));
      if (next === editorZoomLevel) return;
      editorZoomLevel = next;
      for (const listener of listeners) listener();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.key !== '0') return;
      if (!editorZoomSurfaceForTarget(event.target)) return;
      event.preventDefault();
      resetEditorZoomLevel();
    };

    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return null;
}
