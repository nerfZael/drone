import { describe, expect, test } from 'bun:test';

import { HUB_AGENT_MODEL_OPTIONS } from '../src/hub/llm-model-catalog';
import {
  COMPANION_TOOL_SUMMARIES,
  DEFAULT_COMPANION_SETTINGS,
  normalizeCompanionSettings,
} from '../src/hub/companion/companion-config';

describe('Companion settings', () => {
  test('offers OpenAI, Codex, and Gemini including Gemini 3.5 Flash-Lite', () => {
    expect([...new Set(HUB_AGENT_MODEL_OPTIONS.map((option) => option.provider))]).toEqual([
      'openai',
      'codex',
      'gemini',
    ]);
    expect(
      HUB_AGENT_MODEL_OPTIONS.filter((option) => option.id === 'gemini-3.5-flash-lite').map(
        (option) => option.thinkingLevel,
      ),
    ).toEqual(['minimal', 'medium', 'high']);
  });

  test('keeps the catalog fixed and limits navigation to opening existing chats', () => {
    const names = COMPANION_TOOL_SUMMARIES.map((tool) => tool.name);
    expect(names).toContain('open_drone_chat');
    expect(names).not.toContain('open_drone');
    expect(names).not.toContain('send_message');
    expect(names).not.toContain('bash');
    expect(DEFAULT_COMPANION_SETTINGS.enabledTools).toEqual(names);
    expect(
      COMPANION_TOOL_SUMMARIES.filter((tool) => tool.execution === 'mcp').map(
        (tool) => tool.name,
      ),
    ).toEqual([
      'list_repos',
      'list_drones',
      'list_chats',
      'read_chat',
      'search_chat_messages',
    ]);
    expect(
      COMPANION_TOOL_SUMMARIES.find((tool) => tool.name === 'apply_composer_patch')?.requires,
    ).toBe('read_active_composer');
    expect(
      COMPANION_TOOL_SUMMARIES.find((tool) => tool.name === 'apply_composer_patch')?.description,
    ).toContain('do not use Markdown fences');
    expect(
      COMPANION_TOOL_SUMMARIES.find((tool) => tool.name === 'open_drone_chat'),
    ).toMatchObject({ execution: 'browser', category: 'actions' });
    expect(
      COMPANION_TOOL_SUMMARIES.find((tool) => tool.name === 'prepare_drone_draft')?.description,
    ).toContain('Repeated calls are additive');
    expect(DEFAULT_COMPANION_SETTINGS.systemPrompt).toContain(
      'Call it once for every draft the user requests',
    );
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
    expect(settings.model).toBe('gemini-3.5-flash-lite');
    expect(settings.thinkingLevel).toBe('minimal');
    expect(settings.enabledTools).toEqual(['get_hub_overview']);
  });

  test('migrates the former default prompt that prohibited chat navigation', () => {
    const settings = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      systemPrompt: [
        'You are Companion, a concise voice-first assistant embedded in Drone Hub.',
        'Use tools to inspect Drone Hub and perform requested UI changes. Do not describe UI actions instead of using tools.',
        'Read a composer or editor target before patching it. Use the target-specific patch tool and retry after rereading when a revision is stale.',
        'Use keyword chat search only when it helps answer the request. Archived chats are unavailable.',
        'You may highlight drones but cannot open or navigate to drones or chats.',
      ].join('\n'),
    });

    expect(settings.systemPrompt).toBe(DEFAULT_COMPANION_SETTINGS.systemPrompt);
    expect(settings.systemPrompt).toContain('Use open_drone_chat');
  });

  test('enables chat navigation for legacy all-tools profiles without overriding new choices', () => {
    const legacyToolNames = COMPANION_TOOL_SUMMARIES
      .map((tool) => tool.name)
      .filter((name) => name !== 'open_drone_chat');
    const migrated = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      schemaVersion: 1,
      enabledTools: legacyToolNames,
    });
    const explicitlyDisabled = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      enabledTools: legacyToolNames,
    });

    expect(migrated.enabledTools).toContain('open_drone_chat');
    expect(explicitlyDisabled.enabledTools).not.toContain('open_drone_chat');
  });
});
