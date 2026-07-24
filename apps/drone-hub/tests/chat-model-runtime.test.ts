import { describe, expect, test } from 'bun:test';
import {
  displayedChatModelTitle,
  formatAgentModelMetadata,
  formatModelDisplayLabel,
  latestTranscriptModel,
  latestTranscriptRuntime,
  resolveDisplayedChatModel,
  resolveDisplayedReasoning,
} from '../src/droneHub/app/chat-model-runtime';
import { buildExternalAgentComposerControls } from '../src/droneHub/app/external-agent-composer-controls';

describe('chat model runtime', () => {
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
    ).toEqual({ label: 'stale-model', source: 'current' });
    expect(resolveDisplayedChatModel(null, [], false)).toEqual({ label: 'Auto', source: 'unknown' });
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
    expect(formatAgentModelMetadata('Codex', { label: 'gpt-test', source: 'transcript' }, 'high')).toBe('Codex (gpt-test high)');
    expect(formatAgentModelMetadata('', { label: 'Auto', source: 'unknown' })).toBe('Not reported (Auto)');
  });

  test('prefers the model recorded on the last agent message', () => {
    const lastModel = latestTranscriptModel([
      { ok: true, model: 'gpt-5.1' },
      { ok: false, model: 'ignored' },
      { ok: true, model: 'gpt-5.2', reasoning: 'xhigh' },
    ]);
    expect(lastModel).toBe('gpt-5.2');
    expect(latestTranscriptRuntime([{ ok: true, model: 'gpt-5.2', reasoning: 'xhigh' }])).toEqual({
      model: 'gpt-5.2',
      reasoning: 'xhigh',
    });
    expect(resolveDisplayedChatModel(null, [], false, true, lastModel)).toEqual({
      label: 'gpt-5.2',
      source: 'transcript',
    });
    expect(displayedChatModelTitle({ label: 'gpt-5.2', source: 'transcript' }, 'xhigh')).toContain('reasoning: xhigh');
  });

  test('shows the last reported reasoning before the catalog default', () => {
    const model = { label: 'gpt-5.2', source: 'default' as const };
    expect(
      resolveDisplayedReasoning(
        null,
        model,
        [{
          id: 'gpt-5.2',
          label: 'GPT-5.2',
          reasoningLevels: ['medium', 'high'],
          defaultReasoningLevel: 'medium',
        }],
        { model: 'gpt-5.2', reasoning: 'high' },
      ),
    ).toBe('high');
  });

  test('builds one detected model and reasoning control with atomic updates', () => {
    const updates: Array<{ model?: string | null; reasoning?: string | null }> = [];
    const config = buildExternalAgentComposerControls({
      hasChats: true,
      modelControlEnabled: true,
      currentAgentKey: 'builtin:codex',
      agentLabel: 'Codex',
      models: [{
        id: 'gpt-5.2',
        label: 'GPT-5.2',
        isDefault: true,
        reasoningLevels: ['medium', 'high'],
        defaultReasoningLevel: 'medium',
      }],
      currentModel: null,
      currentReasoning: null,
      modelDisabled: false,
      loading: false,
      error: null,
      source: 'live',
      stale: false,
      transcripts: [{ ok: true, model: 'gpt-5.2', reasoning: 'high' }],
      onUpdate: (settings) => updates.push(settings),
    });
    const picker = config?.controls.find((control) => control.kind === 'model-picker');
    expect(picker?.triggerLabel).toBe('GPT-5.2 (High)');
    if (!picker || picker.kind !== 'model-picker') throw new Error('model picker missing');
    picker.onSelect(
      { provider: 'external', id: 'gpt-5.2', thinkingLevel: 'medium' },
      'model',
    );
    picker.onSelect({ provider: 'external', id: '' }, 'model');
    expect(updates).toEqual([
      { model: 'gpt-5.2', reasoning: 'medium' },
      { model: null, reasoning: null },
    ]);
  });

  test('does not invent reasoning when the catalog does not report it', () => {
    const updates: Array<{ model?: string | null; reasoning?: string | null }> = [];
    const config = buildExternalAgentComposerControls({
      hasChats: true,
      modelControlEnabled: true,
      currentAgentKey: 'builtin:codex',
      agentLabel: 'Codex',
      models: [{ id: 'gpt-unknown', label: 'GPT Unknown' }],
      currentModel: null,
      currentReasoning: null,
      modelDisabled: false,
      loading: false,
      error: null,
      source: 'live',
      stale: false,
      transcripts: [],
      onUpdate: (settings) => updates.push(settings),
    });
    const picker = config?.controls.find((control) => control.kind === 'model-picker');
    if (!picker || picker.kind !== 'model-picker') throw new Error('model picker missing');
    picker.onSelect({ provider: 'external', id: 'gpt-unknown' }, 'model');
    expect(updates).toEqual([{ model: 'gpt-unknown' }]);
  });

  test('formats raw GPT model ids without exposing internal custom markers', () => {
    expect(formatModelDisplayLabel('gpt-5.6-sol (custom)')).toBe('GPT-5.6 Sol');
    expect(formatModelDisplayLabel('GPT-5.2 Codex')).toBe('GPT-5.2 Codex');
  });
});
