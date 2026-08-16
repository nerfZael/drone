import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('Companion model picker placement', () => {
  test('opens below the settings control without changing the composer default', () => {
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
    expect(companionSource).toContain("menuPlacement: 'below'");
  });
});
