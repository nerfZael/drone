import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('mobile reading density', () => {
  test('persists one normalized display preference', () => {
    const source = readSource('../src/mobile-reading-density.ts');

    expect(source).toContain("value === 'comfortable' ? 'comfortable' : 'default'");
    expect(source).toContain('AsyncStorage.getItem(MOBILE_READING_DENSITY_STORAGE_KEY)');
    expect(source).toContain('AsyncStorage.setItem(MOBILE_READING_DENSITY_STORAGE_KEY, next)');
  });

  test('exposes the preference in Display settings and core reading surfaces', () => {
    const settings = readSource('../src/screens/SettingsScreen.tsx');
    const transcript = readSource('../src/local-assistant/LocalAssistantTranscript.tsx');
    const drawer = readSource('../src/local-assistant/AppDrawer.tsx');

    expect(settings).toContain("{ value: 'display', label: 'Display', icon: Type }");
    expect(settings).toContain('<MobileReadingSettingsCard />');
    expect(transcript).toContain('messageTextComfortable: { fontSize: 16, lineHeight: 24 }');
    expect(drawer).toContain('droneChatLabelComfortable: { fontSize: 15 }');
  });
});
