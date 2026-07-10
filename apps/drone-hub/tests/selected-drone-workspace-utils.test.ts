import { describe, expect, test } from 'bun:test';
import {
  displayedChatModelTitle,
  formatAgentModelMetadata,
  resolveDisplayedChatModel,
} from '../src/droneHub/app/selected-drone-workspace-utils';

describe('selected drone workspace model display', () => {
  test('prefers an explicitly configured chat model', () => {
    expect(
      resolveDisplayedChatModel(
        'configured-model',
        [{ id: 'discovered-model', label: 'Discovered', isCurrent: true }],
        false,
      ),
    ).toEqual({ label: 'configured-model', source: 'configured' });
  });

  test('uses the CLI current model before its default model', () => {
    expect(
      resolveDisplayedChatModel(
        null,
        [
          { id: 'default-model', label: 'Default', isDefault: true },
          { id: 'current-model', label: 'Current', isCurrent: true },
        ],
        false,
      ),
    ).toEqual({ label: 'current-model', source: 'current' });
  });

  test('uses the CLI default model when no current model is reported', () => {
    expect(
      resolveDisplayedChatModel(
        null,
        [{ id: 'default-model', label: 'Default', isDefault: true }],
        false,
      ),
    ).toEqual({ label: 'default-model', source: 'default' });
  });

  test('shows detection and unknown fallback states', () => {
    expect(resolveDisplayedChatModel(null, [], true)).toEqual({ label: 'Detecting…', source: 'loading' });
    expect(
      resolveDisplayedChatModel(
        null,
        [{ id: 'stale-model', label: 'Stale', isCurrent: true }],
        true,
      ),
    ).toEqual({ label: 'Detecting…', source: 'loading' });
    expect(resolveDisplayedChatModel(null, [], false)).toEqual({ label: 'Default model', source: 'unknown' });
  });

  test('does not claim a default model for custom agent commands', () => {
    expect(resolveDisplayedChatModel(null, [], false, false)).toEqual({
      label: 'Not reported',
      source: 'unsupported',
    });
  });

  test('explains whether a displayed model was configured or detected', () => {
    expect(displayedChatModelTitle({ label: 'gpt-test', source: 'configured' })).toContain('configured');
    expect(displayedChatModelTitle({ label: 'gpt-test', source: 'default' })).toContain('reported as default');
    expect(displayedChatModelTitle({ label: 'Not reported', source: 'unsupported' })).toContain('not reported');
  });

  test('formats agent and model metadata without field labels', () => {
    expect(formatAgentModelMetadata('Codex', { label: 'gpt-test', source: 'default' })).toBe('Codex (gpt-test)');
    expect(formatAgentModelMetadata('', { label: 'Default model', source: 'unknown' })).toBe('Not reported (Default model)');
  });
});
