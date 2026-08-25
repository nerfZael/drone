import { afterEach, describe, expect, test } from 'bun:test';

import {
  ASSISTANT_QUESTION_VIEW_MODE_STORAGE_KEY,
  getAssistantQuestionViewMode,
  setAssistantQuestionViewMode,
} from '../src/droneHub/assistant/assistant-question-view-mode';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
  if (originalLocalStorage === undefined) delete (globalThis as any).localStorage;
  else (globalThis as any).localStorage = originalLocalStorage;
  setAssistantQuestionViewMode('single');
});

describe('assistant question view mode', () => {
  test('persists one shared view mode for questionnaires across chats', () => {
    const storage = new MemoryStorage();
    (globalThis as any).localStorage = storage;

    setAssistantQuestionViewMode('all');

    expect(getAssistantQuestionViewMode()).toBe('all');
    expect(storage.getItem(ASSISTANT_QUESTION_VIEW_MODE_STORAGE_KEY)).toBe('all');
  });
});
