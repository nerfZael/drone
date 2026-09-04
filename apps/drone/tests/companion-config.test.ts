import { describe, expect, test } from 'bun:test';

import { HUB_AGENT_MODEL_OPTIONS } from '../src/hub/llm-model-catalog';
import {
  COMPANION_TOOL_SUMMARIES,
  DEFAULT_COMPANION_SETTINGS,
  companionSettingsEqual,
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
      'list_agent_models',
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
      COMPANION_TOOL_SUMMARIES.find((tool) => tool.name === 'apply_companion_proposal_patch'),
    ).toMatchObject({ requires: 'read_companion_proposal', execution: 'browser' });
    expect(
      COMPANION_TOOL_SUMMARIES.find((tool) => tool.name === 'read_companion_proposal')?.description,
    ).toContain('delete_drone and send_message');
    expect(
      COMPANION_TOOL_SUMMARIES.find((tool) => tool.name === 'apply_companion_proposal_patch')?.description,
    ).toContain('deleting drones and sending or queueing chat messages');
    expect(DEFAULT_COMPANION_SETTINGS.systemPrompt).toContain(
      'one editable proposal',
    );
    expect(DEFAULT_COMPANION_SETTINGS.systemPrompt).toContain('Use list_agent_models');
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

  test('drops unknown tools without changing an explicit supported model combination', () => {
    const settings = normalizeCompanionSettings({
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      thinkingLevel: 'high',
      systemPrompt: 'Custom',
      enabledTools: ['get_hub_overview', 'not_a_tool'],
    });
    expect(settings.provider).toBe('gemini');
    expect(settings.model).toBe('gemini-3.5-flash-lite');
    expect(settings.thinkingLevel).toBe('high');
    expect(settings.enabledTools).toEqual(['get_hub_overview']);
  });

  test('does not fall back from missing or unsupported provider and model selections', () => {
    expect(normalizeCompanionSettings()).toEqual(DEFAULT_COMPANION_SETTINGS);
    expect(() => normalizeCompanionSettings(null)).toThrow('Companion settings must be an object');
    expect(() => normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      enabledTools: null,
    })).toThrow('Companion enabledTools must be an array of tool names');
    expect(() => normalizeCompanionSettings({
      model: DEFAULT_COMPANION_SETTINGS.model,
      thinkingLevel: DEFAULT_COMPANION_SETTINGS.thinkingLevel,
    })).toThrow('Companion provider must be openai, codex, or gemini');
    expect(() => normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      provider: 'gemini',
      model: 'not-a-model',
      thinkingLevel: 'xhigh',
    })).toThrow('Companion model selection is not supported');
  });

  test('detects every settings change that requires refreshing an active Companion session', () => {
    expect(companionSettingsEqual(DEFAULT_COMPANION_SETTINGS, DEFAULT_COMPANION_SETTINGS)).toBe(true);
    expect(companionSettingsEqual(DEFAULT_COMPANION_SETTINGS, {
      ...DEFAULT_COMPANION_SETTINGS,
      provider: 'openai',
    })).toBe(false);
    expect(companionSettingsEqual(DEFAULT_COMPANION_SETTINGS, {
      ...DEFAULT_COMPANION_SETTINGS,
      enabledTools: DEFAULT_COMPANION_SETTINGS.enabledTools.slice(1),
    })).toBe(false);
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

  test('migrates the schema-v3 default prompt to model discovery instructions', () => {
    const previousSchemaV3Prompt = DEFAULT_COMPANION_SETTINGS.systemPrompt
      .split('\n')
      .filter((line) =>
        !line.startsWith('Use list_agent_models') &&
        !line.startsWith('Use list_chats to inspect'),
      )
      .join('\n');
    const settings = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      schemaVersion: 3,
      systemPrompt: previousSchemaV3Prompt,
    });

    expect(settings.systemPrompt).toBe(DEFAULT_COMPANION_SETTINGS.systemPrompt);
    expect(settings.systemPrompt).toContain('Use list_agent_models');
  });

  test('enables proposal editing and chat navigation for legacy all-tools profiles without overriding new choices', () => {
    const legacyToolNames = COMPANION_TOOL_SUMMARIES
      .map((tool) => tool.name)
      .filter((name) =>
        name !== 'open_drone_chat' &&
        name !== 'list_groups' &&
        name !== 'list_agent_models' &&
        name !== 'read_companion_proposal' &&
        name !== 'apply_companion_proposal_patch',
      );
    const migrated = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      schemaVersion: 1,
      enabledTools: [...legacyToolNames, 'prepare_drone_draft'],
    });
    const migratedWithoutDraftPermission = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      schemaVersion: 1,
      enabledTools: legacyToolNames,
    });
    const explicitlyDisabled = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      enabledTools: legacyToolNames,
    });

    expect(migrated.enabledTools).toContain('open_drone_chat');
    expect(migrated.enabledTools).toContain('list_groups');
    expect(migrated.enabledTools).toContain('list_agent_models');
    expect(migrated.enabledTools).toContain('read_companion_proposal');
    expect(migrated.enabledTools).toContain('apply_companion_proposal_patch');
    expect(migratedWithoutDraftPermission.enabledTools).toContain('open_drone_chat');
    expect(migratedWithoutDraftPermission.enabledTools).not.toContain('read_companion_proposal');
    expect(explicitlyDisabled.enabledTools).not.toContain('open_drone_chat');
    expect(explicitlyDisabled.enabledTools).not.toContain('read_companion_proposal');
  });

  test('adds model discovery only to schema-v3 default profiles', () => {
    const schemaV3Defaults = COMPANION_TOOL_SUMMARIES
      .map((tool) => tool.name)
      .filter((name) => name !== 'list_agent_models');
    const migratedDefault = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      schemaVersion: 3,
      enabledTools: schemaV3Defaults,
    });
    const migratedCustomized = normalizeCompanionSettings({
      ...DEFAULT_COMPANION_SETTINGS,
      schemaVersion: 3,
      enabledTools: schemaV3Defaults.filter((name) => name !== 'list_groups'),
    });

    expect(migratedDefault.enabledTools).toContain('list_agent_models');
    expect(migratedCustomized.enabledTools).not.toContain('list_agent_models');
    expect(migratedCustomized.enabledTools).not.toContain('list_groups');
  });
});
