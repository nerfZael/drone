import React from 'react';
import { profileStorageKey } from '../../profile-storage';

/**
 * Where a Markdown preview puts its reading column. Centred suits a wide or
 * full-screen panel; left keeps the text where the editor has it, so switching
 * between edit and preview does not move the eye.
 */
export type MarkdownPreviewAlignment = 'center' | 'left';

export const MARKDOWN_PREVIEW_ALIGNMENT_STORAGE_KEY = profileStorageKey(
  'droneHub.markdownPreviewAlignment',
);

const DEFAULT_MARKDOWN_PREVIEW_ALIGNMENT: MarkdownPreviewAlignment = 'center';
const listeners = new Set<() => void>();

export function normalizeMarkdownPreviewAlignment(value: unknown): MarkdownPreviewAlignment {
  return value === 'left' ? 'left' : DEFAULT_MARKDOWN_PREVIEW_ALIGNMENT;
}

function readStoredAlignment(): MarkdownPreviewAlignment {
  if (typeof localStorage === 'undefined') return DEFAULT_MARKDOWN_PREVIEW_ALIGNMENT;
  try {
    return normalizeMarkdownPreviewAlignment(
      localStorage.getItem(MARKDOWN_PREVIEW_ALIGNMENT_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_MARKDOWN_PREVIEW_ALIGNMENT;
  }
}

let alignment = readStoredAlignment();

export function getMarkdownPreviewAlignment(): MarkdownPreviewAlignment {
  return alignment;
}

export function setMarkdownPreviewAlignment(next: MarkdownPreviewAlignment): void {
  const normalized = normalizeMarkdownPreviewAlignment(next);
  if (normalized === alignment) return;
  alignment = normalized;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MARKDOWN_PREVIEW_ALIGNMENT_STORAGE_KEY, normalized);
    } catch {
      // The preview still re-aligns for this session when storage is unavailable.
    }
  }
  for (const listener of listeners) listener();
}

export function toggleMarkdownPreviewAlignment(): void {
  setMarkdownPreviewAlignment(alignment === 'left' ? 'center' : 'left');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMarkdownPreviewAlignment(): MarkdownPreviewAlignment {
  return React.useSyncExternalStore(
    subscribe,
    getMarkdownPreviewAlignment,
    getMarkdownPreviewAlignment,
  );
}
