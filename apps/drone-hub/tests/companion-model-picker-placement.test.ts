import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  changeCompanionProvider,
  isCompanionModelSelectionValid,
  type CompanionModelOption,
  type CompanionSettingsDraft,
} from '../src/droneHub/companion/use-companion-settings';

const models: CompanionModelOption[] = [
  { provider: 'openai', id: 'shared', name: 'Shared', thinkingLevel: 'low' },
  { provider: 'codex', id: 'shared', name: 'Shared', thinkingLevel: 'low' },
  { provider: 'gemini', id: 'gemini-only', name: 'Gemini only', thinkingLevel: 'medium' },
];

const draft: CompanionSettingsDraft = {
  schemaVersion: 3,
  provider: 'openai',
  model: 'shared',
  thinkingLevel: 'low',
  systemPrompt: 'Prompt',
  enabledTools: [],
};

describe('Companion model picker placement', () => {
  test('uses an explicit provider control and opens its provider-scoped model picker below', () => {
    const pickerSource = readFileSync(
      new URL('../src/droneHub/chat/ChatComposerModelPicker.tsx', import.meta.url),
      'utf8',
    );
    const companionSource = readFileSync(
      new URL('../src/droneHub/companion/CompanionSettingsTab.tsx', import.meta.url),
      'utf8',
    );

    expect(pickerSource).toContain("menuPlacement = 'above'");
    expect(pickerSource).toContain("menuPlacement === 'below' ? 'top-full mt-[.375rem]'");
    expect(companionSource).toContain('label="Companion provider"');
    expect(companionSource).toContain('options: providerModels');
    expect(companionSource).toContain('requireExplicitModelSelection: true');
    expect(companionSource).toContain('It does not fall back to another provider or model.');
    expect(companionSource).toContain("menuPlacement: 'below'");
  });

  test('preserves an exact model selection across providers but never chooses a fallback model', () => {
    const codex = changeCompanionProvider(models, draft, 'codex');
    expect(codex).toMatchObject({ provider: 'codex', model: 'shared', thinkingLevel: 'low' });
    expect(isCompanionModelSelectionValid(models, codex)).toBe(true);

    const gemini = changeCompanionProvider(models, draft, 'gemini');
    expect(gemini).toMatchObject({ provider: 'gemini', model: '', thinkingLevel: '' });
    expect(isCompanionModelSelectionValid(models, gemini)).toBe(false);
  });
});
