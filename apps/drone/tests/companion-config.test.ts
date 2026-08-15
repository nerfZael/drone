import { describe, expect, test } from 'bun:test';

import {
  COMPANION_TOOL_SUMMARIES,
  DEFAULT_COMPANION_SETTINGS,
  normalizeCompanionSettings,
} from '../src/hub/companion/companion-config';

describe('Companion settings', () => {
  test('keeps the catalog fixed and excludes navigation tools', () => {
    const names = COMPANION_TOOL_SUMMARIES.map((tool) => tool.name);
    expect(names).not.toContain('open_drone_chat');
    expect(names).not.toContain('send_message');
    expect(names).not.toContain('bash');
    expect(DEFAULT_COMPANION_SETTINGS.enabledTools).toEqual(names);
  });

  test('adds the matching read dependency for enabled patch tools', () => {
    const settings = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      enabledTools: ['apply_composer_patch', 'apply_editor_patch'],
    });
    expect(settings.enabledTools).toEqual([
      'read_active_composer',
      'apply_composer_patch',
      'read_open_file',
      'apply_editor_patch',
    ]);
  });

  test('drops unknown tools and falls back to a supported model combination', () => {
    const settings = normalizeCompanionSettings({
      provider: 'gemini',
      model: 'not-a-model',
      thinkingLevel: 'xhigh',
      systemPrompt: 'Custom',
      enabledTools: ['get_hub_overview', 'not_a_tool'],
    });
    expect(settings.provider).toBe('gemini');
    expect(settings.model).toBe('gemini-3-flash-preview');
    expect(settings.enabledTools).toEqual(['get_hub_overview']);
  });
});
